"""Set logger history, warm-up ramp, weekly muscle volume, body measurements and the nutrition goal."""

import uuid
from datetime import date, datetime, timedelta, timezone

from knightfall import nutrition as nu
from knightfall import volume
from knightfall.catalog import EXERCISES
from knightfall.domain import Tier
from knightfall.generator import CyclePosition, generate_session
from knightfall.progression import warmup_ramp
from knightfall.records import SetRecord
from knightfall.strength import pct_of_1rm


def today() -> date:
    return datetime.now(timezone.utc).date()


def make_athlete(client, auth, **kw):
    body = {"name": "Bruce", "tier": "batfleck", "bodyweight_kg": 90, "cycle_start": today().isoformat(), **kw}
    r = client.post("/athletes", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


# --- set logger history ------------------------------------------------------------


def test_prescription_carries_last_set_best_e1rm_and_warmup():
    d = date(2026, 1, 1)
    history = [
        SetRecord(d, "barbell_bench_press", reps=5, load_kg=100, rpe=8.5),
        SetRecord(d, "barbell_bench_press", reps=8, load_kg=80, rpe=7.5),
        SetRecord(d - timedelta(days=7), "barbell_bench_press", reps=5, load_kg=105, rpe=10),
        SetRecord(d, "dips", reps=10, load_kg=0, rpe=8),
    ]
    s = generate_session(Tier.BATFLECK, CyclePosition(0, 1), "seed", history=history, bodyweight_kg=90)
    top = s.blocks[1].exercises[0]
    assert top.last_set and (top.last_set.on, top.last_set.load_kg, top.last_set.reps) == (d, 100, 5)
    # 105 kg x 5 at RPE 10 (121.7) beats the latest day's 100 x 5 at 8.5: the best ever, not the latest.
    assert top.best_e1rm_kg == round(105 / pct_of_1rm(5, 10), 1) == 121.7
    assert [w.reps for w in top.warmup_sets] == [8, 3]
    assert all(w.load_kg < top.suggested_load_kg for w in top.warmup_sets)
    assert not any("aproximação" in c for c in top.cues)  # the computed ramp replaces the generic rule
    dips = next(rx for rx in s.blocks[1].exercises if rx.exercise_id == "dips")
    assert dips.last_set and dips.best_e1rm_kg is None  # bodyweight: no external 1RM to chase
    backoff = s.blocks[1].exercises[1]
    assert backoff.warmup_sets == []


def test_warmup_ramp_rounds_down_and_skips_light_or_bodyweight():
    assert warmup_ramp(EXERCISES["barbell_bench_press"], 100) == [(50.0, 8), (75.0, 3)]
    assert warmup_ramp(EXERCISES["hack_squat"], 92) == [(45.0, 8), (65.0, 3)]
    assert warmup_ramp(EXERCISES["dips"], 20) == []
    assert warmup_ramp(EXERCISES["barbell_bench_press"], None) == []


# --- weekly volume -------------------------------------------------------------------


def test_weekly_sets_per_muscle():
    t = date(2026, 3, 10)
    recs = [
        SetRecord(t, "barbell_bench_press", reps=8, load_kg=80, rpe=8),
        SetRecord(t - timedelta(days=6), "pec_deck_fly", reps=12, load_kg=40, rpe=8),
        SetRecord(t - timedelta(days=7), "pec_deck_fly", reps=12, load_kg=40, rpe=8),  # last week
        SetRecord(t, "cable_curl", reps=12, load_kg=20, rpe=8),
        SetRecord(t, "cable_triceps_pressdown", reps=12, load_kg=20, rpe=8),
        SetRecord(t, "smith_hip_thrust", reps=10, load_kg=100, rpe=8),
        SetRecord(t, "box_jump", reps=5),  # plyometrics do not count
        SetRecord(t, "elliptical", reps=None),  # nor cardio
    ]
    this_week, last_week = volume.weekly_sets(recs, t)
    assert this_week == {"chest": 2, "biceps": 1, "triceps": 1, "glutes": 1}
    assert last_week == {"chest": 1}
    for ex_id in EXERCISES:  # every muscle the mapping returns is one the app labels
        m = volume.muscle_of(ex_id)
        assert m is None or m in volume.MUSCLE_LABEL


def test_progress_reports_muscle_volume(client, auth):
    a = make_athlete(client, auth)
    logs = [{"id": str(uuid.uuid4()), "performed_on": today().isoformat(), "exercise_id": "leg_extension",
             "set_index": i, "reps": 12, "load_kg": 50, "rpe": 8} for i in range(3)]
    assert client.post(f"/athletes/{a['id']}/logs", json=logs, headers=auth).status_code == 200
    r = client.get(f"/athletes/{a['id']}/progress", headers=auth).json()
    quads = next(m for m in r["muscle_volume"] if m["muscle"] == "quads")
    assert (quads["label"], quads["sets"], quads["target_min"], quads["target_max"]) == ("Quadríceps", 3, 10, 20)


# --- measurements --------------------------------------------------------------------


def test_measurements_roundtrip(client, auth):
    a = make_athlete(client, auth)
    url = f"/athletes/{a['id']}/measurements"
    first = (today() - timedelta(days=30)).isoformat()
    assert client.put(url, json={"day": first, "values": {"arm": 40, "neck": 41}}, headers=auth).status_code == 200
    r = client.put(url, json={"day": today().isoformat(), "values": {"arm": 41.5}}, headers=auth).json()
    arm = next(x for x in r["sites"] if x["site"] == "arm")
    assert (arm["latest_cm"], arm["change_cm"], len(arm["history"])) == (41.5, 1.5, 2)
    r = client.put(url, json={"day": first, "values": {"neck": None}}, headers=auth).json()
    assert next(x for x in r["sites"] if x["site"] == "neck")["latest_cm"] is None
    assert client.put(url, json={"day": first, "values": {"ego": 99}}, headers=auth).status_code == 422
    assert client.put(url, json={"day": first, "values": {"arm": 5}}, headers=auth).status_code == 422
    export = client.get("/auth/export", headers=auth).json()
    assert len(export["body_measurements"]) == 2


# --- nutrition goal ---------------------------------------------------------------------


def test_goal_raises_the_calorie_band():
    lbm = nu.lean_mass(90, 15, 183, "male")
    cut, keep, bulk = (nu.targets(lbm, 300, g) for g in ("cut", "maintain", "bulk"))
    assert cut.total.kcal < keep.total.kcal < bulk.total.kcal
    assert cut.total.protein_g == bulk.total.protein_g  # protein follows lean mass, not the goal


def test_goal_on_the_profile_and_the_nutrition_day(client, auth):
    a = make_athlete(client, auth)
    assert a["nutrition_goal"] == "cut"
    day = f"/athletes/{a['id']}/nutrition/{today().isoformat()}"
    cut = client.get(day, headers=auth).json()
    r = client.patch(f"/athletes/{a['id']}", json={"nutrition_goal": "bulk"}, headers=auth)
    assert r.status_code == 200 and r.json()["nutrition_goal"] == "bulk"
    bulk = client.get(day, headers=auth).json()
    assert bulk["goal"] == "bulk" and bulk["target"]["kcal"] > cut["target"]["kcal"]
    assert any(s["item_id"] == "creatine:breakfast" for s in bulk["supplements"])
    assert client.patch(f"/athletes/{a['id']}", json={"nutrition_goal": "dirty_bulk"},
                        headers=auth).status_code == 422


# --- carb cycling (growth with health) -------------------------------------------------------------------


def test_cycle_targets_follow_grams_per_kg_and_the_day():
    lbm = nu.lean_mass(90, 15, 183, "male")
    high, medium, rest = (nu.cycle_targets(lbm, 90, k) for k in ("high", "medium", "rest"))
    assert (high.total.protein_g, high.total.fat_g, high.total.carbs_g) == (189, 81, 405)  # 2.1 · 0.9 · 4.5 g/kg
    assert medium.total.carbs_g == 292 and rest.total.carbs_g == 202
    assert high.total.kcal > medium.total.kcal > rest.total.kcal
    assert (high.sodium_min_mg, high.sodium_max_mg) == (3000, 4000)
    peri = high.by_meal[nu.Meal.PRE_WORKOUT].carbs_g + high.by_meal[nu.Meal.POST_WORKOUT].carbs_g
    assert abs(peri - 0.6 * high.total.carbs_g) <= 1  # 60% of the carbs around training
    assert 9 * high.total.fat_g >= 0.2 * high.total.kcal - 9


def test_cycle_drops_the_jalali_rules():
    lbm = nu.lean_mass(90, 15, 183, "male")
    late_carbs = nu.Entry("1", nu.Meal.DINNER, "Arroz", 400, 8, 85, 1, 600, nu.Dairy.CONTAINS, nu.Category.CARB)
    cut = {a.code for a in nu.audit([late_carbs], nu.targets(lbm, 0, "cut")).alerts}
    cycle = {a.code for a in nu.audit([late_carbs], nu.cycle_targets(lbm, 90, "rest")).alerts}
    assert {"carb_curfew", "dairy", "sodium_meal"} <= cut
    assert not cycle & {"carb_curfew", "dairy", "sodium_meal"}


def test_cycle_nutrition_day_api(client, auth):
    a = make_athlete(client, auth, tier="norton_fb")  # day 1: box jumps + front squat
    assert client.patch(f"/athletes/{a['id']}", json={"nutrition_goal": "cycle"}, headers=auth).status_code == 200
    url = f"/athletes/{a['id']}/nutrition"
    d1 = client.get(f"{url}/{today().isoformat()}", headers=auth).json()
    assert d1["goal"] == "cycle" and d1["day_kind"] == "high"
    meals = [m["meal"] for m in d1["meals"]]
    assert "pre_workout" in meals and not any(m["carb_curfew"] for m in d1["meals"])
    sup = {s["item_id"] for s in d1["supplements"]}
    assert {"omega3:breakfast", "magnesium:dinner", "collagen_c:pre_workout"} <= sup and "cla:dinner" not in sup
    rest = client.get(f"{url}/{(today() + timedelta(days=2)).isoformat()}", headers=auth).json()  # day 3: rest
    assert rest["day_kind"] == "rest" and rest["target"]["carbs_g"] < d1["target"]["carbs_g"]
    assert "collagen_c:pre_workout" not in {s["item_id"] for s in rest["supplements"]}
    ok = client.put(f"/athletes/{a['id']}/supplements/{today().isoformat()}",
                    json={"item_id": "omega3:breakfast", "taken": True}, headers=auth)
    assert ok.status_code == 200
    water = next(i for i in client.get(f"/athletes/{a['id']}/routine/{today().isoformat()}",
                                       headers=auth).json()["items"] if i["id"] == "water")
    assert water["target"] == 4250  # 45 ml/kg x 90 kg = 4050, rounded up to 250 ml
    supplements = next(i for i in client.get(f"/athletes/{a['id']}/routine/{today().isoformat()}",
                                             headers=auth).json()["items"] if i["id"] == "supplements")
    assert supplements["detail"].startswith("1 de 6")  # 5 daily + collagen on a power day
