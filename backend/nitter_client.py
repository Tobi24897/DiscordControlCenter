"""Fetch + parse a Nitter (Twitter/X mirror) profile RSS feed.

Nitter exposes a standard RSS 2.0 feed at `<instance>/<user>/rss`. We turn each
<item> (tweet) into the same message shape the Discord poller produces, so Nitter
profiles render in the dashboard exactly like channel columns.
"""

from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

_DC = "{http://purl.org/dc/elements/1.1/}"
_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


class NitterError(Exception):
    """The Nitter instance/profile could not be fetched or parsed."""


# The instance that last served a feed successfully — tried first next time so
# we don't re-scan dead instances every cycle.
_working_instance: str | None = None


def active_instance() -> str | None:
    return _working_instance


def _absolute(instance: str, url: str | None) -> str | None:
    if not url:
        return None
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return instance.rstrip("/") + url
    return url


def _text_from_description(desc: str) -> str:
    # Strip ALL HTML tags (incl. whole <img …/> tags), decode entities, collapse
    # blank lines. (Images are extracted separately from the raw description.)
    text = html.unescape(_TAG_RE.sub("", desc))
    lines = [ln.rstrip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln.strip()).strip()


def _parse(instance: str, username: str, xml_text: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as exc:
        raise NitterError(f"feed is not valid RSS ({exc})")
    channel = root.find("channel")
    if channel is None:
        raise NitterError("no <channel> in feed (instance down or wrong path)")

    image = channel.find("image")
    raw_title = (channel.findtext("title") or username).strip()
    display_name = raw_title.split(" / ")[0].strip() or username
    avatar = _absolute(instance, image.findtext("url") if image is not None else None)

    profile = {"username": username, "display_name": display_name, "avatar_url": avatar}

    items: list[dict[str, Any]] = []
    for it in channel.findall("item"):
        status_id = (it.findtext("guid") or "").strip()
        if not status_id.isdigit():
            # fall back to the id embedded in the status link
            m = re.search(r"/status/(\d+)", it.findtext("link") or "")
            if not m:
                continue
            status_id = m.group(1)
        pub = it.findtext("pubDate")
        try:
            dt = parsedate_to_datetime(pub) if pub else datetime.now(timezone.utc)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            dt = datetime.now(timezone.utc)
        desc = it.findtext("description") or ""
        text = _text_from_description(desc) or html.unescape(it.findtext("title") or "")
        images = [_absolute(instance, u) for u in _IMG_RE.findall(desc)]
        creator = (it.findtext(f"{_DC}creator") or f"@{username}").lstrip("@")
        items.append(
            {
                "status_id": int(status_id),
                "text": text,
                "dt": dt,
                "timestamp": dt.isoformat(),
                "images": [u for u in images if u],
                "author": creator,
                "permalink": f"https://x.com/{creator}/status/{status_id}",
            }
        )
    return profile, items


async def fetch_profile(
    instance: str, username: str, client: httpx.AsyncClient | None = None
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return (profile, items) for a Nitter profile, newest items first as given."""
    instance = (instance or "").strip().rstrip("/")
    username = username.strip().lstrip("@")
    url = f"{instance}/{username}/rss"
    own = client is None
    c = client or httpx.AsyncClient(timeout=12, headers={"User-Agent": _UA}, follow_redirects=True)
    try:
        resp = await c.get(url)
    except httpx.HTTPError as exc:
        raise NitterError(f"could not reach {instance} ({exc})")
    finally:
        if own:
            await c.aclose()
    if resp.status_code == 404:
        raise NitterError(f"@{username} not found on {instance}")
    if resp.status_code != 200 or "xml" not in (resp.headers.get("content-type", "")):
        raise NitterError(
            f"{instance} returned {resp.status_code} (instance down or rate-limited)"
        )
    return _parse(instance, username, resp.text)


async def fetch_profile_failover(
    username: str, instances: list[str], timeout: float = 8.0
) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    """Try each instance in order (last working one first) until one serves the
    feed. Returns (profile, items, used_instance). Raises if all instances fail."""
    global _working_instance
    order: list[str] = []
    for inst in [_working_instance, *instances]:
        norm = (inst or "").strip().rstrip("/")
        if norm and norm not in order:
            order.append(norm)
    if not order:
        raise NitterError("no Nitter instance configured")

    last: NitterError | None = None
    async with httpx.AsyncClient(
        timeout=timeout, headers={"User-Agent": _UA}, follow_redirects=True
    ) as client:
        for inst in order:
            try:
                profile, items = await fetch_profile(inst, username, client=client)
                _working_instance = inst
                return profile, items, inst
            except NitterError as exc:
                last = exc
                # Keep a healthy-but-busy instance cached: a missing user (404) or a
                # rate-limit (429) doesn't mean the instance is dead.
                msg = str(exc).lower()
                transient = "not found" in msg or "429" in msg or "rate-limit" in msg
                if _working_instance == inst and not transient:
                    _working_instance = None
    raise NitterError(str(last) if last else "all Nitter instances failed")
