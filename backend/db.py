"""SQLite persistence layer. Single shared connection + write lock (chat-scale volumes)."""

from __future__ import annotations

import dataclasses
import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config

_conn: sqlite3.Connection | None = None
_lock = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS guilds (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id                    INTEGER PRIMARY KEY,
  guild_id              INTEGER NOT NULL REFERENCES guilds(id),
  name                  TEXT NOT NULL,
  topic                 TEXT,
  position              INTEGER,
  tracked               INTEGER NOT NULL DEFAULT 0,
  notify                INTEGER NOT NULL DEFAULT 1,
  notify_keywords_only  INTEGER NOT NULL DEFAULT 0,
  column_order          INTEGER,
  last_message_id       INTEGER,
  last_read_message_id  INTEGER,
  accessible            INTEGER NOT NULL DEFAULT 1,
  source                TEXT NOT NULL DEFAULT 'discord',
  nitter_username       TEXT,
  nitter_instance       TEXT,
  feed_url              TEXT,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id                     INTEGER PRIMARY KEY,
  channel_id             INTEGER NOT NULL REFERENCES channels(id),
  guild_id               INTEGER NOT NULL,
  author_id              INTEGER NOT NULL,
  author_name            TEXT NOT NULL,
  author_avatar          TEXT,
  content                TEXT NOT NULL DEFAULT '',
  timestamp              TEXT NOT NULL,
  edited_timestamp       TEXT,
  attachments            TEXT NOT NULL DEFAULT '[]',
  embeds                 TEXT NOT NULL DEFAULT '[]',
  referenced_message_id  INTEGER,
  message_type           INTEGER NOT NULL DEFAULT 0,
  permalink              TEXT,
  ingested_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id DESC);

CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""

DEFAULT_STATE: dict[str, Any] = {
    "sound_enabled": True,
    "notify_keywords": ["$", "BTO", "entry"],
    "notify_only_unfocused": True,
    "lookback_days": config.LOOKBACK_DAYS_DEFAULT,
    "nitter_instance": config.NITTER_INSTANCE_DEFAULT,
    "nitter_fallbacks": config.NITTER_FALLBACK_INSTANCES,
}


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_column(conn: sqlite3.Connection, table: str, col: str, decl: str) -> None:
    existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    if col not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def init_db(db_path: str | Path | None = None) -> None:
    """(Re)open the database and ensure schema + state defaults exist."""
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None
    target = str(db_path) if db_path is not None else str(config.DB_PATH)
    if target != ":memory:":
        Path(target).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(_SCHEMA)
    # Migrations: add columns to pre-existing databases (CREATE has them already).
    _ensure_column(conn, "channels", "source", "TEXT NOT NULL DEFAULT 'discord'")
    _ensure_column(conn, "channels", "nitter_username", "TEXT")
    _ensure_column(conn, "channels", "nitter_instance", "TEXT")
    _ensure_column(conn, "channels", "feed_url", "TEXT")
    _ensure_column(conn, "messages", "permalink", "TEXT")
    defaults = dict(DEFAULT_STATE)
    defaults["poll_interval"] = config.POLL_INTERVAL_DEFAULT
    for key, value in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO app_state (key, value) VALUES (?, ?)",
            (key, json.dumps(value)),
        )
    conn.commit()
    _conn = conn


def _db() -> sqlite3.Connection:
    if _conn is None:
        init_db()
    return _conn  # type: ignore[return-value]


def _known_fields(cls: type) -> set[str]:
    return {f.name for f in dataclasses.fields(cls)}


@dataclass
class Guild:
    id: int
    name: str
    icon: str | None = None
    updated_at: str = ""

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Guild":
        known = _known_fields(cls)
        return cls(**{k: row[k] for k in row.keys() if k in known})

    def to_api(self) -> dict[str, Any]:
        return {"id": str(self.id), "name": self.name, "icon": self.icon}


@dataclass
class Channel:
    id: int
    guild_id: int
    name: str
    topic: str | None = None
    position: int | None = None
    tracked: int = 0
    notify: int = 1
    notify_keywords_only: int = 0
    column_order: int | None = None
    last_message_id: int | None = None
    last_read_message_id: int | None = None
    accessible: int = 1
    source: str = "discord"
    nitter_username: str | None = None
    nitter_instance: str | None = None
    feed_url: str | None = None
    updated_at: str = ""

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Channel":
        known = _known_fields(cls)
        return cls(**{k: row[k] for k in row.keys() if k in known})

    def to_api(self, unread: int = 0) -> dict[str, Any]:
        return {
            "id": str(self.id),
            "guild_id": str(self.guild_id),
            "name": self.name,
            "topic": self.topic,
            "position": self.position,
            "tracked": bool(self.tracked),
            "notify": bool(self.notify),
            "notify_keywords_only": bool(self.notify_keywords_only),
            "column_order": self.column_order,
            "last_read_message_id": str(self.last_read_message_id) if self.last_read_message_id else None,
            "accessible": bool(self.accessible),
            "source": self.source,
            "nitter_username": self.nitter_username,
            "feed_url": self.feed_url,
            "unread": unread,
        }


@dataclass
class Message:
    id: int
    channel_id: int
    guild_id: int
    author_id: int
    author_name: str
    author_avatar: str | None = None
    content: str = ""
    timestamp: str = ""
    edited_timestamp: str | None = None
    attachments: str = "[]"
    embeds: str = "[]"
    referenced_message_id: int | None = None
    message_type: int = 0
    permalink: str | None = None
    ingested_at: str = ""

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Message":
        known = _known_fields(cls)
        return cls(**{k: row[k] for k in row.keys() if k in known})

    def to_api(
        self,
        channel_name: str | None = None,
        guild_name: str | None = None,
        source: str = "discord",
    ) -> dict[str, Any]:
        return {
            "id": str(self.id),
            "channel_id": str(self.channel_id),
            "guild_id": str(self.guild_id),
            "author_id": str(self.author_id),
            "author_name": self.author_name,
            "author_avatar": self.author_avatar,
            "content": self.content,
            "timestamp": self.timestamp,
            "edited_timestamp": self.edited_timestamp,
            "attachments": json.loads(self.attachments or "[]"),
            "embeds": json.loads(self.embeds or "[]"),
            "referenced_message_id": str(self.referenced_message_id) if self.referenced_message_id else None,
            "message_type": self.message_type,
            "permalink": self.permalink,
            "source": source,
            "channel_name": channel_name,
            "guild_name": guild_name,
        }


# --- guilds / channels ------------------------------------------------------

def upsert_guilds(guilds: list[dict[str, Any]]) -> None:
    now = utcnow()
    with _lock:
        for g in guilds:
            _db().execute(
                """INSERT INTO guilds (id, name, icon, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name, icon=excluded.icon, updated_at=excluded.updated_at""",
                (int(g["id"]), g.get("name") or "unknown", g.get("icon"), now),
            )
        _db().commit()


def upsert_channels(guild_id: int, channels: list[dict[str, Any]]) -> None:
    """Metadata only — never touches tracked/notify/cursor/read state."""
    now = utcnow()
    with _lock:
        for c in channels:
            _db().execute(
                """INSERT INTO channels (id, guild_id, name, topic, position, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     guild_id=excluded.guild_id, name=excluded.name, topic=excluded.topic,
                     position=excluded.position, updated_at=excluded.updated_at""",
                (int(c["id"]), guild_id, c.get("name") or "unknown", c.get("topic"), c.get("position"), now),
            )
        _db().commit()


def get_channels(tracked_only: bool = False) -> list[Channel]:
    sql = "SELECT * FROM channels"
    if tracked_only:
        sql += " WHERE tracked = 1"
    sql += " ORDER BY COALESCE(column_order, 1000000), COALESCE(position, 1000000), id"
    return [Channel.from_row(r) for r in _db().execute(sql).fetchall()]


def get_channel(channel_id: int) -> Channel | None:
    row = _db().execute("SELECT * FROM channels WHERE id = ?", (channel_id,)).fetchone()
    return Channel.from_row(row) if row else None


def get_guild_names() -> dict[int, str]:
    return {r["id"]: r["name"] for r in _db().execute("SELECT id, name FROM guilds").fetchall()}


def get_channel_names() -> dict[int, str]:
    return {r["id"]: r["name"] for r in _db().execute("SELECT id, name FROM channels").fetchall()}


def get_guild_tree() -> list[dict[str, Any]]:
    unread = unread_counts()
    out: list[dict[str, Any]] = []
    for g_row in _db().execute("SELECT * FROM guilds ORDER BY name COLLATE NOCASE").fetchall():
        guild = Guild.from_row(g_row)
        rows = _db().execute(
            "SELECT * FROM channels WHERE guild_id = ? "
            "ORDER BY COALESCE(position, 1000000), name COLLATE NOCASE",
            (guild.id,),
        ).fetchall()
        api = guild.to_api()
        api["channels"] = [Channel.from_row(r).to_api(unread.get(r["id"], 0)) for r in rows]
        out.append(api)
    return out


_CHANNEL_SETTING_FIELDS = {"tracked", "notify", "notify_keywords_only"}


def set_channel_settings(channel_id: int, **fields: Any) -> Channel | None:
    updates = {
        k: int(bool(v))
        for k, v in fields.items()
        if k in _CHANNEL_SETTING_FIELDS and v is not None
    }
    if updates:
        if updates.get("tracked") == 1:
            updates["accessible"] = 1  # re-probe on next cycle
        cols = ", ".join(f"{k} = ?" for k in updates)
        with _lock:
            _db().execute(
                f"UPDATE channels SET {cols}, updated_at = ? WHERE id = ?",
                (*updates.values(), utcnow(), channel_id),
            )
            _db().commit()
    return get_channel(channel_id)


def set_column_order(ordered_ids: list[int]) -> None:
    with _lock:
        for idx, cid in enumerate(ordered_ids):
            _db().execute("UPDATE channels SET column_order = ? WHERE id = ?", (idx, cid))
        _db().commit()


def set_channel_cursor(channel_id: int, last_message_id: int) -> None:
    with _lock:
        _db().execute(
            "UPDATE channels SET last_message_id = ? WHERE id = ?",
            (last_message_id, channel_id),
        )
        _db().commit()


def set_channel_accessible(channel_id: int, accessible: bool) -> None:
    with _lock:
        _db().execute(
            "UPDATE channels SET accessible = ? WHERE id = ?",
            (int(accessible), channel_id),
        )
        _db().commit()


# --- Nitter profiles (tracked as channels with source='nitter') --------------

def ensure_nitter_guild() -> None:
    with _lock:
        _db().execute(
            "INSERT OR IGNORE INTO guilds (id, name, icon, updated_at) VALUES (?, ?, NULL, ?)",
            (config.NITTER_GUILD_ID, config.NITTER_GUILD_NAME, utcnow()),
        )
        _db().commit()


def get_nitter_channel_by_username(username: str) -> Channel | None:
    row = _db().execute(
        "SELECT * FROM channels WHERE source = 'nitter' AND nitter_username = ? COLLATE NOCASE",
        (username,),
    ).fetchone()
    return Channel.from_row(row) if row else None


def _next_synthetic_channel_id() -> int:
    # Small ids shared across all non-Discord sources (Nitter, RSS, …) so they
    # never collide with each other or with Discord channel snowflakes.
    return int(
        _db()
        .execute("SELECT COALESCE(MAX(id), 2) + 1 AS n FROM channels WHERE source != 'discord'")
        .fetchone()["n"]
    )


def add_nitter_profile(username: str, display_name: str, instance: str) -> Channel:
    ensure_nitter_guild()
    now = utcnow()
    with _lock:
        nid = _next_synthetic_channel_id()
        _db().execute(
            """INSERT INTO channels
               (id, guild_id, name, source, nitter_username, nitter_instance,
                tracked, notify, accessible, position, updated_at)
               VALUES (?, ?, ?, 'nitter', ?, ?, 1, 1, 1, ?, ?)""",
            (nid, config.NITTER_GUILD_ID, display_name or username, username, instance,
             1_000_000 + nid, now),
        )
        _db().commit()
    channel = get_channel(nid)
    assert channel is not None
    return channel


def delete_channel(channel_id: int) -> None:
    with _lock:
        _db().execute("DELETE FROM messages WHERE channel_id = ?", (channel_id,))
        _db().execute("DELETE FROM channels WHERE id = ?", (channel_id,))
        _db().commit()


# --- News feeds (tracked as channels with source='rss') ----------------------

def ensure_news_guild() -> None:
    with _lock:
        _db().execute(
            "INSERT OR IGNORE INTO guilds (id, name, icon, updated_at) VALUES (?, ?, NULL, ?)",
            (config.NEWS_GUILD_ID, config.NEWS_GUILD_NAME, utcnow()),
        )
        _db().commit()


def get_rss_channel_by_url(url: str) -> Channel | None:
    row = _db().execute(
        "SELECT * FROM channels WHERE source = 'rss' AND feed_url = ?", (url,)
    ).fetchone()
    return Channel.from_row(row) if row else None


def add_rss_feed(name: str, url: str) -> Channel:
    ensure_news_guild()
    now = utcnow()
    with _lock:
        nid = _next_synthetic_channel_id()
        _db().execute(
            """INSERT INTO channels
               (id, guild_id, name, source, feed_url, tracked, notify, accessible, position, updated_at)
               VALUES (?, ?, ?, 'rss', ?, 1, 1, 1, ?, ?)""",
            (nid, config.NEWS_GUILD_ID, name or url, url, 2_000_000 + nid, now),
        )
        _db().commit()
    channel = get_channel(nid)
    assert channel is not None
    return channel


# --- messages ----------------------------------------------------------------

_MESSAGE_COLUMNS = (
    "id", "channel_id", "guild_id", "author_id", "author_name", "author_avatar",
    "content", "timestamp", "edited_timestamp", "attachments", "embeds",
    "referenced_message_id", "message_type", "permalink", "ingested_at",
)


def insert_messages(rows: list[dict[str, Any]]) -> list[Message]:
    """INSERT OR IGNORE; returns only the genuinely new messages (rowcount == 1)."""
    if not rows:
        return []
    placeholders = ", ".join("?" for _ in _MESSAGE_COLUMNS)
    sql = f"INSERT OR IGNORE INTO messages ({', '.join(_MESSAGE_COLUMNS)}) VALUES ({placeholders})"
    new_ids: list[int] = []
    with _lock:
        for row in rows:
            cur = _db().execute(sql, tuple(row.get(c) for c in _MESSAGE_COLUMNS))
            if cur.rowcount == 1:
                new_ids.append(int(row["id"]))
        _db().commit()
    if not new_ids:
        return []
    qmarks = ", ".join("?" for _ in new_ids)
    fetched = _db().execute(
        f"SELECT * FROM messages WHERE id IN ({qmarks}) ORDER BY id", new_ids
    ).fetchall()
    return [Message.from_row(r) for r in fetched]


def get_message(message_id: int) -> Message | None:
    row = _db().execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    return Message.from_row(row) if row else None


def update_message_attachments(message_id: int, attachments_json: str) -> None:
    with _lock:
        _db().execute(
            "UPDATE messages SET attachments = ? WHERE id = ?",
            (attachments_json, message_id),
        )
        _db().commit()


def query_messages(
    channel_ids: list[int] | None = None,
    search: str | None = None,
    before_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Newest-first keyset pagination; returns API-shaped dicts incl. channel/guild names."""
    sql = (
        "SELECT m.*, c.name AS channel_name, c.source AS source, g.name AS guild_name "
        "FROM messages m "
        "JOIN channels c ON c.id = m.channel_id "
        "LEFT JOIN guilds g ON g.id = m.guild_id "
        "WHERE 1=1"
    )
    params: list[Any] = []
    if channel_ids:
        sql += f" AND m.channel_id IN ({', '.join('?' for _ in channel_ids)})"
        params.extend(channel_ids)
    else:
        sql += " AND c.tracked = 1"
    if search:
        sql += (
            " AND (m.content LIKE ? COLLATE NOCASE"
            " OR m.embeds LIKE ? COLLATE NOCASE"
            " OR m.author_name LIKE ? COLLATE NOCASE)"
        )
        like = f"%{search}%"
        params.extend([like, like, like])
    if before_id:
        sql += " AND m.id < ?"
        params.append(before_id)
    sql += " ORDER BY m.id DESC LIMIT ?"
    params.append(max(1, min(int(limit), 200)))
    out = []
    for row in _db().execute(sql, params).fetchall():
        msg = Message.from_row(row)
        out.append(
            msg.to_api(
                channel_name=row["channel_name"],
                guild_name=row["guild_name"],
                source=row["source"],
            )
        )
    return out


def message_count() -> int:
    return int(_db().execute("SELECT COUNT(*) FROM messages").fetchone()[0])


def prune_messages_before(cutoff_id: int) -> int:
    """Delete messages older than a snowflake cutoff (lookback retention)."""
    with _lock:
        cur = _db().execute("DELETE FROM messages WHERE id < ?", (cutoff_id,))
        _db().commit()
        return cur.rowcount


# --- unread ------------------------------------------------------------------

def mark_read(channel_id: int, message_id: int | None = None) -> None:
    with _lock:
        if message_id is None:
            _db().execute(
                """UPDATE channels SET last_read_message_id =
                     COALESCE((SELECT MAX(id) FROM messages WHERE channel_id = ?), last_read_message_id)
                   WHERE id = ?""",
                (channel_id, channel_id),
            )
        else:
            _db().execute(
                "UPDATE channels SET last_read_message_id = ? WHERE id = ?",
                (message_id, channel_id),
            )
        _db().commit()


def mark_all_read() -> None:
    with _lock:
        _db().execute(
            """UPDATE channels SET last_read_message_id =
                 COALESCE((SELECT MAX(id) FROM messages WHERE channel_id = channels.id), last_read_message_id)
               WHERE tracked = 1"""
        )
        _db().commit()


def unread_counts() -> dict[int, int]:
    rows = _db().execute(
        """SELECT m.channel_id AS cid, COUNT(*) AS n
           FROM messages m JOIN channels c ON c.id = m.channel_id
           WHERE c.tracked = 1 AND m.id > COALESCE(c.last_read_message_id, 0)
           GROUP BY m.channel_id"""
    ).fetchall()
    return {r["cid"]: r["n"] for r in rows}


# --- app state ----------------------------------------------------------------

def get_state(key: str, default: Any = None) -> Any:
    row = _db().execute("SELECT value FROM app_state WHERE key = ?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["value"])
    except (TypeError, json.JSONDecodeError):
        return default


def set_state(key: str, value: Any) -> None:
    with _lock:
        _db().execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )
        _db().commit()
