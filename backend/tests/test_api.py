import uuid
from datetime import date, timedelta

import pytest
from conftest import register

START = date(2026, 1, 5)


def make_athlete(client, auth, tier="dark_knight", **kw):
    body = {"name": "Bruce", "tier": tier, "bodyweight_kg": 90, "cycle_start": START.isoformat(), **kw}
    return client.post("/athletes", json=body, headers=auth)


def test_routes_require_auth(client, auth):
    a = make_athlete(client, auth).json()
    assert client.get(f"/athletes/{a['id']}").status_code == 401
    assert client.get(f"/athletes/{a['id']}", headers={"Authorization": "Bearer nope"}).status_code == 401
    other = register(client, "joker@arkham.com")
    assert client.get(f"/athletes/{a['id']}", headers=other).status_code == 404


def test_login_logout_and_me(client, auth):
    assert client.get("/auth/me", headers=auth).json() is None
    a = make_athlete(client, auth).json()
    assert client.post("/auth/register", json={"email": "BRUCE@wayne.com", "password": "x" * 8}).status_code == 409
    assert client.post("/auth/login", json={"email": "bruce@wayne.com", "password": "wrong-pass"}).status_code == 401
    r = client.post("/auth/login", json={"email": "bruce@wayne.com", "password": "batcave-123"}).json()
    assert r["athlete_id"] == a["id"]
    h = {"Authorization": f"Bearer {r['token']}"}
    assert client.get("/auth/me", headers=h).json()["id"] == a["id"]
    assert client.post("/auth/logout", headers=h).status_code == 204
    assert client.get("/auth/me", headers=h).status_code == 401
    assert client.get("/auth/me", headers=auth).status_code == 200  # other sessions survive


def test_one_athlete_per_user(client, auth):
    assert make_athlete(client, auth).status_code == 201
    assert make_athlete(client, auth).status_code == 409


def test_brawler_requires_waiver(client, auth):
    assert make_athlete(client, auth, tier="brawler").status_code == 422
    r = make_athlete(client, auth, tier="brawler", accept_brawler_waiver=True)
    assert r.status_code == 201 and r.json()["waiver_accepted_at"]


def test_profile_fields_and_hr_max(client, auth):
    a = make_athlete(client, auth, birth_year=1990, sex="male", timezone="America/Sao_Paulo").json()
    assert a["hr_max"] == round(208 - 0.7 * (date.today().year - 1990))
    r = client.patch(f"/athletes/{a['id']}", json={"hr_max_override": 190, "wake_time": "04:30"}, headers=auth)
    assert r.json()["hr_max"] == 190 and r.json()["wake_time"] == "04:30"
    assert client.patch(f"/athletes/{a['id']}", json={"timezone": "Mars/Base"}, headers=auth).status_code == 422
    assert client.patch(f"/athletes/{a['id']}", json={"wake_time": "25:00"}, headers=auth).status_code == 422


def test_session_and_schedule(client, auth):
    a = make_athlete(client, auth).json()
    s = client.get(f"/athletes/{a['id']}/sessions/{START.isoformat()}", headers=auth).json()
    assert s["tier"] == "dark_knight" and s["cycle_day"] == 1 and s["target_duration_minutes"] == 60
    sched = client.get(f"/athletes/{a['id']}/schedule", params={"start": START.isoformat(), "days": 14},
                       headers=auth).json()
    assert [x["is_training_day"] for x in sched[:7]] == [True, True, True, False, True, True, False]
    assert sched[7]["cycle_index"] == 1
    before = (START - timedelta(days=1)).isoformat()
    assert client.get(f"/athletes/{a['id']}/sessions/{before}", headers=auth).status_code == 422


def test_logs_idempotent_feed_progression_armor_and_strength(client, auth):
    a = make_athlete(client, auth).json()
    day = START
    s = client.get(f"/athletes/{a['id']}/sessions/{day.isoformat()}", headers=auth).json()
    assert s["blocks"][1]["exercises"][0]["exercise_id"] == "db_farmers_walk"
    logs = [{"id": str(uuid.uuid4()), "performed_on": day.isoformat(), "exercise_id": "db_farmers_walk",
             "set_index": i, "load_kg": 54, "duration_seconds": 60, "rpe": 6} for i in range(3)]
    logs.append({"id": str(uuid.uuid4()), "performed_on": day.isoformat(), "exercise_id": "strict_pull_up",
                 "set_index": 0, "reps": 4, "load_kg": 10, "rpe": 8})
    url = f"/athletes/{a['id']}/logs"
    assert client.post(url, json=logs, headers=auth).json() == {"accepted": 4, "duplicates": 0}
    assert client.post(url, json=logs, headers=auth).json() == {"accepted": 0, "duplicates": 4}
    bad = [{**logs[0], "id": str(uuid.uuid4()), "exercise_id": "nope"}]
    assert client.post(url, json=bad, headers=auth).status_code == 422

    armor = client.get(f"/athletes/{a['id']}/armor-load", params={"on": day.isoformat()}, headers=auth).json()
    assert armor["by_kind"]["carry"] == pytest.approx(3 * 54 * 66)
    assert armor["by_kind"]["weighted_pull"] == pytest.approx(100 * 4 * 0.6)

    strength = {x["exercise_id"]: x for x in client.get(f"/athletes/{a['id']}/strength", headers=auth).json()}
    assert "strict_pull_up" in strength and "db_farmers_walk" not in strength  # carries have no reps

    later = [client.get(f"/athletes/{a['id']}/sessions/{(day + timedelta(days=d)).isoformat()}",
                        headers=auth).json() for d in range(1, 60)]
    rx = [e for x in later for b in x["blocks"] for e in b["exercises"]]
    farmer = [e for e in rx if e["exercise_id"] == "db_farmers_walk" and e["target_rpe"]]
    assert farmer and farmer[0]["suggested_load_kg"] > 54
    pull = [e for e in rx if e["exercise_id"] == "strict_pull_up" and e["target_rpe"] and e["reps"]]
    assert pull and all(e["suggested_load_kg"] is not None for e in pull)


def test_readiness_merges_sources_and_expands_block1(client, auth):
    a = make_athlete(client, auth, tier="brawler", accept_brawler_waiver=True).json()
    url = f"/athletes/{a['id']}/readiness"
    day = START + timedelta(days=3)
    for d in range(1, 4):
        client.put(url, json={"day": (day - timedelta(days=d)).isoformat(), "hrv_ms": 70, "hrv_method": "sdnn",
                              "sleep_hours": 8, "source": "healthkit"}, headers=auth)
    client.put(url, json={"day": day.isoformat(), "hrv_ms": 42, "hrv_method": "sdnn", "sleep_hours": 4.5,
                          "source": "healthkit"}, headers=auth)
    r = client.put(url, json={"day": day.isoformat(), "soreness": 5}, headers=auth).json()  # manual add-on
    assert r["level"] == "red" and any("VFC" in x for x in r["reasons"]) and any("sono" in x for x in r["reasons"])
    s = client.get(f"/athletes/{a['id']}/sessions/{day.isoformat()}", headers=auth).json()
    assert s["blocks"][0]["duration_minutes"] == 45 and s["readiness"]["mobility_expanded"]


def test_tier_change_restarts_cycle(client, auth):
    a = make_athlete(client, auth).json()
    url = f"/athletes/{a['id']}"
    assert client.patch(url, json={"tier": "brawler"}, headers=auth).status_code == 422
    r = client.patch(url, json={"tier": "brawler", "accept_brawler_waiver": True}, headers=auth).json()
    assert r["tier"] == "brawler" and r["cycle_start"] == date.today().isoformat() and r["cycle_length"] == 8


def test_today_is_the_athletes_local_day(client, auth):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    days = {}
    for i, tz in enumerate(("Pacific/Kiritimati", "Etc/GMT+12")):  # UTC+14 and UTC-12: always different dates
        h = auth if i == 0 else register(client, f"tz{i}@wayne.com")
        a = client.post("/athletes", json={"name": "B", "tier": "vigilante", "bodyweight_kg": 80, "timezone": tz},
                        headers=h).json()
        assert a["cycle_start"] == datetime.now(ZoneInfo(tz)).date().isoformat()
        days[tz] = a["cycle_start"]
        # Switching tier restarts the cycle on the local day too.
        r = client.patch(f"/athletes/{a['id']}", json={"tier": "dark_knight"}, headers=h).json()
        assert r["cycle_start"] == days[tz]
    assert len(set(days.values())) == 2


def test_patch_ignores_null_for_required_fields(client, auth):
    a = make_athlete(client, auth).json()
    r = client.patch(f"/athletes/{a['id']}", json={"name": None, "bodyweight_kg": None, "body_fat_pct": None},
                     headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Bruce" and r.json()["bodyweight_kg"] == 90


def test_login_is_throttled_per_email(client, auth):
    bad = {"email": "bruce@wayne.com", "password": "wrong-pass"}
    for _ in range(5):
        assert client.post("/auth/login", json=bad).status_code == 401
    r = client.post("/auth/login", json={"email": "bruce@wayne.com", "password": "batcave-123"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    # Other accounts are not locked out by it.
    register(client, "alfred@wayne.com")
    assert client.post("/auth/login", json={"email": "alfred@wayne.com", "password": "batcave-123"}).status_code == 200


def test_unknown_email_and_wrong_password_look_the_same(client, auth):
    a = client.post("/auth/login", json={"email": "nobody@wayne.com", "password": "whatever-1"})
    b = client.post("/auth/login", json={"email": "bruce@wayne.com", "password": "whatever-1"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


def test_throttle_window_slides():
    from knightfall.security import Throttle

    now = [0.0]
    t = Throttle(limit=2, window_s=60, clock=lambda: now[0])
    t.fail("k")
    t.fail("k")
    assert t.retry_after("k") == 61
    now[0] = 61
    assert t.retry_after("k") is None
    t.fail("k")
    t.reset("k")
    assert t.retry_after("k") is None
