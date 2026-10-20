import json
import os
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from knightfall.api import create_app
from knightfall.db import Database

OFF_PRODUCTS = {
    "7891000100103": {  # milk chocolate drink
        "product_name": "Achocolatado", "brands": "X",
        "nutriments": {"energy-kcal_100g": 380, "proteins_100g": 4, "carbohydrates_100g": 85, "fat_100g": 2,
                       "sodium_100g": 0.2},
        "allergens_tags": ["en:milk"], "ingredients_tags": ["en:sugar", "en:skimmed-milk-powder"],
        "serving_quantity": 20,
    },
    "7890000000001": {  # salty soup, dairy-free
        "product_name": "Sopa instantânea",
        "nutriments": {"energy-kcal_100g": 350, "proteins_100g": 8, "carbohydrates_100g": 60, "fat_100g": 8,
                       "salt_100g": 5.0},
        "allergens_tags": [], "ingredients_tags": ["en:wheat", "en:salt"], "traces_tags": ["en:milk"],
        "serving_quantity": 60,
    },
}


def off_handler(request: httpx.Request) -> httpx.Response:
    code = request.url.path.rsplit("/", 1)[-1].removesuffix(".json")
    assert request.headers["user-agent"].startswith("ProjectKnightfall")
    if code in OFF_PRODUCTS:
        return httpx.Response(200, content=json.dumps({"status": 1, "product": OFF_PRODUCTS[code]}))
    return httpx.Response(200, content=json.dumps({"status": 0}))


# Set to a PostgreSQL URL (CI does) to run the whole suite against Postgres instead of SQLite.
PG_URL = os.environ.get("KNIGHTFALL_TEST_DATABASE_URL")


def _fresh_postgres(url: str) -> Database:
    db = Database(url)
    for attempt in range(5):
        try:
            with db.engine.begin() as conn:
                conn.execute(text("DROP SCHEMA public CASCADE"))
                conn.execute(text("CREATE SCHEMA public"))
            break
        except OperationalError as e:
            # TimescaleDB's background jobs (compression policy) can hold locks the drop needs.
            if "deadlock detected" not in str(e) or attempt == 4:
                raise
            time.sleep(0.2)
    # The drop takes TimescaleDB with it, and the extension can only be created again from a new
    # session: the migrations must not reuse this pooled connection.
    db.engine.dispose()
    return db


@pytest.fixture
def client(tmp_path):
    http = httpx.Client(transport=httpx.MockTransport(off_handler))
    db = _fresh_postgres(PG_URL) if PG_URL else Database(f"sqlite:///{tmp_path / 'test.db'}")
    app = create_app(db, http=http)
    with TestClient(app) as c:
        yield c
    db.engine.dispose()


def register(client, email="bruce@wayne.com"):
    r = client.post("/auth/register", json={"email": email, "password": "batcave-123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def auth(client):
    return register(client)
