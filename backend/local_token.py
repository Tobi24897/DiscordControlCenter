"""Read the Discord user token from the local Discord desktop app (Windows).

Discord stores the token in its LevelDB, AES-256-GCM encrypted with a key that
lives DPAPI-encrypted in `Local State` — the exact scheme Chromium uses for
cookies. We decrypt the key via DPAPI (user-scoped, no admin needed) and the
token via AES-GCM. Read-only; the token is never logged. Windows + an installed,
logged-in Discord desktop client required.
"""

from __future__ import annotations

import base64
import ctypes
import glob
import json
import os
import re
from ctypes import wintypes
from pathlib import Path

# Discord prefixes the encrypted token value with this marker in LevelDB.
_TOKEN_RE = re.compile(rb"dQw4w9WgXcQ:([A-Za-z0-9+/=]+)")
_DISCORD_DIRS = ("discord", "discordcanary", "discordptb", "discorddevelopment")


class LocalTokenError(Exception):
    """No readable local Discord token (app missing, not logged in, or locked)."""


def _dpapi_decrypt(blob: bytes) -> bytes:
    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(blob, len(blob))
    blob_in = DATA_BLOB(len(blob), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = DATA_BLOB()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
    )
    if not ok:
        raise LocalTokenError("DPAPI decryption failed")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


def _aes_gcm_decrypt(key: bytes, blob: bytes) -> str:
    # blob = b"v10" + 12-byte nonce + ciphertext + 16-byte GCM tag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce, ct = blob[3:15], blob[15:]
    return AESGCM(key).decrypt(nonce, ct, None).decode("utf-8", errors="strict")


def _looks_like_token(value: str) -> bool:
    # Discord tokens are three dot-separated base64url parts.
    return value.count(".") == 2 and len(value) > 40


def read_local_discord_token() -> str:
    """Return the decrypted Discord token from the local desktop app, or raise."""
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise LocalTokenError("APPDATA not set (not Windows?)")

    errors: list[str] = []
    for name in _DISCORD_DIRS:
        base = Path(appdata) / name
        local_state = base / "Local State"
        leveldb = base / "Local Storage" / "leveldb"
        if not (local_state.exists() and leveldb.is_dir()):
            continue
        try:
            state = json.loads(local_state.read_text(encoding="utf-8"))
            enc_key = base64.b64decode(state["os_crypt"]["encrypted_key"])[5:]  # strip "DPAPI"
            key = _dpapi_decrypt(enc_key)
        except (KeyError, ValueError, OSError, LocalTokenError) as exc:
            errors.append(f"{name}: key error ({exc})")
            continue

        files = glob.glob(str(leveldb / "*.ldb")) + glob.glob(str(leveldb / "*.log"))
        for path in files:
            try:
                data = Path(path).read_bytes()
            except OSError:
                continue  # file locked by the running client — try the next
            for match in _TOKEN_RE.finditer(data):
                try:
                    token = _aes_gcm_decrypt(key, base64.b64decode(match.group(1)))
                except Exception:  # noqa: BLE001 — partial/garbage match, keep scanning
                    continue
                if _looks_like_token(token):
                    return token
        errors.append(f"{name}: no token in leveldb")

    detail = "; ".join(errors) if errors else "no Discord desktop install found"
    raise LocalTokenError(detail)
