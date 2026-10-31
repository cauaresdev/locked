"""Domain operations shared by several routers."""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session as DbSession

from .. import early_bird, readiness, routine
from ..db import Athlete, EarlyBirdRun, ReadinessEntry, SetLog, TelemetrySample, athlete_records
from ..domain import MACHINE_STATIONS, BlockKind, Implement, Pattern, ReadinessSummary, Session, Tier
from ..energy import SESSION_MET, STRENGTH_MET, Sample, hr_max, met_kcal, summarize_hr
from ..generator import CyclePosition, before_start_session, generate_session, locate
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


def athlete_equipment(a: Athlete) -> frozenset[Implement] | None:
    if a.equipment is None:
        return None
    return normalize_equipment(Implement(x) for x in a.equipment.split(",") if x)


def normalize_equipment(items: Iterable[Implement]) -> frozenset[Implement]:
    """Profiles saved before machines were listed per station said just "machine": every station."""
    gear = set(items)
    if Implement.MACHINE in gear:
        gear = (gear - {Implement.MACHINE}) | MACHINE_STATIONS
    return frozenset(gear)


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
        equipment=sorted(athlete_equipment(a) or set(Implement) - {Implement.MACHINE}),
        health_consent_at=a.health_consent_at,
        sleep_target_hours=a.sleep_target_hours,
        nutrition_goal=a.nutrition_goal,  # type: ignore[arg-type]
        routine_items=sorted(routine.enabled_items(a.routine_items)),
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


def readiness_history(s: DbSession, a: Athlete, first: date, last: date) -> dict[date, ReadinessEntry]:
    """Entries a run of readiness_for calls over [first, last] needs, HRV baseline included."""
    lo = first - timedelta(days=readiness.HRV_HISTORY_DAYS)
    rows = s.scalars(select(ReadinessEntry).where(
        ReadinessEntry.athlete_id == a.id, ReadinessEntry.day > lo, ReadinessEntry.day <= last))
    return {e.day: e for e in rows}


def readiness_for(
    s: DbSession, a: Athlete, day: date, all_records: Sequence[SetRecord] | None = None,
    history: Mapping[date, ReadinessEntry] | None = None,
) -> ReadinessSummary | None:
    """`history`: preloaded entries (readiness_history) when scoring many days, so each day costs no query."""
    entry = s.get(ReadinessEntry, (a.id, day)) if history is None else history.get(day)
    since = day - timedelta(days=readiness.ACWR_CHRONIC_DAYS)
    if all_records is None:
        records = athlete_records(s, a.id, since=since)
        first_day = s.scalar(select(func.min(SetLog.performed_on)).where(SetLog.athlete_id == a.id))
    else:
        records = [r for r in all_records if r.performed_on >= since]
        first_day = min((r.performed_on for r in all_records), default=None)
    if entry is None and not records:
        return None
    lumbar, shoulder = readiness.acwr(readiness.joint_stress(records, a.bodyweight_kg), day, first_day)
    hrv = None
    if entry is not None and entry.hrv_ms is not None and history is not None:
        lo = day - timedelta(days=readiness.HRV_HISTORY_DAYS)
        series = {d: e.hrv_ms for d, e in history.items()
                  if lo < d <= day and e.hrv_method == entry.hrv_method and e.hrv_ms is not None}
        hrv = readiness.hrv_signal(series, day)
    elif entry is not None and entry.hrv_ms is not None:
        series = dict(s.execute(
            select(ReadinessEntry.day, ReadinessEntry.hrv_ms).where(
                ReadinessEntry.athlete_id == a.id,
                ReadinessEntry.day <= day,
                ReadinessEntry.day > day - timedelta(days=readiness.HRV_HISTORY_DAYS),
                ReadinessEntry.hrv_method == entry.hrv_method,  # SDNN and RMSSD are not comparable
                ReadinessEntry.hrv_ms.is_not(None),
            )
        ).all())
        hrv = readiness.hrv_signal(series, day)
    return readiness.score(readiness.ReadinessInputs(
        hrv=hrv,
        sleep_hours=entry.sleep_hours if entry else None,
        soreness=entry.soreness if entry else None,
        lumbar_acwr=lumbar,
        shoulder_acwr=shoulder,
    ))


LOW_READINESS_STREAK_DAYS = 3


def low_readiness_streak(s: DbSession, a: Athlete, day: date, today: ReadinessSummary | None,
                         records: Sequence[SetRecord]) -> bool:
    """Deload week triggered by readiness: 3 red days in a row ending within the last cycle.

    The deload lasts one full cycle from the day the streak closes. It is derived
    from the stored readiness history, so nothing extra is persisted.
    """
    cycle_len = TIERS[Tier(a.tier)].cycle_length
    first = day - timedelta(days=cycle_len + LOW_READINESS_STREAK_DAYS - 2)
    history = readiness_history(s, a, first, day)
    run = 0
    for i in range((day - first).days + 1):
        d = first + timedelta(days=i)
        r = (today if d == day else readiness_for(s, a, d, records, history)) if d in history else None
        run = run + 1 if r is not None and r.level == "red" else 0
        if run >= LOW_READINESS_STREAK_DAYS:
            return True
    return False


def plan_context(s: DbSession, a: Athlete, day: date, with_readiness: bool,
                 records: Sequence[SetRecord] | None = None) -> dict:
    """Everything generate_session / alternatives need besides the tier and position."""
    records = athlete_records(s, a.id) if records is None else records
    ready = readiness_for(s, a, day, records) if with_readiness else None
    return dict(
        readiness=ready,
        history=[r for r in records if r.performed_on < day],
        bodyweight_kg=a.bodyweight_kg,
        low_readiness_streak=with_readiness and low_readiness_streak(s, a, day, ready, records),
        equipment=athlete_equipment(a),
    )


MAX_PLAN_DAYS = 10 * 366  # sessions are generated by walking every cycle since the start


def position(a: Athlete, day: date) -> CyclePosition:
    if (day - a.cycle_start).days > MAX_PLAN_DAYS:
        raise HTTPException(422, "date is too far after the program start")
    try:
        return locate(a.cycle_start, day, TIERS[Tier(a.tier)].cycle_length)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


def session_for(
    s: DbSession, a: Athlete, day: date, with_readiness: bool, records: Sequence[SetRecord] | None = None
) -> Session:
    """`records`: the athlete's set history, when the caller already loaded it (or [] to skip loads)."""
    if day < a.cycle_start and TIERS[Tier(a.tier)].weekly:  # waiting for the program's first Monday
        return before_start_session(Tier(a.tier), a.cycle_start)
    return generate_session(
        Tier(a.tier),
        position(a, day),
        a.chaos_seed,
        weeks_in_tier=(day - a.cycle_start).days // 7,
        **plan_context(s, a, day, with_readiness, records),
    )


STRENGTH_WINDOW_PAD = timedelta(minutes=2)


# (exercise_id, performed_at) of every set logged on one day.
DaySets = Sequence[tuple[str, datetime | None]]


def day_sets(s: DbSession, a: Athlete, first: date, last: date) -> dict[date, list[tuple[str, datetime | None]]]:
    """The sets of each day in [first, last], for callers that need many days (one query)."""
    out: dict[date, list[tuple[str, datetime | None]]] = {}
    for d, ex, at in s.execute(select(SetLog.performed_on, SetLog.exercise_id, SetLog.performed_at).where(
            SetLog.athlete_id == a.id, SetLog.performed_on >= first, SetLog.performed_on <= last)):
        out.setdefault(d, []).append((ex, at))
    return out


def strength_window(
    s: DbSession, a: Athlete, plan: Session, day: date, sets: DaySets | None = None
) -> tuple[datetime, datetime] | None:
    """From the first to the last logged set of the day's strength block (device timestamps)."""
    ids = {rx.exercise_id for b in plan.blocks if b.kind == BlockKind.STRENGTH for rx in b.exercises}
    if not ids:
        return None
    if sets is None:
        sets = day_sets(s, a, day, day).get(day, [])
    stamps = [t if t.tzinfo else t.replace(tzinfo=timezone.utc) for ex, t in sets if ex in ids and t is not None]
    if not stamps:
        return None
    return min(stamps) - STRENGTH_WINDOW_PAD, max(stamps) + STRENGTH_WINDOW_PAD


def hr_kcal(
    s: DbSession, a: Athlete, day: date, hr: list[Sample], plan: Session | None = None, sets: DaySets | None = None
) -> float | None:
    """Training kcal from heart rate: net Keytel outside the strength block, net MET inside it.

    Both exclude resting energy, which the nutrition floor (12 kcal/lb LBM) already covers.

    None when the athlete's age or sex is unknown (Keytel needs both).
    """
    def keytel(xs: list[Sample]) -> float | None:
        return summarize_hr(xs, hrmax=athlete_hr_max(a), weight_kg=a.bodyweight_kg, age=age(a, day), sex=a.sex).kcal

    if not hr:
        return None
    if plan is None and day >= a.cycle_start:
        plan = session_for(s, a, day, with_readiness=False, records=[])
    window = strength_window(s, a, plan, day, sets) if plan is not None else None
    if window is None:
        return keytel(hr)
    lo, hi = window
    outside = [x for x in hr if not lo <= x.ts <= hi]
    aerobic = keytel(outside) if outside else 0.0
    if aerobic is None:
        return None
    return round(aerobic + met_kcal(STRENGTH_MET, a.bodyweight_kg, (hi - lo).total_seconds() / 60))


def session_energy(s: DbSession, a: Athlete, day: date, sets: DaySets | None = None) -> tuple[float, str, bool]:
    """(kcal, source, is_training_day) for the day's training energy expenditure.

    `sets`: the day's logged sets when the caller preloaded them (day_sets).
    """
    if day < a.cycle_start:
        return 0.0, "none", False
    plan = session_for(s, a, day, with_readiness=False, records=[])  # only the plan's shape is needed
    if sets is None:
        sets = day_sets(s, a, day, day).get(day, [])
    start, end = local_day_bounds(a, day)
    kcal = hr_kcal(s, a, day, samples(s, a, "hr", start, end), plan, sets)
    if kcal is not None:
        return float(kcal), "telemetry", plan.is_training_day
    if plan.is_training_day or sets:
        minutes = plan.target_duration_minutes if plan.is_training_day else 60
        return float(met_kcal(SESSION_MET, a.bodyweight_kg, minutes)), "estimate", plan.is_training_day
    return 0.0, "none", False


def reject_foreign_ids(s: DbSession, model, ids: list[str], a: Athlete) -> None:
    """422 when a client id already belongs to another athlete.

    Counting it as a duplicate would silently drop the upload (and confirm the id exists);
    a 422 makes the app's outbox isolate the item into its rejected list instead.
    """
    if ids and s.scalar(select(model.id).where(model.id.in_(ids), model.athlete_id != a.id).limit(1)):
        raise HTTPException(422, "id already in use; generate a new one")


def early_bird_runs(s: DbSession, a: Athlete, first: date, last: date) -> dict[date, datetime]:
    """Wake check-ins per day (UTC-aware)."""
    rows = s.scalars(select(EarlyBirdRun).where(EarlyBirdRun.athlete_id == a.id, EarlyBirdRun.day >= first,
                                                EarlyBirdRun.day <= last))
    return {r.day: r.woke_at if r.woke_at.tzinfo else r.woke_at.replace(tzinfo=timezone.utc) for r in rows}


def early_bird_completed(s: DbSession, a: Athlete, first: date, last: date,
                         runs: Mapping[date, datetime] | None = None) -> set[date]:
    """Days in [first, last] whose Early Bird window reached the minutes in zone (all HR windows in one query)."""
    runs = early_bird_runs(s, a, first, last) if runs is None else runs
    days = list(runs)
    windows = [(runs[d], runs[d] + timedelta(minutes=early_bird.WINDOW_MIN, seconds=1)) for d in days]
    hrmax, now = athlete_hr_max(a), datetime.now(timezone.utc)
    return {d for d, hr in zip(days, samples_in_windows(s, a, "hr", windows))
            if early_bird.evaluate(runs[d], hr, hrmax, now).status == "complete"}


LOWER_OR_POWER = {Pattern.SQUAT, Pattern.HINGE, Pattern.LUNGE, Pattern.KNEE_EXTENSION, Pattern.KNEE_FLEXION,
                  Pattern.SPRINT}


def day_profile(s: DbSession, a: Athlete, day: date) -> tuple[str, bool]:
    """(carb-cycling day kind, has jumps or sprints) from the day's planned session.

    Legs, max strength and sprints burn the most glycogen ("high"); upper-body days are "medium";
    rest and active-recovery days are "rest".
    """
    if day < a.cycle_start:
        return "rest", False
    session = session_for(s, a, day, with_readiness=False, records=[])
    if not session.is_training_day:
        return "rest", False
    work = [rx for b in session.blocks if b.kind != BlockKind.PREP for rx in b.exercises]
    power = any(b.name == "Potência" for b in session.blocks) or any(rx.pattern == Pattern.SPRINT for rx in work)
    heavy = power or any(rx.pattern in LOWER_OR_POWER for rx in work)
    return ("high" if heavy else "medium"), power
