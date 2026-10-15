"""RPE-based load autoregulation.

Primary path: estimated 1RM from recent logged sets (see strength.py), then
the load that should land on the target reps @ RPE. Fallback (timed carries,
sleds, sets logged without reps/RPE): the last top set and its RPE decide
whether the load goes up, holds or drops. Loads snap to the smallest
practical jump for each implement.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

from .catalog import Exercise
from .domain import Implement
from .records import SetRecord
from .strength import current_e1rm, e1rm_history, prescribe, system_extra

INCREMENT_KG: dict[Implement, float] = {
    Implement.DUMBBELL: 2.0,
    Implement.KETTLEBELL: 4.0,
    Implement.BARBELL: 2.5,
    Implement.TRAP_BAR: 2.5,
    Implement.CABLE: 2.5,
    Implement.MACHINE: 2.5,
    Implement.SLED: 5.0,
    Implement.BODYWEIGHT: 2.5,  # added load (vest / belt)
}


def last_top_set(records: Iterable[SetRecord], exercise_id: str) -> SetRecord | None:
    """Heaviest set of the most recent day the exercise was logged with load."""
    loaded = [r for r in records if r.exercise_id == exercise_id and r.load_kg is not None]
    if not loaded:
        return None
    last_day = max(r.performed_on for r in loaded)
    return max((r for r in loaded if r.performed_on == last_day), key=lambda r: r.load_kg or 0)


def suggest_load(ex: Exercise, last: SetRecord | None, target_rpe: float | None) -> float | None:
    if last is None or last.load_kg is None:
        return None
    step = INCREMENT_KG.get(ex.implement)
    if step is None:
        return None
    load = last.load_kg
    if target_rpe is None or last.rpe is None:
        return load
    gap = target_rpe - last.rpe
    if gap >= 2:  # far too easy
        return _snap(max(load * 1.05, load + step), step, math.ceil)
    if gap >= 1:  # a bit easy
        return _snap(max(load * 1.025, load + step), step, math.ceil)
    if gap < -0.5:  # overshot the target effort
        return max(0.0, _snap(load * 0.95, step, math.floor))
    return load


def _snap(value: float, step: float, rounding) -> float:
    return rounding(round(value / step, 6)) * step


def recommend_load(
    ex: Exercise,
    records: Iterable[SetRecord],
    target_reps: int | None,
    target_rpe: float | None,
    bodyweight_kg: float | None,
) -> float | None:
    records = list(records)
    step = INCREMENT_KG.get(ex.implement)
    if step is None:
        return None
    if target_reps and target_rpe and (ex.implement != Implement.BODYWEIGHT or bodyweight_kg):
        extra = system_extra(ex, bodyweight_kg or 0.0)
        e1rm = current_e1rm(e1rm_history(records, ex.id, extra))
        if e1rm is not None:
            return prescribe(e1rm, target_reps, target_rpe, step, extra)
    return suggest_load(ex, last_top_set(records, ex.id), target_rpe)
