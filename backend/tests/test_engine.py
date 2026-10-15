import sys
import threading
from datetime import date

import pytest

from knightfall import chaos
from knightfall.catalog import EXERCISES
from knightfall.chaos import select_day
from knightfall.domain import BlockKind, Mode, Tier
from knightfall.generator import CyclePosition, generate_session, locate
from knightfall.templates import TEMPLATES
from knightfall.tiers import TIERS

SEED = "test-seed"


def test_locate_uses_cycle_length_not_weeks():
    start = date(2026, 1, 1)
    assert locate(start, date(2026, 1, 1), 8) == CyclePosition(0, 1)
    assert locate(start, date(2026, 1, 8), 8) == CyclePosition(0, 8)
    assert locate(start, date(2026, 1, 9), 8) == CyclePosition(1, 1)
    with pytest.raises(ValueError):
        locate(start, date(2025, 12, 31), 8)


def test_brawler_cycle_is_6_on_2_off():
    days = [generate_session(Tier.BRAWLER, CyclePosition(0, d), SEED).is_training_day for d in range(1, 9)]
    assert days == [True] * 6 + [False] * 2


def test_day1_cycle0_reproduces_documented_norton_session():
    s = generate_session(Tier.BRAWLER, CyclePosition(0, 1), SEED)
    assert s.protocol_id == "bvs_heavyweight_phase_2"
    assert s.target_duration_minutes == 94
    assert [b.duration_minutes for b in s.blocks] == [32, 40, 22]
    prep, strength, cond = s.blocks
    assert prep.mandatory_lock
    assert [e.exercise_id for e in prep.exercises] == [
        "elliptical", "rumble_roller_lower", "plank_arm_extension_prep", "spiderman_lunge_stretch", "inchworm"]
    assert prep.exercises[0].duration_seconds == 900
    assert prep.exercises[1].duration_seconds == 540
    assert [e.exercise_id for e in strength.exercises] == [
        "db_farmers_walk", "alt_hanging_knee_up", "half_kneeling_cable_row", "wrestlers_back_bridge",
        "strict_pull_up"]
    pull_up = strength.exercises[-1]
    assert (pull_up.sets, pull_up.reps, pull_up.tempo.notation()) == (6, 4, "4-0-4-1")
    bridge = strength.exercises[3]
    assert (bridge.mode, bridge.sets, bridge.hold_seconds, bridge.intra_set_rest_seconds) == (Mode.HOLD, 2, 15, 5)
    assert cond.execution_style == "amrap"
    assert cond.exercises[0].duration_seconds == 20
    assert cond.exercises[2].reps_sequence == [5, 5, 5]


@pytest.mark.parametrize("template_id", list(TEMPLATES))
def test_chaos_changes_every_slot_between_cycles(template_id):
    for k in range(1, 25):
        prev, cur = select_day(SEED, template_id, k - 1), select_day(SEED, template_id, k)
        for slot, a, b in zip(TEMPLATES[template_id].strength, prev.strength, cur.strength):
            pool = {e.id for e in EXERCISES.values() if e.pattern == slot.pattern
                    and any(m in e.variants for m in slot.modalities)}
            if len(pool) > 1:
                assert a[0] != b[0], (template_id, k, slot.pattern)
                ea, eb = EXERCISES[a[0]], EXERCISES[b[0]]
                assert ea.implement != eb.implement or a[1] != b[1]


def test_chaos_preserves_patterns_and_avoids_repeats_within_a_session():
    for tid, t in TEMPLATES.items():
        for k in range(12):
            sel = select_day(SEED, tid, k)
            for slot, (ex_id, mod) in zip(t.strength + t.conditioning, sel.strength + sel.conditioning):
                assert EXERCISES[ex_id].pattern == slot.pattern
                assert mod in slot.modalities
            ids = [v[0] for v in (sel.cardio, sel.roller, *sel.drills, *sel.strength, *sel.conditioning)]
            assert len(ids) == len(set(ids))


def test_chaos_is_deterministic_per_seed():
    assert select_day("a", "D3", 7) == select_day("a", "D3", 7)
    assert any(select_day("a", "D3", k) != select_day("b", "D3", k) for k in range(1, 6))


def test_chaos_chain_survives_concurrent_requests():
    expected = [select_day("race", "D3", k) for k in range(40)]
    old = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)  # force thread switches mid-computation
    try:
        for _ in range(5):
            chaos._chain.cache_clear()
            threads = [threading.Thread(target=select_day, args=("race", "D3", 39)) for _ in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            assert [select_day("race", "D3", k) for k in range(40)] == expected
    finally:
        sys.setswitchinterval(old)


def test_tiers_scale_volume_and_duration():
    brawler = generate_session(Tier.BRAWLER, CyclePosition(0, 1), SEED)
    vigilante = generate_session(Tier.VIGILANTE, CyclePosition(0, 1), SEED)
    assert vigilante.target_duration_minutes == 45
    assert TIERS[Tier.VIGILANTE].cycle.count(None) == 3
    for b, v in zip(brawler.blocks[1].exercises, vigilante.blocks[1].exercises):
        assert v.sets == max(1, int(b.sets * 0.5 + 0.5))
    assert len(vigilante.blocks[0].exercises) == len(brawler.blocks[0].exercises) - 1


def test_red_readiness_expands_mobility_and_trims_strength():
    from knightfall.domain import ReadinessSummary

    red = ReadinessSummary(score=40, level="red", mobility_expanded=True)
    base = generate_session(Tier.BRAWLER, CyclePosition(2, 3), SEED)
    adj = generate_session(Tier.BRAWLER, CyclePosition(2, 3), SEED, readiness=red)
    assert base.blocks[0].duration_minutes == 32 and adj.blocks[0].duration_minutes == 45
    assert len(adj.blocks[0].exercises) == len(base.blocks[0].exercises) + 2
    assert adj.blocks[0].exercises[0].duration_seconds == base.blocks[0].exercises[0].duration_seconds
    for b, a in zip(base.blocks[1].exercises, adj.blocks[1].exercises):
        assert a.sets == max(1, b.sets - 1)
        if b.target_rpe:
            assert a.target_rpe == b.target_rpe - 1
    assert adj.notices


def test_off_day_is_active_recovery():
    s = generate_session(Tier.BRAWLER, CyclePosition(0, 7), SEED)
    assert not s.is_training_day
    assert [b.kind for b in s.blocks] == [BlockKind.RECOVERY]


def test_brawler_long_run_notice():
    s = generate_session(Tier.BRAWLER, CyclePosition(14, 1), SEED, weeks_in_tier=16)
    assert any("16 semanas" in n for n in s.notices)
