"""Batfleck routine: the day's habits, ticked by hand or by the app's own data."""

from __future__ import annotations

from datetime import date, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from .. import nutrition as nu
from .. import routine
from ..db import Athlete, ReadinessEntry, RoutineCheck, SetLog, SupplementIntake
from ..domain import Tier
from ..generator import locate
from ..tiers import REST_DAY, TIERS
from .deps import AthleteDep, Db
from .schemas import Day, RoutineCheckIn, RoutineDayOut, RoutineItemOut, RoutineOptionOut, RoutineOut
from .services import day_profile, early_bird_completed, early_bird_runs, local_today

router = APIRouter(tags=["routine"])

HISTORY_DAYS = 60  # streaks look this far back
EDITABLE_DAYS = 7  # yesterday's water can still be fixed; last month's cannot


def day_type(a: Athlete, day: date) -> routine.DayType:
    cfg = TIERS[Tier(a.tier)]
    if day < a.cycle_start:
        return "rest"
    template = cfg.cycle[locate(a.cycle_start, day, cfg.cycle_length).cycle_day - 1]
    if template is None:
        return "recovery"
    return "rest" if template == REST_DAY else "training"


def _settings(a: Athlete) -> routine.Settings:
    return routine.Settings(a.wake_time, a.sleep_target_hours, a.bodyweight_kg,
                            routine.enabled_items(a.routine_items), a.nutrition_goal)


def _routine(s: Db, a: Athlete, day: date) -> RoutineOut:
    first = day - timedelta(days=HISTORY_DAYS - 1)
    checks: dict[date, dict[str, routine.Check]] = {}
    for c in s.scalars(select(RoutineCheck).where(RoutineCheck.athlete_id == a.id, RoutineCheck.day >= first,
                                                  RoutineCheck.day <= day)):
        checks.setdefault(c.day, {})[c.item_id] = routine.Check(c.done, c.value)
    sleep = dict(s.execute(select(ReadinessEntry.day, ReadinessEntry.sleep_hours).where(
        ReadinessEntry.athlete_id == a.id, ReadinessEntry.day >= first, ReadinessEntry.day <= day)).all())
    trained = set(s.scalars(select(SetLog.performed_on).distinct().where(
        SetLog.athlete_id == a.id, SetLog.performed_on >= first, SetLog.performed_on <= day)))
    taken_ids: dict[date, set[str]] = {}
    for d, item in s.execute(select(SupplementIntake.day, SupplementIntake.item_id).where(
            SupplementIntake.athlete_id == a.id, SupplementIntake.day >= first, SupplementIntake.day <= day)):
        taken_ids.setdefault(d, set()).add(item)
    runs = early_bird_runs(s, a, first, day)
    early = early_bird_completed(s, a, first, day, runs)
    tz = ZoneInfo(a.timezone)

    cfg = _settings(a)
    states: dict[date, list[routine.ItemState]] = {}
    for i in range(HISTORY_DAYS):
        d = first + timedelta(days=i)
        # The checklist the nutrition tab showed that day (carb cycling adds collagen on power days).
        power = day_profile(s, a, d)[1] if a.nutrition_goal == "cycle" else False
        todays = {i for i, _, _ in nu.supplements_for(a.nutrition_goal, power)}
        data = routine.DayData(
            day_type=day_type(a, d),
            sleep_hours=sleep.get(d),
            woke_at_local=runs[d].astimezone(tz) if d in runs else None,
            early_bird_complete=d in early,
            trained=d in trained,
            supplements_taken=len(taken_ids.get(d, set()) & todays),
            supplements_total=len(todays),
        )
        states[d] = routine.items_for(cfg, data, checks.get(d, {}))
    scores = {d: routine.score(items) for d, items in states.items()}
    complete = {d for d, sc in scores.items() if sc.complete}
    today = scores[day]
    enabled = cfg.enabled
    return RoutineOut(
        day=day,
        wake_time=a.wake_time,
        bedtime=routine.bedtime(a.wake_time, a.sleep_target_hours),
        screens_off=routine.screens_off_time(a.wake_time, a.sleep_target_hours),
        sleep_target_hours=a.sleep_target_hours,
        water_target_ml=routine.water_target_ml(a.bodyweight_kg, day_type(a, day), a.nutrition_goal),
        items=[RoutineItemOut(id=it.id, section=it.section, kind=it.kind, title=it.title, detail=it.detail,
                              done=it.done, auto=it.auto, value=it.value, target=it.target)
               for it in states[day]],
        done=today.done,
        total=today.total,
        complete=today.complete,
        streak=routine.streak(complete, day),
        best_streak=routine.best_streak(complete),
        week=[RoutineDayOut(day=d, done=scores[d].done, total=scores[d].total, complete=scores[d].complete)
              for d in (day - timedelta(days=6 - i) for i in range(7))],
        options=[RoutineOptionOut(id=i, title=routine.OPTION_TITLES[i], enabled=i in enabled)
                 for i in routine.OPTIONAL_IDS],
    )


@router.get("/athletes/{athlete_id}/routine/{day}", response_model=RoutineOut)
def get_routine(day: Day, a: AthleteDep, s: Db) -> RoutineOut:
    return _routine(s, a, day)


@router.put("/athletes/{athlete_id}/routine/{day}/items/{item_id}", response_model=RoutineOut)
def put_routine_item(day: Day, item_id: str, body: RoutineCheckIn, a: AthleteDep, s: Db) -> RoutineOut:
    item = routine.ITEM_IDS.get(item_id)
    if item is None:
        raise HTTPException(422, f"unknown routine item {item_id!r}")
    today = local_today(a)
    if day > today + timedelta(days=1):  # +1: a device a timezone ahead of the server's view
        raise HTTPException(422, "a routine day in the future cannot be ticked")
    if day < today - timedelta(days=EDITABLE_DAYS):
        raise HTTPException(422, f"only the last {EDITABLE_DAYS} days can be edited")
    if item.kind == "water" and body.value is None:
        raise HTTPException(422, "water takes a value in ml")
    row = s.get(RoutineCheck, (a.id, day, item_id))
    if row is None:
        row = RoutineCheck(athlete_id=a.id, day=day, item_id=item_id, done=False)
        s.add(row)
    if body.done is not None:
        row.done = body.done
    if body.value is not None:
        row.value = body.value
    s.commit()
    return _routine(s, a, day)
