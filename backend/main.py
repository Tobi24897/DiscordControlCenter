"""DiscordChannelCrawler — FastAPI app: REST API, SSE stream, static frontend serving."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
import webbrowser
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Make sibling backend modules importable regardless of how Python is launched —
# notably the bundled portable Python in the shareable build, whose ._pth does
# not add the script's directory to sys.path.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
import db
import nitter_client
import poller
import rss_client
from session_presence import attach_fastapi, inject_presence_script
from broadcaster import Broadcaster, sse_stream
from discord_client import (
    DiscordAuthError,
    DiscordClient,
    DiscordForbiddenError,
    DiscordHTTPError,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("crawler")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    broadcaster = Broadcaster()
    stop_event = asyncio.Event()
    poller_task: asyncio.Task | None = None
    validate_task: asyncio.Task | None = None

    app.state.broadcaster = broadcaster
    app.state.stop_event = stop_event
    app.state.discord_user = None

    # app.state.client is the single source of truth and can be hot-swapped at
    # runtime (token import/paste) without a restart; the poller reads it live.
    app.state.client = DiscordClient(config.DISCORD_TOKEN) if config.DISCORD_TOKEN else None

    if app.state.client is not None:
        broadcaster.token_status = "unknown"

        async def _validate_token() -> None:
            try:
                me = await app.state.client.get_me()
                broadcaster.token_status = "valid"
                app.state.discord_user = me.get("global_name") or me.get("username")
                logger.info("Discord token OK — logged in as %s", app.state.discord_user)
            except DiscordAuthError:
                broadcaster.token_status = "invalid"
                broadcaster.publish("auth_error", {"detail": "Discord token rejected"})
                logger.error("DISCORD_TOKEN is invalid")
            except Exception as exc:  # noqa: BLE001
                logger.warning("token validation inconclusive: %s", exc)

        validate_task = asyncio.create_task(_validate_token())
    else:
        broadcaster.token_status = "unset"
        logger.warning("No DISCORD_TOKEN yet — import or paste one in Settings")

    poller_task = asyncio.create_task(
        run_poller_wrapper(lambda: app.state.client, broadcaster, stop_event)
    )
    yield

    stop_event.set()
    for task in (validate_task, poller_task):
        if task is None:
            continue
        try:
            await asyncio.wait_for(task, timeout=5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            task.cancel()
    if app.state.client is not None:
        await app.state.client.aclose()


async def run_poller_wrapper(get_client, broadcaster: Broadcaster, stop_event: asyncio.Event) -> None:
    try:
        await poller.run_poller(get_client, broadcaster, stop_event)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("poller crashed")


app = FastAPI(title="DiscordChannelCrawler", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Tab-close failsafe: register the presence route NOW (before the catch-all SPA
# route below would swallow it). The watchdog is armed later, in __main__.
_presence_wd = attach_fastapi(app, start=False)


# --- models -------------------------------------------------------------------

class SettingsPatch(BaseModel):
    poll_interval: int | None = Field(default=None, ge=5, le=600)
    sound_enabled: bool | None = None
    notify_keywords: list[str] | None = None
    notify_only_unfocused: bool | None = None
    lookback_days: int | None = Field(default=None, ge=1, le=90)
    nitter_instance: str | None = None
    nitter_fallbacks: list[str] | None = None


class ChannelPatch(BaseModel):
    tracked: bool | None = None
    notify: bool | None = None
    notify_keywords_only: bool | None = None


class ColumnOrder(BaseModel):
    ordered_ids: list[str]


class ReadBody(BaseModel):
    message_id: str | None = None


class TokenBody(BaseModel):
    token: str


class SendBody(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    reply_to: str | None = None


class OpenDmBody(BaseModel):
    user_id: str


class NitterProfileBody(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    instance: str | None = None


class NewsFeedBody(BaseModel):
    url: str = Field(min_length=4, max_length=500)
    name: str | None = None


# --- helpers ------------------------------------------------------------------

def _settings_payload() -> dict[str, Any]:
    return {
        "poll_interval": db.get_state("poll_interval", config.POLL_INTERVAL_DEFAULT),
        "sound_enabled": db.get_state("sound_enabled", True),
        "notify_keywords": db.get_state("notify_keywords", ["$", "BTO", "entry"]),
        "notify_only_unfocused": db.get_state("notify_only_unfocused", True),
        "lookback_days": db.get_state("lookback_days", config.LOOKBACK_DAYS_DEFAULT),
        "nitter_instance": db.get_state("nitter_instance", config.NITTER_INSTANCE_DEFAULT),
        "nitter_fallbacks": db.get_state("nitter_fallbacks", config.NITTER_FALLBACK_INSTANCES),
        "token_status": app.state.broadcaster.token_status,
        "discord_user": app.state.discord_user,
    }


def _unread_payload() -> dict[str, int]:
    return {str(k): v for k, v in db.unread_counts().items()}


def _require_client() -> DiscordClient:
    client: DiscordClient | None = app.state.client
    if client is None:
        raise HTTPException(status_code=400, detail="No DISCORD_TOKEN configured")
    return client


def _attachment_url_expired(url: str) -> bool:
    """Discord CDN URLs carry an `ex` hex-unix-seconds expiry param."""
    try:
        ex = parse_qs(urlparse(url).query).get("ex", [None])[0]
        if not ex:
            return False
        return int(ex, 16) <= int(time.time()) + 60
    except (ValueError, TypeError):
        return False


# --- routes -------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, Any]:
    n_tracked = len(db.get_channels(tracked_only=True))
    return {
        "status": "ok",
        "token_status": app.state.broadcaster.token_status,
        "discord_user": app.state.discord_user,
        "tracked_channels": n_tracked,
        "effective_min_cycle_s": round(n_tracked * config.REQUEST_SPACING_SECONDS, 1),
        "poller": poller.last_cycle_stats,
        "message_count": db.message_count(),
        "nitter_instance_active": nitter_client.active_instance(),
    }


@app.get("/api/settings")
async def get_settings() -> dict[str, Any]:
    return _settings_payload()


@app.put("/api/settings")
async def put_settings(patch: SettingsPatch) -> dict[str, Any]:
    for key, value in patch.model_dump(exclude_none=True).items():
        if key == "notify_keywords":
            value = [kw.strip() for kw in value if kw.strip()]
        elif key == "nitter_instance":
            value = value.strip().rstrip("/") or config.NITTER_INSTANCE_DEFAULT
        elif key == "nitter_fallbacks":
            cleaned: list[str] = []
            for v in value:
                v = (v or "").strip().rstrip("/")
                if v and v not in cleaned:
                    cleaned.append(v)
            value = cleaned
        db.set_state(key, value)
    return _settings_payload()


@app.post("/api/discovery/refresh")
async def discovery_refresh() -> list[dict[str, Any]]:
    client = _require_client()
    broadcaster: Broadcaster = app.state.broadcaster
    try:
        guilds = await client.get_guilds()
        db.upsert_guilds(guilds)
        for g in guilds:
            try:
                channels = await client.get_guild_channels(int(g["id"]))
            except DiscordForbiddenError:
                logger.warning("no channel access for guild %s — skipping", g.get("name"))
                continue
            db.upsert_channels(int(g["id"]), channels)
        broadcaster.token_status = "valid"
    except DiscordAuthError:
        broadcaster.token_status = "invalid"
        raise HTTPException(status_code=401, detail="Discord token rejected")
    except DiscordHTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return db.get_guild_tree()


@app.get("/api/guilds")
async def get_guilds() -> list[dict[str, Any]]:
    return db.get_guild_tree()


@app.put("/api/channels/order")
async def put_channel_order(body: ColumnOrder) -> dict[str, Any]:
    db.set_column_order([int(cid) for cid in body.ordered_ids])
    return {"ok": True}


@app.put("/api/channels/{channel_id}")
async def put_channel(channel_id: str, patch: ChannelPatch) -> dict[str, Any]:
    channel = db.get_channel(int(channel_id))
    if channel is None:
        raise HTTPException(status_code=404, detail="Unknown channel")
    updated = db.set_channel_settings(int(channel_id), **patch.model_dump(exclude_none=True))
    assert updated is not None
    return updated.to_api(db.unread_counts().get(updated.id, 0))


@app.get("/api/messages")
async def get_messages(
    channels: str | None = None,
    search: str | None = None,
    before: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict[str, Any]]:
    channel_ids = None
    if channels:
        try:
            channel_ids = [int(c) for c in channels.split(",") if c.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid channels parameter")
    before_id = None
    if before:
        try:
            before_id = int(before)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid before parameter")
    return db.query_messages(
        channel_ids=channel_ids, search=search, before_id=before_id, limit=limit
    )


@app.post("/api/channels/{channel_id}/read")
async def post_mark_read(channel_id: str, body: ReadBody | None = None) -> dict[str, Any]:
    message_id = int(body.message_id) if body and body.message_id else None
    db.mark_read(int(channel_id), message_id)
    return {"unread": _unread_payload()}


@app.post("/api/read-all")
async def post_read_all() -> dict[str, Any]:
    db.mark_all_read()
    return {"unread": _unread_payload()}


@app.get("/api/unread")
async def get_unread() -> dict[str, int]:
    return _unread_payload()


@app.get("/api/sse")
async def sse() -> StreamingResponse:
    broadcaster: Broadcaster = app.state.broadcaster
    hello = {
        "token_status": broadcaster.token_status,
        "unread": _unread_payload(),
        "server_time": db.utcnow(),
    }
    return StreamingResponse(
        sse_stream(broadcaster, hello),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _discord_resized(url: str, width: int) -> str:
    """Rewrite a Discord CDN image URL to the media proxy at a capped size.

    The browser decodes images at their SOURCE resolution (CSS max-height does
    not help), so full-res chart screenshots cost ~3-8 MB of RAM each. Routing
    them through media.discordapp.net with width/height caps the decode size and
    cuts memory ~10-20x. The signed params (ex/is/hm) are preserved verbatim.
    """
    host = urlparse(url).netloc
    if host not in ("cdn.discordapp.com", "media.discordapp.net"):
        return url  # external image — can't resize
    url = url.replace("cdn.discordapp.com", "media.discordapp.net")
    if "width=" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}width={width}&height={width}"


@app.get("/api/attachments/{message_id}/{index}")
async def get_attachment(message_id: str, index: int, w: int = 0) -> RedirectResponse:
    msg = db.get_message(int(message_id))
    if msg is None:
        raise HTTPException(status_code=404, detail="Unknown message")
    attachments = json.loads(msg.attachments or "[]")
    if index < 0 or index >= len(attachments):
        raise HTTPException(status_code=404, detail="Unknown attachment")
    attachment = attachments[index]
    url = attachment.get("url")
    if not url:
        raise HTTPException(status_code=404, detail="Attachment has no URL")

    client: DiscordClient | None = app.state.client
    if client is not None and _attachment_url_expired(url):
        try:
            refreshed = await client.refresh_attachment_urls([url])
            new_url = refreshed.get(url)
            if new_url:
                attachment["url"] = new_url
                db.update_message_attachments(msg.id, json.dumps(attachments, ensure_ascii=False))
                url = new_url
        except Exception as exc:  # noqa: BLE001 — fall back to the stale URL
            logger.warning("attachment refresh failed: %s", exc)

    # w>0 requests a size-capped thumbnail (used by the inline <img>); the link
    # to open the file in a new tab omits w to get the full-resolution original.
    if w and (attachment.get("content_type") or "").startswith("image/"):
        url = _discord_resized(url, min(max(w, 16), 1024))
    return RedirectResponse(url, status_code=302)


# --- auth: hot-swappable token (import from local app / paste) ------------------

async def _apply_token(token: str) -> dict[str, Any]:
    """Validate a token, hot-swap the live client, and persist it to .env."""
    token = (token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Empty token")

    candidate = DiscordClient(token)
    try:
        me = await candidate.get_me()
    except DiscordAuthError:
        await candidate.aclose()
        raise HTTPException(status_code=401, detail="Token rejected by Discord")
    except Exception as exc:  # noqa: BLE001
        await candidate.aclose()
        raise HTTPException(status_code=502, detail=f"Could not validate token: {exc}")

    old = app.state.client
    app.state.client = candidate
    app.state.discord_user = me.get("global_name") or me.get("username")
    broadcaster: Broadcaster = app.state.broadcaster
    broadcaster.token_status = "valid"
    if old is not None:
        await old.aclose()

    try:  # persist so it survives restarts; never logged
        from dotenv import set_key

        set_key(str(config.ENV_PATH), "DISCORD_TOKEN", token)
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not persist token to .env: %s", exc)

    broadcaster.publish("poll_status", {"token_status": "valid"})
    logger.info("token updated — logged in as %s", app.state.discord_user)
    return {"token_status": "valid", "discord_user": app.state.discord_user}


@app.post("/api/auth/token")
async def post_auth_token(body: TokenBody) -> dict[str, Any]:
    return await _apply_token(body.token)


@app.post("/api/auth/import-local")
async def post_auth_import_local() -> dict[str, Any]:
    """Read the token from the local Discord desktop app (Windows, DPAPI)."""
    from local_token import LocalTokenError, read_local_discord_token

    try:
        token = read_local_discord_token()
    except LocalTokenError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Could not read a token from the local Discord app: {exc}",
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Local import failed: {exc}")
    return await _apply_token(token)


# --- direct messages ------------------------------------------------------------

def _raw_msg_to_api(m: dict[str, Any]) -> dict[str, Any]:
    """Map a raw Discord message (live DM fetch) to the frontend Message shape."""
    author = m.get("author") or {}
    ref = m.get("referenced_message") or {}
    return {
        "id": str(m["id"]),
        "channel_id": str(m.get("channel_id") or ""),
        "guild_id": "",
        "author_id": str(author.get("id") or 0),
        "author_name": author.get("global_name") or author.get("username") or "unknown",
        "author_avatar": author.get("avatar"),
        "content": poller._resolve_mentions(m.get("content") or "", m.get("mentions"), {}),
        "timestamp": m.get("timestamp") or "",
        "edited_timestamp": m.get("edited_timestamp"),
        "attachments": [poller._trim_attachment(a) for a in m.get("attachments") or []],
        "embeds": [poller._trim_embed(e) for e in m.get("embeds") or []],
        "referenced_message_id": str(ref["id"]) if ref.get("id") else None,
        "message_type": m.get("type") or 0,
        "channel_name": None,
        "guild_name": None,
    }


def _user_to_api(u: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(u.get("id") or 0),
        "username": u.get("username"),
        "global_name": u.get("global_name"),
        "avatar": u.get("avatar"),
    }


def _dm_to_api(c: dict[str, Any]) -> dict[str, Any]:
    recipients = [_user_to_api(r) for r in c.get("recipients") or []]
    return {
        "id": str(c["id"]),
        "type": c.get("type"),
        "is_group": c.get("type") == 3,
        "name": c.get("name"),
        "icon": c.get("icon"),
        "last_message_id": str(c["last_message_id"]) if c.get("last_message_id") else None,
        "recipients": recipients,
    }


@app.get("/api/dms")
async def get_dms() -> list[dict[str, Any]]:
    client = _require_client()
    try:
        channels = await client.get_dm_channels()
    except DiscordAuthError:
        raise HTTPException(status_code=401, detail="Discord token rejected")
    except DiscordHTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    # newest conversations first
    channels.sort(key=lambda c: int(c.get("last_message_id") or 0), reverse=True)
    return [_dm_to_api(c) for c in channels]


@app.get("/api/friends")
async def get_friends() -> list[dict[str, Any]]:
    client = _require_client()
    try:
        rels = await client.get_relationships()
    except DiscordAuthError:
        raise HTTPException(status_code=401, detail="Discord token rejected")
    except DiscordHTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    out = []
    for r in rels:
        user = r.get("user") or {}
        out.append({"type": r.get("type"), "user": _user_to_api(user)})
    return out


@app.get("/api/dms/{channel_id}/messages")
async def get_dm_messages(channel_id: str, before: str | None = None) -> list[dict[str, Any]]:
    client = _require_client()
    before_id = int(before) if before else None
    try:
        msgs = await client.get_messages(int(channel_id), before=before_id, limit=50)
    except DiscordForbiddenError:
        raise HTTPException(status_code=403, detail="No access to this DM")
    except DiscordAuthError:
        raise HTTPException(status_code=401, detail="Discord token rejected")
    except DiscordHTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    # newest first, like the channel feed
    return [_raw_msg_to_api(m) for m in sorted(msgs, key=lambda m: int(m["id"]), reverse=True)]


@app.post("/api/dms/{channel_id}/messages")
async def post_dm_message(
    channel_id: str,
    content: str = Form(""),
    reply_to: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
) -> dict[str, Any]:
    client = _require_client()
    file_tuples: list[tuple[str, bytes, str]] = []
    for f in files:
        data = await f.read()
        if data:
            file_tuples.append(
                (f.filename or "file", data, f.content_type or "application/octet-stream")
            )
    if not content.strip() and not file_tuples:
        raise HTTPException(status_code=400, detail="Empty message")
    try:
        created = await client.send_message(
            int(channel_id),
            content,
            int(reply_to) if reply_to else None,
            files=file_tuples or None,
        )
    except DiscordForbiddenError:
        raise HTTPException(status_code=403, detail="Cannot send to this conversation")
    except DiscordAuthError:
        raise HTTPException(status_code=401, detail="Discord token rejected")
    except DiscordHTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return _raw_msg_to_api(created)


@app.post("/api/dms/open")
async def post_open_dm(body: OpenDmBody) -> dict[str, Any]:
    client = _require_client()
    try:
        channel = await client.open_dm(int(body.user_id))
    except DiscordAuthError:
        raise HTTPException(status_code=401, detail="Discord token rejected")
    except DiscordHTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return _dm_to_api(channel)


# --- Nitter (Twitter/X mirror) profiles ----------------------------------------

def _normalize_handle(raw: str) -> str:
    s = raw.strip()
    m = re.search(r"(?:twitter\.com|x\.com|nitter[^/\s]*)/(@?[A-Za-z0-9_]{1,15})", s)
    if m:
        return m.group(1).lstrip("@")
    return s.lstrip("@").strip("/").split("/")[-1]


@app.get("/api/nitter/profiles")
async def get_nitter_profiles() -> list[dict[str, Any]]:
    unread = db.unread_counts()
    return [c.to_api(unread.get(c.id, 0)) for c in db.get_channels() if c.source == "nitter"]


@app.post("/api/nitter/profiles")
async def add_nitter_profile(body: NitterProfileBody) -> dict[str, Any]:
    username = _normalize_handle(body.username)
    if not username:
        raise HTTPException(status_code=400, detail="Empty username")
    if db.get_nitter_channel_by_username(username) is not None:
        raise HTTPException(status_code=409, detail=f"@{username} is already added")
    primary = (
        body.instance or db.get_state("nitter_instance", config.NITTER_INSTANCE_DEFAULT)
    ).rstrip("/")
    fallbacks = db.get_state("nitter_fallbacks", config.NITTER_FALLBACK_INSTANCES) or []
    try:
        profile, items, _used = await nitter_client.fetch_profile_failover(
            username, [primary, *fallbacks], timeout=config.NITTER_FAILOVER_TIMEOUT
        )
    except nitter_client.NitterError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    channel = db.add_nitter_profile(username, profile.get("display_name") or username, primary)
    # Ingest the items we already fetched so the column has content immediately.
    rows = [poller.nitter_item_to_row(it, channel, profile) for it in items]
    db.insert_messages(rows)
    cursor = max((r["id"] for r in rows), default=0)
    if cursor:
        db.set_channel_cursor(channel.id, cursor)
        db.mark_read(channel.id, cursor)
    app.state.broadcaster.publish(
        "channel_backfilled", {"channel_id": str(channel.id), "count": len(rows)}
    )
    return channel.to_api(0)


@app.delete("/api/nitter/profiles/{channel_id}")
async def delete_nitter_profile(channel_id: str) -> dict[str, Any]:
    channel = db.get_channel(int(channel_id))
    if channel is None or channel.source != "nitter":
        raise HTTPException(status_code=404, detail="Unknown Nitter profile")
    db.delete_channel(int(channel_id))
    return {"ok": True}


# --- News (generic RSS) feeds --------------------------------------------------

@app.get("/api/news/presets")
async def get_news_presets() -> list[dict[str, Any]]:
    return config.NEWS_PRESETS


@app.get("/api/news/feeds")
async def get_news_feeds() -> list[dict[str, Any]]:
    unread = db.unread_counts()
    return [c.to_api(unread.get(c.id, 0)) for c in db.get_channels() if c.source == "rss"]


@app.post("/api/news/feeds")
async def add_news_feed(body: NewsFeedBody) -> dict[str, Any]:
    url = body.url.strip()
    if not url.lower().startswith("http"):
        raise HTTPException(status_code=400, detail="Enter a full feed URL (http…)")
    if db.get_rss_channel_by_url(url) is not None:
        raise HTTPException(status_code=409, detail="That feed is already added")
    try:
        meta, items = await rss_client.fetch_feed(url)
    except rss_client.RssError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    channel = db.add_rss_feed(body.name or meta.get("title") or url, url)
    rows = [poller.rss_item_to_row(it, channel, meta) for it in items]
    db.insert_messages(rows)
    cursor = max((r["id"] for r in rows), default=0)
    if cursor:
        db.set_channel_cursor(channel.id, cursor)
        db.mark_read(channel.id, cursor)
    app.state.broadcaster.publish(
        "channel_backfilled", {"channel_id": str(channel.id), "count": len(rows)}
    )
    return channel.to_api(0)


@app.delete("/api/news/feeds/{channel_id}")
async def delete_news_feed(channel_id: str) -> dict[str, Any]:
    channel = db.get_channel(int(channel_id))
    if channel is None or channel.source != "rss":
        raise HTTPException(status_code=404, detail="Unknown news feed")
    db.delete_channel(int(channel_id))
    return {"ok": True}


# --- static frontend (PortfolioManager pattern) --------------------------------

if config.FRONTEND_DIR.exists():
    logger.info("Serving frontend from %s", config.FRONTEND_DIR)

    _assets_dir = config.FRONTEND_DIR / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="static-assets")

    @app.get("/{path:path}")
    async def serve_frontend(path: str):
        """Serve SPA — API routes above take priority."""
        resolved = (config.FRONTEND_DIR / path).resolve()
        if (
            path
            and str(resolved).startswith(str(config.FRONTEND_DIR.resolve()))
            and resolved.is_file()
            and resolved.name != "index.html"
        ):
            return FileResponse(str(resolved), headers={"Cache-Control": "no-store"})
        # index.html (root, SPA deep-links, explicit /index.html): inject the
        # tab-close presence script server-side so it survives `npm run build`.
        index_html = (config.FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
        return HTMLResponse(inject_presence_script(index_html), headers={"Cache-Control": "no-store"})

else:
    logger.warning(
        "No frontend build found at %s — run 'npm run build' in frontend/", config.FRONTEND_DIR
    )


def _open_browser_when_ready(port: int) -> None:
    import urllib.request

    deadline = time.time() + 20
    url = f"http://127.0.0.1:{port}/api/health"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1):
                break
        except Exception:  # noqa: BLE001
            time.sleep(0.4)
    webbrowser.open(f"http://127.0.0.1:{port}")


if __name__ == "__main__":
    import uvicorn

    if not config.NO_BROWSER:
        threading.Thread(
            target=_open_browser_when_ready, args=(config.SERVER_PORT,), daemon=True
        ).start()
    # Tab-close failsafe: arm the watchdog now that we're actually serving.
    _presence_wd.start()
    uvicorn.run(app, host="127.0.0.1", port=config.SERVER_PORT, log_level="info")
