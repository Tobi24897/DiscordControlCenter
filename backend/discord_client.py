"""Minimal Discord REST client (user token) with serial pacing + rate-limit handling."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

import config

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

MAX_RATE_LIMIT_RETRIES = 4
MAX_TRANSIENT_RETRIES = 3


class DiscordAuthError(Exception):
    """Token rejected — do not retry, surface to the UI."""


class DiscordForbiddenError(Exception):
    """403/404 on a resource — access lost, skip the channel."""


class DiscordHTTPError(Exception):
    """Other HTTP/network failure after retries."""


class DiscordClient:
    def __init__(self, token: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(
            base_url=config.DISCORD_API_BASE,
            headers={"Authorization": token, "User-Agent": USER_AGENT},
            timeout=15.0,
            transport=transport,
        )
        # Lazily created inside the running event loop (L-ASYNC-02).
        self._lock: asyncio.Lock | None = None

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
        data: dict[str, Any] | None = None,
        files: list | None = None,
    ) -> Any:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            # Pacing runs on success AND error paths (L-LLM-05).
            try:
                return await self._request_with_retries(method, path, params, json_body, data, files)
            finally:
                await asyncio.sleep(config.REQUEST_SPACING_SECONDS)

    async def _request_with_retries(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None,
        json_body: Any,
        data: dict[str, Any] | None = None,
        files: list | None = None,
    ) -> Any:
        rate_limit_hits = 0
        transient_failures = 0
        backoff = config.RETRY_BACKOFF_BASE_SECONDS
        while True:
            try:
                if files is not None:
                    resp = await self._client.request(method, path, params=params, data=data, files=files)
                else:
                    resp = await self._client.request(method, path, params=params, json=json_body)
            except httpx.HTTPError as exc:
                transient_failures += 1
                if transient_failures > MAX_TRANSIENT_RETRIES:
                    raise DiscordHTTPError(f"network error on {method} {path}: {exc}") from exc
                await asyncio.sleep(backoff)
                backoff *= 2
                continue

            status = resp.status_code
            logger.debug("%s %s -> %s", method, path, status)

            if status == 401:
                raise DiscordAuthError("Discord token rejected (401)")
            if status in (403, 404):
                raise DiscordForbiddenError(f"{status} on {path}")
            if status == 429:
                rate_limit_hits += 1
                if rate_limit_hits > MAX_RATE_LIMIT_RETRIES:
                    raise DiscordHTTPError(f"persistent 429 on {path}")
                retry_after = _retry_after_seconds(resp)
                logger.warning("rate limited on %s — sleeping %.2fs", path, retry_after)
                await asyncio.sleep(retry_after)
                continue
            if status >= 500:
                transient_failures += 1
                if transient_failures > MAX_TRANSIENT_RETRIES:
                    raise DiscordHTTPError(f"{status} on {path} after retries")
                await asyncio.sleep(backoff)
                backoff *= 2
                continue
            if status >= 400:
                raise DiscordHTTPError(f"{status} on {path}: {resp.text[:200]}")

            # Proactive: if the bucket is exhausted, wait it out before the next call.
            if resp.headers.get("X-RateLimit-Remaining") == "0":
                try:
                    reset_after = float(resp.headers.get("X-RateLimit-Reset-After", "0"))
                except ValueError:
                    reset_after = 0.0
                if reset_after > 0:
                    await asyncio.sleep(min(reset_after, 30.0))

            if status == 204 or not resp.content:
                return None
            return resp.json()

    # --- public API ------------------------------------------------------------

    async def get_me(self) -> dict[str, Any]:
        try:
            return await self._request("GET", "/users/@me")
        except DiscordForbiddenError as exc:  # 403 on @me is an auth problem
            raise DiscordAuthError(str(exc)) from exc

    async def get_guilds(self) -> list[dict[str, Any]]:
        guilds: list[dict[str, Any]] = []
        after: str | None = None
        while True:
            params: dict[str, Any] = {"limit": 200}
            if after:
                params["after"] = after
            page = await self._request("GET", "/users/@me/guilds", params=params) or []
            guilds.extend(page)
            if len(page) < 200:
                break
            after = page[-1]["id"]
        return guilds

    async def get_guild_channels(self, guild_id: int) -> list[dict[str, Any]]:
        channels = await self._request("GET", f"/guilds/{guild_id}/channels") or []
        # text (0) + announcement (5) channels only; threads/forums out of scope
        return [c for c in channels if c.get("type") in (0, 5)]

    async def get_messages(
        self,
        channel_id: int,
        after: int | None = None,
        before: int | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit}
        if after:
            params["after"] = str(after)
        elif before:
            params["before"] = str(before)
        msgs = await self._request("GET", f"/channels/{channel_id}/messages", params=params) or []
        # Never trust response ordering — sort ascending by snowflake.
        return sorted(msgs, key=lambda m: int(m["id"]))

    async def refresh_attachment_urls(self, urls: list[str]) -> dict[str, str]:
        """Re-sign expired CDN attachment URLs. Returns {original: refreshed}."""
        data = await self._request(
            "POST", "/attachments/refresh-urls", json_body={"attachment_urls": urls}
        )
        out: dict[str, str] = {}
        for item in (data or {}).get("refreshed_urls", []):
            original, refreshed = item.get("original"), item.get("refreshed")
            if original and refreshed:
                out[original] = refreshed
        return out

    # --- direct messages / friends -------------------------------------------

    async def get_dm_channels(self) -> list[dict[str, Any]]:
        """1:1 DMs (type 1) and group DMs (type 3)."""
        channels = await self._request("GET", "/users/@me/channels") or []
        return [c for c in channels if c.get("type") in (1, 3)]

    async def get_relationships(self) -> list[dict[str, Any]]:
        """Friends list etc. (type 1 = friend, 3 = incoming, 4 = outgoing request)."""
        return await self._request("GET", "/users/@me/relationships") or []

    async def open_dm(self, recipient_id: int) -> dict[str, Any]:
        """Open (or fetch) the 1:1 DM channel with a user."""
        return await self._request(
            "POST", "/users/@me/channels", json_body={"recipient_id": str(recipient_id)}
        )

    async def send_message(
        self,
        channel_id: int,
        content: str,
        reply_to: int | None = None,
        files: list[tuple[str, bytes, str]] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"content": content}
        if reply_to:
            body["message_reference"] = {"message_id": str(reply_to)}
        path = f"/channels/{channel_id}/messages"
        if files:
            # Multipart: payload_json + files[n] parts (Discord attachment upload).
            multipart = [
                (f"files[{i}]", (name, data, ctype)) for i, (name, data, ctype) in enumerate(files)
            ]
            return await self._request(
                "POST", path, data={"payload_json": json.dumps(body)}, files=multipart
            )
        return await self._request("POST", path, json_body=body)


def _retry_after_seconds(resp: httpx.Response) -> float:
    try:
        body = resp.json()
        if isinstance(body, dict) and "retry_after" in body:
            return min(float(body["retry_after"]), 60.0)
    except Exception:  # noqa: BLE001 — fall through to header
        pass
    try:
        return min(float(resp.headers.get("Retry-After", "1")), 60.0)
    except ValueError:
        return 1.0
