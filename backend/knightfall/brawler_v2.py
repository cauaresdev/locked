"""Brawler V2: the Brawler tier's own program.

Cycle of 8 days: 3 training, active recovery, 3 training, full rest. Each day
is written out exercise by exercise (the cycle-1 matrix). Primary lifts are
fixed; accessories and AMRAP movements rotate each cycle within their
movement pattern, with the same seeded, deterministic draw as the Chaos
Engine. Rest is per exercise: 3–4 min after heavy top sets, 2 min for the
other strength work, 90 s hypertrophy, 60 s isometrics and plyometrics.

Readiness and deload rules that differ from the template tiers:
- red day: no AMRAP and half the Block 2 sets (the session drops to ~45 min);
- deload (every 5th cycle, ~6 weeks, or 3 low-readiness days): Block 2 sets
  x0.6 and effort -2, and the AMRAP shrinks to 10 min at half the load.
"""

from __future__ import annotations

import math
import random
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache

from .catalog import EXERCISES, RxTemplate, distance, per_side, reps, timed
from .chaos import Equipment, available, candidates, pick
from .domain import Block, BlockKind, ExecutionStyle, Modality, Prescription, ReadinessSummary, Session, WarmupSet
from .progression import INCREMENT_KG, last_top_set, warmup_ramp
from .records import SetRecord
from .templates import Variant
from .tiers import DELOAD_RPE_DELTA, DELOAD_SET_MULTIPLIER, REST_DAY, V2_REST_CAP_SECONDS, TierConfig

S, T, I, E, H, C, P = (
    Modality.STRENGTH,
    Modality.TEMPO,
    Modality.ISOMETRIC,
    Modality.EXPLOSIVE,
    Modality.HYPERTROPHY,
    Modality.CONDITIONING,
    Modality.PREP,
)

TOP_SET_RPE = 8.5
BACKOFF_RPE = 7.5
BACKOFF_SHARE = 0.8  # back-off load as a share of the top set
SQUAT_STEP_KG = 2.0  # mandatory jump per cycle on the back squat
RED_SET_MULTIPLIER = 0.5
DELOAD_AMRAP_MINUTES = 10
DELOAD_AMRAP_LOAD = 0.5


@dataclass(frozen=True)
class Item:
    variant: Variant  # cycle-1 choice
    rx: RxTemplate | None = None  # V2 prescription for it (None: the catalog's)
    rest: int | None = None  # seconds after each set; None: the block's
    rotate: tuple[Modality, ...] | None = None  # accessory: pool it rotates in; None: fixed
    role: str | None = None  # "top" / "backoff"


@dataclass(frozen=True)
class Day:
    id: str
    name: str
    prep_minutes: int
    prep: tuple[Item, ...]
    strength_minutes: int
    strength: tuple[Item, ...]
    amrap_minutes: int
    amrap: tuple[Item, ...]

    @property
    def items(self) -> tuple[Item, ...]:
        return self.prep + self.strength + self.amrap


CIRCUIT = (H, C)

DAYS: dict[str, Day] = {
    d.id: d
    for d in [
        Day(
            "V1", "Tração bruta + carregamento",
            prep_minutes=8,
            prep=(
                Item(("t_spine_rotation", P), timed(1, 120)),
                Item(("med_ball_slam", E), rest=60),
            ),
            strength_minutes=35,
            strength=(
                Item(("barbell_bent_over_row", S), reps(1, 5), rest=180, role="top"),
                Item(("barbell_bent_over_row", S), reps(3, 8), rest=180, role="backoff"),
                Item(("wide_grip_lat_pulldown", S), rest=120),
                Item(("db_farmers_walk", S), distance(3, 40, intensity="pesado"), rest=120, rotate=(S,)),
            ),
            amrap_minutes=10,
            amrap=(
                Item(("kb_swing", H), reps(1, 10), rotate=CIRCUIT),
                Item(("inverted_row", H), reps(1, 8, cues=("no TRX ou na barra baixa",)), rotate=CIRCUIT),
                Item(("push_up", H), reps(1, 10), rotate=CIRCUIT),
            ),
        ),
        Day(
            "V2", "Empurrar + largura de ombros",
            prep_minutes=8,
            prep=(
                Item(("band_shoulder_mobility", P)),
                Item(("box_jump", E), rest=60),
            ),
            strength_minutes=35,
            strength=(
                Item(("barbell_bench_press", S), reps(1, 5), rest=210, role="top"),
                Item(("barbell_bench_press", S), reps(3, 8), rest=210, role="backoff"),
                Item(("seated_db_shoulder_press", S), reps(3, 8, reps_max=10, cues=("pegada semi-neutra",)),
                     rest=120),
                Item(("db_lateral_raise", H), reps(4, 12), rest=90, rotate=(H,)),
            ),
            amrap_minutes=12,
            amrap=(
                Item(("airdyne_sprint", E)),
                Item(("wall_ball", H), rotate=CIRCUIT),
                Item(("v_up", H), rotate=CIRCUIT),
            ),
        ),
        Day(
            "V3", "Base de força + correção de core",
            prep_minutes=10,
            prep=(
                Item(("hip_90_90", P), timed(1, 240, cues=("mobilidade de quadril profunda",))),
                Item(("short_sprint", E), rest=90),
            ),
            strength_minutes=40,
            strength=(
                Item(("back_squat", S), rest=210),
                Item(("barbell_rdl", T), rest=120),
                Item(("cable_plank_row", S), rest=60, rotate=(S, I)),
            ),
            amrap_minutes=10,
            amrap=(
                Item(("alternating_lunge", H), rotate=CIRCUIT),
                Item(("burpee", H), rotate=CIRCUIT),
                Item(("double_under", H)),
            ),
        ),
        Day(
            "V5", "Tração, trapézio + pescoço",
            prep_minutes=8,
            prep=(Item(("broad_jump", E), reps(3, 3, cues=("aterrissagem suave",)), rest=60),),
            strength_minutes=35,
            strength=(
                Item(("strict_pull_up", S), reps(4, 6, reps_max=8, cues=("pegada pronada", "lastro no cinto")),
                     rest=180),
                Item(("single_arm_db_row", S), per_side(3, 10), rest=120),
                Item(("db_shrug", H), reps(4, 12, reps_max=15, intensity="pesado"), rest=90, rotate=(H,)),
                Item(("plate_neck_curl", H), rest=60),
            ),
            amrap_minutes=10,
            amrap=(
                Item(("seated_machine_row", H), rotate=CIRCUIT),
                Item(("airdyne_sprint", E)),
                Item(("rowing_crunch", H), rotate=CIRCUIT),
            ),
        ),
        Day(
            "V6", "Empurrar dinâmico + blindagem",
            prep_minutes=8,
            prep=(Item(("med_ball_chest_pass", E), rest=60),),
            strength_minutes=35,
            strength=(
                Item(("db_bench_press", S), reps(4, 8, reps_max=10, cues=("pegada neutra",)), rest=120),
                # Superset: no rest after the curl, the shared rest comes after the triceps.
                Item(("db_hammer_curl", H), reps(4, 10, reps_max=12, intensity="pesado",
                                                 cues=("supersérie com o tríceps: sem descanso entre os dois",)),
                     rest=0),
                Item(("cable_skullcrusher", H), reps(4, 10, reps_max=12, cues=("supersérie com a rosca martelo",)),
                     rest=90),
                Item(("cable_lateral_raise", H), per_side(3, 12, reps_max=15), rest=60, rotate=(H,)),
            ),
            amrap_minutes=12,
            amrap=(
                Item(("barbell_push_press", H), rotate=CIRCUIT),
                Item(("decline_push_up", H), rotate=CIRCUIT),
                Item(("airdyne_sprint", E)),
            ),
        ),
        Day(
            "V7", "Pernas: volume + hipertrofia",
            prep_minutes=8,
            prep=(Item(("jump_squat", E), reps(3, 5, cues=("sem carga",)), rest=60),),
            strength_minutes=35,
            strength=(
                Item(("leg_press", S), rest=150),
                Item(("barbell_hip_thrust", S), reps(3, 8, reps_max=10), rest=120),
                Item(("ab_wheel_rollout", S), reps(3, 8, reps_max=10), rest=90, rotate=(S, T)),
            ),
            amrap_minutes=10,
            amrap=(
                Item(("box_step_up", H), rotate=CIRCUIT),
                Item(("db_thruster", H), rotate=CIRCUIT),
                Item(("reverse_crunch", H), rotate=CIRCUIT),
            ),
        ),
    ]
}


# --- rotation ---------------------------------------------------------------------------------------------

@dataclass
class _Chain:
    cycles: list[tuple[Variant, ...]]
    lock: threading.Lock


@lru_cache(maxsize=4096)
def _chain(seed: str, day_id: str, equipment: Equipment) -> _Chain:
    return _Chain([], threading.Lock())


_cache_lock = threading.Lock()


def _next(seed: str, day: Day, k: int, prev: tuple[Variant, ...] | None, equipment: Equipment) -> tuple[Variant, ...]:
    rng = random.Random(f"{seed}:v2:{day.id}:{k}")
    items = day.items
    # Fixed lifts first: a rotating accessory never lands on a movement the day already has.
    used = {EXERCISES[it.variant[0]].name for it in items if it.rotate is None}
    chosen: list[Variant] = []
    for i, it in enumerate(items):
        if it.rotate is None:
            v = it.variant
        elif k == 0 and available(it.variant[0], equipment):
            v = it.variant
        else:
            pool = candidates(EXERCISES[it.variant[0]].pattern, it.rotate, equipment, v2=True)
            v = pick(pool, rng, prev[i] if prev else None, used)
        used.add(EXERCISES[v[0]].name)
        chosen.append(v)
    return tuple(chosen)


def select(seed: str, day_id: str, cycle_index: int, equipment: Equipment = None) -> tuple[Variant, ...]:
    """The day's variant per item (prep, strength, AMRAP in order) for one cycle."""
    day = DAYS[day_id]
    with _cache_lock:
        chain = _chain(seed, day_id, equipment)
    with chain.lock:
        while len(chain.cycles) <= cycle_index:
            prev = chain.cycles[-1] if chain.cycles else None
            chain.cycles.append(_next(seed, day, len(chain.cycles), prev, equipment))
        return chain.cycles[cycle_index]


# --- prescriptions ----------------------------------------------------------------------------------------

def _snap(load: float, exercise_id: str) -> float:
    """Nearest practical jump for the implement."""
    step = INCREMENT_KG.get(EXERCISES[exercise_id].implement, 1.0)
    return math.floor(load / step + 0.5) * step


@dataclass(frozen=True)
class Params:
    deload: bool
    red: bool
    strength_multiplier: float
    rpe_delta: float


def params(cfg: TierConfig, cycle_index: int, readiness: ReadinessSummary | None,
           low_readiness_streak: bool) -> Params:
    from .generator import is_scheduled_deload

    level = readiness.level if readiness else "green"
    deload = is_scheduled_deload(cfg, cycle_index) or low_readiness_streak
    red = level == "red"
    multiplier = 1.0
    if deload:
        multiplier = DELOAD_SET_MULTIPLIER
    if red:  # the stricter cut wins; they don't stack
        multiplier = min(multiplier, RED_SET_MULTIPLIER)
    rpe_delta = DELOAD_RPE_DELTA if deload else (-1 if level in ("amber", "red") else 0)
    return Params(deload, red, multiplier, rpe_delta)


def _rx(it: Item, v: Variant, *, block: BlockKind, p: Params, history: Sequence[SetRecord],
        bodyweight_kg: float | None) -> Prescription:
    from .generator import build_rx

    catalog = EXERCISES[v[0]].variants[v[1]]
    if it.rx is None or v != it.variant:
        # A rotated accessory keeps the slot's set count, with the drawn exercise's own reps.
        tpl = catalog if it.rx is None else RxTemplate(**{**catalog.__dict__, "sets": it.rx.sets})
    else:
        tpl = it.rx
    strength = block == BlockKind.STRENGTH
    base_rpe = {"top": TOP_SET_RPE, "backoff": BACKOFF_RPE}.get(it.role or "")
    rx = build_rx(
        v,
        tpl=tpl,
        set_multiplier=p.strength_multiplier if strength else 1.0,
        rpe_delta=p.rpe_delta if strength else 0,
        base_rpe=base_rpe,
        no_rpe=block == BlockKind.PREP,
        rest_seconds=it.rest,
        history=history,
        bodyweight_kg=bodyweight_kg,
    )
    update: dict = {"set_role": it.role}
    if it.role == "top":
        update["warmup_sets"] = [WarmupSet(load_kg=kg, reps=n)
                                 for kg, n in warmup_ramp(EXERCISES[v[0]], rx.suggested_load_kg)]
    if v[0] == "back_squat" and not p.deload and (last := last_top_set(history, v[0])) and last.load_kg:
        update["suggested_load_kg"] = last.load_kg + SQUAT_STEP_KG
    return rx.model_copy(update=update)


def _block_rxs(items: Sequence[Item], variants: Sequence[Variant], **kw) -> list[Prescription]:
    out: list[Prescription] = []
    for it, v in zip(items, variants, strict=True):
        rx = _rx(it, v, **kw)
        if it.role == "backoff" and out and out[-1].exercise_id == rx.exercise_id:
            top = out[-1].suggested_load_kg
            if top is not None:  # nearest kilo: the matrix's 80 → 64 kg needs 1 kg plates, like the squat's +2 kg
                rx = rx.model_copy(update={"suggested_load_kg": float(round(top * BACKOFF_SHARE))})
        out.append(rx)
    return out


def rest_day_session(cfg: TierConfig, cycle_index: int, cycle_day: int,
                     readiness: ReadinessSummary | None) -> Session:
    return Session(
        protocol_id=cfg.protocol_id,
        tier=cfg.tier,
        cycle_index=cycle_index,
        cycle_day=cycle_day,
        cycle_length=cfg.cycle_length,
        cycle_structure=cfg.cycle_structure,
        is_training_day=False,
        day_name="Descanso absoluto",
        target_duration_minutes=0,
        rest_cap_seconds=V2_REST_CAP_SECONDS,
        readiness=readiness,
        notices=["Repouso completo do sistema nervoso central: sem treino, sem AMRAP, sem corrida. "
                 "Foco em sono, comida e recuperação dos tecidos."],
        blocks=[],
    )


def generate(
    cfg: TierConfig,
    day_id: str,
    cycle_index: int,
    cycle_day: int,
    seed: str,
    *,
    readiness: ReadinessSummary | None,
    history: Sequence[SetRecord],
    weeks_in_tier: int,
    bodyweight_kg: float | None,
    low_readiness_streak: bool,
    equipment: Equipment,
) -> Session:
    from .generator import missing_equipment_notices

    if day_id == REST_DAY:
        return rest_day_session(cfg, cycle_index, cycle_day, readiness)
    day = DAYS[day_id]
    variants = select(seed, day_id, cycle_index, equipment)
    n_prep, n_strength = len(day.prep), len(day.strength)
    p = params(cfg, cycle_index, readiness, low_readiness_streak)
    kw = dict(p=p, history=history, bodyweight_kg=bodyweight_kg)

    prep = Block(
        order=1,
        kind=BlockKind.PREP,
        name="Preparação: mobilidade e potência",
        duration_minutes=day.prep_minutes,
        execution_style=ExecutionStyle.STRAIGHT_SETS,
        mandatory_lock=True,
        rest_seconds=0,  # only the plyometrics rest (their own 60–90 s); mobility runs straight on
        exercises=_block_rxs(day.prep, variants[:n_prep], block=BlockKind.PREP, **kw),
    )
    strength_minutes = math.ceil(day.strength_minutes * RED_SET_MULTIPLIER) if p.red else day.strength_minutes
    strength = Block(
        order=2,
        kind=BlockKind.STRENGTH,
        name="Força e estrutura",
        duration_minutes=strength_minutes,
        execution_style=ExecutionStyle.STRAIGHT_SETS,
        rest_seconds=cfg.rest_seconds,
        exercises=_block_rxs(day.strength, variants[n_prep:n_prep + n_strength], block=BlockKind.STRENGTH, **kw),
    )
    blocks = [prep, strength]
    if not p.red:
        amrap_rxs = _block_rxs(day.amrap, variants[n_prep + n_strength:], block=BlockKind.CONDITIONING, **kw)
        if p.deload:
            amrap_rxs = [rx.model_copy(update={"suggested_load_kg": _snap(rx.suggested_load_kg * DELOAD_AMRAP_LOAD,
                                                                          rx.exercise_id)})
                         if rx.suggested_load_kg else rx for rx in amrap_rxs]
        blocks.append(Block(
            order=3,
            kind=BlockKind.CONDITIONING,
            name="AMRAP: máximo de rodadas no tempo",
            duration_minutes=DELOAD_AMRAP_MINUTES if p.deload else day.amrap_minutes,
            execution_style=ExecutionStyle.AMRAP,
            rest_seconds=0,
            exercises=amrap_rxs,
        ))

    notices: list[str] = []
    if p.deload:
        from .generator import is_scheduled_deload

        why = (f"programado a cada {cfg.deload_every_cycles} ciclos" if is_scheduled_deload(cfg, cycle_index)
               else f"3 dias seguidos de prontidão baixa; vale por {cfg.cycle_length} dias")
        notices.append(f"Deload ({why}): menos séries no Bloco 2, esforço alvo 2 pontos mais baixo e AMRAP de "
                       f"{DELOAD_AMRAP_MINUTES} min com cargas 50% mais leves.")
    if p.red:
        notices.append("Prontidão vermelha: AMRAP cancelado e metade das séries do Bloco 2.")
    if cfg.max_recommended_weeks and weeks_in_tier >= cfg.max_recommended_weeks:
        notices.append(
            f"{weeks_in_tier} semanas em {cfg.tier.value}: o protocolo integral é recomendado para "
            f"ciclos de até {cfg.max_recommended_weeks} semanas. Considere descer de tier."
        )
    notices += missing_equipment_notices(blocks, equipment)

    return Session(
        protocol_id=cfg.protocol_id,
        tier=cfg.tier,
        cycle_index=cycle_index,
        cycle_day=cycle_day,
        cycle_length=cfg.cycle_length,
        cycle_structure=cfg.cycle_structure,
        is_training_day=True,
        day_name=day.name,
        target_duration_minutes=sum(b.duration_minutes for b in blocks),
        rest_cap_seconds=V2_REST_CAP_SECONDS,
        readiness=readiness,
        deload=p.deload,
        notices=notices,
        blocks=blocks,
    )


def alternatives(session: Session, day_id: str, block_order: int, index: int, *, p: Params,
                 history: Sequence[SetRecord], bodyweight_kg: float | None, equipment: Equipment,
                 limit: int) -> list[Prescription]:
    """Swaps for a Block 2 or AMRAP exercise: same pattern, equipment the athlete has, the slot's sets and rest."""
    if day_id == REST_DAY:
        raise ValueError("rest days have no swappable exercises")
    day = DAYS[day_id]
    block = next((b for b in session.blocks if b.order == block_order), None)
    if block is None or block.kind not in (BlockKind.STRENGTH, BlockKind.CONDITIONING):
        raise ValueError("only strength and conditioning exercises can be swapped")
    items = day.strength if block.kind == BlockKind.STRENGTH else day.amrap
    if not 0 <= index < len(items):
        raise ValueError("no exercise at that position")
    it = items[index]
    if it.role:  # top set and back-off share one exercise: swapping only one half would split them
        return []
    current = block.exercises[index]
    pool = it.rotate or ((S, T, I) if block.kind == BlockKind.STRENGTH else CIRCUIT)
    in_session = {rx.name for b in session.blocks for rx in b.exercises}
    best: dict[str, Variant] = {}
    for v in candidates(current.pattern, pool, equipment, stand_ins=True, v2=True):
        if EXERCISES[v[0]].name in in_session:
            continue
        if v[0] not in best or v[1] == current.modality:
            best[v[0]] = v
    slot = Item(it.variant, it.rx, it.rest, rotate=pool)
    options = [_rx(slot, v, block=block.kind, p=p, history=history, bodyweight_kg=bodyweight_kg)
               for v in best.values()]
    return sorted(options, key=lambda rx: rx.name)[:limit]
