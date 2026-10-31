"""Machine-first splits: Full Body 3x, Upper/Lower 4x, Push/Pull/Legs 6x and Batfleck 5x, plus three
athletic architectures: Norton Jr.'s functional bodybuilding, a conjugate (Westside-style) block and
"Gotham armor" (V-taper volume with two athletic windows).

Built for the gym most people actually have: mostly machines and cables, a smith,
some dumbbells and a barbell. Each day is written out slot by slot. A slot lists
its options in order of preference and takes the first one the athlete's
equipment profile has; `fallbacks` only come in when none of the options is there
(a missing leg curl becomes a nordic curl or a stiff, never a hole in the day).

Main lifts are fixed, so the load can progress week after week. Accessory slots
marked `rotate` move to the next available option every cycle, starting at a
different point on each day, so two days sharing a pool do not show the same
exercise. Selection depends only on (day, slot, cycle, equipment): no seed, no
chain to walk, and the server and an offline device always agree.

Blocks: warm-up checklist (mandatory: light cardio + mobility), then power
(jumps, throws, sprints) on the days that have it, main lifts, accessories and,
on some days, a conditioning finisher. Power always comes right after the
warm-up: speed needs a fresh nervous system, so it never follows fatiguing
work, it gets 90-180 s between efforts, and no effort is prescribed (every rep
is maximal; stop the set when the speed drops). Days with sprints or agility
sit at least 48 h from heavy squats and deadlifts (a test checks every cycle).

Readiness and deload:
- amber: target effort -1;
- red: strength sets x0.6 and effort -1, no finisher, a longer warm-up with one
  more mobility drill;
- deload (every 6th cycle, or 3 low-readiness days in a row): sets x0.6 and
  effort -2, no finisher.
"""

from __future__ import annotations

import math
import zlib
from collections.abc import Sequence
from dataclasses import dataclass, replace

from .catalog import EXERCISES, RxTemplate, distance, per_side, reps, tempo, timed
from .chaos import Equipment, available, candidates
from .domain import (
    Block,
    BlockKind,
    ExecutionStyle,
    Implement,
    Modality,
    Mode,
    Pattern,
    Prescription,
    ReadinessSummary,
    Session,
    Tier,
    WarmupSet,
)
from .progression import warmup_ramp
from .records import SetRecord
from .strength import e1rm_history
from .tiers import DELOAD_RPE_DELTA, DELOAD_SET_MULTIPLIER, REST_DAY, SPLIT_REST_CAP_SECONDS, TierConfig

S, H, C, P, E = (Modality.STRENGTH, Modality.HYPERTROPHY, Modality.CONDITIONING, Modality.PREP,
                 Modality.EXPLOSIVE)

TOP_SET_RPE = 8.5
BACKOFF_RPE = 7.5
BACKOFF_SHARE = 0.8
ROLE_RPE = {"top": TOP_SET_RPE, "backoff": BACKOFF_RPE}
RED_SET_MULTIPLIER = 0.6
WARMUP_SETS_CUE = "antes: 2 séries de aproximação (~50% e ~75% da carga)"
POWER_CUE = "esforço máximo em cada repetição; pare a série se a velocidade cair"
# RIR (reps in reserve) as the app's effort scale: RPE = 10 - RIR.
RIR0_1, RIR1, RIR1_2, RIR2 = 9.5, 9.0, 8.5, 8.0


@dataclass(frozen=True)
class Slot:
    options: tuple[str, ...]
    rx: RxTemplate
    rest: int
    modality: Modality = S
    rotate: bool = False
    fallbacks: tuple[str, ...] = ()
    role: str | None = None  # "top" / "backoff": one exercise, two prescriptions
    rpe: float | None = None  # target effort; None: the modality's default (top / back-off have their own)
    exact: bool = False  # the slot's prescription even when the exercise's catalog entry is done another way


@dataclass(frozen=True)
class SplitDay:
    id: str
    name: str
    focus: str  # "upper" | "lower" | "full": picks the warm-up drills
    main: tuple[Slot, ...]
    accessories: tuple[Slot, ...]
    finisher: tuple[Slot, ...] = ()
    power: tuple[Slot, ...] = ()

    @property
    def slots(self) -> tuple[Slot, ...]:
        return self.power + self.main + self.accessories + self.finisher


def main(options: tuple[str, ...], rx: RxTemplate, rest: int = 150, role: str | None = None,
         fallbacks: tuple[str, ...] = (), rpe: float | None = None, exact: bool = False,
         rotate: bool = False, modality: Modality = S) -> Slot:
    return Slot(options, rx, rest, modality, rotate, fallbacks, role, rpe, exact)


def acc(options: tuple[str, ...], rx: RxTemplate, rest: int = 60, rotate: bool = True,
        fallbacks: tuple[str, ...] = (), rpe: float | None = None, exact: bool = False) -> Slot:
    return Slot(options, rx, rest, H, rotate, fallbacks, None, rpe, exact)


def power(options: tuple[str, ...], rx: RxTemplate, rest: int = 120, fallbacks: tuple[str, ...] = ()) -> Slot:
    """Jumps, throws, sprints: right after the warm-up, full rest, no effort target."""
    return Slot(options, replace(rx, cues=(*rx.cues, POWER_CUE)), rest, E, False, fallbacks, exact=True)


@dataclass(frozen=True)
class Group:
    name: str
    kind: BlockKind
    slots: tuple[Slot, ...]
    scaled: bool  # follows readiness and deload (sets and effort)
    no_rpe: bool = False
    optional: bool = False  # dropped on red readiness and deload days


def groups(day: SplitDay) -> list[Group]:
    """The day's blocks after the warm-up, in order; block numbers start at 2."""
    out = [Group("Potência", BlockKind.STRENGTH, day.power, scaled=True, no_rpe=True),
           Group("Principal", BlockKind.STRENGTH, day.main, scaled=True),
           Group("Acessórios", BlockKind.STRENGTH, day.accessories, scaled=True),
           Group("Finalizador", BlockKind.CONDITIONING, day.finisher, scaled=False, optional=True)]
    return [g for g in out if g.slots]


SUPERSET = "supersérie: sem descanso até o próximo exercício"

# --- option pools, best first ------------------------------------------------------------------------------
# Legs
SQUAT = ("hack_squat", "smith_squat", "back_squat", "leg_press", "goblet_squat", "air_squat")
SQUAT_SMITH = ("smith_squat", "hack_squat", "back_squat", "leg_press", "goblet_squat", "air_squat")
LEG_PRESS = ("leg_press", "hack_squat", "smith_squat", "goblet_squat", "air_squat")
HINGE = ("barbell_rdl", "smith_rdl", "db_romanian_deadlift", "single_leg_rdl", "cable_pull_through",
         "single_leg_hip_thrust")
HIP_THRUST = ("smith_hip_thrust", "barbell_hip_thrust", "cable_pull_through", "single_leg_hip_thrust")
SPLIT_SQUAT = ("smith_split_squat", "rfe_split_squat", "db_walking_lunge", "leg_press_single", "db_reverse_lunge",
               "lateral_squat")
LEG_EXT = ("leg_extension", "single_leg_extension")
LEG_EXT_FB = ("rfe_split_squat", "goblet_squat", "air_squat")
LEG_CURL = ("lying_leg_curl", "seated_leg_curl")
LEG_CURL_FB = ("nordic_curl", "single_leg_rdl", "db_romanian_deadlift")
CALVES = ("standing_calf_raise", "seated_calf_raise", "leg_press_calf_raise", "smith_calf_raise")
CALVES_FB = ("single_leg_calf_raise",)
# Chest
CHEST_PRESS = ("chest_press_machine", "smith_bench_press", "barbell_bench_press", "db_bench_press", "push_up")
BENCH = ("barbell_bench_press", "smith_bench_press", "chest_press_machine", "db_bench_press", "push_up")
INCLINE = ("incline_db_press", "smith_incline_press", "barbell_incline_press", "chest_press_machine",
           "decline_push_up")
INCLINE_SMITH = ("smith_incline_press", "incline_db_press", "barbell_incline_press", "chest_press_machine",
                 "decline_push_up")
DIPS = ("dips", "chest_press_machine", "db_bench_press", "push_up")
FLY = ("pec_deck_fly", "cable_crossover", "low_cable_fly", "db_fly")
FLY_FB = ("push_up",)
# Back
PULLDOWN = ("wide_grip_lat_pulldown", "supinated_pulldown", "strict_pull_up", "single_arm_cable_pulldown",
            "inverted_row")
PULLDOWN_V = ("v_grip_lat_pulldown", "supinated_pulldown", "wide_grip_lat_pulldown", "chin_up")
PULL_UP = ("strict_pull_up", "chin_up", "wide_grip_lat_pulldown")
ROW_HEAVY = ("barbell_bent_over_row", "smith_row", "seated_machine_row", "single_arm_db_row", "inverted_row")
ROW_MACHINE = ("seated_machine_row", "seated_cable_row", "chest_supported_db_row", "single_arm_db_row",
               "inverted_row")
ROW_CABLE = ("seated_cable_row", "seated_machine_row", "half_kneeling_cable_row", "chest_supported_db_row",
             "inverted_row")
ROW_UNI = ("single_arm_db_row", "half_kneeling_cable_row", "seated_cable_row", "inverted_row")
STRAIGHT_ARM = ("straight_arm_pulldown",)
STRAIGHT_ARM_FB = ("single_arm_cable_pulldown", "scapular_pull_up")
# Shoulders, traps, neck
OHP = ("smith_shoulder_press", "shoulder_press_machine", "seated_db_shoulder_press", "barbell_overhead_press",
       "pike_push_up")
LATERAL = ("db_lateral_raise", "cable_lateral_raise")
REAR = ("reverse_pec_deck", "cable_rear_delt_fly", "db_rear_delt_fly")
REAR_FB = ("prone_ytw_raise",)
FACE_PULL = ("face_pull", "cable_rear_delt_fly", "db_rear_delt_fly", "prone_ytw_raise")
SHRUG = ("smith_shrug", "barbell_shrug", "db_shrug")
SHRUG_FB = ("scapular_pull_up",)
NECK_CURL = ("plate_neck_curl", "manual_neck_iso")
NECK_EXT = ("plate_neck_extension", "manual_neck_iso")
# Arms
BICEPS = ("barbell_curl", "cable_curl", "incline_db_curl", "db_hammer_curl")
BICEPS_FB = ("chin_up",)
HAMMER = ("db_hammer_curl", "cable_curl", "barbell_curl")
TRICEPS = ("cable_triceps_pressdown", "overhead_cable_extension", "cable_skullcrusher", "db_skullcrusher",
           "db_overhead_extension")
TRICEPS_FB = ("diamond_push_up", "bench_dip")
PRESSDOWN = ("cable_triceps_pressdown", "cable_skullcrusher")
OVERHEAD_EXT = ("overhead_cable_extension", "db_overhead_extension")
CLOSE_GRIP = ("close_grip_smith_press", "dips", "db_skullcrusher", "diamond_push_up")
# Core
ABS = ("cable_crunch", "hanging_leg_raise", "ab_wheel_rollout", "reverse_crunch")
ANTI_ROT = ("pallof_press", "cable_woodchop", "plank", "dead_bug", "side_plank")
# Conditioning
BIKE_SPRINT = ("airdyne_sprint", "mountain_climber_sprint")
ZONE2 = ("incline_treadmill_walk", "elliptical", "airdyne_easy", "brisk_walk")

# Athletic architectures
FRONT_SQUAT = ("front_squat", "smith_squat", "hack_squat", "goblet_squat")
HINGE_BB = ("barbell_rdl", "smith_rdl", "db_romanian_deadlift")
DEADLIFT = ("trap_bar_deadlift", "conventional_deadlift")
SUITCASE = ("db_suitcase_carry", "suitcase_carry")
FARMER = ("db_farmers_walk", "trap_bar_carry")
PULLUP_W = ("strict_pull_up", "chin_up", "wide_grip_lat_pulldown")
KROC = ("single_arm_db_row", "half_kneeling_cable_row", "seated_cable_row")
SHRUG_BB = ("barbell_shrug", "smith_shrug", "db_shrug")
LAT_CABLE = ("cable_lateral_raise", "db_lateral_raise")
OHP_HEAVY = ("barbell_overhead_press", "smith_shoulder_press", "seated_db_shoulder_press", "shoulder_press_machine")
ME_UPPER = ("barbell_bench_press", "barbell_floor_press")
ME_UPPER_FB = ("smith_bench_press", "chest_press_machine", "db_bench_press")
ME_LOWER = ("conventional_deadlift", "box_squat")
ME_LOWER_FB = ("trap_bar_deadlift", "smith_squat", "hack_squat")
PENDLAY = ("pendlay_row", "barbell_bent_over_row", "smith_row", "seated_machine_row")
HAM_ECC = ("nordic_curl", "single_leg_curl", "lying_leg_curl")
POSTERIOR = ("good_morning", "back_extension")
BULGARIAN = ("rfe_split_squat", "smith_split_squat", "leg_press_single")
NEUTRAL_PULL = ("v_grip_lat_pulldown", "neutral_grip_pull_up", "supinated_pulldown")
TRI_HEAVY = ("close_grip_smith_press", "overhead_cable_extension", "db_skullcrusher")
FOREARM = ("reverse_curl", "db_hammer_curl")
ANTI_ROT_HOLD = RxTemplate(Mode.HOLD, sets=4, hold_seconds=10, reps_per_side=1,
                           cues=("com passo lateral: afaste-se da polia e segure",))
SPRINT_15 = distance(6, 15, intensity="aceleração máxima")

WARMUP_CARDIO = ("elliptical", "airdyne_easy", "incline_treadmill_walk", "brisk_walk")
WARMUP_DRILLS = {
    "upper": ("t_spine_rotation", "plank_arm_extension_prep", "inchworm"),
    "lower": ("hip_90_90", "worlds_greatest_stretch", "spiderman_lunge_stretch"),
    "full": ("worlds_greatest_stretch", "t_spine_rotation", "hip_90_90"),
}
WARMUP_CARDIO_SECONDS = 300


def _r(sets: int, n: int, top: int | None = None, **kw) -> RxTemplate:
    return reps(sets, n, reps_max=top, **kw)


def _side(sets: int, n: int, top: int | None = None, **kw) -> RxTemplate:
    return per_side(sets, n, reps_max=top, **kw)


WALK = (main(ZONE2, timed(1, 900, intensity="zona 2: 60–70% da FC máx. (frequência cardíaca máxima)"), rest=0),)

DAYS: dict[str, SplitDay] = {
    d.id: d
    for d in [
        # --- Full Body 3x ---
        SplitDay(
            "FB1", "Corpo inteiro A", "full",
            main=(
                main(SQUAT, _r(3, 6, 8)),
                main(CHEST_PRESS, _r(3, 6, 8), rest=120),
                main(PULLDOWN, _r(3, 8, 10), rest=120),
            ),
            accessories=(
                acc(LEG_CURL, _r(3, 10, 12), rest=75, fallbacks=LEG_CURL_FB),
                acc(LATERAL, _r(3, 12, 15), fallbacks=REAR_FB),
                acc(ABS, _r(3, 12)),
            ),
        ),
        SplitDay(
            "FB2", "Corpo inteiro B", "full",
            main=(
                main(HINGE, _r(3, 8)),
                main(LEG_PRESS, _r(3, 10, 12), rest=120),
                main(INCLINE, _r(3, 8, 10), rest=120),
                main(ROW_MACHINE, _r(3, 8, 10), rest=120),
            ),
            accessories=(
                acc(BICEPS, _r(2, 10, 12), fallbacks=BICEPS_FB),
                acc(TRICEPS, _r(2, 10, 12), fallbacks=TRICEPS_FB),
                acc(CALVES, _r(3, 12, 15), fallbacks=CALVES_FB),
            ),
        ),
        SplitDay(
            "FB3", "Corpo inteiro C", "full",
            main=(
                main(SQUAT_SMITH, _r(3, 8, 10)),
                main(PULL_UP, _r(3, 6, 8)),
                main(OHP, _r(3, 8, 10), rest=120),
                main(HIP_THRUST, _r(3, 8, 10), rest=120),
            ),
            accessories=(
                acc(LEG_EXT, _r(2, 12, 15), fallbacks=LEG_EXT_FB),
                acc(REAR, _r(3, 12, 15), fallbacks=REAR_FB),
                acc(ANTI_ROT, _side(3, 10)),
            ),
        ),
        # --- Upper / Lower 4x ---
        SplitDay(
            "UL1", "Superior: força", "upper",
            main=(
                main(BENCH, _r(1, 5), rest=180, role="top"),
                main(BENCH, _r(3, 8), rest=180, role="backoff"),
                main(ROW_HEAVY, _r(4, 6, 8)),
                main(OHP, _r(3, 6, 8), rest=120),
                main(PULLDOWN, _r(3, 8, 10), rest=120),
            ),
            accessories=(
                acc(BICEPS, _r(3, 10, 12, cues=(SUPERSET,)), rest=0, fallbacks=BICEPS_FB),
                acc(TRICEPS, _r(3, 10, 12), rest=75, fallbacks=TRICEPS_FB),
            ),
        ),
        SplitDay(
            "UL2", "Inferior: força", "lower",
            main=(
                main(SQUAT, _r(1, 6), rest=180, role="top"),
                main(SQUAT, _r(3, 8), rest=180, role="backoff"),
                main(HINGE, _r(3, 6, 8)),
                main(LEG_PRESS, _r(3, 10, 12), rest=120),
            ),
            accessories=(
                acc(LEG_CURL, _r(3, 8, 10), rest=75, fallbacks=LEG_CURL_FB),
                acc(CALVES, _r(4, 8, 12), fallbacks=CALVES_FB),
                acc(ABS, _r(3, 10, 12)),
            ),
        ),
        SplitDay(
            "UL3", "Superior: hipertrofia", "upper",
            main=(
                main(INCLINE, _r(3, 8, 10), rest=120),
                main(PULLDOWN_V, _r(3, 10, 12), rest=90),
                main(CHEST_PRESS, _r(3, 10, 12), rest=90),
                main(ROW_MACHINE, _r(3, 10, 12), rest=90),
            ),
            accessories=(
                acc(FLY, _r(3, 12, 15), fallbacks=FLY_FB),
                acc(LATERAL, _r(4, 12, 15), fallbacks=REAR_FB),
                acc(BICEPS, _r(2, 12, cues=(SUPERSET,)), rest=0, fallbacks=BICEPS_FB),
                acc(TRICEPS, _r(2, 12), rest=60, fallbacks=TRICEPS_FB),
            ),
        ),
        SplitDay(
            "UL4", "Inferior: hipertrofia", "lower",
            main=(
                main(LEG_PRESS, _r(4, 10, 12), rest=120),
                main(SPLIT_SQUAT, _side(3, 8, 10), rest=90),
                main(HIP_THRUST, _r(3, 10, 12), rest=90),
            ),
            accessories=(
                acc(LEG_EXT, _r(3, 12, 15), fallbacks=LEG_EXT_FB),
                acc(LEG_CURL, _r(3, 12, 15), fallbacks=LEG_CURL_FB),
                acc(("hip_abduction", "cable_kickback"), _r(3, 15, 20), rest=45, fallbacks=("lateral_squat",)),
                acc(CALVES, _r(3, 15, 20), rest=45, fallbacks=CALVES_FB),
            ),
        ),
        # --- Push / Pull / Legs 6x ---
        SplitDay(
            "PPL1", "Empurrar A", "upper",
            main=(
                main(BENCH, _r(4, 6, 8)),
                main(OHP, _r(3, 8, 10), rest=120),
                main(INCLINE, _r(3, 10, 12), rest=90),
            ),
            accessories=(
                acc(FLY, _r(3, 12, 15), fallbacks=FLY_FB),
                acc(LATERAL, _r(3, 12, 15), fallbacks=REAR_FB),
                acc(TRICEPS, _r(3, 10, 12), fallbacks=TRICEPS_FB),
            ),
        ),
        SplitDay(
            "PPL2", "Puxar A", "upper",
            main=(
                main(PULL_UP, _r(4, 6, 8)),
                main(ROW_HEAVY, _r(3, 8, 10), rest=120),
                main(ROW_MACHINE, _r(3, 10, 12), rest=90),
            ),
            accessories=(
                acc(STRAIGHT_ARM, _r(2, 12, 15), rotate=False, fallbacks=STRAIGHT_ARM_FB),
                acc(REAR, _r(3, 15), fallbacks=REAR_FB),
                acc(BICEPS, _r(3, 8, 10), fallbacks=BICEPS_FB),
                acc(HAMMER, _r(2, 12), rotate=False),
            ),
        ),
        SplitDay(
            "PPL3", "Pernas A", "lower",
            main=(
                main(SQUAT, _r(4, 6, 8)),
                main(HINGE, _r(3, 8, 10), rest=120),
                main(LEG_PRESS, _r(3, 12), rest=120),
            ),
            accessories=(
                acc(LEG_CURL, _r(3, 10, 12), fallbacks=LEG_CURL_FB),
                acc(CALVES, _r(4, 10, 12), fallbacks=CALVES_FB),
                acc(ABS, _r(3, 12)),
            ),
        ),
        SplitDay(
            "PPL4", "Empurrar B", "upper",
            main=(
                main(CHEST_PRESS, _r(4, 8, 10), rest=120),
                main(INCLINE_SMITH, _r(3, 8, 10), rest=120),
                main(DIPS, _r(3, 8, 12), rest=90),
            ),
            accessories=(
                acc(FLY, _r(3, 12, 15), fallbacks=FLY_FB),
                acc(LATERAL, _r(4, 12, 15), fallbacks=REAR_FB),
                acc(OVERHEAD_EXT, _r(3, 12), fallbacks=TRICEPS_FB),
            ),
        ),
        SplitDay(
            "PPL5", "Puxar B", "upper",
            main=(
                main(PULLDOWN, _r(4, 8, 10), rest=120),
                main(ROW_UNI, _side(3, 10), rest=90),
                main(ROW_CABLE, _r(3, 10, 12), rest=90),
            ),
            accessories=(
                acc(SHRUG, _r(4, 12, 15), fallbacks=SHRUG_FB),
                acc(FACE_PULL, _r(3, 15), rotate=False),
                acc(BICEPS, _r(3, 12), fallbacks=BICEPS_FB),
            ),
        ),
        SplitDay(
            "PPL6", "Pernas B", "lower",
            main=(
                main(SQUAT_SMITH, _r(4, 8, 10)),
                main(HIP_THRUST, _r(3, 10), rest=120),
                main(SPLIT_SQUAT, _side(3, 10), rest=90),
            ),
            accessories=(
                acc(LEG_EXT, _r(3, 15), fallbacks=LEG_EXT_FB),
                acc(LEG_CURL, _r(3, 12, 15), fallbacks=LEG_CURL_FB),
                acc(("hip_abduction",), _r(2, 15, 20), rest=45, rotate=False, fallbacks=("cable_kickback",)),
                acc(("hip_adduction",), _r(2, 12, 15), rest=45, rotate=False, fallbacks=("lateral_squat",)),
                acc(CALVES, _r(4, 15), rest=45, fallbacks=CALVES_FB),
            ),
        ),
        # --- Batfleck 5x: the BvS mass phase ---
        SplitDay(
            "BF1", "Peito e tríceps", "upper",
            main=(
                main(BENCH, _r(1, 5), rest=180, role="top"),
                main(BENCH, _r(3, 8), rest=180, role="backoff"),
                main(INCLINE_SMITH, _r(3, 8, 10), rest=120),
                main(DIPS, _r(3, 6, 10), rest=120),
            ),
            accessories=(
                acc(FLY, _r(3, 12, 15), fallbacks=FLY_FB),
                acc(PRESSDOWN, _r(3, 10, 12, cues=(SUPERSET,)), rest=0, fallbacks=TRICEPS_FB),
                acc(OVERHEAD_EXT, _r(3, 10, 12), rest=75, fallbacks=TRICEPS_FB),
            ),
        ),
        SplitDay(
            "BF2", "Costas e bíceps", "upper",
            main=(
                main(PULL_UP, _r(4, 5, 8)),
                main(ROW_HEAVY, _r(4, 6, 8)),
                main(PULLDOWN_V, _r(3, 10, 12), rest=90),
                main(ROW_MACHINE, _r(3, 10, 12), rest=90),
            ),
            accessories=(
                acc(STRAIGHT_ARM, _r(2, 12, 15), rotate=False, fallbacks=STRAIGHT_ARM_FB),
                acc(BICEPS, _r(3, 8, 10), fallbacks=BICEPS_FB),
                acc(HAMMER, _r(3, 10, 12), rotate=False),
            ),
        ),
        SplitDay(
            "BF3", "Pernas", "lower",
            main=(
                main(SQUAT, _r(1, 6), rest=180, role="top"),
                main(SQUAT, _r(3, 10), rest=180, role="backoff"),
                main(HINGE, _r(3, 8)),
                main(LEG_PRESS, _r(3, 12, 15), rest=120),
            ),
            accessories=(
                acc(LEG_EXT, _r(3, 12, 15, cues=(SUPERSET,)), rest=0, fallbacks=LEG_EXT_FB),
                acc(LEG_CURL, _r(3, 12, 15), rest=75, fallbacks=LEG_CURL_FB),
                acc(CALVES, _r(4, 10, 15), fallbacks=CALVES_FB),
            ),
        ),
        SplitDay(
            "BF4", "Ombros, trapézio e pescoço", "upper",
            power=(power(BIKE_SPRINT, timed(6, 15, intensity="100% de esforço"), rest=120),),
            main=(
                main(OHP, _r(4, 6, 8)),
                main(SHRUG, _r(4, 10, 12, intensity="pesado"), rest=90, fallbacks=SHRUG_FB),
            ),
            accessories=(
                acc(LATERAL, _r(4, 12, 15), fallbacks=REAR_FB),
                acc(REAR, _r(3, 15), fallbacks=REAR_FB),
                acc(FACE_PULL, _r(3, 15), rotate=False),
                acc(NECK_CURL, _r(3, 15, 20), rest=45, rotate=False),
                acc(NECK_EXT, _r(3, 15, 20), rest=45, rotate=False),
            ),
        ),
        SplitDay(
            "BF5", "Braços e core", "upper",
            main=(
                main(CLOSE_GRIP, _r(3, 8, 10), rest=120),
                main(("barbell_curl", "cable_curl", "db_hammer_curl"), _r(3, 8, 10), rest=90),
            ),
            accessories=(
                acc(TRICEPS, _r(3, 12, cues=(SUPERSET,)), rest=0, fallbacks=TRICEPS_FB),
                acc(("cable_curl", "incline_db_curl", "db_hammer_curl"), _r(3, 12), rest=60),
                acc(ABS, _r(3, 12, 15)),
                acc(ANTI_ROT, _side(3, 10)),
            ),
            finisher=WALK,
        ),
        # --- Functional Bodybuilding (Walter Norton Jr.), 4x: Mon, Tue, Thu, Sat ---
        SplitDay(
            "N1", "Inferior: força, potência vertical e core", "lower",
            power=(power(("box_jump",), _r(4, 3), fallbacks=("jump_squat",)),),
            main=(
                main(FRONT_SQUAT, _r(1, 5), rest=180, role="top", rpe=RIR1),
                main(FRONT_SQUAT, _r(3, 6, 8, cues=("+2,5 kg quando as 3 séries fecharem 8 repetições limpas",)),
                     rest=180, role="backoff", rpe=RIR2),
                main(HINGE_BB, _r(3, 6, 8, tempo=tempo(3, 0, 1, 0),
                                  cues=("dupla progressão: chegue a 8 repetições antes de subir a carga",)),
                     rpe=RIR1_2),
                main(("db_reverse_lunge", "smith_split_squat", "leg_press_single"),
                     _side(3, 8, cues=("+2 kg por halter quando todas as séries saírem com a pelve estável",)),
                     rest=90, rpe=RIR2),
                main(SUITCASE, distance(4, 30, intensity="40–50% do peso corporal",
                                        cues=("30 m por lado", "tronco estritamente vertical")),
                     rest=90, exact=True, fallbacks=("db_farmers_walk",)),
            ),
            accessories=(),
        ),
        SplitDay(
            "N2", "Superior: densidade escapular, empurrar pesado e braços", "upper",
            power=(power(("med_ball_slam",), _r(4, 5), rest=90, fallbacks=("broad_jump",)),),
            main=(
                main(PULLUP_W, _r(5, 5, tempo=tempo(3, 0, 1, 0), cues=("lastro: +1,25 a 2,5 kg ao fechar 5×5",)),
                     rpe=RIR1_2),
                main(INCLINE, _r(4, 8, 10, tempo=tempo(3, 0, 1, 0),
                                 cues=("banco a 30°", "suba a carga quando as 4 séries fecharem 10")),
                     rest=120, rpe=RIR1),
                main(KROC, _side(4, 10, 12, cues=("pesado: puxe o cotovelo em direção ao quadril",)), rest=90,
                     rpe=RIR1),
            ),
            accessories=(
                acc(("alt_db_curl", "barbell_curl", "cable_curl"), _r(4, 6, 8, cues=(SUPERSET,)), rest=0,
                    rotate=False, rpe=RIR1),
                acc(("cable_triceps_pressdown", "overhead_cable_extension"),
                    _r(4, 10, cues=("corda", "drop set na última série")), rest=90, rotate=False,
                    fallbacks=TRICEPS_FB, rpe=RIR1),
            ),
        ),
        SplitDay(
            "N3", "Agilidade, pescoço e trapézio", "full",
            power=(power(("short_sprint", "airdyne_sprint"), SPRINT_15, fallbacks=("mountain_climber_sprint",)),
                   power(("pro_agility", "lateral_shuffle"), _side(4, 1))),
            main=(
                main(SHRUG_BB, _r(5, 6, 8, cues=("pausa de 2 s no topo", "+5 kg ao fechar 5×8 com a pausa")),
                     rest=90, rpe=RIR1, fallbacks=SHRUG_FB),
                main(NECK_CURL, _r(3, 15, 20, cues=("+1 kg por vez, sem impulso",)), rest=60, rpe=RIR2),
                main(NECK_EXT, _r(3, 15, 20), rest=60, rpe=RIR2),
                main(("pallof_press", "cable_woodchop"), ANTI_ROT_HOLD, rest=60, exact=True),
            ),
            accessories=(),
        ),
        SplitDay(
            "N4", "Corpo inteiro: força bruta e carregamentos", "full",
            main=(
                main(DEADLIFT, _r(1, 4, cues=("+2,5 a 5 kg por semana no bloco de acumulação",)), rest=180,
                     role="top", rpe=RIR1, fallbacks=("smith_rdl",)),
                main(DEADLIFT, _r(3, 5), rest=180, role="backoff"),
                main(("barbell_push_press", "smith_shoulder_press", "seated_db_shoulder_press"), _r(4, 5, 6),
                     rpe=RIR1_2),
                main(("dips", "chest_press_machine"), _r(3, 8, 10, cues=("lastro quando bater 10 nas 3 séries",)),
                     rest=120, rpe=RIR1),
            ),
            accessories=(
                acc(LAT_CABLE, _r(4, 12, 15, cues=("rest-pause na última série",
                                                   "+1 repetição por sessão antes de subir o pino")),
                    rest=75, rotate=False, rpe=RIR0_1),
                acc(REAR, _r(4, 12, 15, cues=("rest-pause na última série",)), rest=75, rotate=False, rpe=RIR0_1,
                    fallbacks=REAR_FB),
                acc(FARMER, distance(4, 40, intensity="mais de 80% do peso corporal no total"), rest=120,
                    rotate=False, exact=True),
            ),
        ),
        # --- Conjugate (Westside adapted), 4x: Mon, Tue, Thu, Sat ---
        SplitDay(
            "CJ1", "Esforço máximo superior", "upper",
            main=(
                main(ME_UPPER, _r(1, 3, cues=("esforço máximo: alterna supino e supino no chão a cada semana",)),
                     rest=180, role="top", rpe=RIR1, rotate=True, fallbacks=ME_UPPER_FB),
                main(ME_UPPER, _r(3, 5), rest=180, role="backoff"),
                main(PENDLAY, _r(4, 6), rpe=RIR1),
                main(("seated_db_shoulder_press", "smith_shoulder_press", "shoulder_press_machine"), _r(3, 8, 10),
                     rest=120, rpe=RIR1),
            ),
            accessories=(
                acc(TRI_HEAVY, _r(3, 8, 10), rest=90, rpe=RIR1, fallbacks=TRICEPS_FB),
                acc(FOREARM, _r(3, 10, 12), rotate=False, rpe=RIR1),
            ),
        ),
        SplitDay(
            "CJ2", "Esforço dinâmico inferior", "lower",
            power=(power(("broad_jump",), _r(5, 3)),),
            main=(
                main(("back_squat", "smith_squat"), _r(8, 2, cues=("65–70% do 1RM, intenção de velocidade máxima",)),
                     rest=60, modality=E),
                main(HAM_ECC, _r(4, 6, 8, tempo=tempo(4, 0, 1, 0)), rest=90, rpe=RIR2, fallbacks=LEG_CURL_FB),
                main(("sled_push",), distance(6, 20, intensity="pesado"), rest=120, exact=True,
                     fallbacks=("db_farmers_walk",)),
            ),
            accessories=(),
        ),
        SplitDay(
            "CJ3", "Esforço dinâmico e hipertrofia superior", "upper",
            power=(power(("rotational_med_ball_throw",), _side(4, 4), rest=90,
                         fallbacks=("landmine_rotation", "cable_woodchop")),),
            main=(
                main(("db_bench_press", "chest_press_machine"), _r(4, 8, 10, tempo=tempo(3, 0, 1, 0)), rest=120,
                     rpe=RIR1),
                main(NEUTRAL_PULL, _r(4, 10, 12, cues=("drop set na última série",)), rest=90, rpe=RIR1),
            ),
            accessories=(
                acc(LATERAL, _r(4, 10, 12, cues=(SUPERSET,)), rest=0, rotate=False, fallbacks=REAR_FB),
                acc(("smith_shrug", "barbell_shrug", "db_shrug"), _r(4, 10, 12), rest=75, rotate=False,
                    fallbacks=SHRUG_FB),
                acc(BICEPS, _r(3, 10, 12), fallbacks=BICEPS_FB),
                acc(FOREARM, _r(2, 12, 15), rotate=False),
            ),
        ),
        SplitDay(
            "CJ4", "Esforço máximo inferior", "lower",
            main=(
                main(ME_LOWER, _r(1, 3, 5, cues=("esforço máximo: alterna terra e box squat a cada semana",)),
                     rest=180, role="top", rpe=RIR1, rotate=True, fallbacks=ME_LOWER_FB),
                main(ME_LOWER, _r(2, 5), rest=180, role="backoff"),
                main(BULGARIAN, _side(3, 8), rest=90, rpe=RIR1),
                main(POSTERIOR, _r(3, 8, 10), rest=90, rpe=RIR2, rotate=True,
                     fallbacks=("cable_pull_through", "barbell_rdl")),
                main(("ab_wheel_rollout", "hanging_leg_raise", "cable_crunch"), _r(4, 10, 12), rest=60),
            ),
            accessories=(),
        ),
        # --- Gotham armor, 5x: Mon, Tue, (Wed mobility), Thu, Fri, Sat ---
        SplitDay(
            "G1", "Superior: força e potência de empurrar", "upper",
            power=(power(("med_ball_chest_pass",), _r(4, 4), fallbacks=("push_up",)),),
            main=(
                main(BENCH, _r(4, 4, 6), rest=180, rpe=RIR1_2),
                main(PULLUP_W, _r(4, 5, 6, cues=("lastro no cinto",)), rpe=RIR1_2),
                main(OHP_HEAVY, _r(3, 6, 8), rest=120, rpe=RIR1_2),
            ),
            accessories=(
                acc(LATERAL, _r(3, 12, 15), fallbacks=REAR_FB),
                acc(("face_pull", "cable_rear_delt_fly", "reverse_pec_deck"), _r(3, 15), rotate=False),
                acc(SHRUG, _r(4, 10, 12), fallbacks=SHRUG_FB),
            ),
        ),
        SplitDay(
            "G2", "Inferior completo e saltos verticais", "lower",
            power=(power(("box_jump",), _r(4, 3), fallbacks=("jump_squat",)),),
            main=(
                main(SQUAT, _r(4, 6, 8), rpe=RIR2),
                main(HINGE, _r(3, 8), rpe=RIR2),
                main(LEG_PRESS, _r(3, 10, 12), rest=120, rpe=RIR2),
            ),
            accessories=(
                acc(LEG_CURL, _r(2, 10, 12), fallbacks=LEG_CURL_FB),
                acc(CALVES, _r(3, 10, 15), fallbacks=CALVES_FB),
            ),
        ),
        SplitDay(
            "G3", "Ombros, trapézio e braços", "upper",
            main=(
                main(("seated_db_shoulder_press", "shoulder_press_machine", "smith_shoulder_press"), _r(3, 10, 12),
                     rest=120, rpe=RIR1),
            ),
            accessories=(
                acc(LATERAL, _r(4, 12, 15), fallbacks=REAR_FB),
                acc(REAR, _r(4, 15), fallbacks=REAR_FB),
                acc(SHRUG, _r(4, 10, 12, intensity="pesado"), fallbacks=SHRUG_FB),
                acc(NECK_CURL, _r(2, 15, 20), rest=45, rotate=False),
                acc(NECK_EXT, _r(2, 15, 20), rest=45, rotate=False),
                acc(BICEPS, _r(3, 10, 12, cues=(SUPERSET,)), rest=0, fallbacks=BICEPS_FB),
                acc(TRICEPS, _r(3, 10, 12), rest=75, fallbacks=TRICEPS_FB),
            ),
        ),
        SplitDay(
            "G4", "Sessão atlética: sprints, agilidade, carregamentos e core", "full",
            power=(power(("short_sprint", "airdyne_sprint"), SPRINT_15, fallbacks=("mountain_climber_sprint",)),
                   power(("pro_agility", "lateral_shuffle"), _side(4, 1))),
            main=(
                main(FARMER, distance(4, 40, intensity="pesado"), rest=120, exact=True),
                main(SUITCASE, distance(3, 30, cues=("30 m por lado", "tronco estritamente vertical")), rest=90,
                     exact=True, fallbacks=("db_farmers_walk",)),
            ),
            accessories=(
                acc(("pallof_press", "cable_woodchop"), replace(ANTI_ROT_HOLD, sets=3), rotate=False, exact=True),
                acc(("dead_bug", "side_plank", "plank"), _side(3, 8)),
            ),
        ),
        SplitDay(
            "G5", "Costas (espessura e largura) e peitoral superior", "upper",
            main=(
                main(PULLDOWN, _r(4, 8, 10), rest=120, rpe=RIR1_2),
                main(ROW_HEAVY, _r(4, 6, 8), rpe=RIR1_2),
                main(INCLINE_SMITH, _r(4, 8, 10), rest=120, rpe=RIR1_2),
            ),
            accessories=(
                acc(ROW_CABLE, _r(3, 10, 12)),
                acc(STRAIGHT_ARM, _r(3, 12, 15), rotate=False, fallbacks=STRAIGHT_ARM_FB),
                acc(("low_cable_fly", "cable_crossover", "pec_deck_fly", "db_fly"),
                    _r(3, 12, 15, cues=("foco no peitoral superior",)), rotate=False, fallbacks=FLY_FB),
                acc(HAMMER, _r(3, 10, 12), rotate=False),
            ),
        ),
    ]
}


# --- selection -------------------------------------------------------------------------------------------

def _name(ex_id: str) -> str:
    return EXERCISES[ex_id].name


def _choose(day: SplitDay, i: int, slot: Slot, cycle_index: int, equipment: Equipment, used: set[str]) -> str:
    have = ([o for o in slot.options if available(o, equipment)]
            or [o for o in slot.fallbacks if available(o, equipment)])
    fresh = [o for o in have if _name(o) not in used]
    if not fresh:
        # Everything the slot lists is missing or already in the day: same movement pattern, anything available.
        pattern = EXERCISES[slot.options[0]].pattern
        fresh = [v[0] for v in candidates(pattern, tuple(Modality), equipment, stand_ins=True, v2=True)
                 if available(v[0], equipment) and _name(v[0]) not in used]
        if not fresh:  # nothing the profile covers: the first option, and the session says what is missing
            return have[0] if have else slot.options[0]
        return fresh[0]
    if not slot.rotate:
        return fresh[0]
    # Each slot starts its rotation at its own point, so days sharing a pool differ within a cycle.
    start = zlib.crc32(f"{day.id}:{i}".encode()) % len(have)
    for step in range(len(have)):
        pick = have[(start + cycle_index + step) % len(have)]
        if pick in fresh:
            return pick
    return fresh[0]


def _warmup_cardio(equipment: Equipment) -> str:
    return next((c for c in WARMUP_CARDIO if available(c, equipment)), WARMUP_CARDIO[-1])


def select(day_id: str, cycle_index: int, equipment: Equipment = None) -> tuple[str, ...]:
    """Exercise id per slot (main, accessories, finisher in order) for one cycle."""
    if cycle_index < 0:
        raise ValueError("cycle_index must be >= 0")
    day = DAYS[day_id]
    # The warm-up (red days add a drill) is not drawn here, but nothing may repeat it.
    used = {_name(e) for e in (_warmup_cardio(equipment), *WARMUP_DRILLS[day.focus])}
    chosen: list[str] = []
    for i, slot in enumerate(day.slots):
        # Top set and back-off are one exercise: the back-off repeats the top set's pick.
        if slot.role == "backoff" and chosen:
            ex = chosen[-1]
        else:
            ex = _choose(day, i, slot, cycle_index, equipment, used)
        used.add(_name(ex))
        chosen.append(ex)
    return tuple(chosen)


# --- prescriptions ---------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Params:
    deload: bool
    red: bool
    set_multiplier: float
    rpe_delta: float


def params(cfg: TierConfig, cycle_index: int, readiness: ReadinessSummary | None,
           low_readiness_streak: bool) -> Params:
    from .generator import is_scheduled_deload

    level = readiness.level if readiness else "green"
    deload = is_scheduled_deload(cfg, cycle_index) or low_readiness_streak
    red = level == "red"
    multiplier = DELOAD_SET_MULTIPLIER if deload else (RED_SET_MULTIPLIER if red else 1.0)
    rpe_delta = DELOAD_RPE_DELTA if deload else (-1 if level in ("amber", "red") else 0)
    return Params(deload, red, multiplier, rpe_delta)


def _fit(slot: Slot, ex_id: str) -> tuple[tuple[str, Modality], RxTemplate]:
    """The slot's prescription adapted to the exercise that fills it."""
    ex = EXERCISES[ex_id]
    # The slot's modality when the exercise has it, else the closest one done the same way (reps, hold...).
    prefs = [m for m in (slot.modality, H, S, Modality.TEMPO, Modality.ISOMETRIC, C, P, Modality.EXPLOSIVE)
             if m in ex.variants]
    mod = next((m for m in prefs if ex.variants[m].mode == slot.rx.mode), prefs[0])
    catalog = ex.variants[mod]
    # A plank (hold) filling a reps slot does its own work with the slot's sets; an exact slot keeps its work.
    if catalog.mode != slot.rx.mode and not (slot.exact and _fits_mode(ex_id, slot.rx)):
        return (ex_id, mod), replace(catalog, sets=slot.rx.sets)
    rx = slot.rx
    if ex.unilateral and rx.reps and not rx.reps_per_side:
        rx = replace(rx, reps=None, reps_per_side=rx.reps)
    elif not ex.unilateral and rx.reps_per_side and not rx.reps:
        rx = replace(rx, reps=rx.reps_per_side, reps_per_side=None)
    cues = tuple(dict.fromkeys(rx.cues + catalog.cues))
    return (ex_id, mod), replace(rx, cues=cues, intensity=rx.intensity or catalog.intensity)


def _fits_mode(ex_id: str, rx: RxTemplate) -> bool:
    """An exact slot keeps its own work unless the exercise can't be done that way (a bike sprint has no metres)."""
    ex = EXERCISES[ex_id]
    if rx.mode == Mode.DISTANCE:
        return ex.pattern in (Pattern.CARRY, Pattern.SPRINT) and ex.implement != Implement.ERGOMETER
    return True


def _rx(slot: Slot, ex_id: str, *, scaled: bool, p: Params, history: Sequence[SetRecord],
        bodyweight_kg: float | None, first: bool = False, no_rpe: bool = False) -> Prescription:
    from .generator import build_rx

    variant, tpl = _fit(slot, ex_id)
    rx = build_rx(
        variant,
        tpl=tpl,
        set_multiplier=p.set_multiplier if scaled else 1.0,
        rpe_delta=p.rpe_delta if scaled else 0,
        no_rpe=no_rpe,
        base_rpe=slot.rpe if slot.rpe is not None else ROLE_RPE.get(slot.role or ""),
        rest_seconds=slot.rest,
        history=history,
        bodyweight_kg=bodyweight_kg,
    )
    update: dict = {"set_role": slot.role}
    if first or slot.role == "top":
        ramp = warmup_ramp(EXERCISES[ex_id], rx.suggested_load_kg)
        update["warmup_sets"] = [WarmupSet(load_kg=kg, reps=n) for kg, n in ramp]
        if not ramp and first and tpl.mode == Mode.REPS:  # no load to compute the ramp from yet: the rule
            update["cues"] = [WARMUP_SETS_CUE, *rx.cues]
    return rx.model_copy(update=update)


def _block_rxs(slots: Sequence[Slot], ids: Sequence[str], *, scaled: bool, p: Params,
               history: Sequence[SetRecord], bodyweight_kg: float | None,
               first_lift: bool = False, no_rpe: bool = False) -> list[Prescription]:
    out: list[Prescription] = []
    for n, (slot, ex_id) in enumerate(zip(slots, ids, strict=True)):
        rx = _rx(slot, ex_id, scaled=scaled, p=p, history=history, bodyweight_kg=bodyweight_kg,
                 first=first_lift and n == 0, no_rpe=no_rpe)
        if slot.role == "backoff" and out and out[-1].exercise_id == rx.exercise_id:
            top = out[-1].suggested_load_kg
            if top is not None:
                rx = rx.model_copy(update={"suggested_load_kg": float(round(top * BACKOFF_SHARE))})
        out.append(rx)
    return out


def _work_seconds(rx: Prescription) -> int:
    if rx.duration_seconds:
        return rx.duration_seconds
    if rx.hold_seconds:
        return rx.hold_seconds * (2 if rx.unilateral else 1)
    return 70 if rx.unilateral else 40


def _block_minutes(rxs: Sequence[Prescription]) -> int:
    seconds = sum(rx.sets * (_work_seconds(rx) + (rx.rest_seconds or 0)) for rx in rxs)
    return max(1, math.ceil(seconds / 60))


def _warmup(cfg: TierConfig, day: SplitDay, equipment: Equipment, red: bool) -> Block:
    from .generator import build_rx

    cardio = _warmup_cardio(equipment)
    drills = WARMUP_DRILLS[day.focus][:cfg.mobility_drills + (1 if red else 0)]
    seconds = WARMUP_CARDIO_SECONDS * (2 if red else 1)
    cardio_mod = next(iter(EXERCISES[cardio].variants))
    return Block(
        order=1,
        kind=BlockKind.PREP,
        name="Aquecimento",
        duration_minutes=cfg.prep_expanded_minutes if red else cfg.prep_minutes,
        execution_style=ExecutionStyle.CHECKLIST,
        mandatory_lock=True,
        rest_seconds=0,
        exercises=[
            build_rx((cardio, cardio_mod), duration_seconds=seconds, no_rpe=True),
            *(build_rx((d, P), no_rpe=True) for d in drills),
        ],
    )


def rest_day(cfg: TierConfig, cycle_index: int, cycle_day: int, readiness: ReadinessSummary | None) -> Session:
    return Session(
        protocol_id=cfg.protocol_id,
        tier=cfg.tier,
        cycle_index=cycle_index,
        cycle_day=cycle_day,
        cycle_length=cfg.cycle_length,
        cycle_structure=cfg.cycle_structure,
        is_training_day=False,
        day_name="Descanso",
        target_duration_minutes=0,
        rest_cap_seconds=SPLIT_REST_CAP_SECONDS,
        readiness=readiness,
        notices=["Dia de descanso: o músculo cresce agora. Bata a meta de proteína, de água e de sono; "
                 "uma caminhada leve ajuda, mas não é obrigatória."],
        blocks=[],
    )


def generate(
    cfg: TierConfig,
    day_id: str,
    cycle_index: int,
    cycle_day: int,
    *,
    readiness: ReadinessSummary | None,
    history: Sequence[SetRecord],
    bodyweight_kg: float | None,
    low_readiness_streak: bool,
    equipment: Equipment,
) -> Session:
    from .generator import is_scheduled_deload, missing_equipment_notices

    if day_id == REST_DAY:
        return rest_day(cfg, cycle_index, cycle_day, readiness)
    day = DAYS[day_id]
    ids = select(day_id, cycle_index, equipment)
    p = params(cfg, cycle_index, readiness, low_readiness_streak)
    kw = dict(p=p, history=history, bodyweight_kg=bodyweight_kg)

    blocks = [_warmup(cfg, day, equipment, p.red)]
    at = 0
    for order, g in enumerate(groups(day), start=2):
        g_ids, at = ids[at:at + len(g.slots)], at + len(g.slots)
        if g.optional and (p.red or p.deload):  # always last, so the numbers before it don't shift
            continue
        rxs = _block_rxs(g.slots, g_ids, scaled=g.scaled, first_lift=g.slots is day.main, no_rpe=g.no_rpe,
                         **kw)
        blocks.append(Block(order=order, kind=g.kind, name=g.name, duration_minutes=_block_minutes(rxs),
                            execution_style=ExecutionStyle.STRAIGHT_SETS,
                            rest_seconds=0 if g.kind == BlockKind.CONDITIONING else cfg.rest_seconds,
                            exercises=rxs))

    notices: list[str] = []
    if p.deload:
        why = (f"programado a cada {cfg.deload_every_cycles} ciclos" if is_scheduled_deload(cfg, cycle_index)
               else f"3 dias seguidos de prontidão baixa; vale por {cfg.cycle_length} dias")
        notices.append(f"Deload ({why}): menos séries, esforço alvo 2 pontos mais baixo e sem finalizador.")
    elif p.red:
        notices.append("Prontidão vermelha: aquecimento mais longo, menos séries e sem finalizador.")
    notices += prerequisite_notices(cfg, history, bodyweight_kg)
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
        rest_cap_seconds=SPLIT_REST_CAP_SECONDS,
        readiness=readiness,
        deload=p.deload,
        notices=notices,
        blocks=blocks,
    )


def alternatives(session: Session, day_id: str, block_order: int, index: int, *, p: Params,
                 history: Sequence[SetRecord], bodyweight_kg: float | None, equipment: Equipment,
                 limit: int) -> list[Prescription]:
    """Swaps: the slot's own options first, then the same movement pattern; all with the slot's prescription."""
    if day_id == REST_DAY:
        raise ValueError("rest days have no swappable exercises")
    day = DAYS[day_id]
    by_order = dict(enumerate(groups(day), start=2))
    block = next((b for b in session.blocks if b.order == block_order), None)
    if block is None or block_order not in by_order:
        raise ValueError("only power, main, accessory and finisher exercises can be swapped")
    group = by_order[block_order]
    slots = group.slots
    if not 0 <= index < len(slots):
        raise ValueError("no exercise at that position")
    slot = slots[index]
    if slot.role:  # top set and back-off share one exercise
        return []
    current = block.exercises[index]
    in_session = {rx.name for b in session.blocks for rx in b.exercises}
    pool = [o for o in (*slot.options, *slot.fallbacks) if available(o, equipment)]
    pool += [v[0] for v in candidates(current.pattern, (slot.modality, S, H, Modality.TEMPO, Modality.ISOMETRIC),
                                      equipment, stand_ins=True, v2=True)]
    options: list[str] = []
    for ex_id in pool:
        if _name(ex_id) not in in_session and ex_id not in options:
            options.append(ex_id)
    return [_rx(slot, ex_id, scaled=group.scaled, p=p, history=history, bodyweight_kg=bodyweight_kg,
                no_rpe=group.no_rpe) for ex_id in options[:limit]]


# Advanced programs say who they are for; below the bar the session says so (it still runs).
PREREQUISITES: dict[Tier, tuple[tuple[str, tuple[str, ...], float], ...]] = {
    Tier.CONJUGATE: (
        ("agachamento", ("back_squat", "box_squat", "front_squat"), 1.8),
        ("terra", ("conventional_deadlift", "trap_bar_deadlift"), 2.2),
    ),
}


def prerequisite_notices(cfg: TierConfig, history: Sequence[SetRecord], bodyweight_kg: float | None) -> list[str]:
    bars = PREREQUISITES.get(cfg.tier)
    if not bars or not bodyweight_kg:
        return []
    short = []
    for lift, ids, ratio in bars:
        best = max((pt.e1rm_kg for i in ids for pt in e1rm_history(history, i)), default=None)
        if best is None or best < ratio * bodyweight_kg:
            have = f"1RM estimado {best:.0f} kg".replace(".", ",") if best else "sem registro"
            short.append(f"{lift} ≥ {ratio:.1f}× o peso ({ratio * bodyweight_kg:.0f} kg; {have})".replace(".", ","))
    if not short:
        return []
    return [f"{cfg.name} é para quem já tem base avançada de força: {'; '.join(short)}. "
            "Dá para seguir, mas Upper / Lower ou Functional Bodybuilding rendem mais antes disso."]
