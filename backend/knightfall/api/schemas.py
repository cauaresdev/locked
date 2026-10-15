"""Request/response models."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from ..catalog import EXERCISES
from ..domain import Tier
from ..nutrition import Category, Dairy, Meal

Sex = Literal["male", "female"]


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)


class AuthOut(BaseModel):
    token: str
    user_id: str
    athlete_id: str | None


class TierOut(BaseModel):
    tier: Tier
    protocol_id: str
    cycle_structure: str
    cycle_length: int
    sessions_per_cycle: int
    target_minutes: int
    requires_waiver: bool
    max_recommended_weeks: int | None


class ProfileFields(BaseModel):
    body_fat_pct: float | None = Field(default=None, ge=3, le=60)
    height_cm: float | None = Field(default=None, ge=120, le=230)
    birth_year: int | None = Field(default=None, ge=1920, le=2015)
    sex: Sex | None = None
    hr_max_override: int | None = Field(default=None, ge=120, le=230)
    timezone: str | None = Field(default=None, max_length=64)
    early_bird_enabled: bool | None = None
    wake_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")

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
    cycle_start: date | None = None
    accept_brawler_waiver: bool = False


class AthleteUpdate(ProfileFields):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    tier: Tier | None = None
    bodyweight_kg: float | None = Field(default=None, ge=30, le=250)
    accept_brawler_waiver: bool = False


class AthleteOut(BaseModel):
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
    cycle_length: int
    cycle_structure: str


class ReadinessIn(BaseModel):
    """Partial update: only fields that are sent are written (health sync + manual soreness merge)."""

    day: date
    hrv_ms: float | None = Field(default=None, gt=0, le=300)
    hrv_method: Literal["rmssd", "sdnn"] | None = None
    resting_hr: float | None = Field(default=None, ge=25, le=150)
    sleep_hours: float | None = Field(default=None, ge=0, le=16)
    soreness: int | None = Field(default=None, ge=1, le=5)
    source: Literal["manual", "healthkit", "health_connect"] = "manual"


class SetLogIn(BaseModel):
    id: uuid.UUID
    performed_on: date
    exercise_id: str
    set_index: int = Field(ge=0)
    reps: int | None = Field(default=None, ge=0)
    load_kg: float | None = Field(default=None, ge=0)
    duration_seconds: int | None = Field(default=None, ge=0)
    distance_m: float | None = Field(default=None, ge=0)
    rpe: float | None = Field(default=None, ge=1, le=10)

    @model_validator(mode="after")
    def _known_exercise(self) -> SetLogIn:
        if self.exercise_id not in EXERCISES:
            raise ValueError(f"unknown exercise_id {self.exercise_id!r}")
        return self


class SyncResult(BaseModel):
    accepted: int
    duplicates: int


class ArmorLoadOut(BaseModel):
    total_kg_m: float
    by_kind: dict[str, float]
    current_cycle_kg_m: float
    previous_cycle_kg_m: float


class StrengthOut(BaseModel):
    exercise_id: str
    name: str
    e1rm_kg: float
    history: list[tuple[date, float]]


# --- nutrition ---------------------------------------------------------------


class MacrosOut(BaseModel):
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class TotalsOut(MacrosOut):
    sodium_mg: float


class StapleOut(BaseModel):
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


class MealPlanOut(BaseModel):
    meal: Meal
    target: MacrosOut
    carb_curfew: bool
    suggestions: list[StapleOut]
    consumed: TotalsOut


class AlertOut(BaseModel):
    level: Literal["red", "amber", "info"]
    code: str
    message: str
    meal: Meal | None
    entry_id: str | None


class SupplementOut(BaseModel):
    item_id: str
    label: str
    meal: Meal
    taken: bool


class FoodEntryIn(BaseModel):
    id: uuid.UUID
    day: date
    meal: Meal
    name: str = Field(min_length=1, max_length=255)
    grams: float = Field(gt=0, le=3000)
    staple_id: str | None = None  # nutrients from the staple table
    barcode: str | None = Field(default=None, max_length=32)  # nutrients from the product cache
    # manual entry: nutrients for the given grams
    kcal: float | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    sodium_mg: float | None = Field(default=None, ge=0)
    dairy: Dairy = Dairy.NONE
    category: Category | None = None


class FoodEntryOut(BaseModel):
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


class NutritionDayOut(BaseModel):
    day: date
    is_training_day: bool
    lbm_kg: float
    lbm_source: str
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


class SupplementIn(BaseModel):
    item_id: str
    taken: bool


class ProductOut(BaseModel):
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


class SampleIn(BaseModel):
    ts: datetime
    kind: Literal["hr", "power", "cadence"]
    value: float = Field(ge=0, le=3000)

    @field_validator("ts")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("timestamp must include a timezone offset")
        return v


class TelemetrySummaryOut(BaseModel):
    day: date
    hr_samples: int
    avg_hr: float | None
    max_hr: float | None
    hr_max: int | None
    minutes_by_zone: dict[int, float]
    kcal: float | None
    avg_power_w: float | None
    max_power_w: float | None


class WakeIn(BaseModel):
    woke_at: datetime


class EarlyBirdOut(BaseModel):
    day: date
    enabled: bool
    wake_time: str
    status: str
    woke_at: datetime | None
    window_ends_at: datetime | None
    minutes_in_zone: float
    required_minutes: int
    zone_bpm: tuple[int, int] | None
    avg_hr: float | None
    streak: int
