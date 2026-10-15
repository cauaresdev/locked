"""Domain operations shared by several routers."""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections.abc import Sequence
from datetime import date, datetime, time, timedelta, timezone
from statistics import mean
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session as DbSession

from .. import readiness
from ..db import Athlete, ReadinessEntry, SetLog, TelemetrySample, athlete_records
from ..domain import ReadinessSummary, Session, Tier
from ..energy import SESSION_MET, Sample, hr_max, met_kcal, summarize_hr
from ..generator import generate_session, locate
from ..records import SetRecord
from ..tiers import TIERS
from .schemas import AthleteOut


def local_today(a: Athlete) -> date:
    """The athlete's calendar day, which is what sessions and logs are keyed by (not the server's)."""
    return datetime.now(ZoneInfo(a.timezone)).date()


def age(a: Athlete, on: date | None = None) -> int | None:
    return (on or local_today(a)).year - a.birth_year if a.birth_year else None


def athlete_hr_max(a: Athlete) -> int | None:
    return hr_max(age(a), a.hr_max_override)


def athlete_out(a: Athlete) -> AthleteOut:
    cfg = TIERS[Tier(a.tier)]
    return AthleteOut(
        id=a.id,
        name=a.name,
        tier=cfg.tier,
        cycle_start=a.cycle_start,
        bodyweight_kg=a.bodyweight_kg,
        body_fat_pct=a.body_fat_pct,
        height_cm=a.height_cm,
        birth_year=a.birth_year,
        sex=a.sex,  # type: ignore[arg-type]
        hr_max_override=a.hr_max_override,
        hr_max=athlete_hr_max(a),
        timezone=a.timezone,
        early_bird_enabled=a.early_bird_enabled,
        wake_time=a.wake_time,
        waiver_accepted_at=a.waiver_accepted_at,
        cycle_length=cfg.cycle_length,
        cycle_structure=cfg.cycle_structure,
    )


def require_waiver(tier: Tier, accepted_now: bool, already: datetime | None) -> datetime | None:
    if not TIERS[tier].requires_waiver or already is not None:
        return already
    if not accepted_now:
        raise HTTPException(422, "O tier Brawler exige aceite do termo de responsabilidade.")
    return datetime.now(timezone.utc)


def local_day_bounds(a: Athlete, day: date) -> tuple[datetime, datetime]:
    tz = ZoneInfo(a.timezone)
    start = datetime.combine(day, time.min, tz)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def samples(s: DbSession, a: Athlete, kind: str, start: datetime, end: datetime) -> list[Sample]:
    rows = s.execute(
        select(TelemetrySample.ts, TelemetrySample.value)
        .where(TelemetrySample.athlete_id == a.id, TelemetrySample.kind == kind,
               TelemetrySample.ts >= start, TelemetrySample.ts < end)
        .order_by(TelemetrySample.ts)
    ).all()
    # SQLite returns naive datetimes; everything is stored in UTC.
    return [Sample(ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc), v) for ts, v in rows]


def samples_in_windows(
    s: DbSession, a: Athlete, kind: str, windows: Sequence[tuple[datetime, datetime]]
) -> list[list[Sample]]:
    """Samples inside each [start, end] window, fetched with a single query."""
    if not windows:
        return []
    rows = s.execute(
        select(TelemetrySample.ts, TelemetrySample.value)
        .where(TelemetrySample.athlete_id == a.id, TelemetrySample.kind == kind,
               or_(*(and_(TelemetrySample.ts >= lo, TelemetrySample.ts <= hi) for lo, hi in windows)))
        .order_by(TelemetrySample.ts)
    ).all()
    found = [Sample(ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc), v) for ts, v in rows]
    stamps = [x.ts for x in found]
    return [found[bisect_left(stamps, lo):bisect_right(stamps, hi)] for lo, hi in windows]


def readiness_for(
    s: DbSession, a: Athlete, day: date, all_records: Sequence[SetRecord] | None = None
) -> ReadinessSummary | None:
    entry = s.get(ReadinessEntry, (a.id, day))
    since = day - timedelta(days=28)
    records = (athlete_records(s, a.id, since=since) if all_records is None
               else [r for r in all_records if r.performed_on >= since])
    if entry is None and not records:
        return None
    lumbar, shoulder = readiness.acwr(readiness.joint_stress(records, a.bodyweight_kg), day)
    baseline: list[float] = []
    if entry is not None and entry.hrv_ms is not None:
        baseline = list(s.scalars(
            select(ReadinessEntry.hrv_ms).where(
                ReadinessEntry.athlete_id == a.id,
                ReadinessEntry.day < day,
                ReadinessEntry.day >= day - timedelta(days=7),
                ReadinessEntry.hrv_method == entry.hrv_method,
                ReadinessEntry.hrv_ms.is_not(None),
            )
        ))
    return readiness.score(readiness.ReadinessInputs(
        hrv_rmssd=entry.hrv_ms if entry else None,
        hrv_baseline=mean(baseline) if baseline else None,
        sleep_hours=entry.sleep_hours if entry else None,
        soreness=entry.soreness if entry else None,
        lumbar_acwr=lumbar,
        shoulder_acwr=shoulder,
    ))


def session_for(
    s: DbSession, a: Athlete, day: date, with_readiness: bool, records: Sequence[SetRecord] | None = None
) -> Session:
    """`records`: the athlete's set history, when the caller already loaded it (or [] to skip loads)."""
    tier = Tier(a.tier)
    try:
        pos = locate(a.cycle_start, day, TIERS[tier].cycle_length)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    records = athlete_records(s, a.id) if records is None else records
    history = [r for r in records if r.performed_on < day]
    return generate_session(
        tier,
        pos,
        a.chaos_seed,
        readiness=readiness_for(s, a, day, records) if with_readiness else None,
        history=history,
        weeks_in_tier=(day - a.cycle_start).days // 7,
        bodyweight_kg=a.bodyweight_kg,
    )


def session_energy(s: DbSession, a: Athlete, day: date) -> tuple[float, str, bool]:
    """(kcal, source, is_training_day) for the day's training energy expenditure."""
    if day < a.cycle_start:
        return 0.0, "none", False
    plan = session_for(s, a, day, with_readiness=False, records=[])  # only the plan's shape is needed
    start, end = local_day_bounds(a, day)
    hr = samples(s, a, "hr", start, end)
    if hr:
        summary = summarize_hr(hr, hrmax=athlete_hr_max(a), weight_kg=a.bodyweight_kg, age=age(a, day), sex=a.sex)
        if summary.kcal is not None:
            return float(summary.kcal), "telemetry", plan.is_training_day
    trained = s.scalar(select(SetLog.id).where(SetLog.athlete_id == a.id, SetLog.performed_on == day).limit(1))
    if plan.is_training_day or trained:
        minutes = plan.target_duration_minutes if plan.is_training_day else 60
        return float(met_kcal(SESSION_MET, a.bodyweight_kg, minutes)), "estimate", plan.is_training_day
    return 0.0, "none", False
