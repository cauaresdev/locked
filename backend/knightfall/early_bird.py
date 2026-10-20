"""Modo Gotham Early Bird — fasted aerobic cardio right after waking.

Within WINDOW_MIN minutes of the wake check-in, the athlete must accumulate
REQUIRED_MIN minutes with heart rate in the aerobic band around 75 % of
HRmax (ZONE_LOW..ZONE_HIGH), measured from streamed HR telemetry.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from .energy import Sample, durations

WINDOW_MIN = 30
REQUIRED_MIN = 20
ZONE_LOW, ZONE_HIGH = 0.70, 0.80

Status = Literal["not_started", "in_window", "complete", "missed", "no_hr_max"]


@dataclass(frozen=True)
class EarlyBirdResult:
    status: Status
    woke_at: datetime | None
    window_ends_at: datetime | None
    minutes_in_zone: float
    required_minutes: int
    zone_bpm: tuple[int, int] | None
    avg_hr: float | None


def zone_bpm(hrmax: int) -> tuple[int, int]:
    return round(hrmax * ZONE_LOW), round(hrmax * ZONE_HIGH)


def evaluate(woke_at: datetime | None, samples: Sequence[Sample], hrmax: int | None, now: datetime) -> EarlyBirdResult:
    if hrmax is None:
        return EarlyBirdResult("no_hr_max", woke_at, None, 0.0, REQUIRED_MIN, None, None)
    zone = zone_bpm(hrmax)
    if woke_at is None:
        return EarlyBirdResult("not_started", None, None, 0.0, REQUIRED_MIN, zone, None)
    end = woke_at + timedelta(minutes=WINDOW_MIN)
    window = sorted((s for s in samples if woke_at <= s.ts <= end), key=lambda s: s.ts)
    secs = durations(window)
    in_zone = sum(d for s, d in zip(window, secs) if zone[0] <= s.value <= zone[1]) / 60
    avg = round(sum(s.value for s in window) / len(window), 1) if window else None
    if in_zone >= REQUIRED_MIN:
        status: Status = "complete"
    elif now <= end:
        status = "in_window"
    else:
        status = "missed"
    return EarlyBirdResult(status, woke_at, end, round(in_zone, 1), REQUIRED_MIN, zone, avg)


def streak(completed_days: set[date], today: date, today_open: bool = True) -> int:
    """Consecutive completed days ending today, or yesterday while today can still be completed.

    A window that closed today without 20 min in zone breaks the streak at once.
    """
    if today in completed_days:
        day = today
    elif today_open:
        day = today - timedelta(days=1)
    else:
        return 0
    n = 0
    while day in completed_days:
        n += 1
        day -= timedelta(days=1)
    return n
