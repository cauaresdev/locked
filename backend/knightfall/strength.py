"""Estimated 1RM from logged sets (reps + RPE) and load prescription.

Uses the RPE / reps-in-reserve percentage chart popularised by Reactive
Training Systems: a set of `reps` at `rpe` is equivalent to
`reps + (10 - rpe)` reps to failure. e1RM = load / pct(effective reps).
Prescribed load for a target reps @ RPE = e1RM x pct(target).

For bodyweight lifts the athlete's body mass is part of the system load, so
only the added load is prescribed.

Only straight strength/hypertrophy sets estimate the 1RM: tempo, explosive and
isometric work is deliberately submaximal for its RPE and would drag the
estimate down. Sets logged without a modality (older clients) still count.
Explosive work is prescribed as a fixed share of the 1RM, not by RPE.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from .catalog import Exercise
from .domain import Implement, Modality
from .records import SetRecord

# % of 1RM for 1..12 reps taken to failure (RPE 10).
_CHART = [1.0, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68]
LOOKBACK_DAYS = 3  # e1RM uses the best set of the last few days the lift was trained...
LOOKBACK_MAX_AGE_DAYS = 60  # ...within this many calendar days
MIN_RPE = 6.0  # below this, RPE ratings are too unreliable to estimate from
E1RM_MODALITIES = (None, Modality.STRENGTH, Modality.HYPERTROPHY)
EXPLOSIVE_PCT_1RM = 0.65  # speed work: ~60-70 % of 1RM, moved as fast as possible


def pct_of_1rm(reps: float, rpe: float) -> float:
    eff = reps + (10 - rpe)  # reps to failure
    if eff <= 1:
        return 1.0
    if eff <= len(_CHART):
        lo = int(math.floor(eff))
        frac = eff - lo
        hi = min(lo + 1, len(_CHART))
        return _CHART[lo - 1] + (_CHART[hi - 1] - _CHART[lo - 1]) * frac
    # Beyond the chart: Epley's shape, scaled to meet the chart at its last point so
    # the curve stays continuous and keeps falling as reps go up.
    n = len(_CHART)
    return _CHART[-1] * (1 + n / 30) / (1 + eff / 30)


@dataclass(frozen=True)
class E1rmPoint:
    day: date
    e1rm_kg: float


def set_e1rm(r: SetRecord, system_extra_kg: float = 0.0) -> float | None:
    if r.reps is None or r.reps <= 0 or r.rpe is None or r.rpe < MIN_RPE or r.load_kg is None:
        return None
    if r.modality not in E1RM_MODALITIES:
        return None
    return (r.load_kg + system_extra_kg) / pct_of_1rm(r.reps, r.rpe)


def e1rm_history(records: Iterable[SetRecord], exercise_id: str, system_extra_kg: float = 0.0) -> list[E1rmPoint]:
    best: dict[date, float] = {}
    for r in records:
        if r.exercise_id != exercise_id:
            continue
        v = set_e1rm(r, system_extra_kg)
        if v is not None:
            best[r.performed_on] = max(best.get(r.performed_on, 0.0), v)
    return [E1rmPoint(d, round(v, 1)) for d, v in sorted(best.items())]


def current_e1rm(history: list[E1rmPoint], on: date | None = None) -> float | None:
    """Best of the last LOOKBACK_DAYS training days; with `on`, only days in the 60 days before it."""
    if on is not None:
        history = [p for p in history if p.day >= on - timedelta(days=LOOKBACK_MAX_AGE_DAYS)]
    if not history:
        return None
    return max(p.e1rm_kg for p in history[-LOOKBACK_DAYS:])


def load_at(e1rm: float, pct: float, step: float, system_extra_kg: float = 0.0) -> float:
    """`pct` of the 1RM as external load, rounded down to the implement's increment."""
    raw = e1rm * pct - system_extra_kg
    return max(0.0, math.floor(round(raw / step, 6)) * step)


def prescribe(e1rm: float, reps: int, rpe: float, step: float, system_extra_kg: float = 0.0) -> float:
    """Load for `reps` @ `rpe`, rounded down to the implement's increment."""
    return load_at(e1rm, pct_of_1rm(reps, rpe), step, system_extra_kg)


def system_extra(ex: Exercise, bodyweight_kg: float) -> float:
    return bodyweight_kg if ex.implement == Implement.BODYWEIGHT else 0.0
