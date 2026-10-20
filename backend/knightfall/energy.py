"""Heart-rate zones and session energy expenditure.

- HRmax: athlete override, else Tanaka (208 - 0.7 x age).
- kcal from HR: Keytel et al. (2005) prediction equations, integrated over
  samples (gaps capped so a dropped strap does not invent work). Keytel is
  gross expenditure; the nutrition floor already covers resting energy, so
  only the net part (minus 1 MET) is counted, and only for samples at or above
  50 % of HRmax (90 bpm when HRmax is unknown), where the equation was fitted.
- Fallback without HR telemetry: net MET estimate of the planned session.
- Keytel was validated on steady aerobic work. Lifting raises heart rate
  through pressor and adrenergic responses, not oxygen uptake, so during the
  strength block it overestimates; that stretch is costed with a MET value.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

MAX_SAMPLE_GAP_S = 5.0
ZONE_BOUNDS = (0.5, 0.6, 0.7, 0.8, 0.9)  # Z1..Z5 lower bounds as fraction of HRmax
SESSION_MET = 6.0  # vigorous resistance + conditioning mix
STRENGTH_MET = 5.0  # resistance training with rest periods (Compendium of Physical Activities)
RECOVERY_MET = 3.0
ACTIVE_HR_FRACTION = ZONE_BOUNDS[0]  # below Z1, heart rate is not exercise
ACTIVE_HR_BPM = 90  # same threshold without an HRmax


def resting_kcal_per_min(weight_kg: float) -> float:
    """1 MET: ~1 kcal per kg per hour."""
    return weight_kg / 60


def hr_max(age: int | None, override: int | None) -> int | None:
    if override:
        return override
    if age is None:
        return None
    return round(208 - 0.7 * age)


def zone_of(hr: float, hrmax: int) -> int:
    """0 = below Z1, 1..5 otherwise."""
    frac = hr / hrmax
    return sum(1 for lb in ZONE_BOUNDS if frac >= lb)


def keytel_kcal_per_min(hr: float, weight_kg: float, age: int, sex: str) -> float:
    if sex == "female":
        kj = -20.4022 + 0.4472 * hr - 0.1263 * weight_kg + 0.074 * age
    else:
        kj = -55.0969 + 0.6309 * hr + 0.1988 * weight_kg + 0.2017 * age
    return max(0.0, kj / 4.184)


@dataclass(frozen=True)
class Sample:
    ts: datetime
    value: float


def durations(samples: Sequence[Sample]) -> list[float]:
    """Seconds each sample represents: gap to the next one, capped."""
    out = []
    for i, s in enumerate(samples):
        if i + 1 < len(samples):
            out.append(min(MAX_SAMPLE_GAP_S, (samples[i + 1].ts - s.ts).total_seconds()))
        else:
            out.append(1.0)
    return out


@dataclass(frozen=True)
class HrSummary:
    samples: int
    avg_hr: float | None
    max_hr: float | None
    minutes_by_zone: dict[int, float]
    kcal: float | None  # net of resting energy


def summarize_hr(
    samples: Sequence[Sample], *, hrmax: int | None, weight_kg: float, age: int | None, sex: str | None
) -> HrSummary:
    if not samples:
        return HrSummary(0, None, None, {}, None)
    samples = sorted(samples, key=lambda s: s.ts)
    secs = durations(samples)
    total = sum(secs)
    avg = sum(s.value * d for s, d in zip(samples, secs)) / total if total else None
    zones: dict[int, float] = {}
    if hrmax:
        for s, d in zip(samples, secs):
            z = zone_of(s.value, hrmax)
            zones[z] = zones.get(z, 0.0) + d / 60
        zones = {z: round(m, 1) for z, m in sorted(zones.items())}
    kcal = None
    if age is not None and sex in ("male", "female"):
        active = hrmax * ACTIVE_HR_FRACTION if hrmax else ACTIVE_HR_BPM
        rest = resting_kcal_per_min(weight_kg)
        kcal = round(sum(max(0.0, keytel_kcal_per_min(s.value, weight_kg, age, sex) - rest) * d / 60
                         for s, d in zip(samples, secs) if s.value >= active))
    return HrSummary(len(samples), round(avg, 1) if avg else None, max(s.value for s in samples), zones, kcal)


def met_kcal(met: float, weight_kg: float, minutes: float) -> float:
    """Net (above resting) kcal for an activity of the given MET."""
    return round((met - 1.0) * weight_kg * minutes / 60)
