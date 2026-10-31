"""Exercise catalog.

Each exercise lists the modalities it can be loaded in, with a base
prescription per modality (full Brawler volume; tiers scale it down).
The Chaos Engine picks (exercise, modality) variants per slot.

``lumbar`` / ``shoulder`` are 0-3 joint-stress weights used by the readiness
model to accumulate spinal and shoulder load. ``armor`` marks movements that
count towards the Armor Load metric. ``stand_in`` marks bodyweight options
the Chaos Engine only draws when the equipment profile leaves a pattern
without a regular one (they are always offered as swaps).
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
    reps_max: int | None = None
    reps_per_side: int | None = None
    reps_sequence: tuple[int, ...] | None = None
    hold_seconds: int | None = None
    distance_m: int | None = None
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
    stand_in: bool = False
    tags: frozenset[str] = field(default_factory=frozenset)


V2 = frozenset({"v2"})


def reps(sets: int, n: int, **kw) -> RxTemplate:
    return RxTemplate(Mode.REPS, sets=sets, reps=n, **kw)


def per_side(sets: int, n: int, **kw) -> RxTemplate:
    return RxTemplate(Mode.REPS, sets=sets, reps_per_side=n, **kw)


def timed(sets: int, seconds: int, **kw) -> RxTemplate:
    return RxTemplate(Mode.TIMED, sets=sets, duration_seconds=seconds, **kw)


def hold(sets: int, seconds: int, **kw) -> RxTemplate:
    return RxTemplate(Mode.HOLD, sets=sets, hold_seconds=seconds, **kw)


def distance(sets: int, meters: int, **kw) -> RxTemplate:
    return RxTemplate(Mode.DISTANCE, sets=sets, distance_m=meters, **kw)


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
    Exercise("elliptical", "Elíptico", Pattern.CARDIO, Implement.ERGOMETER,
             {P: timed(1, 900, intensity="70% da FC máx. (frequência cardíaca máxima)")}),
    Exercise("airdyne_easy", "Bike (ritmo leve)", Pattern.CARDIO, Implement.ERGOMETER,
             {P: timed(1, 900, intensity="65–70% da FC máx. (frequência cardíaca máxima)")}),
    Exercise("easy_walk", "Caminhada leve (zona 1)", Pattern.CARDIO, Implement.BODYWEIGHT,
             {C: timed(1, 1800, intensity="abaixo de 60% da FC máx. (frequência cardíaca máxima)")}),
    Exercise("brisk_walk", "Caminhada rápida ou trote leve", Pattern.CARDIO,
             Implement.BODYWEIGHT, {P: timed(1, 900, intensity="65–70% da FC máx. (frequência cardíaca máxima)")}, stand_in=True),
    Exercise("rumble_roller_lower", "Rolo de liberação: membros inferiores", Pattern.MYOFASCIAL,
             Implement.ROLLER, {P: timed(1, 540, cues=("banda iliotibial (lateral da coxa)", "TFL (tensor da fáscia lata, lateral do quadril)", "VMO (vasto medial oblíquo, acima do joelho)", "glúteos", "panturrilha"))}),
    Exercise("rumble_roller_full", "Rolo de liberação: corpo inteiro", Pattern.MYOFASCIAL,
             Implement.ROLLER, {P: timed(1, 540, cues=("banda iliotibial (lateral da coxa)", "glúteos", "dorsais", "coluna torácica (meio das costas)"))}),
    Exercise("brettzel_stretch", "Alongamento Brettzel", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 3, cues=("2 respirações profundas por repetição",))}),
    Exercise("spiderman_lunge_stretch", "Afundo do Homem-Aranha (alongamento)", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 3, cues=("2 respirações profundas por repetição",))}),
    Exercise("inchworm", "Inchworm (caminhada com as mãos)", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: reps(1, 5, cues=("1 respiração por repetição",))}),
    Exercise("plank_arm_extension_prep", "Prancha com extensão de braço", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: RxTemplate(Mode.HOLD, sets=1, hold_seconds=2, reps_per_side=8,
                            cues=("prancha base 10 s", "segurar extensão 2 s"))}),
    Exercise("worlds_greatest_stretch", "World's Greatest Stretch", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 4)}),
    Exercise("t_spine_rotation", "Rotação torácica em quatro apoios", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 8)}),
    Exercise("hip_90_90", "Troca de quadril 90/90", Pattern.MOBILITY, Implement.BODYWEIGHT,
             {P: per_side(1, 6)}),

    # --- Vertical pull ---
    Exercise("strict_pull_up", "Barra fixa pronada", Pattern.PULL_VERTICAL, Implement.BODYWEIGHT,
             {T: reps(6, 4, tempo=tempo(4, 0, 4, 1)),
              S: reps(5, 5, cues=("lastro no cinto",)),
              I: hold(3, 20, cues=("queixo acima da barra",)),
              E: reps(5, 3, cues=("peito na barra",))},
             shoulder=2, armor="weighted_pull"),
    Exercise("neutral_grip_pull_up", "Barra fixa pegada neutra", Pattern.PULL_VERTICAL, Implement.BODYWEIGHT,
             {S: reps(4, 6), T: reps(5, 4, tempo=tempo(3, 1, 2, 1)), H: reps(1, 8)},
             shoulder=2, armor="weighted_pull"),
    Exercise("v_grip_lat_pulldown", "Puxada com triângulo", Pattern.PULL_VERTICAL, Implement.LAT_PULLDOWN,
             {H: reps(1, 15), S: reps(4, 8), T: reps(4, 6, tempo=tempo(3, 0, 2, 1))}, shoulder=1),
    Exercise("single_arm_cable_pulldown", "Puxada unilateral na polia", Pattern.PULL_VERTICAL, Implement.CABLE,
             {H: per_side(1, 12), S: per_side(4, 8)}, unilateral=True, shoulder=1),

    # --- Horizontal pull ---
    Exercise("half_kneeling_cable_row", "Remada unilateral na polia (meio ajoelhado)", Pattern.PULL_HORIZONTAL, Implement.CABLE,
             {S: per_side(4, 12), T: per_side(4, 8, tempo=tempo(3, 1, 2, 0))}, unilateral=True, lumbar=1, shoulder=1),
    Exercise("chest_supported_db_row", "Remada com halteres apoiada no banco", Pattern.PULL_HORIZONTAL, Implement.DUMBBELL,
             {S: reps(4, 8), H: reps(1, 12), I: hold(3, 20, cues=("cotovelos no topo",))}, shoulder=1),
    Exercise("inverted_row", "Remada invertida", Pattern.PULL_HORIZONTAL, Implement.BODYWEIGHT,
             {T: reps(4, 8, tempo=tempo(3, 1, 1, 1)), E: reps(5, 5), H: reps(1, 15)}, shoulder=1),
    Exercise("single_arm_db_row", "Remada unilateral com halter (serrote)", Pattern.PULL_HORIZONTAL, Implement.DUMBBELL,
             {S: per_side(4, 8), H: per_side(1, 12)}, unilateral=True, lumbar=1, shoulder=1),

    # --- Horizontal push ---
    Exercise("db_bench_press", "Supino reto com halteres", Pattern.PUSH_HORIZONTAL, Implement.DUMBBELL,
             {S: reps(5, 6), T: reps(4, 6, tempo=tempo(3, 0, 1, 0)), H: reps(1, 12)}, shoulder=2),
    Exercise("db_floor_press", "Supino no chão com halteres", Pattern.PUSH_HORIZONTAL, Implement.DUMBBELL,
             {S: reps(4, 8), I: hold(3, 15, cues=("pausa com braços estendidos",))}, shoulder=1),
    Exercise("push_up", "Flexão de braço", Pattern.PUSH_HORIZONTAL, Implement.BODYWEIGHT,
             {T: reps(4, 10, tempo=tempo(3, 1, 1, 0)), E: reps(5, 5, cues=("palma",)), H: reps(1, 20),
              I: hold(3, 30, cues=("peito a 2 cm do chão",))}, shoulder=1),
    Exercise("half_kneeling_cable_press", "Supino unilateral na polia (meio ajoelhado)", Pattern.PUSH_HORIZONTAL,
             Implement.CABLE, {S: per_side(4, 10), H: per_side(1, 12)}, unilateral=True, shoulder=1),

    # --- Vertical push ---
    Exercise("half_kneeling_landmine_press", "Desenvolvimento landmine (meio ajoelhado)", Pattern.PUSH_VERTICAL,
             Implement.BARBELL, {S: per_side(4, 8), E: per_side(5, 4)}, unilateral=True, shoulder=1),
    Exercise("seated_db_shoulder_press", "Desenvolvimento sentado com halteres", Pattern.PUSH_VERTICAL, Implement.DUMBBELL,
             {S: reps(4, 8), T: reps(4, 6, tempo=tempo(3, 0, 2, 0)), H: reps(1, 12)}, shoulder=2),
    Exercise("kb_bottoms_up_press", "Desenvolvimento com kettlebell invertido", Pattern.PUSH_VERTICAL, Implement.KETTLEBELL,
             {S: per_side(4, 6), I: hold(3, 20, cues=("segurar acima da cabeça",))}, unilateral=True, shoulder=1),
    Exercise("pike_push_up", "Flexão pike", Pattern.PUSH_VERTICAL, Implement.BODYWEIGHT,
             {S: reps(4, 8), T: reps(4, 5, tempo=tempo(3, 0, 1, 0)), I: hold(3, 15, cues=("cabeça a 2 cm do chão",))},
             shoulder=2, stand_in=True),

    # --- Squat ---
    Exercise("goblet_squat", "Agachamento goblet", Pattern.SQUAT, Implement.DUMBBELL,
             {S: reps(4, 8), T: reps(4, 6, tempo=tempo(4, 1, 1, 0)), H: reps(1, 8)}, lumbar=1),
    Exercise("front_squat", "Agachamento frontal", Pattern.SQUAT, Implement.BARBELL,
             {S: reps(5, 5), T: reps(4, 4, tempo=tempo(4, 1, 1, 0))}, lumbar=2, shoulder=1),
    Exercise("jump_squat", "Agachamento com salto", Pattern.SQUAT, Implement.BODYWEIGHT,
             {E: reps(5, 5), H: reps(1, 10)}),
    Exercise("kb_front_rack_squat", "Agachamento com 2 kettlebells (front rack)", Pattern.SQUAT, Implement.KETTLEBELL,
             {S: reps(4, 8), I: hold(3, 20, cues=("pausa no fundo",)), H: reps(1, 10)}, lumbar=1),
    Exercise("air_squat", "Agachamento livre sem carga", Pattern.SQUAT, Implement.BODYWEIGHT,
             {T: reps(4, 10, tempo=tempo(4, 1, 1, 0)), I: hold(3, 30, cues=("coxas paralelas ao chão",)),
              H: reps(1, 20)}, stand_in=True),

    # --- Hinge ---
    Exercise("trap_bar_deadlift", "Levantamento terra com trap bar", Pattern.HINGE, Implement.TRAP_BAR,
             {S: reps(5, 5), E: reps(6, 3, cues=("velocidade máxima na subida",))}, lumbar=3, shoulder=1),
    Exercise("db_romanian_deadlift", "Stiff com halteres", Pattern.HINGE, Implement.DUMBBELL,
             {S: reps(4, 8), T: reps(4, 6, tempo=tempo(4, 0, 1, 0))}, lumbar=2),
    Exercise("kb_swing", "Kettlebell swing", Pattern.HINGE, Implement.KETTLEBELL,
             {E: reps(6, 10), H: reps(1, 15)}, lumbar=2),
    Exercise("single_leg_rdl", "Stiff unilateral com halter", Pattern.HINGE, Implement.DUMBBELL,
             {S: per_side(3, 8), T: per_side(3, 6, tempo=tempo(3, 1, 1, 0))}, unilateral=True, lumbar=1),
    Exercise("barbell_hip_thrust", "Elevação pélvica com barra", Pattern.HINGE, Implement.BARBELL,
             {S: reps(4, 8), I: hold(3, 30, cues=("quadril travado no topo",)), H: reps(1, 12)}, lumbar=1),
    Exercise("single_leg_hip_thrust", "Elevação pélvica unilateral", Pattern.HINGE, Implement.BODYWEIGHT,
             {S: per_side(3, 12), I: RxTemplate(Mode.HOLD, sets=3, hold_seconds=30, reps_per_side=1,
                                                cues=("quadril travado no topo",)), H: per_side(1, 15)},
             unilateral=True, stand_in=True),
    Exercise("broad_jump", "Salto horizontal", Pattern.HINGE, Implement.BODYWEIGHT,
             {E: reps(5, 3, cues=("aterrissagem suave",))}, lumbar=1, stand_in=True),

    # --- Lunge / unilateral legs ---
    Exercise("lateral_squat", "Agachamento lateral", Pattern.LUNGE, Implement.BODYWEIGHT,
             {S: per_side(3, 6), H: per_side(1, 6)}, unilateral=True),
    Exercise("db_reverse_lunge", "Afundo reverso com halteres", Pattern.LUNGE, Implement.DUMBBELL,
             {S: per_side(4, 8), T: per_side(3, 6, tempo=tempo(3, 1, 1, 0)), H: per_side(1, 8)},
             unilateral=True, lumbar=1),
    Exercise("rfe_split_squat", "Agachamento búlgaro com halteres", Pattern.LUNGE, Implement.DUMBBELL,
             {S: per_side(4, 6), I: RxTemplate(Mode.HOLD, sets=3, hold_seconds=30, reps_per_side=1)},
             unilateral=True, lumbar=1),
    Exercise("jumping_lunge", "Afundo com salto", Pattern.LUNGE, Implement.BODYWEIGHT,
             {E: per_side(4, 5), H: per_side(1, 8)}, unilateral=True, stand_in=True),

    # --- Loaded carries / sled ---
    Exercise("db_farmers_walk", "Caminhada do fazendeiro", Pattern.CARRY, Implement.DUMBBELL,
             {S: timed(4, 60, intensity="pesado"), C: timed(3, 45)}, lumbar=2, shoulder=1, armor="carry"),
    Exercise("trap_bar_carry", "Caminhada com trap bar", Pattern.CARRY, Implement.TRAP_BAR,
             {S: timed(4, 40, intensity="pesado")}, lumbar=2, shoulder=1, armor="carry"),
    Exercise("suitcase_carry", "Caminhada unilateral (mala)", Pattern.CARRY, Implement.KETTLEBELL,
             {S: timed(4, 40, cues=("tempo por lado",))}, unilateral=True, lumbar=2, armor="carry"),
    Exercise("kb_front_rack_carry", "Caminhada com kettlebells (front rack)", Pattern.CARRY, Implement.KETTLEBELL,
             {S: timed(3, 45), I: timed(3, 30, cues=("pausa de 5 s a cada 10 passos",))},
             lumbar=1, shoulder=1, armor="carry"),
    Exercise("sled_push", "Empurrar trenó", Pattern.CARRY, Implement.SLED,
             {E: timed(6, 15), S: timed(5, 20, intensity="pesado"), C: timed(4, 30)}, lumbar=1, armor="sled"),
    Exercise("bear_crawl", "Caminhada do urso", Pattern.CARRY, Implement.BODYWEIGHT,
             {S: timed(4, 40, cues=("joelhos a 2 cm do chão", "quadril baixo")),
              I: hold(3, 30, cues=("prancha de urso: joelhos a 2 cm do chão",))}, shoulder=1, stand_in=True),

    # --- Core ---
    Exercise("pallof_press", "Pallof press", Pattern.CORE_ANTI_ROTATION, Implement.CABLE,
             {I: RxTemplate(Mode.HOLD, sets=3, hold_seconds=20, reps_per_side=1),
              S: per_side(3, 10)}, unilateral=True),
    Exercise("plank_arm_extension", "Prancha com extensão de braço", Pattern.CORE_ANTI_ROTATION, Implement.BODYWEIGHT,
             {I: RxTemplate(Mode.HOLD, sets=3, hold_seconds=2, reps_per_side=8,
                            cues=("prancha base 10 s", "segurar extensão 2 s"))}),
    Exercise("side_plank", "Prancha lateral", Pattern.CORE_ANTI_ROTATION, Implement.BODYWEIGHT,
             {I: RxTemplate(Mode.HOLD, sets=3, hold_seconds=30, reps_per_side=1)}, unilateral=True),
    Exercise("landmine_rotation", "Rotação landmine", Pattern.CORE_ANTI_ROTATION, Implement.BARBELL,
             {E: per_side(4, 6), S: per_side(3, 8)}, lumbar=1),
    Exercise("alt_hanging_knee_up", "Elevação alternada de joelhos na barra", Pattern.CORE_FLEXION, Implement.BODYWEIGHT,
             {S: per_side(3, 11), T: per_side(3, 8, tempo=tempo(2, 1, 2, 0)), H: per_side(1, 12)}, shoulder=1),
    Exercise("ab_wheel_rollout", "Roda abdominal", Pattern.CORE_FLEXION, Implement.BODYWEIGHT,
             {S: reps(3, 10), T: reps(3, 6, tempo=tempo(4, 0, 2, 0)), H: reps(1, 10)}, lumbar=1, shoulder=1),
    Exercise("hollow_hold", "Hollow hold (canoa)", Pattern.CORE_FLEXION, Implement.BODYWEIGHT,
             {I: hold(3, 30)}),

    # --- Neck ---
    Exercise("wrestlers_back_bridge", "Ponte de lutador", Pattern.NECK, Implement.BODYWEIGHT,
             {I: hold(2, 15, intra_set_rest_seconds=5)}, lumbar=1),
    Exercise("band_neck_iso", "Isometria de pescoço com elástico (4 direções)", Pattern.NECK, Implement.BAND,
             {I: hold(4, 20, cues=("frente", "trás", "esquerda", "direita"))}),

    # --- Functional bodybuilding ---
    Exercise("alt_db_open_curl_complex", "Rosca alternada aberta (5 esquerda, 5 direita, 5 juntos)", Pattern.ARMS,
             Implement.DUMBBELL, {H: RxTemplate(Mode.REPS, sets=1, reps_sequence=(5, 5, 5))}),
    Exercise("db_hammer_curl", "Rosca martelo", Pattern.ARMS, Implement.DUMBBELL, {H: reps(1, 12)}),
    Exercise("cable_triceps_pressdown", "Tríceps na polia", Pattern.ARMS, Implement.CABLE, {H: reps(1, 15)}),
    Exercise("db_skullcrusher", "Tríceps testa com halteres", Pattern.ARMS, Implement.DUMBBELL, {H: reps(1, 12)}, shoulder=1),
    Exercise("diamond_push_up", "Flexão diamante", Pattern.ARMS, Implement.BODYWEIGHT, {H: reps(1, 12)}, shoulder=1, stand_in=True),
    Exercise("db_lateral_raise", "Elevação lateral com halteres", Pattern.SHOULDERS, Implement.DUMBBELL, {H: reps(1, 15)}),
    Exercise("cable_lateral_raise", "Elevação lateral na polia", Pattern.SHOULDERS, Implement.CABLE,
             {H: per_side(1, 12)}, unilateral=True),
    Exercise("face_pull", "Face pull", Pattern.SHOULDERS, Implement.CABLE, {H: reps(1, 15)}),
    Exercise("band_pull_apart", "Abertura com elástico", Pattern.SHOULDERS, Implement.BAND, {H: reps(1, 20)}),
    Exercise("prone_ytw_raise", "Y-T-W deitado", Pattern.SHOULDERS, Implement.BODYWEIGHT,
             {H: reps(1, 10, cues=("Y, T e W = 1 repetição",))}, stand_in=True),
    Exercise("db_shrug", "Encolhimento com halteres", Pattern.TRAPS, Implement.DUMBBELL, {H: reps(1, 15)}),
    Exercise("trap_bar_shrug", "Encolhimento com trap bar", Pattern.TRAPS, Implement.TRAP_BAR, {H: reps(1, 12)}, lumbar=1),
    Exercise("scapular_pull_up", "Barra escapular", Pattern.TRAPS, Implement.BODYWEIGHT, {H: reps(1, 12)}, shoulder=1, stand_in=True),

    # --- Brawler V2 (tag "v2": drawn only by the V2 program, so the other tiers' rotations stay as they are) ---
    Exercise("med_ball_slam", "Arremesso de medicine ball no chão", Pattern.HINGE, Implement.MEDICINE_BALL,
             {E: reps(3, 5, cues=("arremesso contra o solo",))}, tags=V2),
    Exercise("med_ball_chest_pass", "Passe de peito com medicine ball", Pattern.PUSH_HORIZONTAL, Implement.MEDICINE_BALL,
             {E: reps(3, 5, cues=("contra a parede",))}, tags=V2),
    Exercise("box_jump", "Salto na caixa", Pattern.SQUAT, Implement.BODYWEIGHT,
             {E: reps(3, 4, cues=("aterrissagem suave", "desça caminhando"))}, tags=V2),
    Exercise("short_sprint", "Tiro curto de corrida", Pattern.SPRINT, Implement.BODYWEIGHT,
             {E: distance(5, 20, intensity="velocidade máxima")}, tags=V2),
    Exercise("band_shoulder_mobility", "Mobilidade de ombro com elástico", Pattern.MOBILITY, Implement.BAND,
             {P: timed(1, 180, cues=("deslocamentos com elástico", "rotações externas"))}, tags=V2),
    Exercise("barbell_bent_over_row", "Remada curvada com barra", Pattern.PULL_HORIZONTAL, Implement.BARBELL,
             {S: reps(4, 6)}, lumbar=2, shoulder=1, tags=V2),
    Exercise("wide_grip_lat_pulldown", "Puxada frontal aberta", Pattern.PULL_VERTICAL, Implement.LAT_PULLDOWN,
             {S: reps(3, 8, reps_max=10, cues=("pela frente",)), H: reps(1, 12)}, shoulder=1, tags=V2),
    Exercise("barbell_bench_press", "Supino reto com barra", Pattern.PUSH_HORIZONTAL, Implement.BARBELL,
             {S: reps(5, 5)}, shoulder=2, tags=V2),
    Exercise("back_squat", "Agachamento livre com barra", Pattern.SQUAT, Implement.BARBELL,
             {S: reps(4, 5, reps_max=8), E: reps(8, 2, cues=("velocidade máxima na subida",))},
             lumbar=2, shoulder=1, tags=V2),
    Exercise("barbell_rdl", "Stiff com barra", Pattern.HINGE, Implement.BARBELL,
             {T: reps(3, 8, reps_max=10, tempo=tempo(3, 0, 1, 0), cues=("excêntrica controlada",))}, lumbar=2,
             tags=V2),
    Exercise("cable_plank_row", "Remada na polia em prancha", Pattern.CORE_ANTI_ROTATION, Implement.CABLE,
             {S: per_side(3, 10, cues=("quadril parado: nada de girar",))}, unilateral=True, shoulder=1, tags=V2),
    Exercise("plate_neck_curl", "Flexão de pescoço com anilha", Pattern.NECK, Implement.BARBELL,
             {H: reps(3, 15, reps_max=20, cues=("anilha na testa, amplitude controlada",))}, tags=V2),
    Exercise("leg_press", "Leg press", Pattern.SQUAT, Implement.LEG_PRESS,
             {S: reps(4, 10, reps_max=12), H: reps(3, 12, reps_max=15)}, lumbar=1),
    Exercise("cable_skullcrusher", "Tríceps testa na polia", Pattern.ARMS, Implement.CABLE,
             {H: reps(1, 12)}, shoulder=1, tags=V2),
    Exercise("decline_push_up", "Flexão declinada", Pattern.PUSH_HORIZONTAL, Implement.BODYWEIGHT,
             {H: reps(1, 10)}, shoulder=1, tags=V2),
    Exercise("wall_ball", "Wall ball", Pattern.SQUAT, Implement.MEDICINE_BALL, {H: reps(1, 12)}, tags=V2),
    Exercise("v_up", "Canivete (V-up)", Pattern.CORE_FLEXION, Implement.BODYWEIGHT, {H: reps(1, 15)}, tags=V2),
    Exercise("rowing_crunch", "Abdominal remador", Pattern.CORE_FLEXION, Implement.BODYWEIGHT, {H: reps(1, 10)}, tags=V2),
    Exercise("reverse_crunch", "Abdominal reverso", Pattern.CORE_FLEXION, Implement.BODYWEIGHT, {H: reps(1, 12)},
             tags=V2),
    Exercise("alternating_lunge", "Afundo alternado", Pattern.LUNGE, Implement.BODYWEIGHT,
             {H: reps(1, 10, cues=("alternando as pernas",))}, tags=V2),
    Exercise("box_step_up", "Subida no banco", Pattern.LUNGE, Implement.BODYWEIGHT,
             {H: reps(1, 10, cues=("alternando as pernas",))}, tags=V2),
    Exercise("burpee", "Burpee", Pattern.SQUAT, Implement.BODYWEIGHT, {H: reps(1, 8)}, tags=V2),
    Exercise("db_thruster", "Thruster com halteres", Pattern.SQUAT, Implement.DUMBBELL,
             {H: reps(1, 8, intensity="leve")}, lumbar=1, shoulder=1, tags=V2),
    Exercise("barbell_push_press", "Push press com barra", Pattern.PUSH_VERTICAL, Implement.BARBELL,
             {H: reps(1, 8, intensity="leve")}, lumbar=1, shoulder=2, tags=V2),
    Exercise("seated_machine_row", "Remada sentada na máquina", Pattern.PULL_HORIZONTAL, Implement.ROW_MACHINE,
             {H: reps(1, 10), S: reps(4, 8, reps_max=10)}, shoulder=1),
    Exercise("double_under", "Pular corda (salto duplo)", Pattern.SPRINT, Implement.BODYWEIGHT,
             {H: reps(1, 15, cues=("15 saltos duplos de corda",))}, tags=V2),

    # --- Machine gym: stations, smith, cables and free-weight staples (splits.py draws these first) ---
    # Legs
    Exercise("hack_squat", "Agachamento hack", Pattern.SQUAT, Implement.HACK_SQUAT,
             {S: reps(4, 6, reps_max=8), H: reps(3, 10, reps_max=12),
              T: reps(3, 8, tempo=tempo(3, 1, 1, 0))}, lumbar=1),
    Exercise("smith_squat", "Agachamento no smith", Pattern.SQUAT, Implement.SMITH,
             {S: reps(4, 6, reps_max=8), H: reps(3, 10, reps_max=12),
              T: reps(3, 8, tempo=tempo(3, 1, 1, 0))}, lumbar=1),
    Exercise("leg_press_single", "Leg press unilateral", Pattern.LUNGE, Implement.LEG_PRESS,
             {S: per_side(3, 8, reps_max=10), H: per_side(3, 12)}, unilateral=True),
    Exercise("smith_split_squat", "Agachamento búlgaro no smith", Pattern.LUNGE, Implement.SMITH,
             {S: per_side(3, 8, reps_max=10), H: per_side(3, 10, reps_max=12)}, unilateral=True, lumbar=1),
    Exercise("db_walking_lunge", "Afundo andando com halteres", Pattern.LUNGE, Implement.DUMBBELL,
             {S: per_side(3, 8), H: per_side(3, 10, reps_max=12)}, unilateral=True, lumbar=1),
    Exercise("smith_rdl", "Stiff no smith", Pattern.HINGE, Implement.SMITH,
             {S: reps(3, 8, reps_max=10), T: reps(3, 8, tempo=tempo(3, 0, 1, 0))}, lumbar=2),
    Exercise("smith_hip_thrust", "Elevação pélvica no smith", Pattern.HINGE, Implement.SMITH,
             {S: reps(3, 8, reps_max=12), H: reps(3, 12, reps_max=15)}, lumbar=1),
    Exercise("cable_pull_through", "Pull-through na polia", Pattern.HINGE, Implement.CABLE,
             {S: reps(3, 12), H: reps(3, 15)}, lumbar=1),
    Exercise("leg_extension", "Cadeira extensora", Pattern.KNEE_EXTENSION, Implement.LEG_EXTENSION,
             {H: reps(3, 12, reps_max=15), T: reps(3, 10, tempo=tempo(3, 0, 1, 1)),
              I: hold(3, 20, cues=("pernas estendidas, quadríceps contraído",))}),
    Exercise("single_leg_extension", "Cadeira extensora unilateral", Pattern.KNEE_EXTENSION, Implement.LEG_EXTENSION,
             {H: per_side(3, 12)}, unilateral=True),
    Exercise("lying_leg_curl", "Mesa flexora", Pattern.KNEE_FLEXION, Implement.LEG_CURL,
             {H: reps(3, 10, reps_max=12), T: reps(3, 8, tempo=tempo(3, 0, 1, 1))}),
    Exercise("seated_leg_curl", "Cadeira flexora", Pattern.KNEE_FLEXION, Implement.LEG_CURL,
             {H: reps(3, 12, reps_max=15)}),
    Exercise("nordic_curl", "Flexão nórdica", Pattern.KNEE_FLEXION, Implement.BODYWEIGHT,
             {H: reps(3, 5, cues=("pés presos, desça o mais devagar possível",))}, stand_in=True),
    Exercise("standing_calf_raise", "Panturrilha em pé na máquina", Pattern.CALVES, Implement.CALF_MACHINE,
             {H: reps(4, 10, reps_max=15, cues=("1 s parado embaixo, 1 s contraído em cima",))}),
    Exercise("seated_calf_raise", "Panturrilha sentado", Pattern.CALVES, Implement.CALF_MACHINE,
             {H: reps(3, 15, reps_max=20)}),
    Exercise("leg_press_calf_raise", "Panturrilha no leg press", Pattern.CALVES, Implement.LEG_PRESS,
             {H: reps(4, 12, reps_max=15)}),
    Exercise("smith_calf_raise", "Panturrilha no smith", Pattern.CALVES, Implement.SMITH,
             {H: reps(4, 10, reps_max=15)}),
    Exercise("single_leg_calf_raise", "Panturrilha unilateral no degrau", Pattern.CALVES, Implement.BODYWEIGHT,
             {H: per_side(3, 15)}, unilateral=True, stand_in=True),
    Exercise("hip_abduction", "Cadeira abdutora", Pattern.HIP_ISOLATION, Implement.HIP_MACHINE,
             {H: reps(3, 15, reps_max=20)}),
    Exercise("hip_adduction", "Cadeira adutora", Pattern.HIP_ISOLATION, Implement.HIP_MACHINE,
             {H: reps(3, 12, reps_max=15)}),
    Exercise("cable_kickback", "Coice na polia", Pattern.HIP_ISOLATION, Implement.CABLE,
             {H: per_side(3, 12, reps_max=15)}, unilateral=True),
    # Chest
    Exercise("chest_press_machine", "Supino na máquina", Pattern.PUSH_HORIZONTAL, Implement.CHEST_PRESS,
             {S: reps(4, 6, reps_max=8), H: reps(3, 10, reps_max=12), T: reps(3, 8, tempo=tempo(3, 0, 1, 0))},
             shoulder=1),
    Exercise("smith_bench_press", "Supino reto no smith", Pattern.PUSH_HORIZONTAL, Implement.SMITH,
             {S: reps(4, 6, reps_max=8), H: reps(3, 10, reps_max=12)}, shoulder=2),
    Exercise("smith_incline_press", "Supino inclinado no smith", Pattern.PUSH_HORIZONTAL, Implement.SMITH,
             {S: reps(4, 6, reps_max=8), H: reps(3, 10, reps_max=12)}, shoulder=2),
    Exercise("incline_db_press", "Supino inclinado com halteres", Pattern.PUSH_HORIZONTAL, Implement.DUMBBELL,
             {S: reps(4, 8, reps_max=10), H: reps(3, 10, reps_max=12), T: reps(3, 8, tempo=tempo(3, 0, 1, 0))},
             shoulder=2),
    Exercise("barbell_incline_press", "Supino inclinado com barra", Pattern.PUSH_HORIZONTAL, Implement.BARBELL,
             {S: reps(4, 6, reps_max=8)}, shoulder=2),
    Exercise("dips", "Paralelas (mergulho)", Pattern.PUSH_HORIZONTAL, Implement.BODYWEIGHT,
             {S: reps(4, 6, reps_max=8, cues=("lastro no cinto quando passar de 12 repetições",)),
              H: reps(3, 10, reps_max=12)}, shoulder=2),
    Exercise("pec_deck_fly", "Voador (peck deck)", Pattern.CHEST_FLY, Implement.PEC_DECK,
             {H: reps(3, 12, reps_max=15)}, shoulder=1),
    Exercise("cable_crossover", "Crossover na polia alta", Pattern.CHEST_FLY, Implement.CABLE,
             {H: reps(3, 12, reps_max=15, cues=("mãos se encontram na altura do quadril",))}, shoulder=1),
    Exercise("low_cable_fly", "Crucifixo na polia baixa", Pattern.CHEST_FLY, Implement.CABLE,
             {H: reps(3, 12, reps_max=15, cues=("mãos sobem até a altura do queixo: peitoral superior",))}),
    Exercise("db_fly", "Crucifixo com halteres", Pattern.CHEST_FLY, Implement.DUMBBELL,
             {H: reps(3, 10, reps_max=12)}, shoulder=1),
    # Back
    Exercise("supinated_pulldown", "Puxada supinada", Pattern.PULL_VERTICAL, Implement.LAT_PULLDOWN,
             {S: reps(4, 8, reps_max=10), H: reps(3, 10, reps_max=12)}, shoulder=1),
    Exercise("chin_up", "Barra fixa supinada", Pattern.PULL_VERTICAL, Implement.BODYWEIGHT,
             {S: reps(4, 6, reps_max=8, cues=("lastro no cinto quando passar de 10 repetições",)),
              H: reps(3, 8, reps_max=10)}, shoulder=2, armor="weighted_pull"),
    Exercise("straight_arm_pulldown", "Pulldown com braços estendidos", Pattern.PULL_VERTICAL, Implement.CABLE,
             {H: reps(3, 12, reps_max=15)}, shoulder=1),
    Exercise("seated_cable_row", "Remada baixa com triângulo", Pattern.PULL_HORIZONTAL, Implement.ROW_MACHINE,
             {S: reps(4, 8, reps_max=10), H: reps(3, 10, reps_max=12), T: reps(3, 8, tempo=tempo(2, 1, 1, 1))},
             lumbar=1, shoulder=1),
    Exercise("smith_row", "Remada curvada no smith", Pattern.PULL_HORIZONTAL, Implement.SMITH,
             {S: reps(4, 8, reps_max=10)}, lumbar=2, shoulder=1),
    # Shoulders / traps / neck
    Exercise("shoulder_press_machine", "Desenvolvimento na máquina", Pattern.PUSH_VERTICAL, Implement.SHOULDER_PRESS,
             {S: reps(4, 6, reps_max=8), H: reps(3, 10, reps_max=12)}, shoulder=1),
    Exercise("smith_shoulder_press", "Desenvolvimento no smith", Pattern.PUSH_VERTICAL, Implement.SMITH,
             {S: reps(4, 6, reps_max=8), H: reps(3, 10, reps_max=12)}, shoulder=2),
    Exercise("barbell_overhead_press", "Desenvolvimento em pé com barra", Pattern.PUSH_VERTICAL, Implement.BARBELL,
             {S: reps(4, 5, reps_max=6)}, lumbar=1, shoulder=2),
    Exercise("reverse_pec_deck", "Crucifixo inverso na máquina", Pattern.REAR_DELT, Implement.PEC_DECK,
             {H: reps(3, 12, reps_max=15)}),
    Exercise("cable_rear_delt_fly", "Crucifixo inverso na polia", Pattern.REAR_DELT, Implement.CABLE,
             {H: reps(3, 12, reps_max=15)}),
    Exercise("db_rear_delt_fly", "Crucifixo inverso com halteres", Pattern.REAR_DELT, Implement.DUMBBELL,
             {H: reps(3, 12, reps_max=15)}, lumbar=1),
    Exercise("smith_shrug", "Encolhimento no smith", Pattern.TRAPS, Implement.SMITH,
             {H: reps(4, 10, reps_max=12, intensity="pesado")}),
    Exercise("barbell_shrug", "Encolhimento com barra", Pattern.TRAPS, Implement.BARBELL,
             {H: reps(4, 10, reps_max=12, intensity="pesado")}, lumbar=1),
    Exercise("plate_neck_extension", "Extensão de pescoço com anilha", Pattern.NECK, Implement.BARBELL,
             {H: reps(3, 15, reps_max=20, cues=("deitado de bruços no banco, anilha na nuca",))}),
    Exercise("manual_neck_iso", "Isometria de pescoço com a mão (4 direções)", Pattern.NECK, Implement.BODYWEIGHT,
             {I: hold(4, 15, cues=("frente", "trás", "esquerda", "direita"))}, stand_in=True),
    # Arms
    Exercise("barbell_curl", "Rosca direta com barra", Pattern.ARMS, Implement.BARBELL,
             {H: reps(3, 8, reps_max=10)}),
    Exercise("cable_curl", "Rosca na polia", Pattern.ARMS, Implement.CABLE, {H: reps(3, 10, reps_max=12)}),
    Exercise("incline_db_curl", "Rosca inclinada com halteres", Pattern.ARMS, Implement.DUMBBELL,
             {H: reps(3, 10, reps_max=12)}),
    Exercise("overhead_cable_extension", "Tríceps francês na polia (corda)", Pattern.ARMS, Implement.CABLE,
             {H: reps(3, 10, reps_max=12)}, shoulder=1),
    Exercise("db_overhead_extension", "Tríceps francês com halter", Pattern.ARMS, Implement.DUMBBELL,
             {H: reps(3, 10, reps_max=12)}, shoulder=1),
    Exercise("close_grip_smith_press", "Supino fechado no smith", Pattern.ARMS, Implement.SMITH,
             {H: reps(3, 8, reps_max=10)}, shoulder=1),
    Exercise("bench_dip", "Mergulho no banco", Pattern.ARMS, Implement.BODYWEIGHT,
             {H: reps(3, 12, reps_max=15)}, shoulder=2, stand_in=True),
    # Core
    Exercise("cable_crunch", "Abdominal na polia (ajoelhado)", Pattern.CORE_FLEXION, Implement.CABLE,
             {H: reps(3, 12, reps_max=15), S: reps(3, 10)}, lumbar=1),
    Exercise("hanging_leg_raise", "Elevação de pernas na barra", Pattern.CORE_FLEXION, Implement.BODYWEIGHT,
             {S: reps(3, 8, reps_max=12), H: reps(3, 10, reps_max=12)}, shoulder=1),
    Exercise("cable_woodchop", "Lenhador na polia", Pattern.CORE_ANTI_ROTATION, Implement.CABLE,
             {S: per_side(3, 10), H: per_side(3, 12)}, unilateral=True, lumbar=1),
    Exercise("plank", "Prancha", Pattern.CORE_ANTI_ROTATION, Implement.BODYWEIGHT,
             {I: hold(3, 45, cues=("glúteo e abdômen contraídos",))}),
    Exercise("dead_bug", "Dead bug", Pattern.CORE_ANTI_ROTATION, Implement.BODYWEIGHT,
             {S: per_side(3, 8, cues=("lombar colada no chão",))}),
    # Cardio
    Exercise("incline_treadmill_walk", "Caminhada inclinada na esteira", Pattern.CARDIO, Implement.ERGOMETER,
             {P: timed(1, 600, intensity="inclinação 8–12%, 60–70% da FC máx. (frequência cardíaca máxima)"),
              C: timed(1, 1200, intensity="inclinação 8–12%, zona 2: 60–70% da FC máx. (frequência cardíaca máxima)")}),
    # --- Athletic architectures (Norton Jr. functional bodybuilding, conjugate, Gotham armor); tagged V2 so the
    # template tiers keep their rotation (splits.py names its options and ignores tags) ---
    Exercise("db_suitcase_carry", "Caminhada unilateral com halter", Pattern.CARRY, Implement.DUMBBELL,
             {S: distance(4, 30, cues=("por lado",))}, unilateral=True, lumbar=2, armor="carry", tags=V2),
    Exercise("pro_agility", "Pro-agility 5-10-5", Pattern.SPRINT, Implement.BODYWEIGHT,
             {E: per_side(4, 1, cues=("centro de gravidade baixo na troca de direção, sem derrapar",))}, tags=V2),
    Exercise("lateral_shuffle", "Deslocamento lateral rápido", Pattern.SPRINT, Implement.BODYWEIGHT,
             {E: timed(4, 8, intensity="ritmo máximo")}, stand_in=True, tags=V2),
    Exercise("conventional_deadlift", "Levantamento terra convencional", Pattern.HINGE, Implement.BARBELL,
             {S: reps(5, 3, reps_max=5)}, lumbar=3, shoulder=1, tags=V2),
    Exercise("box_squat", "Agachamento no caixote (box squat)", Pattern.SQUAT, Implement.BARBELL,
             {S: reps(4, 3, reps_max=5, cues=("senta no caixote sem relaxar o tronco",))}, lumbar=2, shoulder=1, tags=V2),
    Exercise("good_morning", "Good morning com barra", Pattern.HINGE, Implement.BARBELL,
             {S: reps(3, 8, reps_max=10)}, lumbar=2, tags=V2),
    Exercise("back_extension", "Extensão lombar com carga", Pattern.HINGE, Implement.BODYWEIGHT,
             {S: reps(3, 8, reps_max=10, cues=("anilha no peito",)), H: reps(3, 12, reps_max=15)}, lumbar=1, tags=V2),
    Exercise("pendlay_row", "Remada Pendlay", Pattern.PULL_HORIZONTAL, Implement.BARBELL,
             {S: reps(4, 6, cues=("barra volta ao chão a cada repetição",))}, lumbar=2, shoulder=1, tags=V2),
    Exercise("barbell_floor_press", "Supino no chão com barra", Pattern.PUSH_HORIZONTAL, Implement.BARBELL,
             {S: reps(4, 3, reps_max=5)}, shoulder=1, tags=V2),
    Exercise("single_leg_curl", "Mesa flexora unilateral", Pattern.KNEE_FLEXION, Implement.LEG_CURL,
             {H: per_side(4, 6, reps_max=8, tempo=tempo(4, 0, 1, 0))}, unilateral=True, tags=V2),
    Exercise("rotational_med_ball_throw", "Arremesso rotacional de medicine ball na parede",
             Pattern.CORE_ANTI_ROTATION, Implement.MEDICINE_BALL, {E: per_side(4, 4)}, unilateral=True, tags=V2),
    Exercise("alt_db_curl", "Rosca alternada com halteres", Pattern.ARMS, Implement.DUMBBELL,
             {H: reps(4, 6, reps_max=8)}, tags=V2),
    Exercise("reverse_curl", "Rosca inversa com barra", Pattern.ARMS, Implement.BARBELL,
             {H: reps(3, 10, reps_max=12)}, tags=V2),

    # --- Sprints ---
    Exercise("airdyne_sprint", "Tiro na bike", Pattern.SPRINT, Implement.ERGOMETER,
             {C: timed(1, 20, intensity="100% da potência máxima (watts)"), E: timed(1, 15, intensity="100% da potência máxima (watts)")}),
    Exercise("mountain_climber_sprint", "Escalador (ritmo máximo)", Pattern.SPRINT, Implement.BODYWEIGHT,
             {C: timed(1, 20, intensity="ritmo máximo"), E: timed(1, 15, intensity="ritmo máximo")}, stand_in=True),
]

EXERCISES: dict[str, Exercise] = {e.id: e for e in _EXERCISES}

if len(EXERCISES) != len(_EXERCISES):  # pragma: no cover - guards against copy/paste ids
    raise RuntimeError("duplicate exercise id in catalog")


def by_pattern(pattern: Pattern) -> list[Exercise]:
    return [e for e in _EXERCISES if e.pattern == pattern]
