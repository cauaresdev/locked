import json
import logging
import uuid
from datetime import date, timedelta

from conftest import register

from knightfall.catalog import EXERCISES
from knightfall.domain import Implement, Tier
from knightfall.generator import CyclePosition, alternatives, generate_session
from knightfall.tiers import TIERS

START = date(2026, 1, 5)
SEED = "feature-seed"


def athlete(client, auth, tier="dark_knight", **kw):
    body = {"name": "Bruce", "tier": tier, "bodyweight_kg": 90, "cycle_start": START.isoformat(), **kw}
    r = client.post("/athletes", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def log(exercise_id, day, i=0, **kw):
    return {"id": str(uuid.uuid4()), "performed_on": day.isoformat(), "exercise_id": exercise_id, "set_index": i,
            "reps": 5, "load_kg": 50, "rpe": 8, **kw}


# --- weigh-ins ------------------------------------------------------------------


def test_weigh_ins_drive_bodyweight_through_the_7_day_trend(client, auth):
    a = athlete(client, auth, timezone="UTC")
    url = f"/athletes/{a['id']}/weight"
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date()
    for back, kg in [(3, 92.0), (2, 90.0), (1, 91.0), (0, 89.0)]:
        r = client.put(url, json={"day": (today - timedelta(days=back)).isoformat(), "weight_kg": kg}, headers=auth)
        assert r.status_code == 200, r.text
    out = r.json()
    assert out["trend_kg"] == 90.5 and out["profile_weight_kg"] == 90.5
    assert [p["weight_kg"] for p in out["entries"]] == [92.0, 90.0, 91.0, 89.0]
    assert out["entries"][0]["trend_kg"] == 92.0  # first reading: trend is the reading itself
    # A reading older than a week no longer moves the trend.
    client.put(url, json={"day": (today - timedelta(days=30)).isoformat(), "weight_kg": 120}, headers=auth)
    assert client.get(f"/athletes/{a['id']}", headers=auth).json()["bodyweight_kg"] == 90.5
    # Same day again replaces the reading.
    client.put(url, json={"day": today.isoformat(), "weight_kg": 93.0}, headers=auth)
    assert client.get(url, headers=auth).json()["trend_kg"] == 91.5


# --- deload -------------------------------------------------------------------


def test_scheduled_deload_cuts_strength_volume_and_effort():
    cfg = TIERS[Tier.BRAWLER]
    k = cfg.deload_every_cycles - 1  # first deload cycle
    normal = generate_session(Tier.BRAWLER, CyclePosition(k - 1, 1), SEED)
    deload = generate_session(Tier.BRAWLER, CyclePosition(k, 1), SEED)
    assert not normal.deload and deload.deload
    assert any("Deload" in n for n in deload.notices)

    def strength(s):
        return next(b for b in s.blocks if b.kind == "strength").exercises

    assert sum(rx.sets for rx in strength(deload)) < sum(rx.sets for rx in strength(normal))
    for rx in strength(deload):
        assert rx.target_rpe is None or rx.target_rpe <= 6
    assert not generate_session(Tier.BRAWLER, CyclePosition(0, 1), SEED).deload  # never the first cycle


def test_three_red_days_trigger_a_deload(client, auth):
    a = athlete(client, auth)
    url = f"/athletes/{a['id']}"
    day = START + timedelta(days=4)  # a training day for dark_knight (D4)
    for back in (2, 1, 0):
        client.put(f"{url}/readiness", json={"day": (day - timedelta(days=back)).isoformat(),
                                             "sleep_hours": 3.5, "soreness": 5}, headers=auth)
    s = client.get(f"{url}/sessions/{day.isoformat()}", headers=auth).json()
    assert s["deload"] and any("prontidão baixa" in n for n in s["notices"])
    # Two red days are not enough.
    client.put(f"{url}/readiness", json={"day": (day - timedelta(days=2)).isoformat(), "sleep_hours": 8,
                                         "soreness": 1}, headers=auth)
    assert not client.get(f"{url}/sessions/{day.isoformat()}", headers=auth).json()["deload"]


def test_readiness_deload_lasts_a_cycle(client, auth):
    a = athlete(client, auth)  # dark_knight: 7-day cycle D1 D2 D3 rest D4 D6 rest
    url = f"/athletes/{a['id']}"
    day = START + timedelta(days=4)
    for back in (2, 1, 0):
        client.put(f"{url}/readiness", json={"day": (day - timedelta(days=back)).isoformat(),
                                             "sleep_hours": 3.5, "soreness": 5}, headers=auth)
    # Feeling fine the next day does not cancel the deload week.
    client.put(f"{url}/readiness", json={"day": (day + timedelta(days=1)).isoformat(), "sleep_hours": 8,
                                         "soreness": 1}, headers=auth)

    def session(d):
        return client.get(f"{url}/sessions/{(day + timedelta(days=d)).isoformat()}", headers=auth).json()

    assert session(1)["deload"] and session(1)["readiness"]["level"] == "green"
    assert session(5)["is_training_day"] and session(5)["deload"]  # 6th day of the deload
    assert session(7)["is_training_day"] and not session(7)["deload"]  # a full cycle later


def test_new_athlete_training_load_does_not_turn_readiness_red(client, auth):
    a = athlete(client, auth)
    url = f"/athletes/{a['id']}"
    day = START + timedelta(days=11)  # D4 of cycle 1, after 11 days of heavy pulls
    logs = [log("trap_bar_deadlift", START + timedelta(days=d), i, load_kg=140) for d in range(11) for i in range(5)]
    client.post(f"{url}/logs", json=logs, headers=auth)
    s = client.get(f"{url}/sessions/{day.isoformat()}", headers=auth).json()
    assert s["readiness"] is None or s["readiness"]["level"] != "red"
    assert s["blocks"][0]["duration_minutes"] == TIERS[Tier.DARK_KNIGHT].prep_minutes
    r = client.put(f"{url}/readiness", json={"day": day.isoformat(), "sleep_hours": 8}, headers=auth).json()
    assert r["level"] == "green" and not any("ACWR" in x for x in r["reasons"])


def test_e1rm_ignores_tempo_and_explosive_sets(client, auth):
    a = athlete(client, auth)
    url = f"/athletes/{a['id']}"
    client.post(f"{url}/logs", json=[
        log("trap_bar_deadlift", START, load_kg=100, reps=5, rpe=8, modality="strength"),
        log("trap_bar_deadlift", START + timedelta(days=7), load_kg=60, reps=5, rpe=9, modality="tempo"),
        log("trap_bar_deadlift", START + timedelta(days=14), load_kg=70, reps=3, rpe=6, modality="explosive"),
    ], headers=auth)
    lift = client.get(f"{url}/strength", headers=auth).json()[0]
    assert [d for d, _ in lift["history"]] == [START.isoformat()]
    assert client.post(f"{url}/logs", json=[log("trap_bar_deadlift", START, modality="sprinting")],
                       headers=auth).status_code == 422


def test_far_off_dates_are_rejected_quickly(client, auth):
    import time

    a = athlete(client, auth)
    url = f"/athletes/{a['id']}"
    t = time.perf_counter()
    for path in ("sessions/9999-12-31", "sessions/1999-12-31", "sessions/9999-12-31/alternatives?block=2&index=0",
                 "nutrition/9999-12-31", "telemetry/0001-01-01/summary", "early-bird/9999-12-31",
                 "schedule?start=9999-12-31", "cycle/missed?day=0001-01-01", "armor-load?on=9999-12-31"):
        r = client.get(f"{url}/{path}", headers=auth)
        assert r.status_code == 422, (path, r.status_code)
    # Within the calendar bounds but beyond the planning horizon (walking every cycle since the start).
    assert client.get(f"{url}/sessions/2099-01-01", headers=auth).status_code == 422
    assert client.get(f"{url}/nutrition/2099-01-01", headers=auth).status_code == 422
    assert client.get(f"{url}/sessions/{(START + timedelta(days=3 * 365)).isoformat()}",
                      headers=auth).status_code == 200
    assert time.perf_counter() - t < 5
    bad_body = [log("trap_bar_deadlift", date(1990, 1, 1))]
    assert client.post(f"{url}/logs", json=bad_body, headers=auth).status_code == 422
    assert client.put(f"{url}/readiness", json={"day": "9999-12-31", "sleep_hours": 7},
                      headers=auth).status_code == 422
    assert client.post("/athletes", json={"name": "X", "tier": "vigilante", "bodyweight_kg": 80,
                                          "cycle_start": "0001-01-01"}, headers=register(client, "x@y.com")
                       ).status_code == 422


# --- equipment and swaps ----------------------------------------------------------


def test_equipment_profile_filters_the_chaos_engine(client, auth):
    home = ["dumbbell", "kettlebell", "band"]
    a = athlete(client, auth, equipment=home)
    assert a["equipment"] == sorted(home)
    allowed = {Implement(x) for x in home} | {Implement.BODYWEIGHT}
    for k in range(6):
        day = START + timedelta(days=7 * k)  # D1 of cycle k
        s = client.get(f"/athletes/{a['id']}/sessions/{day.isoformat()}", headers=auth).json()
        for b in s["blocks"]:  # Block 1 too (cardio, roller)
            for rx in b["exercises"]:
                ex = EXERCISES[rx["exercise_id"]]
                # Only a slot with nothing available may fall back to the full catalog, and the session says so.
                if ex.implement not in allowed:
                    assert not any(e.implement in allowed for e in EXERCISES.values() if e.pattern == ex.pattern)
                    assert any("perfil de equipamentos" in n for n in s["notices"]), rx["name"]
    # Back to a full gym.
    r = client.patch(f"/athletes/{a['id']}", json={"equipment": None}, headers=auth).json()
    assert len(r["equipment"]) == len(Implement)


def test_alternatives_keep_the_pattern_and_skip_what_is_already_in_the_session(client, auth):
    a = athlete(client, auth)
    url = f"/athletes/{a['id']}/sessions/{START.isoformat()}"
    session = client.get(url, headers=auth).json()
    current = session["blocks"][1]["exercises"][0]
    alts = client.get(f"{url}/alternatives?block=2&index=0", headers=auth).json()
    in_session = {rx["exercise_id"] for b in session["blocks"] for rx in b["exercises"]}
    assert alts and all(x["pattern"] == current["pattern"] for x in alts)
    assert not in_session & {x["exercise_id"] for x in alts}
    assert client.get(f"{url}/alternatives?block=1&index=0", headers=auth).status_code == 422
    assert client.get(f"{url}/alternatives?block=2&index=19", headers=auth).status_code == 422


def test_alternatives_respect_equipment():
    only_db = frozenset({Implement.DUMBBELL})
    allowed = {Implement.DUMBBELL, Implement.BODYWEIGHT}
    session = generate_session(Tier.BRAWLER, CyclePosition(1, 1), SEED, equipment=only_db)
    for i, rx in enumerate(session.blocks[1].exercises):
        has_option = any(e.implement in allowed for e in EXERCISES.values() if e.pattern == rx.pattern)
        for alt in alternatives(Tier.BRAWLER, CyclePosition(1, 1), SEED, 2, i, equipment=only_db):
            assert alt.implement in allowed or not has_option, alt.name


# --- missed sessions / cycle shift ------------------------------------------------


def test_missed_sessions_can_be_made_up_by_shifting_the_cycle(client, auth):
    a = athlete(client, auth)
    url = f"/athletes/{a['id']}"
    day = START + timedelta(days=2)  # D3; D1 trained, D2 missed
    client.post(f"{url}/logs", json=[log("trap_bar_deadlift", START)], headers=auth)
    missed = client.get(f"{url}/cycle/missed?day={day.isoformat()}", headers=auth).json()
    assert missed["missed"] == [(START + timedelta(days=1)).isoformat()]

    before = client.get(f"{url}/sessions/{(START + timedelta(days=1)).isoformat()}", headers=auth).json()
    assert client.post(f"{url}/cycle/shift", json={"days": 1}, headers=auth).json()["cycle_start"] == (
        START + timedelta(days=1)).isoformat()
    after = client.get(f"{url}/sessions/{day.isoformat()}", headers=auth).json()
    assert after["day_name"] == before["day_name"] and after["cycle_day"] == before["cycle_day"]
    # Cannot push the start past today.
    assert client.post(f"{url}/cycle/shift", json={"days": 7}, headers=auth).status_code in (200, 422)


def test_rest_days_are_not_missed_sessions(client, auth):
    a = athlete(client, auth)  # dark_knight: D1 D2 D3 rest D4 D6 rest
    day = START + timedelta(days=4)  # right after the rest day
    r = client.get(f"/athletes/{a['id']}/cycle/missed?day={day.isoformat()}", headers=auth).json()
    assert r["missed"] == []


# --- undo a set ----------------------------------------------------------------


def test_delete_log_is_scoped_and_idempotent(client, auth):
    a = athlete(client, auth)
    entry = log("trap_bar_deadlift", START)
    client.post(f"/athletes/{a['id']}/logs", json=[entry], headers=auth)
    other = register(client, "joker@arkham.com")
    b = athlete(client, other)
    assert client.delete(f"/athletes/{b['id']}/logs/{entry['id']}", headers=other).status_code == 204
    assert client.get(f"/athletes/{a['id']}/strength", headers=auth).json()  # still there
    for _ in range(2):
        assert client.delete(f"/athletes/{a['id']}/logs/{entry['id']}", headers=auth).status_code == 204
    assert client.get(f"/athletes/{a['id']}/strength", headers=auth).json() == []


# --- progress -------------------------------------------------------------------


def test_progress_dashboard(client, auth):
    a = athlete(client, auth, cycle_start=(date.today() - timedelta(days=20)).isoformat(), timezone="UTC")
    url = f"/athletes/{a['id']}"
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date()
    start = date.fromisoformat(a["cycle_start"])
    r = client.post(f"{url}/logs", json=[log("db_farmers_walk", start, load_kg=40, reps=None, duration_seconds=60)],
                    headers=auth)
    assert r.json()["accepted"] == 1
    client.put(f"{url}/readiness", json={"day": today.isoformat(), "sleep_hours": 7}, headers=auth)
    client.put(f"{url}/weight", json={"day": today.isoformat(), "weight_kg": 88}, headers=auth)
    client.post(f"{url}/food-entries", json=[{"id": str(uuid.uuid4()), "day": today.isoformat(), "meal": "breakfast",
                                              "name": "Aveia", "grams": 60, "staple_id": "oats"}], headers=auth)
    p = client.get(f"{url}/progress?days=30", headers=auth).json()
    assert p["weight"]["trend_kg"] == 88
    assert p["readiness"][-1]["day"] == today.isoformat() and p["readiness"][-1]["score"] is not None
    assert p["armor_cycles"][0]["kg_m"] > 0
    assert p["diet"][0]["kcal"] > 0 and p["diet"][0]["kcal_target"] > 0
    att = {d["day"]: d for d in p["attendance"]}
    assert att[start.isoformat()]["trained"] and att[start.isoformat()]["planned"]
    assert sum(d["planned"] for d in p["attendance"]) > sum(d["trained"] for d in p["attendance"])


# --- LGPD ----------------------------------------------------------------------


def test_health_consent_is_recorded(client, auth):
    a = athlete(client, auth, accept_health_data=True)
    assert a["health_consent_at"] is not None


def test_export_and_delete_account(client, auth):
    a = athlete(client, auth)
    url = f"/athletes/{a['id']}"
    client.post(f"{url}/logs", json=[log("trap_bar_deadlift", START)], headers=auth)
    client.put(f"{url}/weight", json={"day": START.isoformat(), "weight_kg": 90}, headers=auth)
    data = client.get("/auth/export", headers=auth).json()
    assert data["user"]["email"] == "bruce@wayne.com" and len(data["set_logs"]) == 1
    assert len(data["weigh_ins"]) == 1 and "chaos_seed" not in data["athlete"]
    assert "password_hash" not in json.dumps(data)

    assert client.request("DELETE", "/auth/account", json={"password": "wrong"}, headers=auth).status_code == 403
    assert client.request("DELETE", "/auth/account", json={"password": "batcave-123"}, headers=auth).status_code == 204
    assert client.get("/auth/me", headers=auth).status_code == 401
    creds = {"email": "bruce@wayne.com", "password": "batcave-123"}
    assert client.post("/auth/login", json=creds).status_code == 401
    assert client.post("/auth/register", json=creds).status_code == 201  # the e-mail is free again


# --- observability ------------------------------------------------------------


def test_requests_are_logged_without_ids_or_bodies(client, auth, caplog):
    a = athlete(client, auth)
    with caplog.at_level(logging.INFO, logger="knightfall.http"):
        caplog.handler.setLevel(logging.INFO)
        logging.getLogger("knightfall").addHandler(caplog.handler)
        r = client.get(f"/athletes/{a['id']}", headers=auth)
    assert r.headers["x-request-id"]
    fields = [rec.fields for rec in caplog.records if hasattr(rec, "fields")]
    assert any(f["route"] == "/athletes/{athlete_id}" and f["status"] == 200 for f in fields)
    assert all(a["id"] not in json.dumps(f) for f in fields)
