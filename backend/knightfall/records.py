from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .domain import Modality


@dataclass(frozen=True)
class SetRecord:
    """One logged set, as the engine sees it (decoupled from the DB row)."""

    performed_on: date
    exercise_id: str
    reps: int | None = None
    load_kg: float | None = None  # external load; for pull-ups, the added load
    duration_seconds: int | None = None
    distance_m: float | None = None
    rpe: float | None = None
    modality: Modality | None = None  # as prescribed; None when the client did not send it
