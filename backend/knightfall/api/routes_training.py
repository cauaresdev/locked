from __future__ import annotations

import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Body, HTTPException, Query
from sqlalchemy import delete, select

from .. import armor, routine
from ..catalog import EXERCISES
from ..db import Athlete, ReadinessEntry, SetLog, athlete_records, insert_new
from ..domain import Prescription, ReadinessSummary, Session, Tier
from ..generator import alternatives
from ..strength import current_e1rm, e1rm_history, system_extra
from ..tiers import TIERS
from .deps import AthleteDep, CurrentUser, Db
from .schemas import (
    MAX_LOG_BATCH,
    ArmorLoadOut,
    AthleteCreate,
    AthleteOut,
    AthleteUpdate,
    CycleShiftIn,
    Day,
    MissedOut,
    ReadinessIn,
    SetLogIn,
    StrengthOut,
    SyncResult,
    TierOut,
)
from .services import (
    athlete_out,
    local_today,
    normalize_equipment,
    plan_context,
    position,
    readiness_for,
    reject_foreign_ids,
    require_waiver,
    session_for,
)

router = APIRouter(tags=["training"])

MAX_SCHEDULE_DAYS = 31
PROFILE_FIELDS = ("body_fat_pct", "height_cm", "birth_year", "sex", "hr_max_override", "timezone",
                  "early_bird_enabled", "wake_time", "sleep_target_hours", "nutrition_goal")
NOT_NULL_FIELDS = {"name", "bodyweight_kg", "timezone", "early_bird_enabled", "wake_time", "sleep_target_hours",
                   "nutrition_goal"}


def _equipment(value: list | None) -> str | None:
    return None if value is None else ",".join(sorted(str(x) for x in normalize_equipment(value)))


@router.get("/tiers", response_model=list[TierOut])
def list_tiers() -> list[TierOut]:
    return [
        TierOut(
            tier=c.tier,
            name=c.name,
            description=c.description,
            protocol_id=c.protocol_id,
            cycle_structure=c.cycle_structure,
            cycle_length=c.cycle_length,
            sessions_per_cycle=c.sessions_per_cycle,
            target_minutes=c.target_minutes,
            requires_waiver=c.requires_waiver,
            max_recommended_weeks=c.max_recommended_weeks,
        )
        for c in TIERS.values()
    ]


@router.post("/athletes", response_model=AthleteOut, status_code=201)
def create_athlete(body: AthleteCreate, user: CurrentUser, s: Db) -> AthleteOut:
    if s.scalar(select(Athlete.id).where(Athlete.user_id == user.id)):
        raise HTTPException(409, "Este usuário já possui um perfil de atleta.")
    a = Athlete(
        id=str(uuid.uuid4()),
        user_id=user.id,
        name=body.name,
        tier=body.tier.value,
        chaos_seed=secrets.token_hex(16),
        bodyweight_kg=body.bodyweight_kg,
        waiver_accepted_at=require_waiver(body.tier, body.accept_brawler_waiver, None),
        timezone="UTC",
        early_bird_enabled=False,
        sleep_target_hours=routine.DEFAULT_SLEEP_TARGET_H,
        nutrition_goal="cut",
        wake_time="04:00",
    )
    for f in PROFILE_FIELDS:
        if (v := getattr(body, f)) is not None:
            setattr(a, f, v)
    a.equipment = _equipment(body.equipment)
    if body.routine_items is not None:
        a.routine_items = routine.encode_enabled(body.routine_items)
    a.health_consent_at = datetime.now(timezone.utc) if body.accept_health_data else None
    a.cycle_start = body.cycle_start or TIERS[body.tier].start_on(local_today(a))
    s.add(a)
    s.commit()
    return athlete_out(a)


@router.get("/athletes/{athlete_id}", response_model=AthleteOut)
def get_athlete(a: AthleteDep) -> AthleteOut:
    return athlete_out(a)


@router.patch("/athletes/{athlete_id}", response_model=AthleteOut)
def update_athlete(body: AthleteUpdate, a: AthleteDep, s: Db) -> AthleteOut:
    for f in ("name", "bodyweight_kg", *PROFILE_FIELDS):
        if f in body.model_fields_set and not (f in NOT_NULL_FIELDS and getattr(body, f) is None):
            setattr(a, f, getattr(body, f))
    if "equipment" in body.model_fields_set:
        a.equipment = _equipment(body.equipment)
    if body.routine_items is not None:
        a.routine_items = routine.encode_enabled(body.routine_items)
    if body.tier is not None and body.tier.value != a.tier:
        a.waiver_accepted_at = require_waiver(body.tier, body.accept_brawler_waiver, a.waiver_accepted_at)
        a.tier = body.tier.value
        a.cycle_start = TIERS[body.tier].start_on(local_today(a))  # a fresh cycle (weekly ones on a Monday)
    s.commit()
    return athlete_out(a)


@router.get("/athletes/{athlete_id}/sessions/{day}", response_model=Session)
def get_session(day: Day, a: AthleteDep, s: Db) -> Session:
    return session_for(s, a, day, with_readiness=True)


@router.get("/athletes/{athlete_id}/sessions/{day}/alternatives", response_model=list[Prescription])
def get_alternatives(
    day: Day, a: AthleteDep, s: Db,
    block: Annotated[int, Query(ge=1, le=3)], index: Annotated[int, Query(ge=0, le=20)],
) -> list[Prescription]:
    """Other exercises for the same slot (same movement pattern, available equipment)."""
    try:
        return alternatives(Tier(a.tier), position(a, day), a.chaos_seed, block, index,
                            **plan_context(s, a, day, with_readiness=True))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@router.get("/athletes/{athlete_id}/schedule", response_model=list[Session])
def get_schedule(
    a: AthleteDep,
    s: Db,
    start: Day | None = None,
    days: Annotated[int, Query(ge=1, le=MAX_SCHEDULE_DAYS)] = 16,
) -> list[Session]:
    """Upcoming sessions without readiness adjustment, for offline caching."""
    first = max(start or local_today(a), a.cycle_start)
    records = athlete_records(s, a.id)
    return [session_for(s, a, first + timedelta(days=i), with_readiness=False, records=records) for i in range(days)]


@router.put("/athletes/{athlete_id}/readiness", response_model=ReadinessSummary)
def put_readiness(body: ReadinessIn, a: AthleteDep, s: Db) -> ReadinessSummary:
    entry = s.get(ReadinessEntry, (a.id, body.day)) or ReadinessEntry(
        athlete_id=a.id, day=body.day, hrv_method="rmssd", source=body.source)
    for f in ("hrv_ms", "hrv_method", "resting_hr", "sleep_hours", "soreness"):
        if f in body.model_fields_set and getattr(body, f) is not None:
            setattr(entry, f, getattr(body, f))
    if body.source != "manual":
        entry.source = body.source
    s.add(entry)
    s.commit()
    result = readiness_for(s, a, body.day)
    assert result is not None  # the entry just stored guarantees a score
    return result


@router.post("/athletes/{athlete_id}/logs", response_model=SyncResult)
def post_logs(
    body: Annotated[list[SetLogIn], Body(max_length=MAX_LOG_BATCH)], a: AthleteDep, s: Db
) -> SyncResult:
    ids = [str(item.id) for item in body]
    reject_foreign_ids(s, SetLog, ids, a)
    rows = [{**item.model_dump(exclude={"id"}), "id": str(item.id), "athlete_id": a.id} for item in body]
    accepted = insert_new(s, SetLog, rows)
    s.commit()
    return SyncResult(accepted=accepted, duplicates=len(body) - accepted)


@router.delete("/athletes/{athlete_id}/logs/{log_id}", status_code=204)
def delete_log(log_id: str, a: AthleteDep, s: Db) -> None:
    """Undo a logged set. Idempotent, so an offline retry is harmless."""
    s.execute(delete(SetLog).where(SetLog.id == log_id, SetLog.athlete_id == a.id))
    s.commit()


def _missed_days(s: Db, a: Athlete, day: date) -> list[date]:
    """Training days right before `day` with nothing logged (most recent last)."""
    cycle_len = TIERS[Tier(a.tier)].cycle_length
    trained = set(s.scalars(select(SetLog.performed_on).where(
        SetLog.athlete_id == a.id, SetLog.performed_on < day,
        SetLog.performed_on >= day - timedelta(days=cycle_len))))
    missed: list[date] = []
    d = day - timedelta(days=1)
    while d >= a.cycle_start and len(missed) < cycle_len - 1:
        plan = session_for(s, a, d, with_readiness=False, records=[])
        if not plan.is_training_day or d in trained:
            break
        missed.append(d)
        d -= timedelta(days=1)
    return sorted(missed)


@router.get("/athletes/{athlete_id}/cycle/missed", response_model=MissedOut)
def get_missed(a: AthleteDep, s: Db, day: Day | None = None) -> MissedOut:
    """Training days just before `day` with no sets logged: candidates to make up by shifting the cycle."""
    return MissedOut(day=day or local_today(a), missed=_missed_days(s, a, day or local_today(a)))


@router.post("/athletes/{athlete_id}/cycle/shift", response_model=AthleteOut)
def shift_cycle(body: CycleShiftIn, a: AthleteDep, s: Db) -> AthleteOut:
    """Push the cycle forward `days` days, so the oldest missed session lands on today.

    Nothing logged moves: only which session each upcoming date maps to.
    """
    today = local_today(a)
    if a.cycle_start + timedelta(days=body.days) > today:
        raise HTTPException(422, "O ciclo não pode começar depois de hoje.")
    a.cycle_start += timedelta(days=body.days)
    s.commit()
    return athlete_out(a)


@router.get("/athletes/{athlete_id}/armor-load", response_model=ArmorLoadOut)
def get_armor_load(a: AthleteDep, s: Db, on: Day | None = None) -> ArmorLoadOut:
    today = on or local_today(a)
    records = athlete_records(s, a.id)
    cycle_len = TIERS[Tier(a.tier)].cycle_length
    current_start = (today - timedelta(days=(today - a.cycle_start).days % cycle_len)
                     if today >= a.cycle_start else today)
    prev_start = current_start - timedelta(days=cycle_len)
    total = armor.armor_load(records, a.bodyweight_kg)
    current = armor.armor_load((r for r in records if current_start <= r.performed_on <= today), a.bodyweight_kg)
    previous = armor.armor_load((r for r in records if prev_start <= r.performed_on < current_start),
                                a.bodyweight_kg)
    return ArmorLoadOut(
        total_kg_m=total.total_kg_m,
        by_kind=total.by_kind,
        current_cycle_kg_m=current.total_kg_m,
        previous_cycle_kg_m=previous.total_kg_m,
    )


@router.get("/athletes/{athlete_id}/strength", response_model=list[StrengthOut])
def get_strength(a: AthleteDep, s: Db) -> list[StrengthOut]:
    """Estimated 1RM per lift, from sets logged with reps + RPE."""
    records = athlete_records(s, a.id)
    out = []
    for ex_id in sorted({r.exercise_id for r in records}):
        ex = EXERCISES[ex_id]
        hist = e1rm_history(records, ex_id, system_extra(ex, a.bodyweight_kg))
        if (cur := current_e1rm(hist)) is not None:
            out.append(StrengthOut(exercise_id=ex_id, name=ex.name, e1rm_kg=cur,
                                   history=[(p.day, p.e1rm_kg) for p in hist]))
    return out
