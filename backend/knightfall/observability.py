"""Structured request logs and optional error reporting.

Every request logs one JSON line (method, route, status, duration, request
id). Set SENTRY_DSN, with the `observability` extra installed, to also send
unhandled errors to Sentry. Request bodies are never logged: they carry
health data.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid

from fastapi import FastAPI, Request

log = logging.getLogger("knightfall.http")

# A client-supplied request id is echoed back and logged: only short opaque tokens are trusted.
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
SENTRY_HEADERS = frozenset({"user-agent", "content-type", "content-length", "x-request-id"})


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {"level": record.levelname.lower(), "logger": record.name, "msg": record.getMessage()}
        out.update(getattr(record, "fields", {}))
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


def configure_logging() -> None:
    root = logging.getLogger("knightfall")
    if root.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(os.environ.get("KNIGHTFALL_LOG_LEVEL", "INFO").upper())
    root.propagate = False


def init_sentry() -> bool:
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        log.warning("SENTRY_DSN is set but sentry-sdk is not installed (pip install '.[observability]')")
        return False
    sentry_sdk.init(
        dsn=dsn,
        send_default_pii=False,
        traces_sample_rate=0.0,
        # Bodies and frame locals carry health data (sets, HR samples, weights): never sent.
        max_request_body_size="never",
        include_local_variables=False,
        before_send=scrub_event,
    )
    return True


def scrub_event(event: dict, _hint: dict | None = None) -> dict:
    """Last line of defence before an error leaves for Sentry: no body, query or auth header."""
    req = event.get("request")
    if isinstance(req, dict):
        req.pop("data", None)
        req.pop("cookies", None)
        req.pop("query_string", None)
        headers = req.get("headers")
        if isinstance(headers, dict):
            req["headers"] = {k: v for k, v in headers.items() if k.lower() in SENTRY_HEADERS}
    return event


def instrument(app: FastAPI) -> None:
    configure_logging()
    init_sentry()

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        given = request.headers.get("x-request-id", "")
        request_id = given if REQUEST_ID_RE.match(given) else uuid.uuid4().hex[:16]
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["x-request-id"] = request_id
            return response
        except Exception:
            log.exception("unhandled error", extra={"fields": {"request_id": request_id}})
            raise
        finally:
            route = request.scope.get("route")
            log.info("request", extra={"fields": {
                "request_id": request_id,
                "method": request.method,
                # The route template, not the raw path: ids stay out of the logs.
                "route": getattr(route, "path", request.url.path),
                "status": status,
                "ms": round((time.perf_counter() - start) * 1000, 1),
            }})
