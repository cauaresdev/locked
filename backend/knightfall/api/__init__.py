"""HTTP API (FastAPI). Every athlete route requires a bearer token and only
serves the athlete owned by that user."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..db import Database
from ..security import Throttle
from . import routes_auth, routes_nutrition, routes_telemetry, routes_training


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
    # The native app does not need CORS; only list origins for a browser client.
    origins = [o.strip() for o in os.environ.get("KNIGHTFALL_CORS_ORIGINS", "").split(",") if o.strip()]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    for r in (routes_auth, routes_training, routes_nutrition, routes_telemetry):
        app.include_router(r.router)
    return app


app = create_app()
