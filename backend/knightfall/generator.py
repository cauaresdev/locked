"""Session generator: tier + calendar position + chaos selection -> Session."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from .catalog import EXERCISES, RxTemplate
from .chaos import DaySelection, select_day
from .domain import (
    Block,
    BlockKind,
    ExecutionStyle,
    Implement,
    Modality,
    Mode,
    Prescription,
    ReadinessSummary,
    Session,
    Tier,
)
from .progression import recommend_load
from .records import SetRecord
from .templates import TEMPLATES, Variant
from .tiers import AMRAP_ROUND_REST_SECONDS, REST_CAP_SECONDS, TIERS, TierConfig

TARGET_RPE: dict[Modality, float] = {
    Modality.STRENGTH: 8,
    Modality.TEMPO: 8,
    Modality.EXPLOSIVE: 7,
    Modality.HYPERTROPHY: 8,
}

RECOVERY_DRILLS = ("worlds_greatest_stretch", "hip_90_90", "t_spine_rotation", "brettzel_stretch")


@dataclass(frozen=True)
class CyclePosition:
    cycle_index: int
    cycle_day: int  # 1-based


def locate(cycle_start: date, on: date, cycle_length: int) -> CyclePosition:
    offset = (on - cycle_start).days
    if offset < 0:
        raise ValueError("date is before the program start")
    return CyclePosition(offset // cycle_length, offset % cycle_length + 1)


def _round_half_up(x: float) -> int:
    return int(x + 0.5)


def _minutes_to_seconds(minutes: float) -> int:
    return max(60, round(minutes) * 60)


def _target_reps(tpl: RxTemplate) -> int | None:
    if tpl.mode != Mode.REPS:
        return None
    if tpl.reps_sequence:
        return max(tpl.reps_sequence)
    return tpl.reps or tpl.reps_per_side


def build_rx(
    variant: Variant,
    *,
    set_multiplier: float = 1.0,
    set_delta: int = 0,
    rpe_delta: float = 0,
    duration_seconds: int | None = None,
    history: Sequence[SetRecord] = (),
    bodyweight_kg: float | None = None,
) -> Prescription:
    ex = EXERCISES[variant[0]]
    tpl: RxTemplate = ex.variants[variant[1]]
    sets = max(1, _round_half_up(tpl.sets * set_multiplier) + set_delta)
    rpe = TARGET_RPE.get(variant[1]) if ex.implement != Implement.ERGOMETER else None
    if rpe is not None:
        rpe = max(5.0, rpe + rpe_delta)
    return Prescription(
        exercise_id=ex.id,
        name=ex.name,
        pattern=ex.pattern,
        implement=ex.implement,
        modality=variant[1],
        mode=tpl.mode,
        sets=sets,
        duration_seconds=duration_seconds or tpl.duration_seconds,
        reps=tpl.reps,
        reps_per_side=tpl.reps_per_side,
        reps_sequence=list(tpl.reps_sequence) if tpl.reps_sequence else None,
        hold_seconds=tpl.hold_seconds,
        intra_set_rest_seconds=tpl.intra_set_rest_seconds,
        tempo=tpl.tempo,
        unilateral=ex.unilateral,
        target_rpe=rpe,
        suggested_load_kg=recommend_load(ex, history, _target_reps(tpl), rpe, bodyweight_kg),
        intensity=tpl.intensity,
        cues=list(tpl.cues),
    )


def _prep_block(cfg: TierConfig, sel: DaySelection, expanded: bool) -> Block:
    base = cfg.prep_minutes
    minutes = cfg.prep_expanded_minutes if expanded else base
    cardio_s = _minutes_to_seconds(base * 0.47)
    roller_s = _minutes_to_seconds(base * 0.28)
    drills = cfg.mobility_drills
    if expanded:  # extra time goes to tissue work and mobility, never to cardio
        roller_s += _minutes_to_seconds((minutes - base) * 0.6)
        drills += 2
    exercises = [
        build_rx(sel.cardio, duration_seconds=cardio_s),
        build_rx(sel.roller, duration_seconds=roller_s),
        *(build_rx(v) for v in sel.drills[:drills]),
    ]
    return Block(
        order=1,
        kind=BlockKind.PREP,
        name="Warm-up, Tissue & Movement Prep",
        duration_minutes=minutes,
        execution_style=ExecutionStyle.CHECKLIST,
        mandatory_lock=True,
        rest_seconds=0,
        exercises=exercises,
    )


def _recovery_session(cfg: TierConfig, pos: CyclePosition, readiness: ReadinessSummary | None) -> Session:
    exercises = [
        build_rx(("easy_walk", Modality.CONDITIONING)),
        build_rx(("rumble_roller_full", Modality.PREP), duration_seconds=600),
        *(build_rx((d, Modality.PREP)) for d in RECOVERY_DRILLS),
    ]
    return Session(
        protocol_id=cfg.protocol_id,
        tier=cfg.tier,
        cycle_index=pos.cycle_index,
        cycle_day=pos.cycle_day,
        cycle_length=cfg.cycle_length,
        cycle_structure=cfg.cycle_structure,
        is_training_day=False,
        day_name="Active Recovery",
        target_duration_minutes=45,
        rest_cap_seconds=REST_CAP_SECONDS,
        readiness=readiness,
        blocks=[
            Block(
                order=1,
                kind=BlockKind.RECOVERY,
                name="Active Recovery",
                duration_minutes=45,
                execution_style=ExecutionStyle.CHECKLIST,
                rest_seconds=0,
                exercises=exercises,
            )
        ],
    )


def generate_session(
    tier: Tier,
    pos: CyclePosition,
    seed: str,
    *,
    readiness: ReadinessSummary | None = None,
    history: Sequence[SetRecord] = (),
    weeks_in_tier: int = 0,
    bodyweight_kg: float | None = None,
) -> Session:
    cfg = TIERS[tier]
    if not 1 <= pos.cycle_day <= cfg.cycle_length:
        raise ValueError(f"cycle_day must be within 1..{cfg.cycle_length}")
    template_id = cfg.cycle[pos.cycle_day - 1]
    if template_id is None:
        return _recovery_session(cfg, pos, readiness)

    sel = select_day(seed, template_id, pos.cycle_index)
    level = readiness.level if readiness else "green"
    expanded = level == "red"
    rpe_delta = -1 if level in ("amber", "red") else 0
    set_delta = -1 if level == "red" else 0

    strength = Block(
        order=2,
        kind=BlockKind.STRENGTH,
        name="Torso, Structural Stability & Raw Strength",
        duration_minutes=cfg.strength_minutes,
        execution_style=ExecutionStyle.STRAIGHT_SETS,
        rest_seconds=cfg.rest_seconds,
        exercises=[
            build_rx(v, set_multiplier=cfg.set_multiplier, set_delta=set_delta, rpe_delta=rpe_delta,
                     history=history, bodyweight_kg=bodyweight_kg)
            for v in sel.strength
        ],
    )
    conditioning = Block(
        order=3,
        kind=BlockKind.CONDITIONING,
        name="Strength & Metabolic Conditioning (AMRAP)",
        duration_minutes=cfg.conditioning_minutes,
        execution_style=ExecutionStyle.AMRAP,
        rest_seconds=AMRAP_ROUND_REST_SECONDS,
        exercises=[build_rx(v, history=history, bodyweight_kg=bodyweight_kg) for v in sel.conditioning],
    )
    prep = _prep_block(cfg, sel, expanded)

    notices: list[str] = []
    if expanded:
        notices.append("Prontidão baixa: Bloco 1 expandido e volume do Bloco 2 reduzido.")
    if cfg.max_recommended_weeks and weeks_in_tier >= cfg.max_recommended_weeks:
        notices.append(
            f"{weeks_in_tier} semanas em {cfg.tier.value}: o protocolo integral é recomendado para "
            f"ciclos de até {cfg.max_recommended_weeks} semanas. Considere descer de tier."
        )

    return Session(
        protocol_id=cfg.protocol_id,
        tier=cfg.tier,
        cycle_index=pos.cycle_index,
        cycle_day=pos.cycle_day,
        cycle_length=cfg.cycle_length,
        cycle_structure=cfg.cycle_structure,
        is_training_day=True,
        day_name=TEMPLATES[template_id].name,
        target_duration_minutes=prep.duration_minutes + cfg.strength_minutes + cfg.conditioning_minutes,
        rest_cap_seconds=REST_CAP_SECONDS,
        readiness=readiness,
        notices=notices,
        blocks=[prep, strength, conditioning],
    )
