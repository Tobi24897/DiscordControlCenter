"""Configuration: .env loading, paths, constants, snowflake helpers."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


DISCORD_TOKEN: str = os.getenv("DISCORD_TOKEN", "").strip()
SERVER_PORT: int = int(os.getenv("SERVER_PORT", "8020"))
POLL_INTERVAL_DEFAULT: int = int(os.getenv("POLL_INTERVAL", "15"))
NO_BROWSER: bool = _env_bool("NO_BROWSER")

DATA_DIR: Path = PROJECT_ROOT / "data"
# DB path can be overridden (e.g. a throwaway DB for testing) without touching
# the live database.
_db_override = os.getenv("DCC_DB", "").strip()
DB_PATH: Path = Path(_db_override) if _db_override else DATA_DIR / "crawler.db"
FRONTEND_DIR: Path = PROJECT_ROOT / "frontend" / "dist"

ENV_PATH: Path = PROJECT_ROOT / ".env"

DISCORD_API_BASE = "https://discord.com/api/v10"
REQUEST_SPACING_SECONDS = 0.4  # serial pacing between Discord requests
RETRY_BACKOFF_BASE_SECONDS = 1.0
BACKFILL_LIMIT = 100
MAX_PAGES_PER_CYCLE = 3  # flooded channels catch up across cycles
INACCESSIBLE_RETRY_CYCLES = 40  # re-probe lost channels every ~10 min at 15s interval
LOOKBACK_DAYS_DEFAULT = 7  # how much channel history to backfill / keep
MAX_BACKFILL_PAGES = 15  # cap backfill (15 x 100 msgs) so a busy channel can't stall
PRUNE_EVERY_CYCLES = 20  # delete messages older than the lookback window periodically

# --- Nitter (Twitter/X mirror) source ---------------------------------------
NITTER_INSTANCE_DEFAULT = "https://nitter.net"
# Free public instances tried (in order) when the primary one is down. Public
# instances come and go — failover keeps X columns alive without any paid API.
NITTER_FALLBACK_INSTANCES = [
    "https://nitter.net",
    "https://nitter.poast.org",
    "https://xcancel.com",
    "https://lightbrd.com",
    "https://nitter.privacyredirect.com",
    "https://nitter.tiekoetter.com",
    "https://nitter.space",
]
NITTER_GUILD_ID = 1  # synthetic guild grouping all Nitter profiles (real Discord ids are snowflakes)
NITTER_GUILD_NAME = "Nitter / X"
NITTER_MIN_INTERVAL = 90  # gentle on public instances (they 429 under load) — once per profile / 90s
NITTER_FAILOVER_TIMEOUT = 8.0  # shorter per-instance timeout while scanning for a live one

# --- News (generic RSS) source ----------------------------------------------
NEWS_GUILD_ID = 2  # synthetic guild grouping all news feeds
NEWS_GUILD_NAME = "News"
NEWS_MIN_INTERVAL = 120  # refresh each news feed at most every 2 min
# Verified free, reputable macro/markets feeds (incl. Bloomberg/Reuters via the
# free Google News bridge, since those killed their direct public RSS).
NEWS_PRESETS = [
    {"name": "WSJ — Markets", "url": "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"},
    {"name": "WSJ — World", "url": "https://feeds.a.dj.com/rss/RSSWorldNews.xml"},
    {"name": "WSJ — Business", "url": "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml"},
    {"name": "CNBC — Top News", "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"},
    {"name": "CNBC — Markets", "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"},
    {"name": "CNBC — Finance", "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664"},
    {"name": "MarketWatch — Top Stories", "url": "http://feeds.marketwatch.com/marketwatch/topstories/"},
    {"name": "MarketWatch — Real-time", "url": "http://feeds.marketwatch.com/marketwatch/realtimeheadlines/"},
    {"name": "Financial Times — Home", "url": "https://www.ft.com/rss/home"},
    {"name": "Financial Times — World", "url": "https://www.ft.com/world?format=rss"},
    {"name": "BBC — Business", "url": "https://feeds.bbci.co.uk/news/business/rss.xml"},
    {"name": "Yahoo Finance", "url": "https://finance.yahoo.com/news/rssindex"},
    {"name": "Nasdaq — Markets", "url": "https://www.nasdaq.com/feed/rssoutbound?category=Markets"},
    {"name": "Investing.com — News", "url": "https://www.investing.com/rss/news.rss"},
    {"name": "Bloomberg (via Google News)", "url": "https://news.google.com/rss/search?q=Bloomberg+markets+when:1d&hl=en-US&gl=US&ceid=US:en"},
    {"name": "Reuters (via Google News)", "url": "https://news.google.com/rss/search?q=Reuters+markets+when:1d&hl=en-US&gl=US&ceid=US:en"},
    {"name": "Business — Google News", "url": "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en"},
]

DISCORD_EPOCH_MS = 1_420_070_400_000


def snowflake_to_dt(snowflake: int) -> datetime:
    ms = (snowflake >> 22) + DISCORD_EPOCH_MS
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def dt_to_snowflake(dt: datetime) -> int:
    ms = int(dt.timestamp() * 1000) - DISCORD_EPOCH_MS
    return max(ms, 0) << 22
