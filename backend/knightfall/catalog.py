"""Exercise catalog.

Each exercise lists the modalities it can be loaded in, with a base
prescription per modality (full Brawler volume; tiers scale it down).
The Chaos Engine picks (exercise, modality) variants per slot.

``lumbar`` / ``shoulder`` are 0-3 joint-stress weights used by the readiness
model to accumulate spinal and shoulder load. ``armor`` marks movements that
count towards the Armor Load metric.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .domain import Implement, Modality, Mode, Pattern, Tempo

ArmorKind = Literal["carry", "sled", "weighted_pull"]


@dataclass(frozen=True)
class RxTemplate:
    mode: Mode
    sets: int = 1
    duration_seconds: int | None = None
    reps: int | None = None
    reps_per_side: int | None = None
    reps_sequence: tuple[int, ...] | None = None
    hold_seconds: int | None = None
    intra_set_rest_seconds: int | None = None
    tempo: Tempo | None = None
    intensity: str | None = None
    cues: tuple[str, ...] = ()


@dataclass(frozen=True)
class Exercise:
    id: str
    name: str
    pattern: Pattern
    implement: Implement
    variants: dict[Modality, RxTemplate]
    unilateral: bool = False
    lumbar: int = 0
    shoulder: int = 0
    armor: ArmorKind | None = None
    tags: frozenset[str] = field(default_factory=frozenset)


def reps(sets: int, n: int, **kw) -> RxTemplate:
    return RxTemplate(Mode.REPS, sets=sets, reps=n, **kw)


def per_side(sets: int, n: int, **kw) -> RxTemplate:
    return RxTemplate(Mode.REPS, sets=sets, reps_per_side=n, **kw)


def timed(sets: int, seconds: int, **kw) -> RxTemplate:
    return RxTemplate(Mode.TIMED, sets=sets, duration_seconds=seconds, **kw)


def hold(sets: int, seconds: int, **kw) -> RxTemplate:
    return RxTemplate(Mode.HOLD, sets=sets, hold_seconds=seconds, **kw)


def tempo(ecc: int, bottom: int, con: int, top: int) -> Tempo:
    return Tempo(eccentric=ecc, bottom_pause=bottom, concentric=con, top_pause=top)


S, T, I, E, H, C, P = (
    Modality.STRENGTH,
    Modality.TEMPO,
    Modality.ISOMETRIC,
    Modality.EXPLOSIVE,
    Modality.HYPERTROPHY,
    Modality.CONDITIONING,
    Modality.PREP,
)

_EXERCISES: list[Exercise] = [
    # --- Block 1: cardio / tissue / mobility (durations are rescaled per tier) ---
    Exercise("elliptical", "Elliptical Trainer", Pattern.CARDIO, Implement.ERGOMETER,
             {P: timed(1, 900, intensity="70% HR_MAX")}),
    Exercise("airdyne_easy", "Airdyne Bike (easy)", Pattern.CARDIO, Implement.ERGOMETER,
             {P: timed(1, 900, intensity="65-70% HR_MAX")}),
    Exercise("easy_walk", "Easy Walk (Zone 1)", Pattern.CARDIO, Implement.BODYWEIGHT,
             {C: timed(1, 1800, intensity="<60% HR_MAX")}),
    Exercise("rumble_roller_lower", "Rumble Roller (Hip/TFL/VMO/Glute/Calf)", Pattern.MYOFASCIAL,
             Implement.ROLLER, {P: timed(1, 540, cues=("IT band", "TFL", "VMO", "glúteos", "panturrilha"))}),
    Exercise("rumble_roller_full", "Rumble Roller (IT Band/Glute/Lats)", Pattern.MYOFASCIAL,
             Implement.ROLLER, {P: timed(1, 540, cues=("IT band", "glúteos", "dorsais", "T-spine"))}),
    Exercise("brettzel_stretch", "Brettzel Stretch", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 3, cues=("2 respirações profundas por rep",))}),
    Exercise("spiderman_lunge_stretch", "Spiderman Lunge Stretch", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 3, cues=("2 respirações profundas por rep",))}),
    Exercise("inchworm", "Inchworm", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: reps(1, 5, cues=("1 respiração por rep",))}),
    Exercise("plank_arm_extension_prep", "Plank with Arm Extension", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: RxTemplate(Mode.HOLD, sets=1, hold_seconds=2, reps_per_side=8,
                            cues=("prancha base 10 s", "segurar extensão 2 s"))}),
    Exercise("worlds_greatest_stretch", "World's Greatest Stretch", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 4)}),
    Exercise("t_spine_rotation", "Quadruped T-Spine Rotation", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 8)}),
    Exercise("hip_90_90", "90/90 Hip Switch", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 6)}),

    # --- Vertical pull ---
    Exercise("strict_pull_up", "Strict Pull-Up", Pattern.PULL_VERTICAL, Implement.BODYWEIGHT,
             {T: reps(6, 4, tempo=tempo(4, 0, 4, 1)),
              S: reps(5, 5, cues=("lastro no cinto",)),
              I: hold(3, 20, cues=("queixo acima da barra",)),
              E: reps(5, 3, cues=("peito na barra",))},
             shoulder=2, armor="weighted_pull"),
    Exercise("neutral_grip_pull_up", "Neutral-Grip Pull-Up", Pattern.PULL_VERTICAL, Implement.BODYWEIGHT,
             {S: reps(4, 6), T: reps(5, 4, tempo=tempo(3, 1, 2, 1)), H: reps(1, 8)},
             shoulder=2, armor="weighted_pull"),
    Exercise("v_grip_lat_pulldown", "V-Grip Lat Pulldown", Pattern.PULL_VERTICAL, Implement.CABLE,
             {H: reps(1, 15), S: reps(4, 8), T: reps(4, 6, tempo=tempo(3, 0, 2, 1))}, shoulder=1),
    Exercise("single_arm_cable_pulldown", "Single-Arm Cable Pulldown", Pattern.PULL_VERTICAL, Implement.CABLE,
             {H: per_side(1, 12), S: per_side(4, 8)}, unilateral=True, shoulder=1),

    # --- Horizontal pull ---
    Exercise("half_kneeling_cable_row", "Half-Kneeling Cable Row", Pattern.PULL_HORIZONTAL, Implement.CABLE,
             {S: per_side(4, 12), T: per_side(4, 8, tempo=tempo(3, 1, 2, 0))}, unilateral=True, lumbar=1, shoulder=1),
    Exercise("chest_supported_db_row", "Chest-Supported DB Row", Pattern.PULL_HORIZONTAL, Implement.DUMBBELL,
             {S: reps(4, 8), H: reps(1, 12), I: hold(3, 20, cues=("cotovelos no topo",))}, shoulder=1),
    Exercise("inverted_row", "Inverted Row", Pattern.PULL_HORIZONTAL, Implement.BODYWEIGHT,
             {T: reps(4, 8, tempo=tempo(3, 1, 1, 1)), E: reps(5, 5), H: reps(1, 15)}, shoulder=1),
    Exercise("single_arm_db_row", "Single-Arm DB Row", Pattern.PULL_HORIZONTAL, Implement.DUMBBELL,
             {S: per_side(4, 8), H: per_side(1, 12)}, unilateral=True, lumbar=1, shoulder=1),

    # --- Horizontal push ---
    Exercise("db_bench_press", "DB Bench Press", Pattern.PUSH_HORIZONTAL, Implement.DUMBBELL,
             {S: reps(5, 6), T: reps(4, 6, tempo=tempo(3, 0, 1, 0)), H: reps(1, 12)}, shoulder=2),
    Exercise("db_floor_press", "DB Floor Press", Pattern.PUSH_HORIZONTAL, Implement.DUMBBELL,
             {S: reps(4, 8), I: hold(3, 15, cues=("pausa com braços estendidos",))}, shoulder=1),
    Exercise("push_up", "Push-Up", Pattern.PUSH_HORIZONTAL, Implement.BODYWEIGHT,
             {T: reps(4, 10, tempo=tempo(3, 1, 1, 0)), E: reps(5, 5, cues=("palma",)), H: reps(1, 20),
              I: hold(3, 30, cues=("peito a 2 cm do chão",))}, shoulder=1),
    Exercise("half_kneeling_cable_press", "Half-Kneeling Cable Chest Press", Pattern.PUSH_HORIZONTAL,
             Implement.CABLE, {S: per_side(4, 10), H: per_side(1, 12)}, unilateral=True, shoulder=1),

    # --- Vertical push ---
    Exercise("half_kneeling_landmine_press", "Half-Kneeling Landmine Press", Pattern.PUSH_VERTICAL,
             Implement.BARBELL, {S: per_side(4, 8), E: per_side(5, 4)}, unilateral=True, shoulder=1),
    Exercise("seated_db_shoulder_press", "Seated DB Shoulder Press", Pattern.PUSH_VERTICAL, Implement.DUMBBELL,
             {S: reps(4, 8), T: reps(4, 6, tempo=tempo(3, 0, 2, 0)), H: reps(1, 12)}, shoulder=2),
    Exercise("kb_bottoms_up_press", "KB Bottoms-Up Press", Pattern.PUSH_VERTICAL, Implement.KETTLEBELL,
             {S: per_side(4, 6), I: hold(3, 20, cues=("segurar acima da cabeça",))}, unilateral=True, shoulder=1),

    # --- Squat ---
    Exercise("goblet_squat", "Goblet Squat", Pattern.SQUAT, Implement.DUMBBELL,
             {S: reps(4, 8), T: reps(4, 6, tempo=tempo(4, 1, 1, 0)), H: reps(1, 8)}, lumbar=1),
    Exercise("front_squat", "Front Squat", Pattern.SQUAT, Implement.BARBELL,
             {S: reps(5, 5), T: reps(4, 4, tempo=tempo(4, 1, 1, 0))}, lumbar=2, shoulder=1),
    Exercise("jump_squat", "Jump Squat", Pattern.SQUAT, Implement.BODYWEIGHT,
             {E: reps(5, 5), H: reps(1, 10)}),
    Exercise("kb_front_rack_squat", "KB Double Front-Rack Squat", Pattern.SQUAT, Implement.KETTLEBELL,
             {S: reps(4, 8), I: hold(3, 20, cues=("pausa no fundo",)), H: reps(1, 10)}, lumbar=1),

    # --- Hinge ---
    Exercise("trap_bar_deadlift", "Trap Bar Deadlift", Pattern.HINGE, Implement.TRAP_BAR,
             {S: reps(5, 5), E: reps(6, 3, cues=("velocidade máxima na subida",))}, lumbar=3, shoulder=1),
    Exercise("db_romanian_deadlift", "DB Romanian Deadlift", Pattern.HINGE, Implement.DUMBBELL,
             {S: reps(4, 8), T: reps(4, 6, tempo=tempo(4, 0, 1, 0))}, lumbar=2),
    Exercise("kb_swing", "Kettlebell Swing", Pattern.HINGE, Implement.KETTLEBELL,
             {E: reps(6, 10), H: reps(1, 15)}, lumbar=2),
    Exercise("single_leg_rdl", "Single-Leg DB RDL", Pattern.HINGE, Implement.DUMBBELL,
             {S: per_side(3, 8), T: per_side(3, 6, tempo=tempo(3, 1, 1, 0))}, unilateral=True, lumbar=1),
    Exercise("barbell_hip_thrust", "Barbell Hip Thrust", Pattern.HINGE, Implement.BARBELL,
             {S: reps(4, 8), I: hold(3, 30, cues=("quadril travado no topo",)), H: reps(1, 12)}, lumbar=1),

    # --- Lunge / unilateral legs ---
    Exercise("lateral_squat", "Lateral Squat", Pattern.LUNGE, Implement.BODYWEIGHT,
             {S: per_side(3, 6), H: per_side(1, 6)}, unilateral=True),
    Exercise("db_reverse_lunge", "DB Reverse Lunge", Pattern.LUNGE, Implement.DUMBBELL,
             {S: per_side(4, 8), T: per_side(3, 6, tempo=tempo(3, 1, 1, 0)), H: per_side(1, 8)},
             unilateral=True, lumbar=1),
    Exercise("rfe_split_squat", "Rear-Foot-Elevated Split Squat", Pattern.LUNGE, Implement.DUMBBELL,
             {S: per_side(4, 6), I: RxTemplate(Mode.HOLD, sets=3, hold_seconds=30, reps_per_side=1)},
             unilateral=True, lumbar=1),

    # --- Loaded carries / sled ---
    Exercise("db_farmers_walk", "Dumbbell Farmer's Walk", Pattern.CARRY, Implement.DUMBBELL,
             {S: timed(4, 60, intensity="pesado"), C: timed(3, 45)}, lumbar=2, shoulder=1, armor="carry"),
    Exercise("trap_bar_carry", "Trap Bar Carry", Pattern.CARRY, Implement.TRAP_BAR,
             {S: timed(4, 40, intensity="pesado")}, lumbar=2, shoulder=1, armor="carry"),
    Exercise("suitcase_carry", "Suitcase Carry", Pattern.CARRY, Implement.KETTLEBELL,
             {S: timed(4, 40, cues=("tempo por lado",))}, unilateral=True, lumbar=2, armor="carry"),
    Exercise("kb_front_rack_carry", "KB Front-Rack Carry", Pattern.CARRY, Implement.KETTLEBELL,
             {S: timed(3, 45), I: timed(3, 30, cues=("pausa de 5 s a cada 10 passos",))},
             lumbar=1, shoulder=1, armor="carry"),
    Exercise("sled_push", "Sled Push", Pattern.CARRY, Implement.SLED,
             {E: timed(6, 15), S: timed(5, 20, intensity="pesado"), C: timed(4, 30)}, lumbar=1, armor="sled"),

    # --- Core ---
    Exercise("pallof_press", "Pallof Press", Pattern.CORE_ANTI_ROTATION, Implement.CABLE,
             {I: RxTemplate(Mode.HOLD, sets=3, hold_seconds=20, reps_per_side=1),
              S: per_side(3, 10)}, unilateral=True),
    Exercise("plank_arm_extension", "Plank with Arm Extension", Pattern.CORE_ANTI_ROTATION, Implement.BODYWEIGHT,
             {I: RxTemplate(Mode.HOLD, sets=3, hold_seconds=2, reps_per_side=8,
                            cues=("prancha base 10 s", "segurar extensão 2 s"))}),
    Exercise("side_plank", "Side Plank", Pattern.CORE_ANTI_ROTATION, Implement.BODYWEIGHT,
             {I: RxTemplate(Mode.HOLD, sets=3, hold_seconds=30, reps_per_side=1)}, unilateral=True),
    Exercise("landmine_rotation", "Landmine Rotation", Pattern.CORE_ANTI_ROTATION, Implement.BARBELL,
             {E: per_side(4, 6), S: per_side(3, 8)}, lumbar=1),
    Exercise("alt_hanging_knee_up", "Alternating Hanging Knee-Up", Pattern.CORE_FLEXION, Implement.BODYWEIGHT,
             {S: per_side(3, 11), T: per_side(3, 8, tempo=tempo(2, 1, 2, 0)), H: per_side(1, 12)}, shoulder=1),
    Exercise("ab_wheel_rollout", "Ab Wheel Rollout", Pattern.CORE_FLEXION, Implement.BODYWEIGHT,
             {S: reps(3, 10), T: reps(3, 6, tempo=tempo(4, 0, 2, 0)), H: reps(1, 10)}, lumbar=1, shoulder=1),
    Exercise("hollow_hold", "Hollow Hold", Pattern.CORE_FLEXION, Implement.BODYWEIGHT,
             {I: hold(3, 30)}),

    # --- Neck ---
    Exercise("wrestlers_back_bridge", "Wrestler's Back Bridge", Pattern.NECK, Implement.BODYWEIGHT,
             {I: hold(2, 15, intra_set_rest_seconds=5)}, lumbar=1),
    Exercise("band_neck_iso", "Band Neck Isometric (4-way)", Pattern.NECK, Implement.BAND,
             {I: hold(4, 20, cues=("frente", "trás", "esquerda", "direita"))}),

    # --- Functional bodybuilding ---
    Exercise("alt_db_open_curl_complex", "Alternating DB Open Curl (5L, 5R, 5 Both)", Pattern.ARMS,
             Implement.DUMBBELL, {H: RxTemplate(Mode.REPS, sets=1, reps_sequence=(5, 5, 5))}),
    Exercise("db_hammer_curl", "DB Hammer Curl", Pattern.ARMS, Implement.DUMBBELL, {H: reps(1, 12)}),
    Exercise("cable_triceps_pressdown", "Cable Triceps Pressdown", Pattern.ARMS, Implement.CABLE, {H: reps(1, 15)}),
    Exercise("db_skullcrusher", "DB Skullcrusher", Pattern.ARMS, Implement.DUMBBELL, {H: reps(1, 12)}, shoulder=1),
    Exercise("db_lateral_raise", "DB Lateral Raise", Pattern.SHOULDERS, Implement.DUMBBELL, {H: reps(1, 15)}),
    Exercise("cable_lateral_raise", "Cable Lateral Raise", Pattern.SHOULDERS, Implement.CABLE,
             {H: per_side(1, 12)}, unilateral=True),
    Exercise("face_pull", "Face Pull", Pattern.SHOULDERS, Implement.CABLE, {H: reps(1, 15)}),
    Exercise("band_pull_apart", "Band Pull-Apart", Pattern.SHOULDERS, Implement.BAND, {H: reps(1, 20)}),
    Exercise("db_shrug", "DB Shrug", Pattern.TRAPS, Implement.DUMBBELL, {H: reps(1, 15)}),
    Exercise("trap_bar_shrug", "Trap Bar Shrug", Pattern.TRAPS, Implement.TRAP_BAR, {H: reps(1, 12)}, lumbar=1),

    # --- Sprints ---
    Exercise("airdyne_sprint", "Airdyne Bike Sprint", Pattern.SPRINT, Implement.ERGOMETER,
             {C: timed(1, 20, intensity="100% MAX_WATTS"), E: timed(1, 15, intensity="100% MAX_WATTS")}),
]

EXERCISES: dict[str, Exercise] = {e.id: e for e in _EXERCISES}

if len(EXERCISES) != len(_EXERCISES):  # pragma: no cover - guards against copy/paste ids
    raise RuntimeError("duplicate exercise id in catalog")


def by_pattern(pattern: Pattern) -> list[Exercise]:
    return [e for e in _EXERCISES if e.pattern == pattern]
