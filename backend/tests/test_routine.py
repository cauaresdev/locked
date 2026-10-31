import uuid
from datetime import date, datetime, timedelta, timezone

from knightfall import routine


def today() -> date:
    return datetime.now(timezone.utc).date()  # athletes default to UTC


def make_athlete(client, auth, tier="full_body", start=None, **kw):
    start = start or today()
    body = {"name": "Bruce", "tier": tier, "bodyweight_kg": 90, "cycle_start": start.isoformat(), **kw}
    r = client.post("/athletes", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def get(client, auth, a, day):
    r = client.get(f"/athletes/{a['id']}/routine/{day.isoformat()}", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def tick(client, auth, a, day, item, **body):
    return client.put(f"/athletes/{a['id']}/routine/{day.isoformat()}/items/{item}", json=body, headers=auth)


# --- pure logic --------------------------------------------------------------------


def test_bedtime_and_water_targets():
    assert routine.bedtime("04:00", 8) == "20:00"
    assert routine.bedtime("06:30", 7.5) == "23:00"
    assert routine.screens_off_time("04:00", 8) == "19:00"
    assert routine.water_target_ml(90, "rest") == 3250  # 3150 rounded up to 250 ml
    assert routine.water_target_ml(90, "training") == 3750


def test_complete_at_80_percent_and_streaks():
    assert routine.Score(8, 10).complete and not routine.Score(7, 10).complete
    assert routine.Score(4, 5).complete and not routine.Score(0, 0).complete
    d = date(2026, 3, 10)
    days = {d - timedelta(days=i) for i in range(1, 4)}
    assert routine.streak(days, d) == 3  # today still open
    assert routine.streak(days | {d}, d) == 4
    assert routine.best_streak(days | {d - timedelta(days=10)}) == 3


def test_auto_items_tick_from_data():
    cfg = routine.Settings("04:00", 8.0, 90, routine.DEFAULT_ENABLED)
    data = routine.DayData("training", sleep_hours=7.8, woke_at_local=datetime(2026, 3, 10, 4, 20),
                           early_bird_complete=True, trained=True, supplements_taken=6, supplements_total=6)
    items = {i.id: i for i in routine.items_for(cfg, data, {})}
    assert all(items[k].done and items[k].auto for k in ("sleep", "wake", "fasted_cardio", "training", "supplements"))
    late = routine.DayData("rest", sleep_hours=6.0, woke_at_local=datetime(2026, 3, 10, 5, 0))
    items = {i.id: i for i in routine.items_for(cfg, late, {})}
    assert not items["sleep"].done and not items["wake"].done
    assert "training" not in items  # rest day


# --- API -----------------------------------------------------------------------------


def test_routine_day_defaults(client, auth):
    a = make_athlete(client, auth)
    r = get(client, auth, a, today())
    ids = [i["id"] for i in r["items"]]
    assert ids[0] == "sleep" and "water" in ids and "training" in ids  # day 1 of Full Body trains
    assert "cold_shower" not in ids  # off by default
    assert r["bedtime"] == "20:00" and r["water_target_ml"] == 3750
    assert r["done"] == 0 and r["streak"] == 0 and len(r["week"]) == 7
    assert {o["id"] for o in r["options"]} == set(routine.OPTIONAL_IDS)


def test_ticks_water_and_streak(client, auth):
    a = make_athlete(client, auth, start=today() - timedelta(days=3))
    yesterday = today() - timedelta(days=1)
    day = get(client, auth, a, yesterday)
    for item in day["items"]:
        if item["kind"] == "water":
            r = tick(client, auth, a, yesterday, "water", value=item["target"])
        else:
            r = tick(client, auth, a, yesterday, item["id"], done=True)
        assert r.status_code == 200, r.text
    r = r.json()
    assert r["complete"] and r["done"] == r["total"]
    assert get(client, auth, a, today())["streak"] == 1  # today is still open
    # Water adds up as an absolute value and is done only at the target.
    r = tick(client, auth, a, today(), "water", value=500).json()
    water = next(i for i in r["items"] if i["id"] == "water")
    assert water["value"] == 500 and not water["done"]
    assert tick(client, auth, a, today(), "water", done=True).status_code == 422  # needs ml


def test_logged_sets_tick_training(client, auth):
    a = make_athlete(client, auth)
    body = [{"id": str(uuid.uuid4()), "performed_on": today().isoformat(), "exercise_id": "hack_squat",
             "set_index": 0, "reps": 8, "load_kg": 100, "rpe": 8}]
    assert client.post(f"/athletes/{a['id']}/logs", json=body, headers=auth).status_code == 200
    training = next(i for i in get(client, auth, a, today())["items"] if i["id"] == "training")
    assert training["done"] and training["auto"]


def test_settings_change_the_items(client, auth):
    a = make_athlete(client, auth)
    r = client.patch(f"/athletes/{a['id']}", json={"routine_items": ["cold_shower", "mobility"],
                                                   "sleep_target_hours": 7.5}, headers=auth)
    assert r.status_code == 200, r.text
    assert set(r.json()["routine_items"]) == {"cold_shower", "mobility", "sleep", "water", "training"}
    ids = {i["id"] for i in get(client, auth, a, today())["items"]}
    assert ids == {"sleep", "cold_shower", "water", "training", "mobility"}
    assert get(client, auth, a, today())["bedtime"] == "20:30"
    bad = client.patch(f"/athletes/{a['id']}", json={"routine_items": ["nap"]}, headers=auth)
    assert bad.status_code == 422


def test_validation(client, auth):
    a = make_athlete(client, auth)
    assert tick(client, auth, a, today(), "nap", done=True).status_code == 422
    assert tick(client, auth, a, today() + timedelta(days=5), "sunlight", done=True).status_code == 422
    assert tick(client, auth, a, today() - timedelta(days=30), "sunlight", done=True).status_code == 422
    assert tick(client, auth, a, today(), "sunlight").status_code == 422  # neither done nor value
    other = client.post("/auth/register", json={"email": "joker@ace.com", "password": "hahaha-123"}).json()
    r = client.get(f"/athletes/{a['id']}/routine/{today().isoformat()}",
                   headers={"Authorization": f"Bearer {other['token']}"})
    assert r.status_code == 404


def test_tiers_list_the_new_programs(client, auth):
    tiers = {t["tier"]: t for t in client.get("/tiers", headers=auth).json()}
    assert {"full_body", "upper_lower", "push_pull_legs", "batfleck"} <= set(tiers)
    assert tiers["batfleck"]["name"] == "Batfleck" and tiers["batfleck"]["sessions_per_cycle"] == 5
