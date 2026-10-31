import sys
import threading
from datetime import date

import pytest

from knightfall import chaos
from knightfall.catalog import EXERCISES
from knightfall.chaos import candidates, select_day
from knightfall.domain import BlockKind, Implement, Mode, Tier
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


def test_brawler_cycle_is_3_on_recovery_3_on_rest():
    days = [generate_session(Tier.BRAWLER, CyclePosition(0, d), SEED) for d in range(1, 9)]
    assert [d.is_training_day for d in days] == [True] * 3 + [False] + [True] * 3 + [False]
    assert [b.kind for b in days[3].blocks] == [BlockKind.RECOVERY]
    assert days[7].blocks == [] and days[7].day_name == "Descanso absoluto"
    assert TIERS[Tier.BRAWLER].sessions_per_cycle == 6


def test_template_day1_cycle0_reproduces_documented_norton_session():
    # The template tiers keep the original Day 1 (Dark Knight: 0.75 of the sets, 3 drills).
    s = generate_session(Tier.DARK_KNIGHT, CyclePosition(0, 1), SEED)
    prep, strength, cond = s.blocks
    assert prep.mandatory_lock
    assert [e.exercise_id for e in prep.exercises] == [
        "elliptical", "rumble_roller_lower", "plank_arm_extension_prep", "spiderman_lunge_stretch", "inchworm"]
    assert [e.exercise_id for e in strength.exercises] == [
        "db_farmers_walk", "alt_hanging_knee_up", "half_kneeling_cable_row", "wrestlers_back_bridge",
        "strict_pull_up"]
    pull_up = strength.exercises[-1]
    assert (pull_up.sets, pull_up.reps, pull_up.tempo.notation()) == (5, 4, "4-0-4-1")
    bridge = strength.exercises[3]
    assert (bridge.mode, bridge.hold_seconds, bridge.intra_set_rest_seconds) == (Mode.HOLD, 15, 5)
    assert cond.execution_style == "amrap"
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
    dark_knight = generate_session(Tier.DARK_KNIGHT, CyclePosition(0, 1), SEED)
    vigilante = generate_session(Tier.VIGILANTE, CyclePosition(0, 1), SEED)
    assert vigilante.target_duration_minutes == 45
    assert TIERS[Tier.VIGILANTE].cycle.count(None) == 3
    for d, v in zip(dark_knight.blocks[1].exercises, vigilante.blocks[1].exercises):
        base = EXERCISES[v.exercise_id].variants[v.modality].sets
        assert v.sets == max(1, int(base * 0.5 + 0.5))
        assert d.sets == max(1, int(base * 0.75 + 0.5))
    assert len(vigilante.blocks[0].exercises) == len(dark_knight.blocks[0].exercises) - 1


def test_red_readiness_expands_mobility_and_trims_strength():
    from knightfall.domain import ReadinessSummary

    red = ReadinessSummary(score=40, level="red", mobility_expanded=True)
    base = generate_session(Tier.DARK_KNIGHT, CyclePosition(2, 3), SEED)
    adj = generate_session(Tier.DARK_KNIGHT, CyclePosition(2, 3), SEED, readiness=red)
    assert base.blocks[0].duration_minutes == 16 and adj.blocks[0].duration_minutes == 24
    assert len(adj.blocks[0].exercises) == len(base.blocks[0].exercises) + 2
    assert adj.blocks[0].exercises[0].duration_seconds == base.blocks[0].exercises[0].duration_seconds
    for b, a in zip(base.blocks[1].exercises, adj.blocks[1].exercises):
        assert a.sets == max(1, b.sets - 1)
        if b.target_rpe:
            assert a.target_rpe == b.target_rpe - 1
    assert adj.notices


def test_off_day_is_active_recovery():
    s = generate_session(Tier.DARK_KNIGHT, CyclePosition(0, 4), SEED)
    assert not s.is_training_day
    assert [b.kind for b in s.blocks] == [BlockKind.RECOVERY]


def test_brawler_long_run_notice():
    s = generate_session(Tier.BRAWLER, CyclePosition(14, 1), SEED, weeks_in_tier=16)
    assert any("16 semanas" in n for n in s.notices)


def _rotation_pairs(template_id, equipment=None, cycles=25):
    """(slot, previous variant, current variant, exercise names the rest of today's session took)."""
    t = TEMPLATES[template_id]
    slots = t.strength + t.conditioning
    for k in range(1, cycles):
        prev, cur = select_day(SEED, template_id, k - 1, equipment), select_day(SEED, template_id, k, equipment)
        today = cur.strength + cur.conditioning
        for i, (slot, a, b) in enumerate(zip(slots, prev.strength + prev.conditioning, today)):
            others = [cur.cardio, cur.roller, *cur.drills, *(v for j, v in enumerate(today) if j != i)]
            taken = {EXERCISES[v[0]].name for v in others}
            yield slot, a, b, taken


@pytest.mark.parametrize("equipment", [None, frozenset({Implement.BODYWEIGHT}), frozenset({Implement.DUMBBELL})])
@pytest.mark.parametrize("template_id", list(TEMPLATES))
def test_chaos_never_repeats_a_slot_identically(template_id, equipment):
    """Strength and conditioning: a slot with options left never keeps the same (exercise, modality), and in
    a full gym a slot with several exercises always changes exercise (sprint has one: its modality alternates)."""
    for slot, a, b, taken in _rotation_pairs(template_id, equipment):
        free = [v for v in candidates(slot.pattern, slot.modalities, equipment) if EXERCISES[v[0]].name not in taken]
        if len(free) > 1:
            assert a != b, (template_id, slot.pattern)
        if len({v[0] for v in free}) > 1 and equipment is None:
            assert a[0] != b[0], (template_id, slot.pattern)


# Bodyweight-only is left out: with one push-up variant D2 needs it in both blocks, and the engine
# repeats rather than leave a hole.
@pytest.mark.parametrize("equipment", [None, frozenset({Implement.DUMBBELL})])
@pytest.mark.parametrize("template_id", list(TEMPLATES))
def test_chaos_never_shows_a_movement_twice_in_a_day(template_id, equipment):
    """Prep drill and core lift share "Plank with Arm Extension" under two ids: a day shows it once."""
    for k in range(25):
        sel = select_day(SEED, template_id, k, equipment)
        names = [EXERCISES[v[0]].name for v in (sel.cardio, sel.roller, *sel.drills, *sel.strength, *sel.conditioning)]
        assert len(names) == len(set(names)), (template_id, k, names)


# Seed "golden". A change here reshuffles every athlete's program: update it only on purpose.
GOLDEN = {
    ("D2", 1): "db_farmers_walk:strength cable_woodchop:strength incline_db_press:tempo "
               "kb_bottoms_up_press:strength smith_hip_thrust:strength airdyne_sprint:explosive "
               "db_lateral_raise:hypertrophy cable_triceps_pressdown:hypertrophy "
               "chest_press_machine:hypertrophy barbell_shrug:hypertrophy",
    ("D3", 4): "trap_bar_carry:strength dead_bug:strength barbell_hip_thrust:isometric leg_press:strength "
               "lateral_squat:strength airdyne_sprint:conditioning smith_hip_thrust:hypertrophy "
               "hanging_leg_raise:hypertrophy band_pull_apart:hypertrophy db_reverse_lunge:hypertrophy",
}
GOLDEN_DIGEST = "0308ebc9ad35893ac84a99338a0addd9f4ac7b4b7ca2b44cdf6fecc584dd4cb4"  # all templates, cycles 0-11


def _golden_selection(tid, k):
    sel = select_day("golden", tid, k)
    return " ".join(f"{e}:{m.value}" for e, m in (*sel.strength, *sel.conditioning))


def test_chaos_golden_schedule():
    import hashlib

    for (tid, k), expected in GOLDEN.items():
        assert _golden_selection(tid, k) == expected
    h = hashlib.sha256()
    for tid in TEMPLATES:
        for k in range(12):
            sel = select_day("golden", tid, k)
            h.update(repr((sel.cardio, sel.roller, sel.drills, sel.strength, sel.conditioning)).encode())
    assert h.hexdigest() == GOLDEN_DIGEST


def test_chaos_does_not_depend_on_catalog_order(monkeypatch):
    from knightfall import catalog

    expected = [select_day("order", tid, k) for tid in TEMPLATES for k in range(8)]
    monkeypatch.setattr(catalog, "_EXERCISES", list(reversed(catalog._EXERCISES)))
    chaos._chain.cache_clear()
    chaos._candidates.cache_clear()
    try:
        assert [select_day("order", tid, k) for tid in TEMPLATES for k in range(8)] == expected
    finally:
        chaos._chain.cache_clear()
        chaos._candidates.cache_clear()


@pytest.mark.parametrize("tier", [Tier.VIGILANTE, Tier.DARK_KNIGHT])
def test_bodyweight_profile_uses_stand_ins_and_flags_the_rest(tier):
    bw = frozenset({Implement.BODYWEIGHT})
    cfg = TIERS[tier]
    for k in range(6):
        for d in range(1, cfg.cycle_length + 1):
            s = generate_session(tier, CyclePosition(k, d), SEED, equipment=bw)
            off = {rx.implement for b in s.blocks for rx in b.exercises if rx.implement != Implement.BODYWEIGHT}
            assert off <= {Implement.ROLLER}, (k, d, off)  # Block 1 included: no bike, KB, dumbbells...
            flagged = [n for n in s.notices if "perfil de equipamentos" in n]
            assert bool(flagged) == bool(off)
            assert all("rolo de liberação" in n for n in flagged)
    full = generate_session(tier, CyclePosition(1, 1), SEED)
    assert not any("perfil de equipamentos" in n for n in full.notices)


def test_full_gym_keeps_regular_exercises_but_swaps_offer_stand_ins():
    from knightfall.generator import alternatives

    for tid in TEMPLATES:
        for k in range(12):
            sel = select_day(SEED, tid, k)
            ids = [sel.cardio[0], sel.roller[0], *(v[0] for v in (*sel.drills, *sel.strength, *sel.conditioning))]
            assert not any(EXERCISES[i].stand_in for i in ids), (tid, k)
    sprint_alts = alternatives(Tier.BRAWLER, CyclePosition(1, 1), SEED, 3, 0)
    assert any(EXERCISES[rx.exercise_id].stand_in for rx in sprint_alts)


def test_alternatives_validate_the_cycle_day():
    from knightfall.generator import alternatives

    for day in (0, 9, -1):
        with pytest.raises(ValueError, match="cycle_day"):
            alternatives(Tier.BRAWLER, CyclePosition(0, day), SEED, 2, 0)
