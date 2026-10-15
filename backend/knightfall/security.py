"""Password hashing (scrypt, stdlib) and opaque bearer tokens.

Tokens are random 256-bit strings; only their SHA-256 is stored, so a
database leak does not leak usable sessions, and logout is a row delete.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time
from collections import deque

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1
TOKEN_TTL_DAYS = 90


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=64)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    expected = base64.b64decode(digest)
    actual = hashlib.scrypt(
        password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
    )
    return hmac.compare_digest(actual, expected)


# Verified against when the e-mail is unknown, so a login costs the same scrypt
# work either way and response time does not reveal which e-mails have accounts.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


class Throttle:
    """Sliding-window failure counter (in memory, per process).

    Behind several API workers each one counts separately, so the effective
    limit is `limit x workers`; a shared store (Redis) would make it exact.
    """

    def __init__(self, limit: int, window_s: float, clock=time.monotonic) -> None:
        self.limit, self.window_s, self._clock = limit, window_s, clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _live(self, key: str, now: float) -> deque[float]:
        q = self._hits.setdefault(key, deque())
        while q and now - q[0] >= self.window_s:
            q.popleft()
        return q

    def retry_after(self, key: str) -> int | None:
        """Seconds until `key` may try again, or None when it is not blocked."""
        with self._lock:
            now = self._clock()
            q = self._live(key, now)
            if len(q) < self.limit:
                return None
            return max(1, int(self.window_s - (now - q[0])) + 1)

    def fail(self, key: str) -> None:
        with self._lock:
            self._live(key, self._clock()).append(self._clock())

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
