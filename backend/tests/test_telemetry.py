from datetime import date, datetime, timedelta, timezone

import pytest

from knightfall.early_bird import evaluate, streak
from knightfall.energy import Sample, hr_max, keytel_kcal_per_min, summarize_hr, zone_of
from knightfall.records import SetRecord
from knightfall.strength import current_e1rm, e1rm_history, pct_of_1rm, prescribe

T0 = datetime(2026, 3, 2, 4, 0, tzinfo=timezone.utc)


def hr_series(bpm, minutes, start=T0, step=1):
    return [Sample(start + timedelta(seconds=i), bpm) for i in range(0, minutes * 60, step)]


def test_hr_max_and_zones():
    assert hr_max(40, None) == 180 and hr_max(40, 195) == 195 and hr_max(None, None) is None
    assert zone_of(135, 180) == 3 and zone_of(80, 180) == 0 and zone_of(180, 180) == 5


def test_keytel_and_gap_capping():
    assert keytel_kcal_per_min(150, 90, 35, "male") == pytest.approx(15.41, abs=0.01)
    s = summarize_hr(hr_series(150, 10), hrmax=185, weight_kg=90, age=35, sex="male")
    assert s.kcal == pytest.approx(154, abs=1) and s.minutes_by_zone == {4: 10.0}
    gappy = [Sample(T0, 150), Sample(T0 + timedelta(minutes=30), 150)]  # strap dropped for 30 min
    assert summarize_hr(gappy, hrmax=185, weight_kg=90, age=35, sex="male").kcal <= 2


def test_early_bird_evaluation():
    hrmax = 180  # zone 126..144
    good = hr_series(135, 21, start=T0 + timedelta(minutes=2))
    assert evaluate(T0, good, hrmax, T0 + timedelta(hours=1)).status == "complete"
    short = hr_series(135, 10)
    assert evaluate(T0, short, hrmax, T0 + timedelta(minutes=12)).status == "in_window"
    assert evaluate(T0, short, hrmax, T0 + timedelta(hours=1)).status == "missed"
    too_hard = hr_series(165, 25)
    assert evaluate(T0, too_hard, hrmax, T0 + timedelta(hours=1)).minutes_in_zone == 0
    late = hr_series(135, 25, start=T0 + timedelta(minutes=31))
    assert evaluate(T0, late, hrmax, T0 + timedelta(hours=1)).status == "missed"
    assert evaluate(None, [], hrmax, T0).status == "not_started"
    assert evaluate(T0, good, None, T0).status == "no_hr_max"


def test_streak():
    d = date(2026, 3, 10)
    days = {d - timedelta(days=i) for i in range(1, 4)}
    assert streak(days, d) == 3  # today still open
    assert streak(days | {d}, d) == 4
    assert streak({d - timedelta(days=3)}, d) == 0


def test_e1rm_and_prescription():
    assert pct_of_1rm(1, 10) == 1.0
    assert pct_of_1rm(4, 8) == pytest.approx(0.837)  # 6 reps to failure
    recs = [SetRecord(date(2026, 3, 1), "db_bench_press", reps=6, load_kg=40, rpe=8)]
    e1rm = current_e1rm(e1rm_history(recs, "db_bench_press"))
    assert e1rm == pytest.approx(40 / pct_of_1rm(6, 8), abs=0.1)
    assert prescribe(e1rm, 6, 8, 2.0) == 40
    assert prescribe(e1rm, 6, 7, 2.0) == 38  # one more rep in reserve -> lighter
    # bodyweight lift: system mass includes bodyweight, only the added load is prescribed
    pull = [SetRecord(date(2026, 3, 1), "strict_pull_up", reps=4, load_kg=10, rpe=8)]
    e = current_e1rm(e1rm_history(pull, "strict_pull_up", 90))
    assert prescribe(e, 4, 8, 2.5, 90) == 10
    assert e1rm_history([SetRecord(date(2026, 3, 1), "db_bench_press", reps=6, load_kg=40, rpe=5)],
                        "db_bench_press") == []  # RPE too low to trust


def test_telemetry_api_and_early_bird(client, auth):
    a = client.post("/athletes", json={"name": "B", "tier": "vigilante", "bodyweight_kg": 90, "birth_year": 1986,
                                       "sex": "male", "timezone": "America/Sao_Paulo"}, headers=auth).json()
    url = f"/athletes/{a['id']}"
    from zoneinfo import ZoneInfo
    local_day = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    woke = datetime.now(ZoneInfo("America/Sao_Paulo")).replace(hour=0, minute=5, second=0, microsecond=0)
    r = client.put(f"{url}/early-bird/{local_day.isoformat()}/wake", json={"woke_at": woke.isoformat()},
                   headers=auth).json()
    hrmax = a["hr_max"]
    assert r["zone_bpm"] == [round(hrmax * 0.7), round(hrmax * 0.8)]
    bpm = round(hrmax * 0.75)
    samples = [{"ts": (woke + timedelta(minutes=1, seconds=i)).isoformat(), "kind": "hr", "value": bpm}
               for i in range(21 * 60)]
    samples += [{"ts": (woke + timedelta(minutes=1, seconds=i)).isoformat(), "kind": "power", "value": 200}
                for i in range(0, 60)]
    assert client.post(f"{url}/telemetry", json=samples, headers=auth).json()["accepted"] == len(samples)
    assert client.post(f"{url}/telemetry", json=samples[:10], headers=auth).json()["duplicates"] == 10
    r = client.get(f"{url}/early-bird/{local_day.isoformat()}", headers=auth).json()
    assert r["status"] == "complete" and r["minutes_in_zone"] >= 20 and r["streak"] == 1
    summary = client.get(f"{url}/telemetry/{local_day.isoformat()}/summary", headers=auth).json()
    assert summary["avg_hr"] == bpm and summary["max_power_w"] == 200 and summary["kcal"] > 0
    naive = [{"ts": "2026-03-02T04:00:00", "kind": "hr", "value": 100}]
    assert client.post(f"{url}/telemetry", json=naive, headers=auth).status_code == 422
    wrong_day = (woke - timedelta(days=2)).isoformat()
    assert client.put(f"{url}/early-bird/{local_day.isoformat()}/wake", json={"woke_at": wrong_day},
                      headers=auth).status_code == 422


def test_pct_of_1rm_is_continuous_and_decreasing_past_the_chart():
    from knightfall.strength import pct_of_1rm

    effs = [1 + i / 10 for i in range(0, 300)]  # 1 .. 30.9 reps to failure
    pcts = [pct_of_1rm(e, 10) for e in effs]
    assert all(b < a for a, b in zip(pcts, pcts[1:]))
    assert abs(pct_of_1rm(12.01, 10) - pct_of_1rm(12, 10)) < 0.001


def test_early_bird_streak_over_several_days(client, auth):
    from zoneinfo import ZoneInfo

    tz = ZoneInfo("America/Sao_Paulo")
    a = client.post("/athletes", json={"name": "B", "tier": "vigilante", "bodyweight_kg": 90, "birth_year": 1986,
                                       "sex": "male", "timezone": "America/Sao_Paulo"}, headers=auth).json()
    url = f"/athletes/{a['id']}"
    today = datetime.now(tz).date()
    bpm = round(a["hr_max"] * 0.75)

    def morning(days_ago: int, minutes: int) -> None:
        d = today - timedelta(days=days_ago)
        woke = datetime(d.year, d.month, d.day, 0, 5, tzinfo=tz)
        client.put(f"{url}/early-bird/{d.isoformat()}/wake", json={"woke_at": woke.isoformat()}, headers=auth)
        hr = [{"ts": (woke + timedelta(seconds=i)).isoformat(), "kind": "hr", "value": bpm}
              for i in range(minutes * 60)]
        assert client.post(f"{url}/telemetry", json=hr, headers=auth).status_code == 200

    for days_ago in (1, 2, 3):
        morning(days_ago, 21)
    morning(4, 10)  # missed: breaks the streak
    morning(5, 21)
    r = client.get(f"{url}/early-bird/{today.isoformat()}", headers=auth).json()
    assert r["status"] == "not_started" and r["streak"] == 3
