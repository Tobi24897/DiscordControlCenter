"""SSE pub/sub: per-subscriber asyncio queues + the stream generator."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncGenerator

logger = logging.getLogger(__name__)

QUEUE_MAXSIZE = 500
HEARTBEAT_SECONDS = 15


class Broadcaster:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self.token_status: str = "unset"  # unset | unknown | valid | invalid
        self.dropped = 0

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        self._subscribers.add(q)
        logger.info("SSE client connected (total: %d)", len(self._subscribers))
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)
        logger.info("SSE client disconnected (total: %d)", len(self._subscribers))

    def publish(self, event_type: str, data: Any) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait((event_type, data))
            except asyncio.QueueFull:
                # Drop oldest so a stalled client can't block fresh events.
                try:
                    q.get_nowait()
                    q.put_nowait((event_type, data))
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
                self.dropped += 1
                if self.dropped % 100 == 1:
                    logger.warning("SSE backpressure: %d events dropped so far", self.dropped)


def format_sse(event_type: str, data: Any) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def sse_stream(
    broadcaster: Broadcaster, hello_payload: dict[str, Any]
) -> AsyncGenerator[str, None]:
    q = broadcaster.subscribe()
    try:
        yield format_sse("hello", hello_payload)
        while True:
            try:
                event_type, data = await asyncio.wait_for(q.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield ": ping\n\n"  # keepalive comment
                continue
            yield format_sse(event_type, data)
    finally:
        broadcaster.unsubscribe(q)
