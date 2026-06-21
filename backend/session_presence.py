"""Session-presence failsafe — auto-shutdown the local backend shortly after
the last browser tab viewing it goes away.

Why a held-open connection instead of polling: a backgrounded browser tab
throttles JS timers (Chrome ~1/min), so a setInterval heartbeat would look
"dead" within seconds of tab-switching and wrongly kill the server. An open
EventSource connection is NOT torn down on backgrounding — only a real tab /
window / browser close (or a crash) drops the TCP socket. A watchdog shuts the
whole process tree down once no presence connection has existed for `grace`
seconds, with:
  * a startup grace, so the server doesn't die before the browser first
    connects, and
  * an orphan timeout, so a server nobody ever opened still cleans itself up.

Integrations (all stdlib-only; framework bits import lazily):
  * FastAPI / Starlette  -> attach_fastapi(app, ...)            (call from main())
  * stdlib http.server   -> PresenceWatchdog + handle_stdlib_sse(handler, wd)
  * Streamlit            -> start_streamlit_watchdog(...)

Copied per project on purpose (a set-and-forget failsafe with no shared
package). If you change one, mirror the change to the other copies.

NOTE: do NOT add `from __future__ import annotations` here. The FastAPI route
in attach_fastapi() relies on its `request: Request` parameter annotation being
the real class object (resolved eagerly from the local import). Stringified
annotations break FastAPI's request injection (it treats `request` as a query
param -> 422).
"""

import os
import subprocess
import threading
import time

# Path the page connects to. Deliberately obscure so it can't collide with an
# app route. Served as text/event-stream and held open for the tab's lifetime.
PRESENCE_PATH = "/__session_presence__"

# Tiny inline <script> injected into the served HTML. EventSource auto-reconnects
# on transient drops, so no client-side reconnect logic is needed.
PRESENCE_SCRIPT = (
    "<script>/* session-presence failsafe: backend self-stops ~seconds after "
    "this tab closes */(function(){try{var mk=function(){try{var e="
    "new EventSource('" + PRESENCE_PATH + "');e.onerror=function(){};}"
    "catch(_){}};mk();}catch(_){}})();</script>"
)

_CREATE_NO_WINDOW = 0x08000000

_DEBUG = bool(os.environ.get("SESSION_PRESENCE_DEBUG"))
_DEBUG_PATH = os.environ.get("SESSION_PRESENCE_DEBUG", "")


def _debug(msg: str) -> None:
    if not _DEBUG:
        return
    try:
        with open(_DEBUG_PATH, "a", encoding="utf-8") as fh:
            fh.write(f"{time.monotonic():.2f} {msg}\n")
    except Exception:
        pass


def _kill_tree_and_exit(pid: int | None = None) -> None:
    """Kill the current process AND its children (taskkill /T), then hard-exit.

    /T takes any child processes (scan subprocesses, pipeline workers, ...) with
    it, so the session leaves nothing behind.
    """
    target = os.getpid() if pid is None else pid
    try:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(target)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=_CREATE_NO_WINDOW,
            check=False,
        )
    except Exception:
        pass
    os._exit(0)


def inject_presence_script(html: str) -> str:
    """Insert the presence <script> just before </body> (or append if absent)."""
    if PRESENCE_PATH in html:
        return html
    idx = html.rfind("</body>")
    if idx == -1:
        return html + PRESENCE_SCRIPT
    return html[:idx] + PRESENCE_SCRIPT + html[idx:]


class PresenceWatchdog:
    """Tracks live presence connections; shuts down when the last one has been
    gone for `grace` seconds (or after `startup_grace` if none ever connected)."""

    def __init__(
        self,
        *,
        grace: float = 6.0,
        startup_grace: float = 150.0,
        poll: float = 1.0,
        gate=None,
        on_shutdown=None,
        label: str = "session-presence-watchdog",
    ) -> None:
        self._grace = grace
        self._startup_grace = startup_grace
        self._poll = poll
        self._gate = gate  # callable -> True means "do not shut down right now"
        self._on_shutdown = on_shutdown or _kill_tree_and_exit
        self._label = label
        self._lock = threading.Lock()
        self._count = 0
        self._ever = False
        self._zero_since = time.monotonic()
        self._start = time.monotonic()
        self._started = False

    def connect(self) -> None:
        with self._lock:
            self._count += 1
            self._ever = True
        _debug(f"connect -> count={self._count}")

    def disconnect(self) -> None:
        with self._lock:
            if self._count > 0:
                self._count -= 1
            if self._count == 0:
                self._zero_since = time.monotonic()
        _debug(f"disconnect -> count={self._count}")

    def _ready_to_shutdown(self) -> bool:
        with self._lock:
            now = time.monotonic()
            if self._gate is not None:
                try:
                    if self._gate():
                        return False
                except Exception:
                    pass
            if not self._ever:
                return (now - self._start) >= self._startup_grace
            return self._count == 0 and (now - self._zero_since) >= self._grace

    def _run(self) -> None:
        _debug("watchdog started")
        while True:
            time.sleep(self._poll)
            if self._ready_to_shutdown():
                _debug("watchdog -> SHUTDOWN")
                self._on_shutdown()
                return

    def start(self) -> "PresenceWatchdog":
        if not self._started:
            self._started = True
            threading.Thread(target=self._run, name=self._label, daemon=True).start()
        return self


def handle_stdlib_sse(handler, watchdog: "PresenceWatchdog", keepalive: float = 2.0) -> None:
    """Serve the presence SSE stream from a BaseHTTPRequestHandler.

    Blocks the handler thread until the client disconnects, so the server MUST
    be a ThreadingHTTPServer. On disconnect the next write raises and the
    watchdog is decremented.
    """
    watchdog.connect()
    try:
        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream")
        handler.send_header("Cache-Control", "no-cache")
        handler.send_header("Connection", "keep-alive")
        handler.end_headers()
        handler.wfile.write(b": presence open\n\n")
        handler.wfile.flush()
        while True:
            time.sleep(keepalive)
            handler.wfile.write(b": ping\n\n")
            handler.wfile.flush()
    except Exception:
        pass
    finally:
        watchdog.disconnect()


def attach_fastapi(
    app,
    *,
    grace: float = 6.0,
    startup_grace: float = 150.0,
    keepalive: float = 2.0,
    gate=None,
    on_shutdown=None,
    start: bool = True,
) -> "PresenceWatchdog":
    """Register the presence SSE route on a FastAPI app and (by default) start
    the watchdog.

    Prefer calling this from the server entry point (main()) so merely importing
    the app for CLI/tests never arms the shutdown timer. When the route MUST be
    registered at import time (e.g. before a catch-all SPA route, or on a
    module-level ``app`` started via ``uvicorn app:app``), pass ``start=False``
    here and call ``.start()`` on the returned watchdog from the real entry
    point / behind an env guard.
    """
    import asyncio

    from fastapi import Request
    from fastapi.responses import StreamingResponse

    watchdog = PresenceWatchdog(
        grace=grace, startup_grace=startup_grace, gate=gate, on_shutdown=on_shutdown
    )

    @app.get(PRESENCE_PATH, include_in_schema=False)
    async def _session_presence(request: Request):  # noqa: ANN202
        watchdog.connect()

        async def gen():
            try:
                yield b": presence open\n\n"
                while True:
                    disc = await request.is_disconnected()
                    _debug(f"gen loop is_disconnected={disc}")
                    if disc:
                        break
                    yield b": ping\n\n"
                    await asyncio.sleep(keepalive)
            finally:
                _debug("gen finally")
                watchdog.disconnect()

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    if start:
        watchdog.start()
    return watchdog


_streamlit_started = False


def start_streamlit_watchdog(
    *,
    grace: float = 6.0,
    startup_grace: float = 150.0,
    poll: float = 2.0,
    on_shutdown=None,
) -> None:
    """Watchdog for a Streamlit app: shuts down when Streamlit reports no active
    browser sessions for `grace` seconds. Safe to call on every script rerun —
    only the first call arms the thread (module-global guard survives reruns).
    """
    global _streamlit_started
    if _streamlit_started:
        return
    _streamlit_started = True

    shutdown = on_shutdown or _kill_tree_and_exit

    def active_sessions():
        try:
            from streamlit.runtime import get_instance

            mgr = get_instance()._session_mgr
            if hasattr(mgr, "num_active_sessions"):
                return mgr.num_active_sessions()
            return len(mgr.list_active_sessions())
        except Exception:
            return None  # runtime not up yet / API unknown -> "can't tell"

    state = {"ever": False, "zero_since": time.monotonic(), "start": time.monotonic()}

    def run():
        while True:
            time.sleep(poll)
            n = active_sessions()
            if n is None:
                continue
            now = time.monotonic()
            if n > 0:
                state["ever"] = True
                state["zero_since"] = now
                continue
            if state["ever"]:
                if now - state["zero_since"] >= grace:
                    shutdown()
                    return
            elif now - state["start"] >= startup_grace:
                shutdown()
                return

    threading.Thread(target=run, name="streamlit-presence-watchdog", daemon=True).start()
