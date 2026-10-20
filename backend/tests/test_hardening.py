"""Input limits, batch uploads and the security/observability edges of the API."""

import json
import uuid
from datetime import date, datetime, timedelta, timezone

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from conftest import register

from knightfall.db import Base
from knightfall.foods import _num
from knightfall.observability import scrub_event
from knightfall.security import Throttle

START = date(2026, 1, 5)


def athlete(client, auth):
    body = {"name": "Bruce", "tier": "dark_knight", "bodyweight_kg": 90, "cycle_start": START.isoformat()}
    r = client.post("/athletes", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def log(**kw):
    return {"id": str(uuid.uuid4()), "performed_on": START.isoformat(), "exercise_id": "trap_bar_deadlift",
            "set_index": 0, "reps": 5, "load_kg": 100, "rpe": 8, **kw}


def food(**kw):
    return {"id": str(uuid.uuid4()), "day": START.isoformat(), "meal": "snack", "name": "Frango", "grams": 150,
            "kcal": 250, "protein_g": 45, **kw}


# --- inputs that used to be stored and then break a day's views with a 500 --------


def test_non_finite_and_absurd_numbers_are_rejected(client, auth):
    url = f"/athletes/{athlete(client, auth)['id']}"
    headers = {**auth, "content-type": "application/json"}
    # Not valid JSON, but json.dumps writes these tokens and the API's parser accepts them.
    for bad in (float("inf"), float("nan")):
        assert client.post(f"{url}/food-entries", content=json.dumps([food(kcal=bad)]),
                           headers=headers).status_code == 422
        assert client.post(f"{url}/logs", content=json.dumps([log(load_kg=bad)]), headers=headers).status_code == 422
    assert client.post(f"{url}/logs", json=[log(load_kg=1e308)], headers=auth).status_code == 422
    assert client.post(f"{url}/logs", json=[log(set_index=10**30)], headers=auth).status_code == 422
    assert client.post(f"{url}/food-entries", json=[food(sodium_mg=10**9)], headers=auth).status_code == 422
    assert client.post(f"{url}/food-entries", json=[food()], headers=auth).json()["accepted"] == 1


def test_timestamps_need_an_offset_and_a_sane_range(client, auth):
    url = f"/athletes/{athlete(client, auth)['id']}"
    assert client.post(f"{url}/logs", json=[log(performed_at="0001-01-01T00:01:00Z")], headers=auth).status_code == 422
    assert client.post(f"{url}/logs", json=[log(performed_at="2026-01-05T10:00:00")], headers=auth).status_code == 422
    assert client.post(f"{url}/logs", json=[log(performed_at="2026-01-05T10:00:00Z")], headers=auth).status_code == 200
    far = [{"ts": "0001-01-01T00:00:00+05:00", "kind": "hr", "value": 120}]
    assert client.post(f"{url}/telemetry", json=far, headers=auth).status_code == 422
    # The day still renders after the good upload.
    assert client.get(f"{url}/nutrition/{START.isoformat()}", headers=auth).status_code == 200


# --- batch uploads ------------------------------------------------------------------


def test_batches_are_capped_before_any_work(client, auth):
    url = f"/athletes/{athlete(client, auth)['id']}"
    assert client.post(f"{url}/logs", json=[log(set_index=i % 200) for i in range(501)],
                       headers=auth).status_code == 422
    assert client.post(f"{url}/food-entries", json=[food() for _ in range(501)], headers=auth).status_code == 422
    t0 = datetime(2026, 1, 5, tzinfo=timezone.utc)
    samples = [{"ts": (t0 + timedelta(seconds=i)).isoformat(), "kind": "hr", "value": 100} for i in range(5001)]
    assert client.post(f"{url}/telemetry", json=samples, headers=auth).status_code == 422


def test_retries_and_in_batch_repeats_count_as_duplicates(client, auth):
    url = f"/athletes/{athlete(client, auth)['id']}"
    a, b = log(), log(set_index=1)
    assert client.post(f"{url}/logs", json=[a, a, b], headers=auth).json() == {"accepted": 2, "duplicates": 1}
    assert client.post(f"{url}/logs", json=[a, b], headers=auth).json() == {"accepted": 0, "duplicates": 2}
    f = food()
    assert client.post(f"{url}/food-entries", json=[f, f], headers=auth).json() == {"accepted": 1, "duplicates": 1}
    assert client.post(f"{url}/food-entries", json=[f], headers=auth).json() == {"accepted": 0, "duplicates": 1}


def test_an_id_owned_by_another_athlete_is_rejected_not_swallowed(client, auth):
    mine = athlete(client, auth)
    other_auth = register(client, "alfred@wayne.com")
    other = athlete(client, other_auth)
    set_, entry = log(), food()
    client.post(f"/athletes/{mine['id']}/logs", json=[set_], headers=auth)
    client.post(f"/athletes/{mine['id']}/food-entries", json=[entry], headers=auth)
    assert client.post(f"/athletes/{other['id']}/logs", json=[set_], headers=other_auth).status_code == 422
    assert client.post(f"/athletes/{other['id']}/food-entries", json=[entry], headers=other_auth).status_code == 422


def test_progress_scores_readiness_from_preloaded_history(client, auth):
    a = athlete(client, auth)
    url = f"/athletes/{a['id']}"
    today = datetime.now(timezone.utc).date()
    for back in range(20):
        day = (today - timedelta(days=back)).isoformat()
        client.put(f"{url}/readiness", json={"day": day, "hrv_ms": 60 + back % 5, "sleep_hours": 7}, headers=auth)
    r = client.get(f"{url}/progress?days=14", headers=auth)
    assert r.status_code == 200
    days = r.json()["readiness"]
    assert len(days) == 14 and all(d["score"] is not None for d in days)
    # Same score as the single-day endpoint, which loads its own history.
    single = client.put(f"{url}/readiness", json={"day": today.isoformat()}, headers=auth).json()
    assert days[-1]["score"] == single["score"]


# --- auth ----------------------------------------------------------------------------


def test_throttle_forgets_expired_keys():
    now = [0.0]
    t = Throttle(limit=3, window_s=60, clock=lambda: now[0])
    assert t.retry_after("never-seen") is None and len(t) == 0  # lookups store nothing
    t.SWEEP_EVERY = 10
    for i in range(9):
        t.fail(f"email:{i}")
    now[0] = 61
    t.fail("email:last")  # 10th failure: sweep
    assert len(t) == 1
    now[0] = 200
    assert t.retry_after("email:last") is None and len(t) == 0


def test_registration_is_throttled_per_ip(client):
    for i in range(20):
        client.post("/auth/register", json={"email": f"user{i}@wayne.com", "password": "batcave-123"})
    r = client.post("/auth/register", json={"email": "late@wayne.com", "password": "batcave-123"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0


def test_new_login_purges_expired_tokens(client, auth):
    from knightfall.db import AuthToken

    db = client.app.state.db
    with db.new_session() as s:
        user_id = s.query(AuthToken).one().user_id
        s.add(AuthToken(token_hash="0" * 64, user_id=user_id,
                        expires_at=datetime.now(timezone.utc) - timedelta(days=1)))
        s.commit()
    client.post("/auth/login", json={"email": "bruce@wayne.com", "password": "batcave-123"})
    with db.new_session() as s:
        assert s.get(AuthToken, "0" * 64) is None and s.query(AuthToken).count() == 2


# --- observability ---------------------------------------------------------------------


def test_request_id_is_echoed_only_when_well_formed(client):
    assert client.get("/health", headers={"x-request-id": "abc-123"}).headers["x-request-id"] == "abc-123"
    echoed = client.get("/health", headers={"x-request-id": "x" * 500}).headers["x-request-id"]
    assert echoed != "x" * 500 and len(echoed) == 16


def test_sentry_events_lose_bodies_and_credentials():
    event = {"request": {"data": {"weight_kg": 90}, "query_string": "days=60", "cookies": {"a": "b"},
                         "headers": {"Authorization": "Bearer secret", "User-Agent": "app", "X-Request-Id": "r1"}}}
    req = scrub_event(event)["request"]
    assert "data" not in req and "query_string" not in req and "cookies" not in req
    assert req["headers"] == {"User-Agent": "app", "X-Request-Id": "r1"}


def test_open_food_facts_junk_numbers_read_as_missing():
    assert _num("12.5") == 12.5 and _num(0) == 0
    for junk in ("nan", "inf", "-1", float("inf"), "", None, "abc", [1]):
        assert _num(junk) is None


# --- schema -----------------------------------------------------------------------------


def _not_timescale_managed(obj, name, type_, reflected, compare_to) -> bool:
    # create_hypertable adds its own index on the time column: TimescaleDB's, not the models'.
    return not (type_ == "index" and reflected and compare_to is None and name == "telemetry_samples_ts_idx")


def test_migrations_match_the_models(client):
    """Alembic head (applied on startup) and the SQLAlchemy models describe the same schema."""
    with client.app.state.db.engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": False, "include_object": _not_timescale_managed})
        diff = compare_metadata(ctx, Base.metadata)
    assert diff == []
