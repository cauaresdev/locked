"""Session generator: tier + calendar position + chaos selection -> Session."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

from .catalog import EXERCISES, Exercise, RxTemplate
from .chaos import DaySelection, Equipment, available, candidates, select_day
from .domain import (
    Block,
    BlockKind,
    ExecutionStyle,
    Implement,
    LastSet,
    Modality,
    Mode,
    Pattern,
    Prescription,
    ReadinessSummary,
    Session,
    Tier,
)
from .progression import last_set, recommend_load
from .records import SetRecord
from .strength import e1rm_history
from .templates import TEMPLATES, Variant
from .tiers import (
    AMRAP_ROUND_REST_SECONDS,
    DELOAD_RPE_DELTA,
    DELOAD_SET_MULTIPLIER,
    REST_CAP_SECONDS,
    TIERS,
    TierConfig,
)

TARGET_RPE: dict[Modality, float] = {
    Modality.STRENGTH: 8,
    Modality.TEMPO: 8,
    Modality.EXPLOSIVE: 7,
    Modality.HYPERTROPHY: 8,
}

MAX_RAMPED_RPE = 9.5

RECOVERY_DRILLS = ("worlds_greatest_stretch", "hip_90_90", "t_spine_rotation", "brettzel_stretch")
RECOVERY_EXTRA_DRILLS = ("spiderman_lunge_stretch", "inchworm")

IMPLEMENT_LABEL: dict[Implement, str] = {
    Implement.BARBELL: "barra",
    Implement.DUMBBELL: "halteres",
    Implement.KETTLEBELL: "kettlebell",
    Implement.CABLE: "polia (cabo)",
    Implement.MACHINE: "máquina",
    Implement.LEG_PRESS: "leg press",
    Implement.LEG_EXTENSION: "cadeira extensora",
    Implement.LEG_CURL: "mesa ou cadeira flexora",
    Implement.SMITH: "smith",
    Implement.HACK_SQUAT: "hack",
    Implement.CALF_MACHINE: "máquina de panturrilha",
    Implement.HIP_MACHINE: "abdutora / adutora",
    Implement.LAT_PULLDOWN: "puxador (pulldown)",
    Implement.ROW_MACHINE: "remada sentada (máquina ou remada baixa)",
    Implement.CHEST_PRESS: "supino na máquina",
    Implement.PEC_DECK: "voador (peck deck)",
    Implement.SHOULDER_PRESS: "desenvolvimento na máquina",
    Implement.BODYWEIGHT: "peso corporal",
    Implement.SLED: "trenó",
    Implement.TRAP_BAR: "barra hexagonal (trap bar)",
    Implement.BAND: "elástico",
    Implement.MEDICINE_BALL: "medicine ball",
    Implement.ROLLER: "rolo de liberação miofascial",
    Implement.ERGOMETER: "aparelho de cardio (bike, esteira ou elíptico)",
}


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
    # A range ("8 a 10") is loaded for its top: the last reps of the range still land on the target effort.
    return tpl.reps_max or tpl.reps or tpl.reps_per_side


def build_rx(
    variant: Variant,
    *,
    set_multiplier: float = 1.0,
    set_delta: int = 0,
    rpe_delta: float = 0,
    duration_seconds: int | None = None,
    history: Sequence[SetRecord] = (),
    bodyweight_kg: float | None = None,
    tpl: RxTemplate | None = None,
    base_rpe: float | None = None,
    no_rpe: bool = False,
    rest_seconds: int | None = None,
) -> Prescription:
    """`tpl` replaces the catalog's prescription for the variant; `base_rpe` its modality's target effort."""
    ex = EXERCISES[variant[0]]
    tpl = tpl or ex.variants[variant[1]]
    sets = max(1, _round_half_up(tpl.sets * set_multiplier) + set_delta)
    rpe = TARGET_RPE.get(variant[1]) if ex.implement != Implement.ERGOMETER and ex.pattern != Pattern.SPRINT else None
    if base_rpe is not None and rpe is not None:
        rpe = base_rpe
    if no_rpe:
        rpe = None
    if rpe is not None:
        # A ramp may push effort up, but never to failure: capped at RPE 9.5 (or the slot's own, if higher).
        rpe = max(5.0, rpe + rpe_delta) if rpe_delta <= 0 else min(rpe + rpe_delta, max(rpe, MAX_RAMPED_RPE))
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
        reps_max=tpl.reps_max,
        reps_per_side=tpl.reps_per_side,
        reps_sequence=list(tpl.reps_sequence) if tpl.reps_sequence else None,
        hold_seconds=tpl.hold_seconds,
        distance_m=tpl.distance_m,
        intra_set_rest_seconds=tpl.intra_set_rest_seconds,
        rest_seconds=rest_seconds,
        tempo=tpl.tempo,
        unilateral=ex.unilateral,
        target_rpe=rpe,
        suggested_load_kg=recommend_load(ex, history, _target_reps(tpl), rpe, bodyweight_kg, variant[1]),
        intensity=tpl.intensity,
        cues=list(tpl.cues),
        **history_fields(ex, history),
    )


def history_fields(ex: Exercise, history: Sequence[SetRecord]) -> dict:
    """What the athlete did last time and the all-time best estimate, for the set logger."""
    last = last_set(history, ex.id)
    best = None
    if ex.implement != Implement.BODYWEIGHT:  # with body mass in it, the "1RM" is not a load to chase
        best = max((p.e1rm_kg for p in e1rm_history(history, ex.id)), default=None)
    return dict(
        last_set=LastSet(on=last.performed_on, load_kg=last.load_kg, reps=last.reps, rpe=last.rpe) if last else None,
        best_e1rm_kg=best,
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
        name="Aquecimento, tecidos e preparação de movimento",
        duration_minutes=minutes,
        execution_style=ExecutionStyle.CHECKLIST,
        mandatory_lock=True,
        rest_seconds=0,
        exercises=exercises,
    )


def missing_equipment_notices(blocks: Sequence[Block], equipment: Equipment) -> list[str]:
    """Exercises that fell back to an implement outside the athlete's equipment profile."""
    missing: dict[Implement, list[str]] = {}
    for b in blocks:
        for rx in b.exercises:
            if not available(rx.exercise_id, equipment) and rx.name not in missing.get(rx.implement, []):
                missing.setdefault(rx.implement, []).append(rx.name)
    return [f"Seu perfil de equipamentos não tem {IMPLEMENT_LABEL[imp]}: {', '.join(names)} entrou mesmo assim "
            "porque esse padrão de movimento não tem opção sem ele. Use \"Trocar exercício\" ou adapte."
            for imp, names in missing.items()]


def _recovery_session(cfg: TierConfig, pos: CyclePosition, readiness: ReadinessSummary | None,
                      equipment: Equipment = None) -> Session:
    # Without a roller the day is walk + mobility, not a warning about missing gear.
    roller = available("rumble_roller_full", equipment)
    exercises = [
        build_rx(("easy_walk", Modality.CONDITIONING)),
        *([build_rx(("rumble_roller_full", Modality.PREP), duration_seconds=600)] if roller else []),
        *(build_rx((d, Modality.PREP)) for d in RECOVERY_DRILLS + (() if roller else RECOVERY_EXTRA_DRILLS)),
    ]
    blocks = [
        Block(
            order=1,
            kind=BlockKind.RECOVERY,
            name="Recuperação ativa",
            duration_minutes=45,
            execution_style=ExecutionStyle.CHECKLIST,
            rest_seconds=0,
            exercises=exercises,
        )
    ]
    return Session(
        protocol_id=cfg.protocol_id,
        tier=cfg.tier,
        cycle_index=pos.cycle_index,
        cycle_day=pos.cycle_day,
        cycle_length=cfg.cycle_length,
        cycle_structure=cfg.cycle_structure,
        is_training_day=False,
        day_name="Recuperação ativa",
        target_duration_minutes=45,
        rest_cap_seconds=REST_CAP_SECONDS,
        readiness=readiness,
        notices=missing_equipment_notices(blocks, equipment),
        blocks=blocks,
    )


def is_scheduled_deload(cfg: TierConfig, cycle_index: int) -> bool:
    return cycle_index > 0 and (cycle_index + 1) % cfg.deload_every_cycles == 0


@dataclass(frozen=True)
class StrengthParams:
    deload: bool
    set_multiplier: float
    set_delta: int
    rpe_delta: float


def _strength_params(
    cfg: TierConfig, pos: CyclePosition, readiness: ReadinessSummary | None, low_readiness_streak: bool
) -> StrengthParams:
    level = readiness.level if readiness else "green"
    deload = is_scheduled_deload(cfg, pos.cycle_index) or low_readiness_streak
    if deload:  # replaces the readiness trim rather than stacking on it
        return StrengthParams(True, cfg.set_multiplier * DELOAD_SET_MULTIPLIER, 0, DELOAD_RPE_DELTA)
    return StrengthParams(False, cfg.set_multiplier, -1 if level == "red" else 0,
                          -1 if level in ("amber", "red") else 0)


def generate_session(
    tier: Tier,
    pos: CyclePosition,
    seed: str,
    *,
    readiness: ReadinessSummary | None = None,
    history: Sequence[SetRecord] = (),
    weeks_in_tier: int = 0,
    bodyweight_kg: float | None = None,
    low_readiness_streak: bool = False,
    equipment: Equipment = None,
    replacements: Mapping[str, str] | None = None,
) -> Session:
    """`replacements`: the athlete's standing swaps (planned exercise id -> the one they do instead)."""
    ctx = dict(readiness=readiness, history=history, bodyweight_kg=bodyweight_kg,
               low_readiness_streak=low_readiness_streak, equipment=equipment)
    session = _generate(tier, pos, seed, weeks_in_tier=weeks_in_tier, **ctx)
    if replacements and session.is_training_day:
        session = apply_replacements(tier, pos, seed, session, replacements, **ctx)
    return session


def apply_replacements(tier: Tier, pos: CyclePosition, seed: str, session: Session,
                       replacements: Mapping[str, str], **ctx) -> Session:
    """Swap each planned exercise the athlete replaced for good, when the replacement is one of that slot's
    alternatives (same prescription rules as a swap made in the app). Others stay as planned."""
    blocks = list(session.blocks)
    done: list[str] = []
    for bi, block in enumerate(blocks):
        for i, rx in enumerate(block.exercises):
            target = replacements.get(rx.exercise_id)
            if target is None:
                continue
            current = session.model_copy(update={"blocks": blocks})
            try:
                options = _alternatives(tier, pos, seed, current, block.order, i, **ctx)
            except ValueError:
                continue
            pick = next((o for o in options if o.exercise_id == target), None)
            if pick is None:
                continue
            exercises = list(blocks[bi].exercises)
            exercises[i] = pick
            blocks[bi] = blocks[bi].model_copy(update={"exercises": exercises})
            done.append(f"{pick.name} no lugar de {rx.name}")
    if not done:
        return session
    notice = "Suas trocas fixas: " + "; ".join(done) + ". Desfaça em Perfil > Trocas de exercício."
    return session.model_copy(update={"blocks": blocks, "notices": [*session.notices, notice]})


def _generate(
    tier: Tier,
    pos: CyclePosition,
    seed: str,
    *,
    readiness: ReadinessSummary | None = None,
    history: Sequence[SetRecord] = (),
    weeks_in_tier: int = 0,
    bodyweight_kg: float | None = None,
    low_readiness_streak: bool = False,
    equipment: Equipment = None,
) -> Session:
    cfg = TIERS[tier]
    if not 1 <= pos.cycle_day <= cfg.cycle_length:
        raise ValueError(f"cycle_day must be within 1..{cfg.cycle_length}")
    template_id = cfg.cycle[pos.cycle_day - 1]
    if template_id is None:
        return _recovery_session(cfg, pos, readiness, equipment)
    if cfg.program == "split":
        from . import splits

        return splits.generate(cfg, template_id, pos.cycle_index, pos.cycle_day, readiness=readiness,
                               history=history, bodyweight_kg=bodyweight_kg,
                               low_readiness_streak=low_readiness_streak, equipment=equipment)
    if cfg.program == "v2":
        from . import brawler_v2

        return brawler_v2.generate(cfg, template_id, pos.cycle_index, pos.cycle_day, seed, readiness=readiness,
                                   history=history, weeks_in_tier=weeks_in_tier, bodyweight_kg=bodyweight_kg,
                                   low_readiness_streak=low_readiness_streak, equipment=equipment)

    sel = select_day(seed, template_id, pos.cycle_index, equipment)
    level = readiness.level if readiness else "green"
    expanded = level == "red"
    p = _strength_params(cfg, pos, readiness, low_readiness_streak)
    deload, set_multiplier, set_delta, rpe_delta = p.deload, p.set_multiplier, p.set_delta, p.rpe_delta

    strength = Block(
        order=2,
        kind=BlockKind.STRENGTH,
        name="Tronco, estabilidade e força bruta",
        duration_minutes=cfg.strength_minutes,
        execution_style=ExecutionStyle.STRAIGHT_SETS,
        rest_seconds=cfg.rest_seconds,
        exercises=[
            build_rx(v, set_multiplier=set_multiplier, set_delta=set_delta, rpe_delta=rpe_delta,
                     history=history, bodyweight_kg=bodyweight_kg)
            for v in sel.strength
        ],
    )
    conditioning = Block(
        order=3,
        kind=BlockKind.CONDITIONING,
        name="Força e condicionamento (AMRAP: máximo de rodadas no tempo)",
        duration_minutes=cfg.conditioning_minutes,
        execution_style=ExecutionStyle.AMRAP,
        rest_seconds=AMRAP_ROUND_REST_SECONDS,
        exercises=[build_rx(v, history=history, bodyweight_kg=bodyweight_kg) for v in sel.conditioning],
    )
    prep = _prep_block(cfg, sel, expanded)

    notices: list[str] = []
    if deload:
        scheduled = is_scheduled_deload(cfg, pos.cycle_index)
        why = (f"programado a cada {cfg.deload_every_cycles} ciclos" if scheduled
               else f"3 dias seguidos de prontidão baixa; vale por {cfg.cycle_length} dias")
        notices.append(f"Deload (semana de descarga, {why}): menos séries no Bloco 2 e esforço alvo 2 pontos "
                       "mais baixo, para o corpo absorver o treino.")
    if expanded:
        notices.append("Prontidão baixa: Bloco 1 expandido e volume do Bloco 2 reduzido.")
    if cfg.max_recommended_weeks and weeks_in_tier >= cfg.max_recommended_weeks:
        notices.append(
            f"{weeks_in_tier} semanas em {cfg.tier.value}: o protocolo integral é recomendado para "
            f"ciclos de até {cfg.max_recommended_weeks} semanas. Considere descer de tier."
        )
    notices += missing_equipment_notices([prep, strength, conditioning], equipment)

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
        deload=deload,
        notices=notices,
        blocks=[prep, strength, conditioning],
    )


MAX_ALTERNATIVES = 8


def alternatives(
    tier: Tier,
    pos: CyclePosition,
    seed: str,
    block_order: int,
    index: int,
    *,
    readiness: ReadinessSummary | None = None,
    history: Sequence[SetRecord] = (),
    bodyweight_kg: float | None = None,
    low_readiness_streak: bool = False,
    equipment: Equipment = None,
    replacements: Mapping[str, str] | None = None,
) -> list[Prescription]:
    """Swaps for one exercise of the strength or conditioning block: same movement pattern,
    other exercises the athlete has equipment for, prescribed with the block's parameters."""
    ctx = dict(readiness=readiness, history=history, bodyweight_kg=bodyweight_kg,
               low_readiness_streak=low_readiness_streak, equipment=equipment)
    cfg = TIERS[tier]
    if not 1 <= pos.cycle_day <= cfg.cycle_length:
        raise ValueError(f"cycle_day must be within 1..{cfg.cycle_length}")
    session = generate_session(tier, pos, seed, replacements=replacements, **ctx)
    return _alternatives(tier, pos, seed, session, block_order, index, **ctx)


def _alternatives(
    tier: Tier,
    pos: CyclePosition,
    seed: str,
    session: Session,
    block_order: int,
    index: int,
    *,
    readiness: ReadinessSummary | None = None,
    history: Sequence[SetRecord] = (),
    bodyweight_kg: float | None = None,
    low_readiness_streak: bool = False,
    equipment: Equipment = None,
) -> list[Prescription]:
    """alternatives() for an already generated session."""
    cfg = TIERS[tier]
    template_id = cfg.cycle[pos.cycle_day - 1]
    if template_id is None:
        raise ValueError("recovery days have no swappable exercises")
    if cfg.program == "split":
        from . import splits

        sp = splits.params(cfg, pos.cycle_index, readiness, low_readiness_streak)
        return splits.alternatives(session, template_id, block_order, index, p=sp, history=history,
                                   bodyweight_kg=bodyweight_kg, equipment=equipment, limit=MAX_ALTERNATIVES)
    if cfg.program == "v2":
        from . import brawler_v2

        p = brawler_v2.params(cfg, pos.cycle_index, readiness, low_readiness_streak)
        return brawler_v2.alternatives(session, template_id, block_order, index, p=p, history=history,
                                       bodyweight_kg=bodyweight_kg, equipment=equipment, limit=MAX_ALTERNATIVES)
    block = next((b for b in session.blocks if b.order == block_order), None)
    if block is None or block.kind not in (BlockKind.STRENGTH, BlockKind.CONDITIONING):
        raise ValueError("only strength and conditioning exercises can be swapped")
    slots = TEMPLATES[template_id].strength if block.kind == BlockKind.STRENGTH else TEMPLATES[template_id].conditioning
    if not 0 <= index < len(slots):
        raise ValueError("no exercise at that position")
    slot = slots[index]
    current = block.exercises[index]
    in_session = {rx.name for b in session.blocks for rx in b.exercises}  # names: one movement can have two ids

    # One option per exercise, preferring the modality the slot has today.
    best: dict[str, Variant] = {}
    for v in candidates(slot.pattern, slot.modalities, equipment, stand_ins=True):
        if EXERCISES[v[0]].name in in_session:
            continue
        if v[0] not in best or v[1] == current.modality:
            best[v[0]] = v
    if block.kind == BlockKind.STRENGTH:
        p = _strength_params(cfg, pos, readiness, low_readiness_streak)
        kw = dict(set_multiplier=p.set_multiplier, set_delta=p.set_delta, rpe_delta=p.rpe_delta)
    else:
        kw = {}
    options = [build_rx(v, history=history, bodyweight_kg=bodyweight_kg, **kw) for v in best.values()]
    return sorted(options, key=lambda rx: rx.name)[:MAX_ALTERNATIVES]


def before_start_session(tier: Tier, start: date) -> Session:
    """A day between picking a weekly program and its first Monday: free, nothing prescribed."""
    cfg = TIERS[tier]
    return Session(
        protocol_id=cfg.protocol_id,
        tier=cfg.tier,
        cycle_index=0,
        cycle_day=1,
        cycle_length=cfg.cycle_length,
        cycle_structure=cfg.cycle_structure,
        is_training_day=False,
        day_name="Antes do programa",
        target_duration_minutes=0,
        rest_cap_seconds=REST_CAP_SECONDS,
        notices=[f"{cfg.name} começa na segunda, {start.strftime('%d/%m')}. Até lá: descanso, uma caminhada "
                 "ou um treino livre."],
        blocks=[],
    )
