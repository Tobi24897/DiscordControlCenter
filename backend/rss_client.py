"""Fetch + parse a generic news RSS/Atom feed (feedparser) into message rows.

Reputable outlets (WSJ, FT, CNBC, MarketWatch, BBC, …) publish free RSS; Bloomberg
and Reuters are reachable via the free Google News bridge. Each entry becomes a
message so a news feed renders as a dashboard column like a Discord channel.
"""

from __future__ import annotations

import calendar
import html
import logging
import re
from datetime import datetime, timezone
from typing import Any

import feedparser
import httpx

logger = logging.getLogger(__name__)

_TAG_RE = re.compile(r"<[^>]+>")
_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.IGNORECASE)
_IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif")
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


class RssError(Exception):
    """The feed could not be fetched or parsed."""


def _strip_html(s: str) -> str:
    return html.unescape(_TAG_RE.sub("", s or "")).strip()


def _looks_image(url: str) -> bool:
    return any(url.lower().split("?")[0].endswith(ext) for ext in _IMG_EXT)


def _first_image(entry: dict[str, Any]) -> str | None:
    for mc in entry.get("media_content") or []:
        url = mc.get("url")
        if url and (str(mc.get("type", "")).startswith("image") or _looks_image(url)):
            return url
    for mt in entry.get("media_thumbnail") or []:
        if mt.get("url"):
            return mt["url"]
    for enc in entry.get("enclosures") or []:
        href = enc.get("href")
        if href and (str(enc.get("type", "")).startswith("image") or _looks_image(href)):
            return href
    for ln in entry.get("links") or []:
        href = ln.get("href")
        if ln.get("rel") == "enclosure" and href and (
            str(ln.get("type", "")).startswith("image") or _looks_image(href)
        ):
            return href
    m = _IMG_RE.search(entry.get("summary") or "")
    return m.group(1) if m else None


def _entry_dt(entry: dict[str, Any]) -> datetime:
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            return datetime.fromtimestamp(calendar.timegm(t), tz=timezone.utc)
    return datetime.now(timezone.utc)


def parse_feed(raw: bytes, url: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    parsed = feedparser.parse(raw)
    if parsed.get("bozo") and not parsed.get("entries"):
        raise RssError("not a valid RSS/Atom feed")
    feed = parsed.get("feed", {})
    meta = {
        "title": (feed.get("title") or url).strip(),
        "image": (feed.get("image") or {}).get("href") or feed.get("icon") or feed.get("logo"),
    }
    items: list[dict[str, Any]] = []
    for e in parsed.get("entries", [])[:40]:
        title = html.unescape(e.get("title") or "").strip()
        summary = _strip_html(e.get("summary") or "")
        if summary and summary != title:
            text = f"{title}\n{summary}" if title else summary
        else:
            text = title
        dt = _entry_dt(e)
        items.append(
            {
                "guid": e.get("id") or e.get("link") or title,
                "text": text.strip(),
                "dt": dt,
                "timestamp": dt.isoformat(),
                "image": _first_image(e),
                "link": e.get("link"),
                "author": e.get("author") or meta["title"],
            }
        )
    return meta, items


async def fetch_feed(
    url: str, client: httpx.AsyncClient | None = None, timeout: float = 12.0
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    own = client is None
    c = client or httpx.AsyncClient(timeout=timeout, headers={"User-Agent": _UA}, follow_redirects=True)
    try:
        resp = await c.get(url)
    except httpx.HTTPError as exc:
        raise RssError(f"could not reach feed ({exc})")
    finally:
        if own:
            await c.aclose()
    if resp.status_code != 200:
        raise RssError(f"feed returned {resp.status_code}")
    return parse_feed(resp.content, url)
