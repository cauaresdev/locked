from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..db import Athlete, AuthToken, User
from ..security import DUMMY_HASH, TOKEN_TTL_DAYS, hash_password, new_token, token_digest, verify_password
from .deps import CurrentUser, Db
from .schemas import AthleteOut, AuthOut, Credentials
from .services import athlete_out

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue(s: Db, user: User) -> AuthOut:
    token = new_token()
    s.add(AuthToken(
        token_hash=token_digest(token),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=TOKEN_TTL_DAYS),
    ))
    s.commit()
    athlete_id = s.scalar(select(Athlete.id).where(Athlete.user_id == user.id))
    return AuthOut(token=token, user_id=user.id, athlete_id=athlete_id)


@router.post("/register", response_model=AuthOut, status_code=201)
def register(body: Credentials, s: Db) -> AuthOut:
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
    keys = (f"email:{email}", f"ip:{request.client.host if request.client else '?'}")
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
