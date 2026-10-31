"""Body weight and the progress dashboard (strength, readiness, armor load, diet, attendance)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from .. import armor, volume
from .. import weight as wt
from ..db import Athlete, BodyMeasurement, FoodEntry, WeighIn, athlete_records
from ..domain import Tier
from ..tiers import TIERS
from .deps import AthleteDep, Db
from .routes_nutrition import day_targets
from .routes_training import get_strength
from .schemas import (
    MEASUREMENT_SITES,
    ArmorCycleOut,
    AttendanceDayOut,
    DietDayOut,
    MeasurementsIn,
    MeasurementSiteOut,
    MeasurementsOut,
    MuscleVolumeOut,
    ProgressOut,
    ReadinessDayOut,
    WeighInIn,
    WeightOut,
    WeightPointOut,
)
from .services import day_sets, local_today, readiness_for, readiness_history, session_energy, session_for

router = APIRouter(tags=["progress"])

MAX_DAYS = 180


def _weights(s: Db, a: Athlete, since: date | None = None) -> dict[date, float]:
    q = select(WeighIn.day, WeighIn.weight_kg).where(WeighIn.athlete_id == a.id)
    if since is not None:
        q = q.where(WeighIn.day >= since)
    return dict(s.execute(q).all())


def _weight_out(s: Db, a: Athlete, days: int) -> WeightOut:
    since = local_today(a) - timedelta(days=days)
    weights = _weights(s, a, since - timedelta(days=wt.TREND_DAYS))  # earlier readings feed the first trends
    points = [WeightPointOut(day=d, weight_kg=w, trend_kg=t) for d, w, t in wt.series(weights) if d >= since]
    return WeightOut(entries=points, trend_kg=points[-1].trend_kg if points else None,
                     profile_weight_kg=a.bodyweight_kg)


@router.put("/athletes/{athlete_id}/weight", response_model=WeightOut)
def put_weight(body: WeighInIn, a: AthleteDep, s: Db) -> WeightOut:
    """Record a weigh-in. The 7-day trend becomes the body weight every target is computed from."""
    row = s.get(WeighIn, (a.id, body.day)) or WeighIn(athlete_id=a.id, day=body.day)
    row.weight_kg, row.source = body.weight_kg, body.source
    s.add(row)
    s.flush()
    latest = s.scalar(select(func.max(WeighIn.day)).where(WeighIn.athlete_id == a.id))
    weights = _weights(s, a, latest - timedelta(days=wt.TREND_DAYS))  # only the trend window is needed
    if (t := wt.trend(weights, latest)) is not None:
        a.bodyweight_kg = t
    s.commit()
    return _weight_out(s, a, 90)


@router.get("/athletes/{athlete_id}/weight", response_model=WeightOut)
def get_weight(a: AthleteDep, s: Db, days: Annotated[int, Query(ge=1, le=MAX_DAYS)] = 90) -> WeightOut:
    return _weight_out(s, a, days)


@router.get("/athletes/{athlete_id}/progress", response_model=ProgressOut)
def get_progress(a: AthleteDep, s: Db, days: Annotated[int, Query(ge=7, le=MAX_DAYS)] = 60) -> ProgressOut:
    today = local_today(a)
    since = today - timedelta(days=days - 1)
    records = athlete_records(s, a.id)

    # Everything per-day below comes from these preloads, not from one query per day.
    history = readiness_history(s, a, since, today)
    sets_by_day = day_sets(s, a, since, today)

    readiness_days = []
    for e in sorted((e for d, e in history.items() if d >= since), key=lambda e: e.day):
        r = readiness_for(s, a, e.day, records, history)
        readiness_days.append(ReadinessDayOut(
            day=e.day, score=r.score if r else None, level=r.level if r else None, hrv_ms=e.hrv_ms,
            hrv_method=e.hrv_method, resting_hr=e.resting_hr, sleep_hours=e.sleep_hours, soreness=e.soreness))

    # Armor load per cycle, for the cycles that overlap the window.
    cycle_len = TIERS[Tier(a.tier)].cycle_length
    cycles = []
    if today >= a.cycle_start:
        first = max(0, (since - a.cycle_start).days // cycle_len) if since > a.cycle_start else 0
        last = (today - a.cycle_start).days // cycle_len
        for k in range(first, last + 1):
            start = a.cycle_start + timedelta(days=k * cycle_len)
            end = start + timedelta(days=cycle_len)
            load = armor.armor_load((r for r in records if start <= r.performed_on < end), a.bodyweight_kg)
            cycles.append(ArmorCycleOut(cycle_index=k, start=start, kg_m=load.total_kg_m))

    # Diet adherence on days with food logged.
    diet = []
    food_days: dict[date, list[FoodEntry]] = {}
    for f in s.scalars(select(FoodEntry).where(FoodEntry.athlete_id == a.id, FoodEntry.day >= since,
                                               FoodEntry.day <= today)):
        food_days.setdefault(f.day, []).append(f)
    for d, rows in sorted(food_days.items()):
        target = day_targets(s, a, d, session_energy(s, a, d, sets_by_day.get(d, []))[0])[0].total
        diet.append(DietDayOut(day=d, kcal=round(sum(r.kcal for r in rows)), kcal_target=target.kcal,
                               protein_g=round(sum(r.protein_g for r in rows)), protein_target_g=target.protein_g))

    # Attendance: planned training days vs. days with sets logged.
    trained = set(sets_by_day)
    attendance = []
    d = max(since, a.cycle_start)
    while d <= today:
        planned = session_for(s, a, d, with_readiness=False, records=[]).is_training_day
        attendance.append(AttendanceDayOut(day=d, planned=planned, trained=d in trained))
        d += timedelta(days=1)

    this_week, last_week = volume.weekly_sets(records, today)
    targets = TIERS[Tier(a.tier)].volume_targets  # the program's own bands; the rest use the default
    return ProgressOut(
        days=days,
        strength=get_strength(a, s),
        muscle_volume=[MuscleVolumeOut(muscle=m, label=volume.MUSCLE_LABEL[m], sets=this_week[m],
                                       previous_sets=last_week[m],
                                       target_min=targets.get(m, volume.TARGET_SETS)[0],
                                       target_max=targets.get(m, volume.TARGET_SETS)[1]) for m in volume.MUSCLES],
        weight=_weight_out(s, a, days),
        readiness=readiness_days,
        armor_cycles=cycles,
        diet=diet,
        attendance=attendance,
    )


MAX_MEASUREMENT_DAYS = 3 * 366


def _measurements(s: Db, a: Athlete, days: int) -> MeasurementsOut:
    since = local_today(a) - timedelta(days=days)
    by_site: dict[str, list[tuple[date, float]]] = {}
    for m in s.scalars(select(BodyMeasurement).where(BodyMeasurement.athlete_id == a.id, BodyMeasurement.day >= since)
                       .order_by(BodyMeasurement.day)):
        by_site.setdefault(m.site, []).append((m.day, m.cm))
    out = []
    for site, label in MEASUREMENT_SITES.items():
        h = by_site.get(site, [])
        out.append(MeasurementSiteOut(
            site=site, label=label, latest_cm=h[-1][1] if h else None, latest_day=h[-1][0] if h else None,
            change_cm=round(h[-1][1] - h[0][1], 1) if len(h) > 1 else None, history=h))
    return MeasurementsOut(sites=out)


@router.get("/athletes/{athlete_id}/measurements", response_model=MeasurementsOut)
def get_measurements(a: AthleteDep, s: Db,
                     days: Annotated[int, Query(ge=7, le=MAX_MEASUREMENT_DAYS)] = 365) -> MeasurementsOut:
    return _measurements(s, a, days)


@router.put("/athletes/{athlete_id}/measurements", response_model=MeasurementsOut)
def put_measurements(body: MeasurementsIn, a: AthleteDep, s: Db) -> MeasurementsOut:
    for site, cm in body.values.items():
        row = s.get(BodyMeasurement, (a.id, body.day, site))
        if cm is None:
            if row is not None:
                s.delete(row)
        elif row is None:
            s.add(BodyMeasurement(athlete_id=a.id, day=body.day, site=site, cm=cm))
        else:
            row.cm = cm
    s.commit()
    return _measurements(s, a, 365)
