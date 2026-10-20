from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Body, HTTPException
from sqlalchemy import select

from .. import early_bird
from ..db import EarlyBirdRun, TelemetrySample, insert_new
from ..energy import summarize_hr
from .deps import AthleteDep, Db
from .schemas import Day, EarlyBirdOut, SampleIn, SyncResult, TelemetrySummaryOut, WakeIn
from .services import age, athlete_hr_max, hr_kcal, local_day_bounds, local_today, samples, samples_in_windows

router = APIRouter(tags=["telemetry"])

MAX_BATCH = 5000


def _utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc)


@router.post("/athletes/{athlete_id}/telemetry", response_model=SyncResult)
def post_telemetry(body: Annotated[list[SampleIn], Body(max_length=MAX_BATCH)], a: AthleteDep, s: Db) -> SyncResult:
    # Dedupe on the primary key (athlete, kind, ts) so retried uploads are harmless: in the batch
    # here (millisecond precision, last value wins), against stored rows with ON CONFLICT DO NOTHING.
    keys = {(x.kind, _utc(x.ts).replace(microsecond=_utc(x.ts).microsecond // 1000 * 1000)): x.value for x in body}
    rows = [{"athlete_id": a.id, "kind": kind, "ts": ts, "value": v} for (kind, ts), v in keys.items()]
    accepted = insert_new(s, TelemetrySample, rows)
    s.commit()
    return SyncResult(accepted=accepted, duplicates=len(body) - accepted)


@router.get("/athletes/{athlete_id}/telemetry/{day}/summary", response_model=TelemetrySummaryOut)
def telemetry_summary(day: Day, a: AthleteDep, s: Db) -> TelemetrySummaryOut:
    start, end = local_day_bounds(a, day)
    hrmax = athlete_hr_max(a)
    hr_samples = samples(s, a, "hr", start, end)
    hr = summarize_hr(hr_samples, hrmax=hrmax, weight_kg=a.bodyweight_kg, age=age(a, day), sex=a.sex)
    power = [p.value for p in samples(s, a, "power", start, end)]
    return TelemetrySummaryOut(
        day=day,
        hr_samples=hr.samples,
        avg_hr=hr.avg_hr,
        max_hr=hr.max_hr,
        hr_max=hrmax,
        minutes_by_zone=hr.minutes_by_zone,
        kcal=hr_kcal(s, a, day, hr_samples),
        avg_power_w=round(sum(power) / len(power), 1) if power else None,
        max_power_w=max(power) if power else None,
    )


def _early_bird(s: Db, a, day: date) -> EarlyBirdOut:
    run = s.get(EarlyBirdRun, (a.id, day))
    woke = None
    if run is not None:
        woke = run.woke_at if run.woke_at.tzinfo else run.woke_at.replace(tzinfo=timezone.utc)
    hr = []
    if woke is not None:
        hr = samples(s, a, "hr", woke, woke + timedelta(minutes=early_bird.WINDOW_MIN, seconds=1))
    now = datetime.now(timezone.utc)
    hrmax = athlete_hr_max(a)
    result = early_bird.evaluate(woke, hr, hrmax, now)

    # Streak over the last 60 days of check-ins (all their HR windows in one query).
    runs = list(s.scalars(select(EarlyBirdRun).where(EarlyBirdRun.athlete_id == a.id,
                                                       EarlyBirdRun.day >= day - timedelta(days=60),
                                                       EarlyBirdRun.day <= day)))
    wakes = [r.woke_at if r.woke_at.tzinfo else r.woke_at.replace(tzinfo=timezone.utc) for r in runs]
    windows = [(w, w + timedelta(minutes=early_bird.WINDOW_MIN, seconds=1)) for w in wakes]
    completed = {
        r.day
        for r, w, r_hr in zip(runs, wakes, samples_in_windows(s, a, "hr", windows))
        if early_bird.evaluate(w, r_hr, hrmax, now).status == "complete"
    }

    return EarlyBirdOut(
        day=day,
        enabled=a.early_bird_enabled,
        wake_time=a.wake_time,
        status=result.status,
        woke_at=result.woke_at,
        window_ends_at=result.window_ends_at,
        minutes_in_zone=result.minutes_in_zone,
        required_minutes=result.required_minutes,
        zone_bpm=result.zone_bpm,
        avg_hr=result.avg_hr,
        streak=early_bird.streak(completed, day, today_open=result.status == "in_window" or (
            result.status == "not_started" and day >= local_today(a))),
    )


@router.get("/athletes/{athlete_id}/early-bird/{day}", response_model=EarlyBirdOut)
def get_early_bird(day: Day, a: AthleteDep, s: Db) -> EarlyBirdOut:
    return _early_bird(s, a, day)


@router.put("/athletes/{athlete_id}/early-bird/{day}/wake", response_model=EarlyBirdOut)
def wake(day: Day, body: WakeIn, a: AthleteDep, s: Db) -> EarlyBirdOut:
    if body.woke_at.tzinfo is None:
        raise HTTPException(422, "woke_at must include a timezone offset")
    start, end = local_day_bounds(a, day)
    woke = _utc(body.woke_at)
    if not start <= woke < end:
        raise HTTPException(422, "woke_at is not within that local day")
    run = s.get(EarlyBirdRun, (a.id, day))
    if run is None:  # the first check-in of the day is the one that counts
        s.add(EarlyBirdRun(athlete_id=a.id, day=day, woke_at=woke))
        s.commit()
    return _early_bird(s, a, day)
