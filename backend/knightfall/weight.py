"""Body-weight trend.

Daily weigh-ins swing 1-2 kg with water and gut content, so targets follow
the mean of the last 7 days of readings instead of a single scale value.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, timedelta
from statistics import mean

TREND_DAYS = 7


def trend(weights: Mapping[date, float], on: date) -> float | None:
    """Mean of the readings in the 7 days ending on `on`, or None without any."""
    window = [w for d, w in weights.items() if on - timedelta(days=TREND_DAYS - 1) <= d <= on]
    return round(mean(window), 1) if window else None


def series(weights: Mapping[date, float]) -> list[tuple[date, float, float]]:
    """(day, reading, trend on that day) for every reading, oldest first."""
    return [(d, w, trend(weights, d) or w) for d, w in sorted(weights.items())]
