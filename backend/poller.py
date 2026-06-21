"""Background poll loop: incremental message ingestion for all tracked channels."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import config
import db
import nitter_client
import rss_client
from broadcaster import Broadcaster
from discord_client import (
    DiscordAuthError,
    DiscordClient,
    DiscordForbiddenError,
    DiscordHTTPError,
)

logger = logging.getLogger(__name__)

# Exposed for /api/health (L-DBG-01: observable stage counters).
last_cycle_stats: dict[str, Any] = {}

_CHANNEL_MENTION_RE = re.compile(r"<#(\d+)>")
_ROLE_MENTION_RE = re.compile(r"<@&\d+>")


def _trim_attachment(a: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "filename", "size", "content_type", "url", "width", "height")
    return {k: a.get(k) for k in keys if a.get(k) is not None}


def _trim_embed(e: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("title", "description", "url", "color", "timestamp"):
        if e.get(key) is not None:
            out[key] = e[key]
    if isinstance(e.get("author"), dict) and e["author"].get("name"):
        out["author"] = {"name": e["author"]["name"]}
    if isinstance(e.get("footer"), dict) and e["footer"].get("text"):
        out["footer"] = {"text": e["footer"]["text"]}
    for media in ("image", "thumbnail"):
        if isinstance(e.get(media), dict) and e[media].get("url"):
            out[media] = {"url": e[media]["url"]}
    if isinstance(e.get("fields"), list):
        out["fields"] = [
            {"name": f.get("name", ""), "value": f.get("value", "")}
            for f in e["fields"][:25]
            if isinstance(f, dict)
        ]
    return out


def _resolve_mentions(
    content: str, mentions: list[dict[str, Any]] | None, channel_names: dict[int, str]
) -> str:
    """Rewrite mention tokens to readable text at ingest (searchable, no client lookups)."""
    for m in mentions or []:
        try:
            name = m.get("global_name") or m.get("username") or "user"
            content = content.replace(f"<@{m['id']}>", f"@{name}")
            content = content.replace(f"<@!{m['id']}>", f"@{name}")
        except (KeyError, TypeError):
            continue
    content = _CHANNEL_MENTION_RE.sub(
        lambda mt: f"#{channel_names.get(int(mt.group(1)), 'channel')}", content
    )
    content = _ROLE_MENTION_RE.sub("@role", content)
    return content


def message_to_row(
    msg: dict[str, Any], channel: db.Channel, channel_names: dict[int, str]
) -> dict[str, Any]:
    author = msg.get("author") or {}
    referenced = msg.get("referenced_message") or {}
    return {
        "id": int(msg["id"]),
        "channel_id": channel.id,
        "guild_id": channel.guild_id,
        "author_id": int(author.get("id") or 0),
        "author_name": author.get("global_name") or author.get("username") or "unknown",
        "author_avatar": author.get("avatar"),
        "content": _resolve_mentions(msg.get("content") or "", msg.get("mentions"), channel_names),
        "timestamp": msg.get("timestamp") or "",
        "edited_timestamp": msg.get("edited_timestamp"),
        "attachments": json.dumps(
            [_trim_attachment(a) for a in msg.get("attachments") or []], ensure_ascii=False
        ),
        "embeds": json.dumps(
            [_trim_embed(e) for e in msg.get("embeds") or []], ensure_ascii=False
        ),
        "referenced_message_id": int(referenced["id"]) if referenced.get("id") else None,
        "message_type": msg.get("type") or 0,
        "ingested_at": db.utcnow(),
    }


def _lookback_cutoff_id() -> int:
    days = int(db.get_state("lookback_days", config.LOOKBACK_DAYS_DEFAULT))
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(days, 1))
    return config.dt_to_snowflake(cutoff)


async def _backfill_channel(
    client: DiscordClient,
    broadcaster: Broadcaster,
    channel: db.Channel,
    channel_names: dict[int, str],
    cutoff_id: int,
) -> None:
    """First track: page backward until the lookback cutoff (or the page cap)."""
    before: int | None = None
    newest: int | None = None
    total_new = 0
    for _ in range(config.MAX_BACKFILL_PAGES):
        msgs = await client.get_messages(channel.id, before=before, limit=100)
        if not msgs:
            break
        ids = [int(m["id"]) for m in msgs]
        if newest is None:
            newest = max(ids)
        rows = [message_to_row(m, channel, channel_names) for m in msgs]
        total_new += len(db.insert_messages(rows))
        oldest = min(ids)
        before = oldest
        if oldest <= cutoff_id or len(msgs) < 100:
            break
    cursor = newest if newest is not None else config.dt_to_snowflake(datetime.now(timezone.utc))
    db.set_channel_cursor(channel.id, cursor)
    db.mark_read(channel.id, cursor)  # backfill is not "unread", no notifications
    broadcaster.publish("channel_backfilled", {"channel_id": str(channel.id), "count": total_new})
    logger.info("backfilled #%s with %d messages (lookback)", channel.name, total_new)


async def _poll_channel(
    client: DiscordClient,
    broadcaster: Broadcaster,
    channel: db.Channel,
    channel_names: dict[int, str],
    guild_names: dict[int, str],
) -> int:
    """Incremental poll of one channel; returns the number of new messages."""
    guild_name = guild_names.get(channel.guild_id)
    new_total = 0
    cursor = channel.last_message_id
    for _ in range(config.MAX_PAGES_PER_CYCLE):
        msgs = await client.get_messages(channel.id, after=cursor)
        if not msgs:
            break
        rows = [message_to_row(m, channel, channel_names) for m in msgs]
        new = db.insert_messages(rows)
        cursor = max(int(m["id"]) for m in msgs)  # advance even if all duplicates
        db.set_channel_cursor(channel.id, cursor)
        for message in new:
            broadcaster.publish(
                "message", message.to_api(channel_name=channel.name, guild_name=guild_name)
            )
        new_total += len(new)
        if len(msgs) < 100:
            break
    return new_total


# --- Nitter (Twitter/X mirror) source ----------------------------------------

_nitter_last_fetch: dict[int, float] = {}


def _nitter_synthetic_id(dt: datetime, status_id: int) -> int:
    """Discord-epoch snowflake from the tweet time so Nitter + Discord messages
    sort chronologically together; low bits from the status id keep it unique."""
    return config.dt_to_snowflake(dt) | (int(status_id) & 0x3FFFFF)


def nitter_item_to_row(
    item: dict[str, Any], channel: db.Channel, profile: dict[str, Any]
) -> dict[str, Any]:
    attachments = [
        {"filename": f"image{i}.jpg", "url": url, "content_type": "image/jpeg"}
        for i, url in enumerate(item.get("images") or [])
    ]
    return {
        "id": _nitter_synthetic_id(item["dt"], item["status_id"]),
        "channel_id": channel.id,
        "guild_id": channel.guild_id,
        "author_id": 0,
        "author_name": profile.get("display_name") or channel.name,
        "author_avatar": profile.get("avatar_url"),  # http url — used directly by the UI
        "content": item.get("text") or "",
        "timestamp": item["timestamp"],
        "edited_timestamp": None,
        "attachments": json.dumps(attachments, ensure_ascii=False),
        "embeds": "[]",
        "referenced_message_id": None,
        "message_type": 0,
        "permalink": item.get("permalink"),
        "ingested_at": db.utcnow(),
    }


async def _poll_nitter(broadcaster: Broadcaster, channel: db.Channel) -> int:
    first_time = channel.last_message_id is None
    now = time.monotonic()
    if not first_time and now - _nitter_last_fetch.get(channel.id, 0.0) < config.NITTER_MIN_INTERVAL:
        return 0  # be gentle on the public instance
    primary = channel.nitter_instance or db.get_state(
        "nitter_instance", config.NITTER_INSTANCE_DEFAULT
    )
    fallbacks = db.get_state("nitter_fallbacks", config.NITTER_FALLBACK_INSTANCES) or []
    username = channel.nitter_username or channel.name
    try:
        profile, items, _used = await nitter_client.fetch_profile_failover(
            username, [primary, *fallbacks], timeout=config.NITTER_FAILOVER_TIMEOUT
        )
    except nitter_client.NitterError as exc:
        _nitter_last_fetch[channel.id] = now
        raise DiscordHTTPError(f"nitter @{username}: {exc}")
    _nitter_last_fetch[channel.id] = now

    rows = [nitter_item_to_row(it, channel, profile) for it in items]
    new = db.insert_messages(rows)
    cursor = max((r["id"] for r in rows), default=channel.last_message_id or 0)
    db.set_channel_cursor(channel.id, cursor)
    if first_time:
        db.mark_read(channel.id, cursor)
        broadcaster.publish("channel_backfilled", {"channel_id": str(channel.id), "count": len(new)})
        return 0
    for message in new:
        broadcaster.publish(
            "message",
            message.to_api(channel_name=channel.name, guild_name=config.NITTER_GUILD_NAME, source="nitter"),
        )
    return len(new)


# --- News (generic RSS) source -----------------------------------------------

_rss_last_fetch: dict[int, float] = {}


def _rss_synthetic_id(dt: datetime, guid: str) -> int:
    h = int(hashlib.md5(guid.encode("utf-8")).hexdigest()[:8], 16) & 0x3FFFFF
    return config.dt_to_snowflake(dt) | h


def rss_item_to_row(
    item: dict[str, Any], channel: db.Channel, meta: dict[str, Any]
) -> dict[str, Any]:
    attachments = []
    if item.get("image"):
        attachments = [{"filename": "image.jpg", "url": item["image"], "content_type": "image/jpeg"}]
    guid = str(item.get("guid") or item.get("link") or (item.get("text") or "")[:40])
    return {
        "id": _rss_synthetic_id(item["dt"], guid),
        "channel_id": channel.id,
        "guild_id": channel.guild_id,
        "author_id": 0,
        "author_name": item.get("author") or meta.get("title") or channel.name,
        "author_avatar": meta.get("image"),  # feed logo (http) — used directly by the UI
        "content": item.get("text") or "",
        "timestamp": item["timestamp"],
        "edited_timestamp": None,
        "attachments": json.dumps(attachments, ensure_ascii=False),
        "embeds": "[]",
        "referenced_message_id": None,
        "message_type": 0,
        "permalink": item.get("link"),
        "ingested_at": db.utcnow(),
    }


async def _poll_rss(broadcaster: Broadcaster, channel: db.Channel) -> int:
    first_time = channel.last_message_id is None
    now = time.monotonic()
    if not first_time and now - _rss_last_fetch.get(channel.id, 0.0) < config.NEWS_MIN_INTERVAL:
        return 0
    if not channel.feed_url:
        return 0
    try:
        meta, items = await rss_client.fetch_feed(channel.feed_url)
    except rss_client.RssError as exc:
        _rss_last_fetch[channel.id] = now
        raise DiscordHTTPError(f"news {channel.name}: {exc}")
    _rss_last_fetch[channel.id] = now

    rows = [rss_item_to_row(it, channel, meta) for it in items]
    new = db.insert_messages(rows)
    cursor = max((r["id"] for r in rows), default=channel.last_message_id or 0)
    db.set_channel_cursor(channel.id, cursor)
    if first_time:
        db.mark_read(channel.id, cursor)
        broadcaster.publish("channel_backfilled", {"channel_id": str(channel.id), "count": len(new)})
        return 0
    for message in new:
        broadcaster.publish(
            "message",
            message.to_api(channel_name=channel.name, guild_name=config.NEWS_GUILD_NAME, source="rss"),
        )
    return len(new)


async def run_poller(
    get_client: Callable[[], DiscordClient | None],
    broadcaster: Broadcaster,
    stop_event: asyncio.Event,
) -> None:
    global last_cycle_stats
    cycle = 0
    logger.info("poller started")
    while not stop_event.is_set():
        cycle += 1
        interval = int(db.get_state("poll_interval", config.POLL_INTERVAL_DEFAULT))
        client = get_client()
        stats: dict[str, Any] = {
            "ts": db.utcnow(),
            "cycle": cycle,
            "channels_polled": 0,
            "channels_skipped": 0,
            "new_messages": 0,
            "errors": 0,
        }

        # Re-validate a previously-rejected token (Discord only).
        if client is not None and broadcaster.token_status == "invalid":
            try:
                await client.get_me()
                broadcaster.token_status = "valid"
                logger.info("token valid again — resuming polling")
            except DiscordAuthError:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.warning("token re-validation inconclusive: %s", exc)

        discord_ok = client is not None and broadcaster.token_status != "invalid"
        cutoff_id = _lookback_cutoff_id()
        try:
            channels = db.get_channels(tracked_only=True)
            channel_names = db.get_channel_names()
            guild_names = db.get_guild_names()
        except Exception:  # noqa: BLE001
            channels, channel_names, guild_names = [], {}, {}

        for channel in channels:
            if stop_event.is_set():
                break
            try:
                # Nitter / news poll independently of the Discord token.
                if channel.source == "nitter":
                    stats["new_messages"] += await _poll_nitter(broadcaster, channel)
                    stats["channels_polled"] += 1
                    continue
                if channel.source == "rss":
                    stats["new_messages"] += await _poll_rss(broadcaster, channel)
                    stats["channels_polled"] += 1
                    continue
                if not discord_ok:
                    stats["channels_skipped"] += 1
                    continue
                if not channel.accessible and cycle % config.INACCESSIBLE_RETRY_CYCLES != 0:
                    stats["channels_skipped"] += 1
                    continue
                if channel.last_message_id is None:
                    await _backfill_channel(client, broadcaster, channel, channel_names, cutoff_id)
                else:
                    stats["new_messages"] += await _poll_channel(
                        client, broadcaster, channel, channel_names, guild_names
                    )
                stats["channels_polled"] += 1
                if not channel.accessible:
                    db.set_channel_accessible(channel.id, True)
            except DiscordForbiddenError:
                db.set_channel_accessible(channel.id, False)
                broadcaster.publish("channel_inaccessible", {"channel_id": str(channel.id)})
                stats["errors"] += 1
                logger.warning("lost access to #%s — skipping", channel.name)
            except DiscordAuthError:
                broadcaster.token_status = "invalid"
                broadcaster.publish("auth_error", {"detail": "Discord token rejected"})
                discord_ok = False
                logger.error("Discord token rejected — polling paused, re-validating every 60s")
            except DiscordHTTPError as exc:
                stats["errors"] += 1
                logger.warning("poll error on %s: %s", channel.name, exc)
            except Exception:  # noqa: BLE001 — one bad channel must not kill the loop
                stats["errors"] += 1
                logger.exception("unexpected poller error on %s", channel.name)

        # Retention: drop messages older than the lookback window.
        if cycle % config.PRUNE_EVERY_CYCLES == 0:
            try:
                pruned = db.prune_messages_before(cutoff_id)
                if pruned:
                    logger.info("pruned %d messages older than lookback", pruned)
            except Exception:  # noqa: BLE001
                logger.exception("prune failed")

        last_cycle_stats = stats
        broadcaster.publish("poll_status", {**stats, "token_status": broadcaster.token_status})
        if stats["new_messages"] or stats["errors"]:
            logger.info(
                "cycle %d: polled=%d skipped=%d new=%d errors=%d",
                cycle,
                stats["channels_polled"],
                stats["channels_skipped"],
                stats["new_messages"],
                stats["errors"],
            )

        wait = 60 if broadcaster.token_status == "invalid" else max(interval, 5)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=wait)
        except asyncio.TimeoutError:
            pass
    logger.info("poller stopped")
