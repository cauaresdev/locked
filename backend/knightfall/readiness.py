"""Batsuit Readiness Score.

Heuristic (not medical) index that blends HRV vs. personal baseline, sleep,
subjective soreness. The acute:chronic workload ratio (ACWR) of joint stress
on the lumbar spine and shoulders is not part of the score: its evidence is
weak, so a spike only caps a green day at amber. A red score expands Block 1
(mobility) and trims Block 2 volume.

HRV follows the approach of Plews & Buchheit: a 7-day rolling mean of
ln(HRV) compared with the athlete's 60-day baseline, flagged only when it
falls below the smallest worthwhile change (0.5 SD). One bad night barely
moves a 7-day mean, so the score stops swinging on single readings.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import mean, stdev

from .catalog import EXERCISES
from .domain import ReadinessSummary
from .records import SetRecord

WEIGHTS = {"hrv": 0.35, "sleep": 0.25, "soreness": 0.15}
ACWR_WARN = 1.3  # reason shown
ACWR_DANGER = 1.5  # caps green at amber
ACWR_CHRONIC_DAYS = 28
ACWR_MIN_HISTORY_DAYS = 21  # a chronic average needs ~3 weeks of training history
AMBER_MAX_SCORE = 69

HRV_ACUTE_DAYS = 7
HRV_BASELINE_DAYS = 60
HRV_MIN_ACUTE = 3  # readings needed for a rolling mean
HRV_MIN_BASELINE = 14  # readings needed before the 60-day baseline is trusted
HRV_SWC_SD = 0.5  # smallest worthwhile change, in baseline SDs
HRV_FLOOR_SD = 2.0  # this far below baseline the HRV component is zero
HRV_HISTORY_DAYS = HRV_BASELINE_DAYS + HRV_ACUTE_DAYS


@dataclass(frozen=True)
class HrvSignal:
    part: float  # 0 (suppressed) .. 1 (normal)
    reason: str | None = None


def hrv_signal(series: Mapping[date, float], day: date) -> HrvSignal | None:
    """HRV component for `day` from readings of one method (all RMSSD or all SDNN).

    With 14+ baseline readings: 7-day mean of ln(HRV) vs. the 60-day baseline.
    Before that, today's reading vs. the mean of the previous 7 days.
    """
    if day not in series:
        return None
    acute = [math.log(v) for d, v in series.items() if day - timedelta(days=HRV_ACUTE_DAYS - 1) <= d <= day and v > 0]
    base_start = day - timedelta(days=HRV_ACUTE_DAYS + HRV_BASELINE_DAYS - 1)
    baseline = [math.log(v) for d, v in series.items()
                if base_start <= d < day - timedelta(days=HRV_ACUTE_DAYS - 1) and v > 0]
    if len(baseline) >= HRV_MIN_BASELINE and len(acute) >= HRV_MIN_ACUTE:
        mu, sd = mean(baseline), max(stdev(baseline), 0.02)
        z = (mean(acute) - mu) / sd
        part = 1.0 if z >= -HRV_SWC_SD else _linear(z, -HRV_FLOOR_SD, -HRV_SWC_SD)
        reason = None
        if z < -HRV_SWC_SD:
            drop = 1 - math.exp(mean(acute) - mu)
            reason = (f"VFC (variabilidade da frequência cardíaca) da semana {drop:.0%} abaixo "
                      f"da sua linha de base de {HRV_BASELINE_DAYS} dias")
        return HrvSignal(part, reason)
    previous = [v for d, v in series.items() if day - timedelta(days=HRV_ACUTE_DAYS) <= d < day]
    if len(previous) < HRV_MIN_ACUTE:
        return None
    ratio = series[day] / mean(previous)
    reason = None
    if ratio < 0.85:
        reason = f"VFC (variabilidade da frequência cardíaca) em {ratio:.0%} da média dos últimos 7 dias"
    # Day-to-day noise is ~5-10 %: like the SWC above, a small dip still scores full marks.
    return HrvSignal(1.0 if ratio >= 0.95 else _linear(ratio, 0.75, 0.95), reason)


@dataclass(frozen=True)
class ReadinessInputs:
    hrv: HrvSignal | None = None
    sleep_hours: float | None = None
    soreness: int | None = None  # 1 (fresh) .. 5 (wrecked)
    lumbar_acwr: float | None = None
    shoulder_acwr: float | None = None


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _linear(x: float, lo: float, hi: float) -> float:
    return _clamp01((x - lo) / (hi - lo))


def joint_stress(records: Iterable[SetRecord], bodyweight_kg: float) -> dict[date, tuple[float, float]]:
    """Daily (lumbar, shoulder) stress units: joint weight x relative load, per set."""
    daily: dict[date, tuple[float, float]] = {}
    for r in records:
        ex = EXERCISES.get(r.exercise_id)
        if ex is None or (ex.lumbar == 0 and ex.shoulder == 0):
            continue
        factor = 1.0 + (r.load_kg or 0.0) / bodyweight_kg
        lum, sho = daily.get(r.performed_on, (0.0, 0.0))
        daily[r.performed_on] = (lum + ex.lumbar * factor, sho + ex.shoulder * factor)
    return daily


def acwr(
    daily: dict[date, tuple[float, float]], on: date, first_day: date | None = None
) -> tuple[float | None, float | None]:
    """Acute (7 d) : chronic (weekly average over up to 28 d) ratio, for lumbar and shoulder.

    `first_day` is when the athlete's training history starts (default: the first
    day in `daily`). The chronic average only covers days since then, and with
    less than ACWR_MIN_HISTORY_DAYS of history there is no ratio: a new athlete's
    first weeks would otherwise read as a huge spike.
    """
    first_day = first_day or min(daily, default=None)
    if first_day is None:
        return None, None
    covered = min(ACWR_CHRONIC_DAYS, (on - first_day).days)
    if covered < ACWR_MIN_HISTORY_DAYS:
        return None, None

    def window(days: int, idx: int) -> float:
        return sum(daily.get(on - timedelta(days=d), (0.0, 0.0))[idx] for d in range(1, days + 1))

    out: list[float | None] = []
    for idx in (0, 1):
        chronic = window(covered, idx) / (covered / 7)
        out.append(window(7, idx) / chronic if chronic > 0 else None)
    return out[0], out[1]


def score(inputs: ReadinessInputs) -> ReadinessSummary:
    parts: dict[str, float] = {}
    reasons: list[str] = []

    if inputs.hrv is not None:
        parts["hrv"] = inputs.hrv.part
        if inputs.hrv.reason:
            reasons.append(inputs.hrv.reason)

    if inputs.sleep_hours is not None:
        parts["sleep"] = _linear(inputs.sleep_hours, 4.0, 8.0)
        if inputs.sleep_hours < 6:
            reasons.append(f"sono curto ({inputs.sleep_hours:.1f} h)")

    worst_acwr = max((a for a in (inputs.lumbar_acwr, inputs.shoulder_acwr) if a is not None), default=None)
    if worst_acwr is not None:
        if worst_acwr > ACWR_WARN:
            joint = "na lombar" if worst_acwr == inputs.lumbar_acwr else "nos ombros"
            ratio = f"{worst_acwr:.2f}".replace(".", ",")
            reasons.append(f"carga da última semana alta {joint}: {ratio}× a média do mês "
                           "(ACWR, razão de carga aguda:crônica)")

    if inputs.soreness is not None:
        parts["soreness"] = _linear(5 - inputs.soreness, 0, 4)
        if inputs.soreness >= 4:
            reasons.append("dor muscular elevada")

    if not parts and worst_acwr is None:
        return ReadinessSummary(score=100, level="green", mobility_expanded=False,
                                reasons=["sem dados de prontidão"])

    value = 100
    if parts:
        total_w = sum(WEIGHTS[k] for k in parts)
        value = round(100 * sum(WEIGHTS[k] * v for k, v in parts.items()) / total_w)

    level = "green" if value > AMBER_MAX_SCORE else "amber" if value >= 50 else "red"
    # The evidence behind ACWR is weak: a spike caps the day at amber but never makes it worse.
    if worst_acwr is not None and worst_acwr > ACWR_DANGER and level == "green":
        level, value = "amber", AMBER_MAX_SCORE
    return ReadinessSummary(score=value, level=level, mobility_expanded=level == "red", reasons=reasons)
