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
    # Net of resting energy: (15.41 - 90/60) kcal/min x 10 min.
    assert s.kcal == pytest.approx(139, abs=1) and s.minutes_by_zone == {4: 10.0}
    gappy = [Sample(T0, 150), Sample(T0 + timedelta(minutes=30), 150)]  # strap dropped for 30 min
    assert summarize_hr(gappy, hrmax=185, weight_kg=90, age=35, sex="male").kcal <= 2


def test_resting_heart_rate_is_not_training_energy():
    # A day of sitting around (Keytel alone would say ~4 kcal/min at 80 bpm) adds nothing.
    assert summarize_hr(hr_series(80, 60), hrmax=185, weight_kg=90, age=35, sex="male").kcal == 0
    assert summarize_hr(hr_series(85, 60), hrmax=None, weight_kg=90, age=35, sex="male").kcal == 0
    # Above the activity threshold only the net part counts: never more than gross Keytel minus 1 MET.
    walk = summarize_hr(hr_series(100, 60), hrmax=185, weight_kg=90, age=35, sex="male").kcal
    assert walk == pytest.approx(60 * (keytel_kcal_per_min(100, 90, 35, "male") - 1.5), abs=1)


def test_early_bird_streak_breaks_once_todays_window_closes():
    today = T0.date()
    done = {today - timedelta(days=d) for d in (1, 2)}
    assert streak(done, today) == 2  # today still open
    assert streak(done, today, today_open=False) == 0  # today's window closed without 20 min
    assert streak(done | {today}, today, today_open=False) == 3


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


def test_e1rm_uses_straight_sets_from_the_last_60_days():
    from knightfall.domain import Modality
    from knightfall.strength import LOOKBACK_MAX_AGE_DAYS

    d = date(2026, 3, 1)
    straight = SetRecord(d, "trap_bar_deadlift", reps=5, load_kg=100, rpe=8, modality=Modality.STRENGTH)
    tempo = SetRecord(d + timedelta(days=3), "trap_bar_deadlift", reps=5, load_kg=60, rpe=9, modality=Modality.TEMPO)
    fast = SetRecord(d + timedelta(days=5), "trap_bar_deadlift", reps=3, load_kg=70, rpe=6,
                     modality=Modality.EXPLOSIVE)
    legacy = SetRecord(d + timedelta(days=7), "trap_bar_deadlift", reps=5, load_kg=90, rpe=8)  # no modality sent
    hist = e1rm_history([straight, tempo, fast, legacy], "trap_bar_deadlift")
    assert [p.day for p in hist] == [straight.performed_on, legacy.performed_on]
    # Calendar lookback: a two-month-old best no longer counts.
    later = d + timedelta(days=LOOKBACK_MAX_AGE_DAYS + 1)
    assert current_e1rm(hist, later) == hist[-1].e1rm_kg
    assert current_e1rm(hist, d + timedelta(days=LOOKBACK_MAX_AGE_DAYS + 30)) is None
    assert current_e1rm(hist) == max(p.e1rm_kg for p in hist)


def test_explosive_work_is_prescribed_as_a_share_of_1rm():
    from knightfall.catalog import EXERCISES
    from knightfall.domain import Modality
    from knightfall.progression import recommend_load

    ex = EXERCISES["trap_bar_deadlift"]
    hist = [SetRecord(date(2026, 3, 1), "trap_bar_deadlift", reps=5, load_kg=100, rpe=8, modality=Modality.STRENGTH)]
    e1rm = current_e1rm(e1rm_history(hist, ex.id))  # 100 / 0.811 = 123.3
    assert recommend_load(ex, hist, 3, 7, 90, Modality.EXPLOSIVE) == 80.0  # 65 % of 123.3, rounded down
    assert recommend_load(ex, hist, 3, 7, 90, Modality.STRENGTH) == prescribe(e1rm, 3, 7, 2.5)
    # Bodyweight speed work: 65 % of (body + belt) is below body mass, so no added load.
    pull = EXERCISES["strict_pull_up"]
    weighted = [SetRecord(date(2026, 3, 1), "strict_pull_up", reps=5, load_kg=20, rpe=8)]
    assert recommend_load(pull, weighted, 3, 7, 90, Modality.EXPLOSIVE) == 0.0


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


def test_strength_block_is_costed_with_met_not_heart_rate(client, auth):
    import uuid
    from datetime import date, timezone

    start = date(2026, 1, 5)
    a = client.post("/athletes", json={"name": "B", "tier": "dark_knight", "bodyweight_kg": 90, "birth_year": 1986,
                                       "sex": "male", "cycle_start": start.isoformat()}, headers=auth).json()
    url = f"/athletes/{a['id']}"
    t0 = datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc)
    hr = [{"ts": (t0 + timedelta(seconds=i)).isoformat(), "kind": "hr", "value": 150} for i in range(60 * 60)]
    client.post(f"{url}/telemetry", json=hr, headers=auth)
    hr_only = client.get(f"{url}/telemetry/{start.isoformat()}/summary", headers=auth).json()["kcal"]

    session = client.get(f"{url}/sessions/{start.isoformat()}", headers=auth).json()
    lift = next(b for b in session["blocks"] if b["kind"] == "strength")["exercises"][0]["exercise_id"]
    logs = [{"id": str(uuid.uuid4()), "performed_on": start.isoformat(), "exercise_id": lift, "set_index": i,
             "reps": 5, "load_kg": 60, "rpe": 8, "performed_at": (t0 + timedelta(minutes=20 + 5 * i)).isoformat()}
            for i in range(5)]  # strength block from 10:20 to 10:40
    assert client.post(f"{url}/logs", json=logs, headers=auth).json()["accepted"] == 5
    split = client.get(f"{url}/telemetry/{start.isoformat()}/summary", headers=auth).json()["kcal"]

    # 24 min (block + padding) at MET 5 = 4 net MET x 90 kg x 24/60 h = 144 kcal instead of Keytel's estimate.
    assert split < hr_only
    keytel_per_min = hr_only / 60
    assert split == pytest.approx(keytel_per_min * 36 + 144, abs=3)
    nutrition = client.get(f"{url}/nutrition/{start.isoformat()}", headers=auth).json()
    assert nutrition["session_kcal_source"] == "telemetry" and nutrition["session_kcal"] == pytest.approx(split, abs=1)
