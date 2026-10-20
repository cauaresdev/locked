"""Request/response models."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from ..catalog import EXERCISES
from ..domain import Implement, Modality, OutModel, Tier
from ..nutrition import Category, Dairy, Meal

Sex = Literal["male", "female"]

MIN_DAY, MAX_DAY = date(2000, 1, 1), date(2100, 12, 31)


def _sane_day(v: date) -> date:
    if not MIN_DAY <= v <= MAX_DAY:
        raise ValueError(f"date must be between {MIN_DAY} and {MAX_DAY}")
    return v


# Any calendar day the API accepts (path, query or body): far-off dates overflow date maths.
Day = Annotated[date, AfterValidator(_sane_day)]

_MIN_TS = datetime.combine(MIN_DAY, time(), timezone.utc)
_MAX_TS = datetime.combine(MAX_DAY, time(), timezone.utc)


def _sane_instant(v: datetime) -> datetime:
    if v.tzinfo is None:
        raise ValueError("timestamp must include a timezone offset")
    if not _MIN_TS <= v <= _MAX_TS:
        raise ValueError(f"timestamp must be between {MIN_DAY} and {MAX_DAY}")
    return v


# A point in time from a device clock: offset required (naive values are ambiguous)
# and kept in the same range as Day, so timezone maths cannot overflow.
Instant = Annotated[datetime, AfterValidator(_sane_instant)]

# Batch uploads are split by the app's outbox; the caps bound the work one request can ask for.
MAX_LOG_BATCH = 500


class InModel(BaseModel):
    """Request body: NaN and ±Infinity are rejected (they pass ge/le-free fields and break JSON out)."""

    model_config = ConfigDict(allow_inf_nan=False)


class Credentials(InModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)


class PasswordIn(InModel):
    password: str = Field(min_length=1, max_length=256)


class AuthOut(OutModel):
    token: str
    user_id: str
    athlete_id: str | None


class TierOut(OutModel):
    tier: Tier
    protocol_id: str
    cycle_structure: str
    cycle_length: int
    sessions_per_cycle: int
    target_minutes: int
    requires_waiver: bool
    max_recommended_weeks: int | None


class ProfileFields(InModel):
    body_fat_pct: float | None = Field(default=None, ge=3, le=60)
    height_cm: float | None = Field(default=None, ge=120, le=230)
    birth_year: int | None = Field(default=None, ge=1920, le=2015)
    sex: Sex | None = None
    hr_max_override: int | None = Field(default=None, ge=120, le=230)
    timezone: str | None = Field(default=None, max_length=64)
    early_bird_enabled: bool | None = None
    wake_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    equipment: list[Implement] | None = None  # implements available; None/omitted = full gym

    @field_validator("timezone")
    @classmethod
    def _valid_tz(cls, v: str | None) -> str | None:
        if v is None:
            return v
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as e:
            raise ValueError(f"unknown timezone {v!r}") from e
        return v


class AthleteCreate(ProfileFields):
    name: str = Field(min_length=1, max_length=120)
    tier: Tier
    bodyweight_kg: float = Field(ge=30, le=250)
    cycle_start: Day | None = None
    accept_brawler_waiver: bool = False
    # LGPD: heart rate, HRV and sleep are sensitive health data.
    accept_health_data: bool = False


class AthleteUpdate(ProfileFields):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    tier: Tier | None = None
    bodyweight_kg: float | None = Field(default=None, ge=30, le=250)
    accept_brawler_waiver: bool = False


class AthleteOut(OutModel):
    id: str
    name: str
    tier: Tier
    cycle_start: date
    bodyweight_kg: float
    body_fat_pct: float | None
    height_cm: float | None
    birth_year: int | None
    sex: Sex | None
    hr_max_override: int | None
    hr_max: int | None
    timezone: str
    early_bird_enabled: bool
    wake_time: str
    waiver_accepted_at: datetime | None
    equipment: list[Implement]
    health_consent_at: datetime | None
    cycle_length: int
    cycle_structure: str


class ReadinessIn(InModel):
    """Partial update: only fields that are sent are written (health sync + manual soreness merge)."""

    day: Day
    hrv_ms: float | None = Field(default=None, gt=0, le=300)
    hrv_method: Literal["rmssd", "sdnn"] | None = None
    resting_hr: float | None = Field(default=None, ge=25, le=150)
    sleep_hours: float | None = Field(default=None, ge=0, le=16)
    soreness: int | None = Field(default=None, ge=1, le=5)
    source: Literal["manual", "healthkit", "health_connect"] = "manual"


class SetLogIn(InModel):
    id: uuid.UUID
    performed_on: Day
    exercise_id: str
    set_index: int = Field(ge=0, le=200)
    reps: int | None = Field(default=None, ge=0, le=1000)
    load_kg: float | None = Field(default=None, ge=0, le=1000)
    duration_seconds: int | None = Field(default=None, ge=0, le=86_400)
    distance_m: float | None = Field(default=None, ge=0, le=100_000)
    rpe: float | None = Field(default=None, ge=1, le=10)
    modality: Modality | None = None  # the prescription's modality; only straight sets estimate the 1RM
    performed_at: Instant | None = None  # when the set ended, device clock (dates the strength block)

    @model_validator(mode="after")
    def _known_exercise(self) -> SetLogIn:
        if self.exercise_id not in EXERCISES:
            raise ValueError(f"unknown exercise_id {self.exercise_id!r}")
        return self


class MissedOut(OutModel):
    day: date
    missed: list[date]


class CycleShiftIn(InModel):
    days: int = Field(ge=1, le=7)


class SyncResult(BaseModel):
    accepted: int
    duplicates: int


class ArmorLoadOut(OutModel):
    total_kg_m: float
    by_kind: dict[str, float]
    current_cycle_kg_m: float
    previous_cycle_kg_m: float


class StrengthOut(OutModel):
    exercise_id: str
    name: str
    e1rm_kg: float
    history: list[tuple[date, float]]


# --- body weight / progress ------------------------------------------------------


class WeighInIn(InModel):
    day: Day
    weight_kg: float = Field(ge=30, le=250)
    source: Literal["manual", "healthkit", "health_connect"] = "manual"


class WeightPointOut(OutModel):
    day: date
    weight_kg: float
    trend_kg: float  # mean of the readings in the 7 days ending that day


class WeightOut(OutModel):
    entries: list[WeightPointOut]
    trend_kg: float | None
    profile_weight_kg: float  # what every target is computed from (follows the trend)


class ReadinessDayOut(OutModel):
    day: date
    score: int | None
    level: Literal["green", "amber", "red"] | None
    hrv_ms: float | None
    hrv_method: str
    resting_hr: float | None
    sleep_hours: float | None
    soreness: int | None


class ArmorCycleOut(OutModel):
    cycle_index: int
    start: date
    kg_m: float


class DietDayOut(OutModel):
    day: date
    kcal: float
    kcal_target: float
    protein_g: float
    protein_target_g: float


class AttendanceDayOut(OutModel):
    day: date
    planned: bool
    trained: bool


class ProgressOut(OutModel):
    days: int
    strength: list[StrengthOut]
    weight: WeightOut
    readiness: list[ReadinessDayOut]
    armor_cycles: list[ArmorCycleOut]
    diet: list[DietDayOut]
    attendance: list[AttendanceDayOut]


# --- nutrition ---------------------------------------------------------------


class MacrosOut(OutModel):
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class TotalsOut(MacrosOut):
    sodium_mg: float


class StapleOut(OutModel):
    id: str
    name: str
    category: Category
    kcal: float
    protein: float
    carbs: float
    fat: float
    sodium_mg: float
    default_g: float
    dairy: Dairy


class MealPlanOut(OutModel):
    meal: Meal
    target: MacrosOut
    carb_curfew: bool
    suggestions: list[StapleOut]
    consumed: TotalsOut


class AlertOut(OutModel):
    level: Literal["red", "amber", "info"]
    code: str
    message: str
    meal: Meal | None
    entry_id: str | None


class SupplementOut(OutModel):
    item_id: str
    label: str
    meal: Meal
    taken: bool


class FoodEntryIn(InModel):
    id: uuid.UUID
    day: Day
    meal: Meal
    name: str = Field(min_length=1, max_length=255)
    grams: float = Field(gt=0, le=3000)
    staple_id: str | None = None  # nutrients from the staple table
    barcode: str | None = Field(default=None, max_length=32)  # nutrients from the product cache
    # manual entry: nutrients for the given grams
    kcal: float | None = Field(default=None, ge=0, le=20_000)
    protein_g: float | None = Field(default=None, ge=0, le=3000)
    carbs_g: float | None = Field(default=None, ge=0, le=3000)
    fat_g: float | None = Field(default=None, ge=0, le=3000)
    sodium_mg: float | None = Field(default=None, ge=0, le=100_000)
    dairy: Dairy = Dairy.NONE
    category: Category | None = None


class FoodEntryOut(OutModel):
    id: str
    day: date
    meal: Meal
    name: str
    barcode: str | None
    grams: float
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    sodium_mg: float
    dairy: Dairy
    category: Category | None


class NutritionDayOut(OutModel):
    day: date
    is_training_day: bool
    lbm_kg: float
    lbm_source: Literal["body_fat", "boer", "assumed"]
    kcal_floor: float
    kcal_ceiling: float
    session_kcal: float
    session_kcal_source: Literal["telemetry", "estimate", "none"]
    target: MacrosOut
    sodium_min_mg: int
    sodium_max_mg: int
    consumed: TotalsOut
    meals: list[MealPlanOut]
    alerts: list[AlertOut]
    supplements: list[SupplementOut]
    entries: list[FoodEntryOut]


class SupplementIn(InModel):
    item_id: str
    taken: bool


class ProductOut(OutModel):
    barcode: str
    found: bool
    name: str
    brand: str | None
    kcal_100g: float | None
    protein_100g: float | None
    carbs_100g: float | None
    fat_100g: float | None
    sodium_mg_100g: float | None
    serving_g: float | None
    dairy: Dairy
    dairy_evidence: str
    alerts: list[AlertOut]


# --- telemetry / early bird ----------------------------------------------------


class SampleIn(InModel):
    ts: Instant
    kind: Literal["hr", "power", "cadence"]
    value: float = Field(ge=0, le=3000)


class TelemetrySummaryOut(OutModel):
    day: date
    hr_samples: int
    avg_hr: float | None
    max_hr: float | None
    hr_max: int | None
    minutes_by_zone: dict[int, float]
    kcal: float | None
    avg_power_w: float | None
    max_power_w: float | None


class WakeIn(InModel):
    woke_at: Instant


class EarlyBirdOut(OutModel):
    day: date
    enabled: bool
    wake_time: str
    status: Literal["not_started", "in_window", "complete", "missed", "no_hr_max"]
    woke_at: datetime | None
    window_ends_at: datetime | None
    minutes_in_zone: float
    required_minutes: int
    zone_bpm: tuple[int, int] | None
    avg_hr: float | None
    streak: int
