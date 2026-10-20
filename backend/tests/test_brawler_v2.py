from datetime import date

from knightfall import brawler_v2
from knightfall.catalog import EXERCISES
from knightfall.chaos import select_day
from knightfall.domain import BlockKind, Implement, Modality, Mode, ReadinessSummary, Tier
from knightfall.generator import CyclePosition, alternatives, generate_session
from knightfall.records import SetRecord
from knightfall.templates import TEMPLATES

SEED = "v2-test"
S = Modality.STRENGTH


def session(cycle: int, day: int, **kw):
    return generate_session(Tier.BRAWLER, CyclePosition(cycle, day), SEED, **kw)


def test_cycle1_day1_is_the_matrix():
    s = session(0, 1)
    prep, strength, amrap = s.blocks
    assert prep.mandatory_lock and prep.execution_style == "straight_sets"
    assert prep.rest_seconds == 0  # no rest after the mobility drill
    assert [(rx.exercise_id, rx.sets, rx.rest_seconds) for rx in prep.exercises] == [
        ("t_spine_rotation", 1, None), ("med_ball_slam", 3, 60)]
    row_top, row_backoff, pulldown, farmers = strength.exercises
    assert (row_top.set_role, row_top.sets, row_top.reps, row_top.rest_seconds) == ("top", 1, 5, 180)
    assert (row_backoff.set_role, row_backoff.sets, row_backoff.reps) == ("backoff", 3, 8)
    assert (pulldown.reps, pulldown.reps_max, pulldown.rest_seconds) == (8, 10, 120)
    assert (farmers.mode, farmers.sets, farmers.distance_m) == (Mode.DISTANCE, 3, 40)
    assert amrap.duration_minutes == 10 and amrap.rest_seconds == 0
    assert [(rx.exercise_id, rx.reps) for rx in amrap.exercises] == [
        ("kb_swing", 10), ("inverted_row", 8), ("push_up", 10)]
    assert s.rest_cap_seconds == 240


def test_superset_rests_only_after_the_second_exercise():
    curl, skull = session(0, 6).blocks[1].exercises[1:3]
    assert (curl.exercise_id, curl.rest_seconds) == ("db_hammer_curl", 0)
    assert (skull.exercise_id, skull.rest_seconds) == ("cable_skullcrusher", 90)


def test_neck_work_is_the_plate_curl_not_the_bridge():
    for k in range(10):
        ids = {rx.exercise_id for b in session(k, 5).blocks for rx in b.exercises}
        assert "plate_neck_curl" in ids and "wrestlers_back_bridge" not in ids


def test_primaries_stay_fixed_while_accessories_rotate():
    fixed = {i for i, it in enumerate(brawler_v2.DAYS["V1"].items) if it.rotate is None}
    cycles = [brawler_v2.select(SEED, "V1", k) for k in range(8)]
    for i in fixed:
        assert len({c[i] for c in cycles}) == 1
    rotating = [i for i in range(len(cycles[0])) if i not in fixed]
    for k in range(1, 8):
        assert any(cycles[k][i] != cycles[k - 1][i] for i in rotating)
    for c in cycles:  # a rotated accessory keeps its slot's movement pattern
        for it, v in zip(brawler_v2.DAYS["V1"].items, c):
            assert EXERCISES[v[0]].pattern == EXERCISES[it.variant[0]].pattern


def test_no_movement_twice_in_a_v2_day():
    for day in ("V1", "V2", "V3", "V5", "V6", "V7"):
        for k in range(12):
            variants = brawler_v2.select(SEED, day, k)
            top_backoff = {v for v, it in zip(variants, brawler_v2.DAYS[day].items) if it.role}
            names = [EXERCISES[v[0]].name for v in variants if v not in top_backoff]
            assert len(names) == len(set(names)), (day, k, names)


def test_red_day_drops_the_amrap_and_halves_block_2():
    red = ReadinessSummary(score=30, level="red", mobility_expanded=True)
    base, adj = session(1, 2), session(1, 2, readiness=red)
    assert [b.kind for b in adj.blocks] == [BlockKind.PREP, BlockKind.STRENGTH]
    for b, a in zip(base.blocks[1].exercises, adj.blocks[1].exercises):
        assert a.sets == max(1, int(b.sets * 0.5 + 0.5))
    assert adj.target_duration_minutes < base.target_duration_minutes / 2 + 10
    assert any("AMRAP cancelado" in n for n in adj.notices)


def test_deload_cuts_sets_effort_and_the_amrap():
    first = session(3, 1).blocks[2].exercises[0]  # same cycle with and without the deload: same draw
    history = [SetRecord(date(2026, 1, 1), first.exercise_id, 10, 24, rpe=8, modality=first.modality)]
    normal = session(3, 1, history=history)
    deload = session(3, 1, history=history, low_readiness_streak=True)
    assert deload.deload and not normal.deload
    assert session(4, 1).deload  # and every 5th cycle on schedule
    assert sum(rx.sets for rx in deload.blocks[1].exercises) < sum(rx.sets for rx in normal.blocks[1].exercises)
    assert all(d.target_rpe == n.target_rpe - 2 for n, d in zip(normal.blocks[1].exercises, deload.blocks[1].exercises))
    assert deload.blocks[2].duration_minutes == 10
    n_load, d_load = normal.blocks[2].exercises[0].suggested_load_kg, deload.blocks[2].exercises[0].suggested_load_kg
    assert n_load and d_load == brawler_v2._snap(n_load / 2, first.exercise_id)


def test_backoff_is_80_percent_of_the_top_set():
    history = [SetRecord(date(2026, 1, 1), "barbell_bent_over_row", 5, 80, rpe=8.5, modality=S)]
    top, backoff = session(1, 1, history=history).blocks[1].exercises[:2]
    assert top.suggested_load_kg == 80 and backoff.suggested_load_kg == 64


def test_back_squat_adds_2_kg_per_cycle():
    history = [SetRecord(date(2026, 1, 3), "back_squat", 6, 90, rpe=8, modality=S)]
    squat = session(1, 3, history=history).blocks[1].exercises[0]
    assert squat.suggested_load_kg == 92


def test_rest_day_has_no_session():
    s = session(2, 8)
    assert not s.is_training_day and s.blocks == [] and s.target_duration_minutes == 0


def test_swaps_keep_the_slot_and_skip_top_sets():
    assert alternatives(Tier.BRAWLER, CyclePosition(0, 2), SEED, 2, 0) == []  # bench top set
    squat_alts = alternatives(Tier.BRAWLER, CyclePosition(0, 3), SEED, 2, 0)
    assert squat_alts and all(rx.pattern == "squat" and rx.rest_seconds == 210 for rx in squat_alts)


def test_missing_equipment_is_flagged_for_fixed_lifts():
    bw = frozenset({Implement.BODYWEIGHT})
    s = session(1, 1, equipment=bw)
    implements = {rx.implement for b in s.blocks for rx in b.exercises} - {Implement.BODYWEIGHT}
    assert implements  # the barbell row is fixed: it stays and is flagged
    flagged = " ".join(n for n in s.notices if "perfil de equipamentos" in n)
    assert "barra" in flagged


def test_v2_exercises_stay_out_of_the_template_tiers():
    for tid in TEMPLATES:
        for k in range(12):
            sel = select_day("golden", tid, k)
            ids = [v[0] for v in (sel.cardio, sel.roller, *sel.drills, *sel.strength, *sel.conditioning)]
            assert not any("v2" in EXERCISES[i].tags for i in ids)
