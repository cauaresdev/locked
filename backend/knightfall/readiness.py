"""Batsuit Readiness Score.

Heuristic (not medical) index that blends HRV vs. personal baseline, sleep,
subjective soreness and the acute:chronic workload ratio (ACWR) of joint
stress accumulated on the lumbar spine and shoulders. A red score expands
Block 1 (mobility) and trims Block 2 volume.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from .catalog import EXERCISES
from .domain import ReadinessSummary
from .records import SetRecord

WEIGHTS = {"hrv": 0.35, "sleep": 0.25, "load": 0.25, "soreness": 0.15}
ACWR_DANGER = 1.5


@dataclass(frozen=True)
class ReadinessInputs:
    hrv_rmssd: float | None = None
    hrv_baseline: float | None = None
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


def acwr(daily: dict[date, tuple[float, float]], on: date) -> tuple[float | None, float | None]:
    """Acute (7 d) : chronic (28 d weekly average) ratio, for lumbar and shoulder."""

    def window(days: int, idx: int) -> float:
        return sum(daily.get(on - timedelta(days=d), (0.0, 0.0))[idx] for d in range(1, days + 1))

    out: list[float | None] = []
    for idx in (0, 1):
        chronic = window(28, idx) / 4
        out.append(window(7, idx) / chronic if chronic > 0 else None)
    return out[0], out[1]


def score(inputs: ReadinessInputs) -> ReadinessSummary:
    parts: dict[str, float] = {}
    reasons: list[str] = []

    if inputs.hrv_rmssd is not None and inputs.hrv_baseline:
        ratio = inputs.hrv_rmssd / inputs.hrv_baseline
        parts["hrv"] = _linear(ratio, 0.75, 1.05)
        if ratio < 0.85:
            reasons.append(f"VFC {ratio:.0%} da linha de base")

    if inputs.sleep_hours is not None:
        parts["sleep"] = _linear(inputs.sleep_hours, 4.0, 8.0)
        if inputs.sleep_hours < 6:
            reasons.append(f"sono curto ({inputs.sleep_hours:.1f} h)")

    worst_acwr = max((a for a in (inputs.lumbar_acwr, inputs.shoulder_acwr) if a is not None), default=None)
    if worst_acwr is not None:
        parts["load"] = 1.0 if worst_acwr <= 1.3 else _linear(2.0 - worst_acwr, 0.0, 0.7)
        if worst_acwr > 1.3:
            joint = "lombar" if worst_acwr == inputs.lumbar_acwr else "ombros"
            reasons.append(f"carga aguda alta em {joint} (ACWR {worst_acwr:.2f})")

    if inputs.soreness is not None:
        parts["soreness"] = _linear(5 - inputs.soreness, 0, 4)
        if inputs.soreness >= 4:
            reasons.append("dor muscular elevada")

    if not parts:
        return ReadinessSummary(score=100, level="green", mobility_expanded=False,
                                reasons=["sem dados de prontidão"])

    total_w = sum(WEIGHTS[k] for k in parts)
    value = round(100 * sum(WEIGHTS[k] * v for k, v in parts.items()) / total_w)

    level = "green" if value >= 70 else "amber" if value >= 50 else "red"
    if worst_acwr is not None and worst_acwr > ACWR_DANGER:
        level = "red"
    return ReadinessSummary(score=value, level=level, mobility_expanded=level == "red", reasons=reasons)
