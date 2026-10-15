"""Day templates: which biomechanical pattern fills each slot of each block.

The Chaos Engine keeps these patterns fixed and only rotates the variant
(implement / modality) between cycles. ``canonical`` pins the cycle-0 choice;
D1's canonical choices reproduce the documented Day 1 of the Norton protocol.
"""

from __future__ import annotations

from dataclasses import dataclass

from .domain import Modality, Pattern

S, T, I, E, H, C = (
    Modality.STRENGTH,
    Modality.TEMPO,
    Modality.ISOMETRIC,
    Modality.EXPLOSIVE,
    Modality.HYPERTROPHY,
    Modality.CONDITIONING,
)

HEAVY = (S, T, I, E)
CARRY_MODS = (S, E, I)
CIRCUIT = (H, C)
SPRINT_MODS = (C, E)

Variant = tuple[str, Modality]


@dataclass(frozen=True)
class Slot:
    pattern: Pattern
    modalities: tuple[Modality, ...]
    canonical: Variant | None = None


@dataclass(frozen=True)
class DayTemplate:
    id: str
    name: str
    strength: tuple[Slot, ...]
    conditioning: tuple[Slot, ...]
    canonical_cardio: str | None = None
    canonical_roller: str | None = None
    canonical_drills: tuple[str, ...] = ()


def slot(pattern: Pattern, modalities: tuple[Modality, ...], canonical: Variant | None = None) -> Slot:
    return Slot(pattern, modalities, canonical)


SPRINT = slot(Pattern.SPRINT, SPRINT_MODS, ("airdyne_sprint", C))

TEMPLATES: dict[str, DayTemplate] = {
    t.id: t
    for t in [
        DayTemplate(
            "D1",
            "Pull + Carry",
            strength=(
                slot(Pattern.CARRY, CARRY_MODS, ("db_farmers_walk", S)),
                slot(Pattern.CORE_FLEXION, HEAVY, ("alt_hanging_knee_up", S)),
                slot(Pattern.PULL_HORIZONTAL, HEAVY, ("half_kneeling_cable_row", S)),
                slot(Pattern.NECK, (I,), ("wrestlers_back_bridge", I)),
                slot(Pattern.PULL_VERTICAL, HEAVY, ("strict_pull_up", T)),
            ),
            conditioning=(
                SPRINT,
                slot(Pattern.PULL_VERTICAL, CIRCUIT, ("v_grip_lat_pulldown", H)),
                slot(Pattern.ARMS, CIRCUIT, ("alt_db_open_curl_complex", H)),
                slot(Pattern.SQUAT, CIRCUIT, ("goblet_squat", H)),
                slot(Pattern.LUNGE, CIRCUIT, ("lateral_squat", H)),
            ),
            canonical_cardio="elliptical",
            canonical_roller="rumble_roller_lower",
            canonical_drills=("plank_arm_extension_prep", "spiderman_lunge_stretch", "inchworm",
                              "brettzel_stretch", "t_spine_rotation"),
        ),
        DayTemplate(
            "D2",
            "Push + Anti-Rotation",
            strength=(
                slot(Pattern.CARRY, CARRY_MODS),
                slot(Pattern.CORE_ANTI_ROTATION, HEAVY),
                slot(Pattern.PUSH_HORIZONTAL, HEAVY),
                slot(Pattern.PUSH_VERTICAL, HEAVY),
                slot(Pattern.HINGE, HEAVY),
            ),
            conditioning=(
                SPRINT,
                slot(Pattern.SHOULDERS, CIRCUIT),
                slot(Pattern.ARMS, CIRCUIT),
                slot(Pattern.PUSH_HORIZONTAL, CIRCUIT),
                slot(Pattern.TRAPS, CIRCUIT),
            ),
        ),
        DayTemplate(
            "D3",
            "Legs + Hinge",
            strength=(
                slot(Pattern.CARRY, CARRY_MODS),
                slot(Pattern.CORE_ANTI_ROTATION, HEAVY),
                slot(Pattern.HINGE, HEAVY),
                slot(Pattern.SQUAT, HEAVY),
                slot(Pattern.LUNGE, HEAVY),
            ),
            conditioning=(
                SPRINT,
                slot(Pattern.HINGE, CIRCUIT),
                slot(Pattern.CORE_FLEXION, CIRCUIT),
                slot(Pattern.SHOULDERS, CIRCUIT),
                slot(Pattern.LUNGE, CIRCUIT),
            ),
        ),
        DayTemplate(
            "D4",
            "Pull + Neck",
            strength=(
                slot(Pattern.CARRY, CARRY_MODS),
                slot(Pattern.CORE_FLEXION, HEAVY),
                slot(Pattern.PULL_VERTICAL, HEAVY),
                slot(Pattern.PULL_HORIZONTAL, HEAVY),
                slot(Pattern.NECK, (I,)),
            ),
            conditioning=(
                SPRINT,
                slot(Pattern.TRAPS, CIRCUIT),
                slot(Pattern.ARMS, CIRCUIT),
                slot(Pattern.SHOULDERS, CIRCUIT),
                slot(Pattern.SQUAT, CIRCUIT),
            ),
        ),
        DayTemplate(
            "D5",
            "Push + Shoulders",
            strength=(
                slot(Pattern.CARRY, CARRY_MODS),
                slot(Pattern.CORE_ANTI_ROTATION, HEAVY),
                slot(Pattern.PUSH_VERTICAL, HEAVY),
                slot(Pattern.PUSH_HORIZONTAL, HEAVY),
                slot(Pattern.PULL_HORIZONTAL, HEAVY),
            ),
            conditioning=(
                SPRINT,
                slot(Pattern.SHOULDERS, CIRCUIT),
                slot(Pattern.ARMS, CIRCUIT),
                slot(Pattern.TRAPS, CIRCUIT),
                slot(Pattern.PULL_HORIZONTAL, CIRCUIT),
            ),
        ),
        DayTemplate(
            "D6",
            "Full-Body Chaos",
            strength=(
                slot(Pattern.CARRY, CARRY_MODS),
                slot(Pattern.CORE_FLEXION, HEAVY),
                slot(Pattern.HINGE, HEAVY),
                slot(Pattern.PULL_VERTICAL, HEAVY),
                slot(Pattern.PUSH_HORIZONTAL, HEAVY),
            ),
            conditioning=(
                SPRINT,
                slot(Pattern.SQUAT, CIRCUIT),
                slot(Pattern.PULL_HORIZONTAL, CIRCUIT),
                slot(Pattern.SHOULDERS, CIRCUIT),
                slot(Pattern.ARMS, CIRCUIT),
            ),
        ),
    ]
}

MAX_DRILLS = 5
