"""FastAPI dependencies: DB session, authenticated user, owned athlete."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session as DbSession

from ..db import Athlete, AuthToken, User
from ..security import token_digest

_bearer = HTTPBearer(auto_error=False)


def get_db(request: Request) -> Iterator[DbSession]:
    yield from request.app.state.db.session()


Db = Annotated[DbSession, Depends(get_db)]


def get_http(request: Request) -> httpx.Client:
    return request.app.state.http


Http = Annotated[httpx.Client, Depends(get_http)]


def get_user(s: Db, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(401, "missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    tok = s.get(AuthToken, token_digest(creds.credentials))
    expires = tok.expires_at if tok else None
    if expires is not None and expires.tzinfo is None:  # SQLite drops tzinfo
        expires = expires.replace(tzinfo=timezone.utc)
    if tok is None or expires is None or expires < datetime.now(timezone.utc):
        raise HTTPException(401, "invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    user = s.get(User, tok.user_id)
    if user is None:
        raise HTTPException(401, "invalid token")
    return user


CurrentUser = Annotated[User, Depends(get_user)]


def get_athlete(athlete_id: str, s: Db, user: CurrentUser) -> Athlete:
    a = s.get(Athlete, athlete_id)
    if a is None or a.user_id != user.id:  # 404 either way: don't leak other users' ids
        raise HTTPException(404, "athlete not found")
    return a


AthleteDep = Annotated[Athlete, Depends(get_athlete)]
