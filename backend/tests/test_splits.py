from datetime import date, timedelta

import pytest

from knightfall import splits
from knightfall.catalog import EXERCISES
from knightfall.domain import MACHINE_STATIONS, BlockKind, Implement, Mode, ReadinessSummary, Tier
from knightfall.generator import CyclePosition, alternatives, generate_session
from knightfall.records import SetRecord
from knightfall.tiers import REST_DAY, TIERS

SPLITS = [t for t, c in TIERS.items() if c.program == "split"]
# A machine gym: stations (no shoulder press machine), cables, dumbbells, barbell, cardio.
MACHINE_GYM = frozenset((MACHINE_STATIONS - {Implement.SHOULDER_PRESS})
                        | {Implement.CABLE, Implement.DUMBBELL, Implement.BARBELL, Implement.ERGOMETER})


def training_days(tier):
    return [d for d, t in enumerate(TIERS[tier].cycle, 1) if t and t != REST_DAY]


def test_every_option_exists_and_every_day_is_in_a_cycle():
    for day in splits.DAYS.values():
        for slot in day.slots:
            for ex_id in (*slot.options, *slot.fallbacks):
                assert ex_id in EXERCISES, (day.id, ex_id)
    scheduled = {t for c in TIERS.values() if c.program == "split" for t in c.cycle if t and t != REST_DAY}
    assert scheduled == set(splits.DAYS)


@pytest.mark.parametrize("tier", SPLITS)
@pytest.mark.parametrize("equipment", [None, MACHINE_GYM, frozenset({Implement.DUMBBELL}), frozenset()])
def test_sessions_validate_and_never_repeat_an_exercise(tier, equipment):
    for k in range(8):
        for d in training_days(tier):
            s = generate_session(tier, CyclePosition(k, d), "seed", equipment=equipment)
            assert s.blocks[0].mandatory_lock and s.blocks[0].kind == BlockKind.PREP
            names = [rx.name for b in s.blocks for rx in b.exercises if rx.set_role != "backoff"]
            if equipment != frozenset():  # bodyweight only: a push-up may have to fill two chest slots
                assert len(names) == len(set(names)), (tier, k, d, names)
            assert (20 if s.deload else 35) <= s.target_duration_minutes <= 80, (tier, d, s.target_duration_minutes)


@pytest.mark.parametrize("tier", SPLITS)
def test_machine_gym_gets_machines_and_no_missing_gear(tier):
    implements = set()
    for d in training_days(tier):
        s = generate_session(tier, CyclePosition(0, d), "seed", equipment=MACHINE_GYM)
        assert not [n for n in s.notices if "perfil de equipamentos" in n], s.notices
        implements |= {rx.implement for b in s.blocks for rx in b.exercises}
    assert implements & MACHINE_STATIONS
    assert Implement.SHOULDER_PRESS not in implements


def test_bodyweight_only_profile_falls_back_instead_of_leaving_holes():
    s = generate_session(Tier.UPPER_LOWER, CyclePosition(0, 5), "seed", equipment=frozenset())
    ids = [rx.exercise_id for b in s.blocks for rx in b.exercises]
    assert "nordic_curl" in ids  # leg curl slot without a leg curl machine
    assert all(EXERCISES[i].implement == Implement.BODYWEIGHT for i in ids if i in ("nordic_curl",))


def test_main_lifts_stay_and_accessories_rotate_once_per_mesocycle():
    meso = TIERS[Tier.PUSH_PULL_LEGS].deload_every_cycles
    cycles = [splits.select("PPL1", k, MACHINE_GYM, meso) for k in range(4 * meso)]
    n_main = len(splits.DAYS["PPL1"].main)
    assert len({c[:n_main] for c in cycles}) == 1
    fly = [c[n_main] for c in cycles]
    per_meso = [fly[m * meso:(m + 1) * meso] for m in range(4)]
    assert all(len(set(block)) == 1 for block in per_meso)  # same accessory all mesocycle: loads can progress
    firsts = [block[0] for block in per_meso]
    assert len(set(firsts)) > 1 and all(a != b for a, b in zip(firsts, firsts[1:]))


def test_effort_ramps_across_the_mesocycle_and_the_load_follows():
    history = [SetRecord(date(2026, 1, 1), "barbell_bench_press", reps=5, load_kg=100, rpe=8.5)]
    weeks = [generate_session(Tier.BATFLECK, CyclePosition(k, 1), "seed", history=history, bodyweight_kg=90)
             for k in range(6)]
    tops = [w.blocks[1].exercises[0] for w in weeks]
    assert [w.meso_week for w in weeks] == [1, 2, 3, 4, 5, 6] and weeks[0].meso_length == 6
    assert [t.target_rpe for t in tops[:5]] == [7.5, 8.0, 8.5, 9.0, 9.5]
    assert weeks[5].deload and tops[5].target_rpe == 6.5  # deload: target -2, no ramp
    loads = [t.suggested_load_kg for t in tops[:5]]
    assert loads == sorted(loads) and loads[0] < loads[-1]
    assert not any("Mesociclo novo" in n for n in weeks[0].notices)
    assert any("Mesociclo novo" in n for n in generate_session(Tier.BATFLECK, CyclePosition(6, 1), "seed").notices)


def test_ramp_never_prescribes_failure_and_conjugate_opts_out():
    week5 = [rx.target_rpe for d in _sessions(Tier.NORTON_FB, 4) for b in d.blocks for rx in b.exercises]
    assert max(r for r in week5 if r is not None) == 9.5
    cj = [[rx.target_rpe for d in _sessions(Tier.CONJUGATE, k) for b in d.blocks for rx in b.exercises]
          for k in (0, 4)]
    assert cj[0] == cj[1]


def test_top_set_and_backoff_share_the_exercise_and_the_backoff_is_lighter():
    history = [SetRecord(date(2026, 1, 1), "barbell_bench_press", reps=5, load_kg=100, rpe=8.5)]
    s = generate_session(Tier.BATFLECK, CyclePosition(2, 1), "seed", history=history, bodyweight_kg=90)  # ramp 0
    top, backoff = s.blocks[1].exercises[:2]
    assert (top.set_role, backoff.set_role) == ("top", "backoff")
    assert top.exercise_id == backoff.exercise_id == "barbell_bench_press"
    assert top.target_rpe == 8.5 and backoff.target_rpe == 7.5
    assert backoff.suggested_load_kg == round(top.suggested_load_kg * 0.8)
    assert top.warmup_sets and not any("aproximação" in c for c in top.cues)  # computed ramp, not the rule
    fresh = generate_session(Tier.BATFLECK, CyclePosition(0, 1), "seed").blocks[1].exercises[0]
    assert fresh.warmup_sets == [] and "aproximação" in fresh.cues[0]  # no load yet: the rule


def test_slot_prescription_adapts_to_unilateral_and_hold_options():
    slot = splits.acc(("single_arm_db_row",), splits._r(3, 10))
    (_, _), rx = splits._fit(slot, "single_arm_db_row")
    assert rx.reps is None and rx.reps_per_side == 10
    slot = splits.acc(("plank",), splits._side(3, 10))
    (_, _), rx = splits._fit(slot, "plank")
    assert rx.mode == Mode.HOLD and rx.sets == 3


def test_red_readiness_and_deload_trim_the_day():
    green = generate_session(Tier.BATFLECK, CyclePosition(0, 6), "seed")  # arms day: incline-walk finisher
    red = generate_session(Tier.BATFLECK, CyclePosition(0, 6), "seed",
                           readiness=ReadinessSummary(score=20, level="red", mobility_expanded=True))
    assert [b.name for b in green.blocks][-1] == "Finalizador"
    assert "Finalizador" not in [b.name for b in red.blocks]
    assert len(red.blocks[0].exercises) == len(green.blocks[0].exercises) + 1
    assert sum(rx.sets for rx in red.blocks[1].exercises) < sum(rx.sets for rx in green.blocks[1].exercises)
    deload = generate_session(Tier.BATFLECK, CyclePosition(5, 6), "seed")
    assert deload.deload and "Finalizador" not in [b.name for b in deload.blocks]


def test_rest_and_recovery_days():
    rest = generate_session(Tier.FULL_BODY, CyclePosition(0, 2), "seed")
    assert not rest.is_training_day and rest.blocks == []
    recovery = generate_session(Tier.FULL_BODY, CyclePosition(0, 6), "seed", equipment=MACHINE_GYM)
    ids = [rx.exercise_id for rx in recovery.blocks[0].exercises]
    assert "rumble_roller_full" not in ids and not recovery.notices  # no roller: mobility instead of a warning


def test_alternatives_offer_the_slot_options_first():
    alts = alternatives(Tier.PUSH_PULL_LEGS, CyclePosition(0, 1), "seed", 3, 0, equipment=MACHINE_GYM)
    current = generate_session(Tier.PUSH_PULL_LEGS, CyclePosition(0, 1), "seed", equipment=MACHINE_GYM)
    fly = current.blocks[2].exercises[0]
    assert alts and fly.exercise_id not in [a.exercise_id for a in alts]
    assert alts[0].exercise_id in splits.FLY
    assert all(a.sets == fly.sets for a in alts)
    # Top set / back-off cannot be swapped one half at a time.
    assert alternatives(Tier.BATFLECK, CyclePosition(0, 1), "seed", 2, 0) == []


# --- athletic rules: power first, sprints away from heavy legs, program volume ----------------------------

def _sessions(tier, k=0, **kw):
    cfg = TIERS[tier]
    return [generate_session(tier, CyclePosition(k, d), "seed", **kw) for d in range(1, cfg.cycle_length + 1)]


@pytest.mark.parametrize("tier", SPLITS)
def test_power_comes_right_after_the_warmup(tier):
    for s in _sessions(tier, equipment=MACHINE_GYM):
        for b in s.blocks:
            if b.name == "Potência":
                assert b.order == 2, (tier, s.day_name)
                assert all(rx.target_rpe is None for rx in b.exercises)  # every rep maximal
                assert all(rx.rest_seconds and 90 <= rx.rest_seconds <= 180 for rx in b.exercises)
            elif b.order > 1 and b.name != "Finalizador":
                # Sprints and agility never come after fatiguing work.
                assert not any(rx.pattern == "sprint" for rx in b.exercises), (tier, s.day_name, b.name)


def _sprints(s):
    return any(rx.pattern == "sprint" for b in s.blocks for rx in b.exercises)


def _heavy_legs(s):
    return any(rx.pattern in ("squat", "hinge") and rx.modality == "strength" and rx.sets >= 3
               for b in s.blocks if b.name == "Principal" for rx in b.exercises)


@pytest.mark.parametrize("tier", SPLITS)
def test_sprint_days_sit_48h_from_heavy_squats_and_deadlifts(tier):
    sessions = _sessions(tier)
    n = len(sessions)
    sprint = [i for i, s in enumerate(sessions) if _sprints(s)]
    heavy = [i for i, s in enumerate(sessions) if _heavy_legs(s)]
    for i in sprint:
        for j in heavy:
            gap = min((i - j) % n, (j - i) % n)  # the cycle repeats: Sunday's neighbour is Monday
            assert gap >= 2, (tier, sessions[i].day_name, sessions[j].day_name)


def test_gotham_armor_hits_its_weekly_volume_bands():
    from knightfall import volume
    from knightfall.records import SetRecord

    start = date(2026, 3, 2)
    recs = [SetRecord(start + timedelta(days=d), rx.exercise_id, reps=10, load_kg=50, rpe=8)
            for d, s in enumerate(_sessions(Tier.GOTHAM_ARMOR, equipment=MACHINE_GYM))
            for b in s.blocks if b.kind != "prep" for rx in b.exercises for _ in range(rx.sets)]
    week, _ = volume.weekly_sets(recs, start + timedelta(days=6))
    for muscle, (lo, hi) in TIERS[Tier.GOTHAM_ARMOR].volume_targets.items():
        assert lo <= week[muscle] <= hi, (muscle, week[muscle], (lo, hi))


def test_effort_targets_follow_rir():
    n1 = _sessions(Tier.NORTON_FB, 2, equipment=MACHINE_GYM)[0]  # mid-mesocycle: no ramp offset
    power, main = n1.blocks[1], n1.blocks[2]
    assert power.name == "Potência" and power.exercises[0].exercise_id == "box_jump"
    top, backoff = main.exercises[:2]
    assert (top.set_role, top.target_rpe, backoff.target_rpe) == ("top", 9.0, 8.0)  # RIR 1 / RIR 2
    carry = main.exercises[-1]
    assert (carry.mode, carry.distance_m, carry.sets) == ("distance", 30, 4)


def test_max_effort_lift_alternates_each_week():
    picks = [_sessions(Tier.CONJUGATE, k)[0].blocks[1].exercises[0].exercise_id for k in range(4)]
    assert set(picks) == {"barbell_bench_press", "barbell_floor_press"}
    assert all(a != b for a, b in zip(picks, picks[1:]))


def test_speed_squats_are_light_and_fast():
    history = [SetRecord(date(2026, 1, 1), "back_squat", reps=5, load_kg=150, rpe=9)]
    cj2 = generate_session(Tier.CONJUGATE, CyclePosition(1, 2), "seed", history=history, bodyweight_kg=80)
    speed = next(rx for b in cj2.blocks for rx in b.exercises if rx.exercise_id == "back_squat")
    assert (speed.sets, speed.reps, speed.modality) == (8, 2, "explosive")
    assert speed.suggested_load_kg < 0.7 * 150 / 0.837 + 2.5  # ~65% of the 1RM, not a top-set load


def test_conjugate_says_who_it_is_for():
    weak = generate_session(Tier.CONJUGATE, CyclePosition(0, 1), "seed", bodyweight_kg=90)
    assert any("base avançada" in n for n in weak.notices)
    strong = [SetRecord(date(2026, 1, 1), "back_squat", reps=1, load_kg=180, rpe=10),
              SetRecord(date(2026, 1, 1), "conventional_deadlift", reps=1, load_kg=210, rpe=10)]
    ok = generate_session(Tier.CONJUGATE, CyclePosition(0, 1), "seed", bodyweight_kg=90, history=strong)
    assert not any("base avançada" in n for n in ok.notices)


def test_weekly_programs_start_on_a_monday():
    cfg = TIERS[Tier.GOTHAM_ARMOR]
    assert cfg.start_on(date(2026, 10, 31)) == date(2026, 11, 2)  # Saturday -> next Monday
    assert cfg.start_on(date(2026, 11, 2)) == date(2026, 11, 2)  # a Monday starts the same day
    assert TIERS[Tier.FULL_BODY].start_on(date(2026, 10, 31)) == date(2026, 10, 31)


def test_days_before_the_first_monday_are_free(client, auth):
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date()
    r = client.post("/athletes", json={"name": "Bruce", "tier": "upper_lower", "bodyweight_kg": 90}, headers=auth)
    a = r.json()
    a = client.patch(f"/athletes/{a['id']}", json={"tier": "norton_fb"}, headers=auth).json()
    start = date.fromisoformat(a["cycle_start"])
    assert start.weekday() == 0 and 0 <= (start - today).days <= 6
    if start > today:
        s = client.get(f"/athletes/{a['id']}/sessions/{today.isoformat()}", headers=auth).json()
        assert (s["day_name"], s["is_training_day"], s["blocks"]) == ("Antes do programa", False, [])
        assert client.get(f"/athletes/{a['id']}/cycle/missed", headers=auth).json()["missed"] == []
        assert client.get(f"/athletes/{a['id']}/routine/{today.isoformat()}", headers=auth).status_code == 200
        assert client.get(f"/athletes/{a['id']}/nutrition/{today.isoformat()}", headers=auth).status_code == 200
    first = client.get(f"/athletes/{a['id']}/sessions/{start.isoformat()}", headers=auth).json()
    assert first["cycle_day"] == 1 and first["is_training_day"]


def test_calibration_set_on_the_last_loading_week_only_on_stations_with_safeties():
    from knightfall.plateau import CALIBRATION_SAFE

    def flagged(k):
        return [rx for d in _sessions(Tier.UPPER_LOWER, k, equipment=MACHINE_GYM) for b in d.blocks
                for rx in b.exercises if rx.amrap_last_set]

    peak = flagged(4)  # week 5 of 6
    assert peak and all(EXERCISES[rx.exercise_id].implement in CALIBRATION_SAFE for rx in peak)
    assert all(any("falha técnica" in c for c in rx.cues) for rx in peak)
    assert not flagged(2) and not flagged(5)  # mid-mesocycle, deload
    red = ReadinessSummary(score=20, level="red", mobility_expanded=True)
    assert not [rx for d in _sessions(Tier.UPPER_LOWER, 4, equipment=MACHINE_GYM, readiness=red)
                for b in d.blocks for rx in b.exercises if rx.amrap_last_set]


def test_plateau_notes_one_stalled_lift_and_fatigue_when_several_stall():
    start = date(2026, 1, 5)

    def flat(ex_id, top):
        # Best early on, then three sessions below it.
        loads = [top, top - 5, top - 5, top - 2.5]
        return [SetRecord(start + timedelta(days=7 * i), ex_id, reps=5, load_kg=kg, rpe=8.5)
                for i, kg in enumerate(loads)]

    def rising(ex_id, top):
        return [SetRecord(start + timedelta(days=7 * i), ex_id, reps=5, load_kg=top + 2.5 * i, rpe=8.5)
                for i in range(4)]

    pos = CyclePosition(2, 1)  # Batfleck day 1: bench top set + back-off; no deload
    s = generate_session(Tier.BATFLECK, pos, "seed", history=flat("barbell_bench_press", 100), bodyweight_kg=90)
    note = [n for n in s.notices if "sem recorde" in n]
    assert len(note) == 1 and note[0].startswith("Supino reto com barra:") and "troque a variação" in note[0]
    ok = generate_session(Tier.BATFLECK, pos, "seed", history=rising("barbell_bench_press", 100), bodyweight_kg=90)
    assert not any("sem recorde" in n for n in ok.notices)

    day1 = generate_session(Tier.BATFLECK, pos, "seed")
    main = [rx.exercise_id for rx in day1.blocks[1].exercises if rx.modality == "strength" and rx.set_role != "backoff"]
    assert len(set(main)) >= 2, main
    both = flat(main[0], 100) + flat(next(e for e in main if e != main[0]), 60)
    tired = generate_session(Tier.BATFLECK, pos, "seed", history=both, bodyweight_kg=90)
    assert any("antecipar o deload" in n for n in tired.notices)
