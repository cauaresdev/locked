from __future__ import annotations

import secrets
import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from .. import armor
from ..catalog import EXERCISES
from ..db import Athlete, ReadinessEntry, SetLog, athlete_records
from ..domain import ReadinessSummary, Session, Tier
from ..strength import current_e1rm, e1rm_history, system_extra
from ..tiers import TIERS
from .deps import AthleteDep, CurrentUser, Db
from .schemas import (
    ArmorLoadOut,
    AthleteCreate,
    AthleteOut,
    AthleteUpdate,
    ReadinessIn,
    SetLogIn,
    StrengthOut,
    SyncResult,
    TierOut,
)
from .services import athlete_out, local_today, readiness_for, require_waiver, session_for

router = APIRouter(tags=["training"])

MAX_SCHEDULE_DAYS = 31
PROFILE_FIELDS = ("body_fat_pct", "height_cm", "birth_year", "sex", "hr_max_override", "timezone",
                  "early_bird_enabled", "wake_time")
NOT_NULL_FIELDS = {"name", "bodyweight_kg", "timezone", "early_bird_enabled", "wake_time"}


@router.get("/tiers", response_model=list[TierOut])
def list_tiers() -> list[TierOut]:
    return [
        TierOut(
            tier=c.tier,
            protocol_id=c.protocol_id,
            cycle_structure=c.cycle_structure,
            cycle_length=c.cycle_length,
            sessions_per_cycle=sum(1 for d in c.cycle if d),
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
        wake_time="04:00",
    )
    for f in PROFILE_FIELDS:
        if (v := getattr(body, f)) is not None:
            setattr(a, f, v)
    a.cycle_start = body.cycle_start or local_today(a)
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
    if body.tier is not None and body.tier.value != a.tier:
        a.waiver_accepted_at = require_waiver(body.tier, body.accept_brawler_waiver, a.waiver_accepted_at)
        a.tier = body.tier.value
        a.cycle_start = local_today(a)  # a new tier starts a fresh cycle
    s.commit()
    return athlete_out(a)


@router.get("/athletes/{athlete_id}/sessions/{day}", response_model=Session)
def get_session(day: date, a: AthleteDep, s: Db) -> Session:
    return session_for(s, a, day, with_readiness=True)


@router.get("/athletes/{athlete_id}/schedule", response_model=list[Session])
def get_schedule(
    a: AthleteDep,
    s: Db,
    start: date | None = None,
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
def post_logs(body: list[SetLogIn], a: AthleteDep, s: Db) -> SyncResult:
    ids = [str(item.id) for item in body]
    existing = set(s.scalars(select(SetLog.id).where(SetLog.id.in_(ids)))) if ids else set()
    accepted = 0
    for item in body:
        key = str(item.id)
        if key in existing:
            continue
        existing.add(key)
        s.add(SetLog(athlete_id=a.id, **item.model_dump(exclude={"id"}), id=key))
        accepted += 1
    s.commit()
    return SyncResult(accepted=accepted, duplicates=len(body) - accepted)


@router.get("/athletes/{athlete_id}/armor-load", response_model=ArmorLoadOut)
def get_armor_load(a: AthleteDep, s: Db, on: date | None = None) -> ArmorLoadOut:
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
