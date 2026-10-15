import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from knightfall.foods import classify_dairy, parse_product
from knightfall.nutrition import (
    Category,
    Dairy,
    Entry,
    Meal,
    audit,
    lean_mass,
    targets,
)

DAY = date(2026, 3, 2)


def test_lean_mass_sources():
    assert lean_mass(103, 7.9, None, None).kg == pytest.approx(94.9)
    assert lean_mass(90, None, 180, "male").source == "boer"
    assert lean_mass(90, None, None, None).source == "assumed"


def test_jalali_targets_floor_ceiling_and_curfew():
    lbm = lean_mass(103, 7.9, None, None)  # 94.9 kg ≈ 209 lb
    rest = targets(lbm, 0)
    assert rest.total.kcal == pytest.approx(12 * 94.9 * 2.20462, abs=1)
    heavy = targets(lbm, 5000)
    assert heavy.total.kcal == heavy.kcal_ceiling == pytest.approx(14 * 94.9 * 2.20462, abs=1)
    mid = targets(lbm, 300)
    assert mid.total.kcal == pytest.approx(rest.total.kcal + 300, abs=1)
    for t in (rest, heavy):
        assert t.by_meal[Meal.DINNER].carbs_g == 0 and t.by_meal[Meal.SNACK].carbs_g == 0
        assert t.by_meal[Meal.BREAKFAST].carbs_g > 0
        assert sum(m.protein_g for m in t.by_meal.values()) == pytest.approx(t.total.protein_g, abs=2)


def e(meal, sodium=0, carbs=0, dairy=Dairy.NONE, category=None, name="x"):
    return Entry(str(uuid.uuid4()), meal, name, 100, 10, carbs, 2, sodium, dairy, category)


def test_audit_alerts():
    t = targets(lean_mass(90, 12, None, None), 0)
    codes = lambda entries: {a.code for a in audit(entries, t).alerts}  # noqa: E731
    assert codes([e(Meal.BREAKFAST, sodium=400)]) == set()
    assert "sodium_meal" in codes([e(Meal.BREAKFAST, sodium=300), e(Meal.BREAKFAST, sodium=250)])
    assert "dairy" in codes([e(Meal.SNACK, dairy=Dairy.CONTAINS)])
    assert codes([e(Meal.POST_WORKOUT, dairy=Dairy.ISOLATE)]) == set()
    assert "carb_curfew" in codes([e(Meal.DINNER, carbs=30)])
    assert "carb_curfew" not in codes([e(Meal.DINNER, carbs=30, category=Category.VEG)])
    day = [e(m, sodium=480) for m in Meal] + [e(Meal.DINNER, sodium=200)]
    assert "sodium_day" in codes(day)


@pytest.mark.parametrize("product,expected", [
    ({"allergens_tags": ["en:milk"]}, Dairy.CONTAINS),
    ({"ingredients_tags": ["en:whey-protein-concentrate"]}, Dairy.CONTAINS),
    ({"product_name": "Hydrolyzed Whey Protein Isolate", "allergens_tags": ["en:milk"],
      "ingredients_tags": ["en:hydrolysed-whey-protein-isolate"]}, Dairy.ISOLATE),
    ({"ingredients_tags": ["en:coconut-milk", "en:cocoa-butter"]}, Dairy.NONE),
    ({"traces_tags": ["en:milk"]}, Dairy.TRACES),
    ({}, Dairy.NONE),
])
def test_classify_dairy(product, expected):
    assert classify_dairy(product)[0] == expected


def test_parse_product_sodium_from_salt_and_kj():
    p = parse_product("1", {"status": 1, "product": {"product_name": "x",
                                                     "nutriments": {"energy_100g": 418.4, "salt_100g": 1.0}}})
    assert p.kcal_100g == 100 and p.sodium_mg_100g == 400
    assert not parse_product("1", {"status": 0}).found


# --- API -----------------------------------------------------------------------


def athlete(client, auth, **kw):
    body = {"name": "Bruce", "tier": "brawler", "accept_brawler_waiver": True, "bodyweight_kg": 103,
            "body_fat_pct": 7.9, "birth_year": 1972, "sex": "male", "cycle_start": DAY.isoformat(), **kw}
    return client.post("/athletes", json=body, headers=auth).json()


def test_barcode_lookup_alerts_and_cache(client, auth):
    r = client.get("/foods/barcode/7891000100103", headers=auth).json()
    assert r["found"] and r["dairy"] == "contains" and r["alerts"][0]["level"] == "red"
    soup = client.get("/foods/barcode/7890000000001", headers=auth).json()
    assert soup["sodium_mg_100g"] == 2000
    assert {a["code"] for a in soup["alerts"]} == {"dairy_traces", "sodium_portion"}
    assert client.get("/foods/barcode/0000000000000", headers=auth).json()["found"] is False
    assert client.get("/foods/barcode/abc", headers=auth).status_code == 422
    assert client.get("/foods/barcode/7891000100103").status_code == 401


def test_nutrition_day_flow(client, auth):
    a = athlete(client, auth)
    url = f"/athletes/{a['id']}"
    day = client.get(f"{url}/nutrition/{DAY.isoformat()}", headers=auth).json()
    assert day["is_training_day"] and day["session_kcal_source"] == "estimate" and day["session_kcal"] > 0
    assert day["lbm_source"] == "body_fat" and day["kcal_floor"] <= day["target"]["kcal"] <= day["kcal_ceiling"]
    assert [m["meal"] for m in day["meals"]] == ["breakfast", "post_workout", "snack", "dinner"]
    assert [m["carb_curfew"] for m in day["meals"]] == [False, False, True, True]

    client.get("/foods/barcode/7890000000001", headers=auth)
    entries = [
        {"id": str(uuid.uuid4()), "day": DAY.isoformat(), "meal": "breakfast", "name": "Aveia", "grams": 80,
         "staple_id": "oats"},
        {"id": str(uuid.uuid4()), "day": DAY.isoformat(), "meal": "dinner", "name": "Sopa", "grams": 60,
         "barcode": "7890000000001"},
        {"id": str(uuid.uuid4()), "day": DAY.isoformat(), "meal": "dinner", "name": "Brócolis", "grams": 200,
         "staple_id": "broccoli"},
    ]
    assert client.post(f"{url}/food-entries", json=entries, headers=auth).json() == {"accepted": 3, "duplicates": 0}
    assert client.post(f"{url}/food-entries", json=entries, headers=auth).json()["duplicates"] == 3
    unknown = [{**entries[1], "id": str(uuid.uuid4()), "barcode": "1234567890123"}]
    assert client.post(f"{url}/food-entries", json=unknown, headers=auth).status_code == 422

    day = client.get(f"{url}/nutrition/{DAY.isoformat()}", headers=auth).json()
    assert day["consumed"]["kcal"] == pytest.approx(0.8 * 379 + 0.6 * 350 + 2 * 35, abs=1)
    codes = {x["code"] for x in day["alerts"]}
    assert {"sodium_meal", "carb_curfew", "dairy_traces"} <= codes
    dinner = next(m for m in day["meals"] if m["meal"] == "dinner")
    assert dinner["consumed"]["sodium_mg"] == pytest.approx(1200 + 82, abs=1)

    client.delete(f"{url}/food-entries/{entries[1]['id']}", headers=auth)
    day = client.get(f"{url}/nutrition/{DAY.isoformat()}", headers=auth).json()
    assert not {"sodium_meal", "carb_curfew"} & {x["code"] for x in day["alerts"]}

    sup = client.put(f"{url}/supplements/{DAY.isoformat()}", json={"item_id": "flaxseed_oil:breakfast",
                                                                   "taken": True}, headers=auth).json()
    assert [s["taken"] for s in sup].count(True) == 1
    assert client.put(f"{url}/supplements/{DAY.isoformat()}", json={"item_id": "x", "taken": True},
                      headers=auth).status_code == 422


def test_session_kcal_from_telemetry(client, auth):
    a = athlete(client, auth, timezone="UTC")
    t0 = datetime(2026, 3, 2, 10, 0, tzinfo=timezone.utc)
    samples = [{"ts": (t0 + timedelta(seconds=i)).isoformat(), "kind": "hr", "value": 150} for i in range(3600)]
    r = client.post(f"/athletes/{a['id']}/telemetry", json=samples, headers=auth).json()
    assert r == {"accepted": 3600, "duplicates": 0}
    day = client.get(f"/athletes/{a['id']}/nutrition/{DAY.isoformat()}", headers=auth).json()
    assert day["session_kcal_source"] == "telemetry"
    assert 700 < day["session_kcal"] < 1100  # ~60 min at 150 bpm (Keytel, 103 kg, 54 y)
