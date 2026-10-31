from datetime import date, timedelta

import pytest

from knightfall.armor import armor_load
from knightfall.catalog import EXERCISES
from knightfall.progression import suggest_load
from knightfall.readiness import HrvSignal, ReadinessInputs, acwr, hrv_signal, joint_stress, score
from knightfall.records import SetRecord

D = date(2026, 3, 1)


def rec(exercise_id, load=None, rpe=None, reps=None, duration=None, distance=None, day=D):
    return SetRecord(day, exercise_id, reps=reps, load_kg=load, duration_seconds=duration, distance_m=distance, rpe=rpe)


def test_suggest_load_follows_rpe():
    db = EXERCISES["db_bench_press"]
    assert suggest_load(db, None, 8) is None
    assert suggest_load(db, rec("db_bench_press", 30, rpe=8), 8) == 30
    assert suggest_load(db, rec("db_bench_press", 30, rpe=7), 8) == 32  # +1 increment
    assert suggest_load(db, rec("db_bench_press", 40, rpe=5.5), 8) == 42
    assert suggest_load(db, rec("db_bench_press", 30, rpe=9.5), 8) == 28
    sled = EXERCISES["sled_push"]
    assert suggest_load(sled, rec("sled_push", 100, rpe=5), 7) == 105


def test_armor_load_units():
    records = [
        rec("db_farmers_walk", load=54, duration=60),  # 54 kg * 66 m
        rec("sled_push", load=100, distance=20),
        rec("strict_pull_up", load=10, reps=4),  # (90+10) * 4 * 0.6
        rec("goblet_squat", load=30, reps=8),  # not armor
    ]
    out = armor_load(records, bodyweight_kg=90)
    assert out.by_kind == {"carry": 3564.0, "sled": 2000.0, "weighted_pull": 240.0}
    assert out.total_kg_m == 5804.0


def test_acwr_flags_spike():
    steady = [rec("trap_bar_deadlift", load=100, day=D - timedelta(days=d)) for d in range(8, 29, 3)]
    spike = [rec("trap_bar_deadlift", load=140, day=D - timedelta(days=d)) for d in range(1, 7)]
    lumbar, _ = acwr(joint_stress(steady + spike, 90), D)
    assert lumbar is not None and lumbar > 1.5
    s = score(ReadinessInputs(sleep_hours=8, lumbar_acwr=lumbar))
    # A spike alone caps the day at amber; it does not force red.
    assert s.level == "amber" and not s.mobility_expanded and any("ACWR" in r for r in s.reasons)


def test_acwr_needs_three_weeks_of_history():
    daily = joint_stress([rec("trap_bar_deadlift", load=100, day=D - timedelta(days=d)) for d in range(1, 11)], 90)
    assert acwr(daily, D) == (None, None)  # new athlete: 10 days would read as a 2.8x "spike"
    steady = joint_stress([rec("trap_bar_deadlift", load=100, day=D - timedelta(days=d)) for d in range(1, 22)], 90)
    lumbar, _ = acwr(steady, D)
    assert lumbar == pytest.approx(1.0)  # 21 days: chronic averaged over the days actually covered
    # Someone who trained long ago and restarts 10 days back does get a ratio (and a real spike).
    lumbar, _ = acwr(daily, D, first_day=D - timedelta(days=200))
    assert lumbar == pytest.approx(2.8)


def test_acwr_alone_never_makes_the_day_red():
    only = score(ReadinessInputs(lumbar_acwr=2.8))
    assert only.level == "amber" and only.score < 70 and not only.mobility_expanded
    mediocre = ReadinessInputs(sleep_hours=6, soreness=3)
    assert score(mediocre).level == "amber"
    assert score(ReadinessInputs(sleep_hours=6, soreness=3, lumbar_acwr=2.0)).level == "amber"
    # ACWR is not a weighted part: a moderate ratio leaves the score alone.
    assert score(ReadinessInputs(sleep_hours=8, lumbar_acwr=1.4)).score == score(ReadinessInputs(sleep_hours=8)).score
    bad = ReadinessInputs(sleep_hours=4, soreness=5, lumbar_acwr=2.0)
    assert score(bad).level == "red"  # red comes from the other signals


def test_hrv_fallback_scores_a_normal_reading_as_normal():
    assert hrv_signal(_series({0: 60, 1: 60, 2: 60, 3: 60}), D) == HrvSignal(1.0)
    assert hrv_signal(_series({0: 58, 1: 60, 2: 60, 3: 60}), D).part == 1.0  # -3 % is noise
    dip = hrv_signal(_series({0: 51, 1: 60, 2: 60, 3: 60}), D)  # -15 %
    assert 0 < dip.part < 1


def test_overshooting_effort_drops_load_by_at_most_one_coarse_step():
    kb = EXERCISES["kb_front_rack_carry"]
    assert suggest_load(kb, rec("kb_front_rack_carry", 8, rpe=10), 8) == 8  # 8 -> 4 kg would be -50 %
    assert suggest_load(kb, rec("kb_front_rack_carry", 24, rpe=10), 8) == 24
    bar = EXERCISES["front_squat"]
    assert suggest_load(bar, rec("front_squat", 100, rpe=10), 8) == 95
    assert suggest_load(bar, rec("front_squat", 101, rpe=10), 8) == 95  # off-grid load: nearest jump
    for load in (8, 12, 16, 20, 24, 32, 40):
        assert load - suggest_load(kb, rec("kb_front_rack_carry", load, rpe=10), 8) <= 4


def test_score_levels():
    assert score(ReadinessInputs()).level == "green"
    good = score(ReadinessInputs(hrv=HrvSignal(1.0), sleep_hours=8, soreness=1))
    assert good.score == 100 and good.level == "green"
    bad = score(ReadinessInputs(hrv=HrvSignal(0.0, "VFC baixa"), sleep_hours=4.5, soreness=5))
    assert bad.level == "red" and "VFC baixa" in bad.reasons


def _series(values_by_offset):
    return {D - timedelta(days=o): v for o, v in values_by_offset.items()}


def test_hrv_uses_rolling_week_against_60_day_baseline():
    import math
    import random

    rng = random.Random(1)
    # Realistic day-to-day noise: lnRMSSD varies ~8 % around its mean.
    baseline = {o: 60 * math.exp(rng.gauss(0, 0.08)) for o in range(7, 67)}
    # One bad night (-33 %) in an otherwise normal week: the 7-day mean absorbs it,
    # where comparing that night alone with the week before would score zero.
    one_bad = _series({**baseline, **{o: 60 for o in range(1, 7)}, 0: 40})
    sig = hrv_signal(one_bad, D)
    assert sig is not None and sig.part > 0.5
    # A whole week suppressed is flagged.
    bad_week = _series({**baseline, **{o: 45 for o in range(0, 7)}})
    sig = hrv_signal(bad_week, D)
    assert sig is not None and sig.part == 0.0 and "linha de base" in sig.reason
    # Normal week: full marks, no reason.
    normal = _series({**baseline, **{o: 60 for o in range(0, 7)}})
    assert hrv_signal(normal, D) == HrvSignal(1.0)


def test_hrv_falls_back_to_last_week_before_a_baseline_exists():
    sig = hrv_signal(_series({0: 42, 1: 70, 2: 70, 3: 70}), D)
    assert sig is not None and sig.part == 0.0 and "últimos 7 dias" in sig.reason
    assert hrv_signal(_series({0: 42, 1: 70}), D) is None  # too little history
    assert hrv_signal(_series({1: 70, 2: 70, 3: 70}), D) is None  # no reading today


def test_every_exercise_has_a_demo_in_the_app():
    """The app shows photos (exerciseMedia.ts) or written steps (howTo.ts) for every catalog exercise."""
    import re
    from pathlib import Path

    from knightfall.catalog import EXERCISES

    engine = Path(__file__).resolve().parents[2] / "mobile" / "src" / "engine"
    photos = set(re.findall(r"^  (\w+): \[require", (engine / "exerciseMedia.ts").read_text(), re.M))
    steps = set(re.findall(r"^  (\w+): \[$", (engine / "howTo.ts").read_text(), re.M))
    assert not (photos | steps) - set(EXERCISES), "demo for an exercise the catalog doesn't have"
    assert not set(EXERCISES) - (photos | steps), sorted(set(EXERCISES) - (photos | steps))


def test_database_urls_from_hosts_get_the_psycopg_driver():
    from knightfall.db import normalize_url

    assert normalize_url("postgres://u:p@h/db?sslmode=require") == "postgresql+psycopg://u:p@h/db?sslmode=require"
    assert normalize_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_url("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_url("sqlite:///./x.db") == "sqlite:///./x.db"
