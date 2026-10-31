"""Core domain types shared by the engine and the API.

A session is not a flat Exercise -> Sets -> Reps list: blocks mix timed work,
rep work and isometric holds, with optional tempo (cadence) and unilateral work.
Every prescription carries an execution ``mode`` so the client player knows
which timer/metronome/logger to show.
"""

from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Tier(StrEnum):
    """Training program the athlete follows (the API keeps the historical name "tier")."""

    VIGILANTE = "vigilante"  # 45 min, 4 sessions / 7-day cycle
    DARK_KNIGHT = "dark_knight"  # 60 min, 5 sessions / 7-day cycle
    BRAWLER = "brawler"  # 3 on / recovery / 3 on / rest (Brawler V2)
    # Machine-first splits (splits.py)
    FULL_BODY = "full_body"  # 3 sessions / 7-day cycle
    UPPER_LOWER = "upper_lower"  # 4 sessions / 7-day cycle
    PUSH_PULL_LEGS = "push_pull_legs"  # 6 sessions / 7-day cycle
    BATFLECK = "batfleck"  # 5 sessions / 7-day cycle, BvS hypertrophy
    NORTON_FB = "norton_fb"  # 4 sessions: Walter Norton Jr.'s functional bodybuilding
    CONJUGATE = "conjugate"  # 4 sessions: conjugate (Westside-style) max + dynamic effort, advanced
    GOTHAM_ARMOR = "gotham_armor"  # 5 sessions: V-taper aesthetics + two athletic windows


class Pattern(StrEnum):
    """Biomechanical patterns the Chaos Engine must preserve across cycles."""

    PULL_VERTICAL = "pull_vertical"
    PULL_HORIZONTAL = "pull_horizontal"
    PUSH_HORIZONTAL = "push_horizontal"
    PUSH_VERTICAL = "push_vertical"
    SQUAT = "squat"
    HINGE = "hinge"
    LUNGE = "lunge"
    CARRY = "carry"
    CORE_ANTI_ROTATION = "core_anti_rotation"
    CORE_FLEXION = "core_flexion"
    NECK = "neck"
    ARMS = "arms"
    SHOULDERS = "shoulders"
    TRAPS = "traps"
    KNEE_EXTENSION = "knee_extension"  # leg extension
    KNEE_FLEXION = "knee_flexion"  # leg curl
    CALVES = "calves"
    HIP_ISOLATION = "hip_isolation"  # abduction / adduction / kickback
    CHEST_FLY = "chest_fly"
    REAR_DELT = "rear_delt"
    SPRINT = "sprint"
    CARDIO = "cardio"
    MYOFASCIAL = "myofascial"
    MOBILITY = "mobility"


class Implement(StrEnum):
    """What an exercise needs. Machines are listed per station: most gyms have some, not all."""

    BARBELL = "barbell"
    DUMBBELL = "dumbbell"
    KETTLEBELL = "kettlebell"
    CABLE = "cable"
    MACHINE = "machine"  # legacy profile value: stands for every machine station
    LEG_PRESS = "leg_press"
    LEG_EXTENSION = "leg_extension"
    LEG_CURL = "leg_curl"
    SMITH = "smith"
    HACK_SQUAT = "hack_squat"
    CALF_MACHINE = "calf_machine"
    HIP_MACHINE = "hip_machine"  # abductor / adductor / glute machine
    LAT_PULLDOWN = "lat_pulldown"
    ROW_MACHINE = "row_machine"  # seated row machine or low cable row station
    CHEST_PRESS = "chest_press"
    PEC_DECK = "pec_deck"  # also reverse fly
    SHOULDER_PRESS = "shoulder_press"
    BODYWEIGHT = "bodyweight"
    SLED = "sled"
    TRAP_BAR = "trap_bar"
    BAND = "band"
    MEDICINE_BALL = "medicine_ball"
    ROLLER = "roller"
    ERGOMETER = "ergometer"


MACHINE_STATIONS: frozenset[Implement] = frozenset({
    Implement.LEG_PRESS, Implement.LEG_EXTENSION, Implement.LEG_CURL, Implement.SMITH, Implement.HACK_SQUAT,
    Implement.CALF_MACHINE, Implement.HIP_MACHINE, Implement.LAT_PULLDOWN, Implement.ROW_MACHINE,
    Implement.CHEST_PRESS, Implement.PEC_DECK, Implement.SHOULDER_PRESS,
})


class Modality(StrEnum):
    """How a movement is loaded. The Chaos Engine rotates this axis too."""

    STRENGTH = "strength"
    TEMPO = "tempo"
    ISOMETRIC = "isometric"
    EXPLOSIVE = "explosive"
    HYPERTROPHY = "hypertrophy"
    CONDITIONING = "conditioning"
    PREP = "prep"


class Mode(StrEnum):
    """Execution mode: decides which timer/logger the player renders."""

    TIMED = "timed"  # run a clock for duration_seconds per set
    REPS = "reps"  # count reps (optionally with tempo metronome)
    HOLD = "hold"  # isometric hold of hold_seconds per set/rep
    DISTANCE = "distance"  # cover distance_m per set (carries, short sprints)


class BlockKind(StrEnum):
    PREP = "prep"  # Block 1 — movement & tissue prep (mandatory lock)
    STRENGTH = "strength"  # Block 2 — torso, stability & raw strength
    CONDITIONING = "conditioning"  # Block 3 — functional bodybuilding AMRAP
    RECOVERY = "recovery"  # off days — active recovery


class ExecutionStyle(StrEnum):
    STRAIGHT_SETS = "straight_sets"
    AMRAP = "amrap"
    CHECKLIST = "checklist"


# Longest rest the engine prescribes: 3–4 min after a heavy top set.
REST_MAX_SECONDS = 240


class OutModel(BaseModel):
    """Response model: fields with defaults are always sent, so the schema marks them required."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class Tempo(OutModel):
    """Cadence in seconds per phase, e.g. 4-0-4-1 for the strict pull-up."""

    eccentric: int = Field(ge=0, le=10)
    bottom_pause: int = Field(default=0, ge=0, le=10)
    concentric: int = Field(ge=0, le=10)
    top_pause: int = Field(default=0, ge=0, le=10)

    @property
    def rep_seconds(self) -> int:
        return self.eccentric + self.bottom_pause + self.concentric + self.top_pause

    def notation(self) -> str:
        return f"{self.eccentric}-{self.bottom_pause}-{self.concentric}-{self.top_pause}"


class LastSet(OutModel):
    """The heaviest set of the last day the exercise was logged."""

    on: date
    load_kg: float | None
    reps: int | None
    rpe: float | None


class WarmupSet(OutModel):
    load_kg: float = Field(ge=0)
    reps: int = Field(ge=1)


class Prescription(OutModel):
    exercise_id: str
    name: str
    pattern: Pattern
    implement: Implement
    modality: Modality
    mode: Mode
    sets: int = Field(default=1, ge=1)
    duration_seconds: int | None = Field(default=None, ge=1)
    reps: int | None = Field(default=None, ge=1)
    reps_max: int | None = Field(default=None, ge=1)  # top of a rep range ("8 a 10"); reps is the bottom
    reps_per_side: int | None = Field(default=None, ge=1)
    reps_sequence: list[int] | None = None
    hold_seconds: int | None = Field(default=None, ge=1)
    distance_m: int | None = Field(default=None, ge=1)
    intra_set_rest_seconds: int | None = Field(default=None, ge=0)
    # Rest after each set of this exercise; None = the block's rest. 0 = straight into the next
    # exercise (first half of a superset).
    rest_seconds: int | None = Field(default=None, ge=0, le=REST_MAX_SECONDS)
    set_role: Literal["top", "backoff"] | None = None
    tempo: Tempo | None = None
    unilateral: bool = False
    target_rpe: float | None = Field(default=None, ge=1, le=10)
    suggested_load_kg: float | None = Field(default=None, ge=0)
    intensity: str | None = None
    cues: list[str] = Field(default_factory=list)
    last_set: LastSet | None = None
    best_e1rm_kg: float | None = Field(default=None, ge=0)  # all-time best estimate; external load only
    warmup_sets: list[WarmupSet] = Field(default_factory=list)  # ramp before the first heavy lift

    @model_validator(mode="after")
    def _check_mode_fields(self) -> Prescription:
        match self.mode:
            case Mode.TIMED:
                if self.duration_seconds is None:
                    raise ValueError("timed prescription needs duration_seconds")
            case Mode.REPS:
                if not (self.reps or self.reps_per_side or self.reps_sequence):
                    raise ValueError("reps prescription needs reps, reps_per_side or reps_sequence")
            case Mode.HOLD:
                if self.hold_seconds is None:
                    raise ValueError("hold prescription needs hold_seconds")
            case Mode.DISTANCE:
                if self.distance_m is None:
                    raise ValueError("distance prescription needs distance_m")
        return self


class Block(OutModel):
    order: int
    kind: BlockKind
    name: str
    duration_minutes: int
    execution_style: ExecutionStyle
    mandatory_lock: bool = False
    rest_seconds: int = Field(default=45, ge=0, le=REST_MAX_SECONDS)
    exercises: list[Prescription]


class ReadinessSummary(OutModel):
    score: int = Field(ge=0, le=100)
    level: Literal["green", "amber", "red"]
    mobility_expanded: bool
    reasons: list[str] = Field(default_factory=list)


class Session(OutModel):
    protocol_id: str
    tier: Tier
    cycle_index: int
    cycle_day: int  # 1-based
    cycle_length: int
    cycle_structure: str
    is_training_day: bool
    day_name: str
    target_duration_minutes: int
    rest_cap_seconds: int
    readiness: ReadinessSummary | None = None
    deload: bool = False
    notices: list[str] = Field(default_factory=list)
    blocks: list[Block]
