from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from ..db import (
    Athlete,
    AuthToken,
    EarlyBirdRun,
    FoodEntry,
    ReadinessEntry,
    SetLog,
    SupplementIntake,
    TelemetrySample,
    User,
    WeighIn,
)
from ..security import DUMMY_HASH, TOKEN_TTL_DAYS, hash_password, new_token, token_digest, verify_password
from .deps import CurrentUser, Db
from .schemas import AthleteOut, AuthOut, Credentials, PasswordIn
from .services import athlete_out

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _issue(s: Db, user: User) -> AuthOut:
    token = new_token()
    now = datetime.now(timezone.utc)
    # Expired sessions are useless; drop the user's old ones whenever a new one starts.
    s.execute(delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.expires_at < now))
    s.add(AuthToken(
        token_hash=token_digest(token),
        user_id=user.id,
        expires_at=now + timedelta(days=TOKEN_TTL_DAYS),
    ))
    s.commit()
    athlete_id = s.scalar(select(Athlete.id).where(Athlete.user_id == user.id))
    return AuthOut(token=token, user_id=user.id, athlete_id=athlete_id)


@router.post("/register", response_model=AuthOut, status_code=201)
def register(body: Credentials, request: Request, s: Db) -> AuthOut:
    throttle, key = request.app.state.register_ip_throttle, f"ip:{_client_ip(request)}"
    if (wait := throttle.retry_after(key)) is not None:
        raise HTTPException(429, "Muitas tentativas. Tente novamente mais tarde.", headers={"Retry-After": str(wait)})
    throttle.fail(key)  # every attempt counts: the limit is on sign-up volume, not on mistakes
    user = User(id=str(uuid.uuid4()), email=body.email.lower(), password_hash=hash_password(body.password))
    s.add(user)
    try:
        s.flush()
    except IntegrityError:
        s.rollback()
        raise HTTPException(409, "E-mail já cadastrado.") from None
    return _issue(s, user)


@router.post("/login", response_model=AuthOut)
def login(body: Credentials, request: Request, s: Db) -> AuthOut:
    email = body.email.lower()
    keys = (f"email:{email}", f"ip:{_client_ip(request)}")
    throttles = (request.app.state.login_email_throttle, request.app.state.login_ip_throttle)
    waits = [w for t, k in zip(throttles, keys) if (w := t.retry_after(k)) is not None]
    if waits:
        raise HTTPException(429, "Muitas tentativas. Tente novamente mais tarde.",
                            headers={"Retry-After": str(max(waits))})
    user = s.scalar(select(User).where(User.email == email))
    ok = verify_password(body.password, user.password_hash if user else DUMMY_HASH) and user is not None
    if not ok:
        for t, k in zip(throttles, keys):
            t.fail(k)
        raise HTTPException(401, "E-mail ou senha inválidos.")
    throttles[0].reset(keys[0])
    return _issue(s, user)


@router.post("/logout", status_code=204)
def logout(request: Request, user: CurrentUser, s: Db) -> None:
    raw = request.headers["authorization"].split(" ", 1)[1]
    tok = s.get(AuthToken, token_digest(raw))
    if tok is not None:
        s.delete(tok)
        s.commit()


@router.get("/me", response_model=AthleteOut | None)
def me(user: CurrentUser, s: Db) -> AthleteOut | None:
    a = s.scalar(select(Athlete).where(Athlete.user_id == user.id))
    return athlete_out(a) if a else None


# --- LGPD: data portability and erasure ------------------------------------------

ATHLETE_TABLES = (SetLog, ReadinessEntry, TelemetrySample, FoodEntry, SupplementIntake, EarlyBirdRun, WeighIn)


def _json(v) -> str:
    return json.dumps(v, ensure_ascii=False, default=lambda x: x.isoformat() if isinstance(x, date) else str(x))


def _export_chunks(s, user: User) -> Iterator[str]:
    """The export as JSON text, table by table. Rows are streamed from the database in
    batches (telemetry alone is ~86k rows a day at 1 Hz), so memory stays flat."""
    try:
        yield '{"user": ' + _json({"id": user.id, "email": user.email, "created_at": user.created_at})
        a = s.scalar(select(Athlete).where(Athlete.user_id == user.id))
        athlete = {c.key: getattr(a, c.key) for c in Athlete.__table__.columns if c.key != "chaos_seed"} if a else None
        yield ', "athlete": ' + _json(athlete)
        for model in ATHLETE_TABLES if a else ():
            cols = [c for c in model.__table__.columns if c.key != "athlete_id"]
            yield f', "{model.__tablename__}": ['
            rows = s.execute(select(*cols).where(model.athlete_id == a.id).execution_options(yield_per=2000))
            for i, row in enumerate(rows):
                yield ("," if i else "") + _json(dict(row._mapping))
            yield "]"
        yield "}"
    finally:
        s.close()


@router.get("/export", response_model=None, responses={200: {"content": {"application/json": {
    "schema": {"type": "object", "additionalProperties": True}}}}})
def export_data(user: CurrentUser, request: Request) -> StreamingResponse:
    """Everything stored about the signed-in user, as JSON (LGPD art. 18, portability)."""
    s = request.app.state.db.new_session()  # outlives the request's session: the body streams after return
    return StreamingResponse(_export_chunks(s, user), media_type="application/json")


@router.delete("/account", status_code=204)
def delete_account(body: PasswordIn, user: CurrentUser, s: Db) -> None:
    """Erase the account and every record tied to it (LGPD art. 18, deletion). Needs the password."""
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(403, "Senha incorreta.")
    # Explicit deletes: SQLite only honours ON DELETE CASCADE with a per-connection pragma.
    a = s.scalar(select(Athlete).where(Athlete.user_id == user.id))
    if a is not None:
        for model in ATHLETE_TABLES:
            s.execute(delete(model).where(model.athlete_id == a.id))
        s.delete(a)
    s.execute(delete(AuthToken).where(AuthToken.user_id == user.id))
    s.delete(user)
    s.commit()
