from datetime import date, timedelta

from knightfall.armor import armor_load
from knightfall.catalog import EXERCISES
from knightfall.progression import suggest_load
from knightfall.readiness import ReadinessInputs, acwr, joint_stress, score
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
    assert s.level == "red" and s.mobility_expanded


def test_score_levels():
    assert score(ReadinessInputs()).level == "green"
    good = score(ReadinessInputs(hrv_rmssd=70, hrv_baseline=65, sleep_hours=8, soreness=1))
    assert good.score == 100 and good.level == "green"
    bad = score(ReadinessInputs(hrv_rmssd=45, hrv_baseline=65, sleep_hours=4.5, soreness=5))
    assert bad.level == "red"
