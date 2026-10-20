"""HTTP API (FastAPI). Every athlete route requires a bearer token and only
serves the athlete owned by that user."""

from __future__ import annotations

import math
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from ..db import Database
from ..observability import instrument
from ..security import Throttle
from . import routes_auth, routes_nutrition, routes_progress, routes_telemetry, routes_training


def _json_safe(v):
    """422 details echo the rejected input; NaN/Infinity there would crash the JSON encoder (500)."""
    if isinstance(v, float) and not math.isfinite(v):
        return str(v)
    if isinstance(v, dict):
        return {k: _json_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_json_safe(x) for x in v]
    return v


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse({"detail": _json_safe(jsonable_encoder(exc.errors()))}, status_code=422)


def create_app(db: Database | None = None, http: httpx.Client | None = None) -> FastAPI:
    database = db or Database()
    client = http or httpx.Client()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.migrate()
        yield
        if http is None:
            client.close()

    app = FastAPI(title="Project Knightfall", version="0.2.0", lifespan=lifespan)
    app.state.db = database
    app.state.http = client
    # Failed logins: 5 per e-mail and 30 per client IP every 15 minutes.
    app.state.login_email_throttle = Throttle(limit=5, window_s=15 * 60)
    app.state.login_ip_throttle = Throttle(limit=30, window_s=15 * 60)
    # Sign-ups (each one a scrypt hash and a 409 probe): 20 per client IP an hour, successful or not.
    app.state.register_ip_throttle = Throttle(limit=20, window_s=60 * 60)
    # The native app does not need CORS; only list origins for a browser client.
    origins = [o.strip() for o in os.environ.get("KNIGHTFALL_CORS_ORIGINS", "").split(",") if o.strip()]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    instrument(app)
    app.add_exception_handler(RequestValidationError, _validation_error)

    @app.get("/health", responses={503: {"description": "database unreachable"}})
    def health() -> JSONResponse:
        # Liveness + readiness in one: a container whose database is gone is not healthy.
        try:
            with database.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except SQLAlchemyError:
            return JSONResponse({"status": "degraded", "database": "down"}, status_code=503)
        return JSONResponse({"status": "ok", "database": "up"})

    for r in (routes_auth, routes_training, routes_nutrition, routes_telemetry, routes_progress):
        app.include_router(r.router)
    return app


app = create_app()
