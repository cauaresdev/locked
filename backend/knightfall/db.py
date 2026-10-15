"""Persistence (SQLAlchemy 2.0).

SQLite by default for local dev/tests; set KNIGHTFALL_DATABASE_URL to a
PostgreSQL URL (postgresql+psycopg://...) in production. Schema changes go
through Alembic (knightfall/migrations); the app upgrades to head on startup.
Client-generated UUIDs on logs/food entries make offline retries idempotent.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    create_engine,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .records import SetRecord

DEFAULT_URL = "sqlite:///./knightfall.db"
MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuthToken(Base):
    __tablename__ = "auth_tokens"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256 hex; raw token never stored
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Athlete(Base):
    __tablename__ = "athletes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    tier: Mapped[str] = mapped_column(String(32))
    cycle_start: Mapped[date] = mapped_column(Date)
    chaos_seed: Mapped[str] = mapped_column(String(64))
    bodyweight_kg: Mapped[float] = mapped_column(Float)
    body_fat_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sex: Mapped[str | None] = mapped_column(String(8), nullable=True)  # "male" | "female"
    hr_max_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    early_bird_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    wake_time: Mapped[str] = mapped_column(String(5), default="04:00")  # HH:MM local
    waiver_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SetLog(Base):
    __tablename__ = "set_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # client-generated UUID
    athlete_id: Mapped[str] = mapped_column(ForeignKey("athletes.id", ondelete="CASCADE"), index=True)
    performed_on: Mapped[date] = mapped_column(Date, index=True)
    exercise_id: Mapped[str] = mapped_column(String(64))
    set_index: Mapped[int] = mapped_column(Integer)
    reps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    load_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    rpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def to_record(self) -> SetRecord:
        return SetRecord(
            performed_on=self.performed_on,
            exercise_id=self.exercise_id,
            reps=self.reps,
            load_kg=self.load_kg,
            duration_seconds=self.duration_seconds,
            distance_m=self.distance_m,
            rpe=self.rpe,
        )


class ReadinessEntry(Base):
    __tablename__ = "readiness_entries"

    athlete_id: Mapped[str] = mapped_column(ForeignKey("athletes.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    hrv_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Apple Health reports SDNN, Health Connect/most straps RMSSD: baselines only compare like with like.
    hrv_method: Mapped[str] = mapped_column(String(8), default="rmssd")
    resting_hr: Mapped[float | None] = mapped_column(Float, nullable=True)
    sleep_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    soreness: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="manual")


class TelemetrySample(Base):
    """Heart rate / power / cadence samples. A TimescaleDB hypertable on Postgres."""

    __tablename__ = "telemetry_samples"

    athlete_id: Mapped[str] = mapped_column(ForeignKey("athletes.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)  # "hr" | "power" | "cadence"
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    value: Mapped[float] = mapped_column(Float)


class FoodProduct(Base):
    """Barcode lookup cache (Open Food Facts), nutrients per 100 g."""

    __tablename__ = "food_products"

    barcode: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    brand: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kcal_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_mg_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    serving_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    dairy: Mapped[str] = mapped_column(String(16))  # see nutrition.Dairy
    dairy_evidence: Mapped[str] = mapped_column(String(500), default="")
    found: Mapped[bool] = mapped_column(Boolean, default=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FoodEntry(Base):
    __tablename__ = "food_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # client-generated UUID
    athlete_id: Mapped[str] = mapped_column(ForeignKey("athletes.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    meal: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(255))
    barcode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    grams: Mapped[float] = mapped_column(Float)
    kcal: Mapped[float] = mapped_column(Float)
    protein_g: Mapped[float] = mapped_column(Float)
    carbs_g: Mapped[float] = mapped_column(Float)
    fat_g: Mapped[float] = mapped_column(Float)
    sodium_mg: Mapped[float] = mapped_column(Float)
    dairy: Mapped[str] = mapped_column(String(16), default="none")
    category: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SupplementIntake(Base):
    __tablename__ = "supplement_intakes"

    athlete_id: Mapped[str] = mapped_column(ForeignKey("athletes.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    item_id: Mapped[str] = mapped_column(String(48), primary_key=True)  # e.g. "flaxseed_oil:breakfast"


class EarlyBirdRun(Base):
    __tablename__ = "early_bird_runs"

    athlete_id: Mapped[str] = mapped_column(ForeignKey("athletes.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    woke_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Database:
    def __init__(self, url: str | None = None) -> None:
        self.url = url or os.environ.get("KNIGHTFALL_DATABASE_URL", DEFAULT_URL)
        kwargs = {"connect_args": {"check_same_thread": False}} if self.url.startswith("sqlite") else {}
        self.engine = create_engine(self.url, **kwargs)
        self._sessions = sessionmaker(self.engine, expire_on_commit=False)

    def migrate(self) -> None:
        """Upgrade the schema to the latest Alembic revision."""
        from alembic import command
        from alembic.config import Config

        cfg = Config()
        cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
        with self.engine.begin() as conn:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, "head")

    def session(self) -> Iterator[Session]:
        with self._sessions() as s:
            yield s


def athlete_records(s: Session, athlete_id: str, since: date | None = None) -> list[SetRecord]:
    q = select(SetLog).where(SetLog.athlete_id == athlete_id)
    if since is not None:
        q = q.where(SetLog.performed_on >= since)
    return [row.to_record() for row in s.scalars(q)]
