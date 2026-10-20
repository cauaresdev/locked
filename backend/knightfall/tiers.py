"""Adaptation tiers.

Brawler is the full documented protocol (6 on / 2 off, ~94 min). The lower
tiers keep the philosophy (mandatory mobility + heavy compound + finishing
circuit) with less volume so a normal schedule can sustain it.
"""

from __future__ import annotations

from dataclasses import dataclass

from .domain import Tier


@dataclass(frozen=True)
class TierConfig:
    tier: Tier
    protocol_id: str
    # One entry per cycle day: a day-template id, or None for a recovery day.
    cycle: tuple[str | None, ...]
    cycle_structure: str
    prep_minutes: int
    prep_expanded_minutes: int
    strength_minutes: int
    conditioning_minutes: int
    set_multiplier: float
    mobility_drills: int
    rest_seconds: int
    requires_waiver: bool = False
    max_recommended_weeks: int | None = None
    deload_every_cycles: int = 6  # every Nth cycle is a deload (~6 weeks)

    @property
    def cycle_length(self) -> int:
        return len(self.cycle)

    @property
    def target_minutes(self) -> int:
        return self.prep_minutes + self.strength_minutes + self.conditioning_minutes


TIERS: dict[Tier, TierConfig] = {
    Tier.VIGILANTE: TierConfig(
        tier=Tier.VIGILANTE,
        protocol_id="knightfall_vigilante",
        cycle=("D1", "D2", None, "D3", "D6", None, None),
        cycle_structure="4_of_7",
        prep_minutes=12,
        prep_expanded_minutes=18,
        strength_minutes=20,
        conditioning_minutes=13,
        set_multiplier=0.5,
        mobility_drills=2,
        rest_seconds=45,
    ),
    Tier.DARK_KNIGHT: TierConfig(
        tier=Tier.DARK_KNIGHT,
        protocol_id="knightfall_dark_knight",
        cycle=("D1", "D2", "D3", None, "D4", "D6", None),
        cycle_structure="5_of_7",
        prep_minutes=16,
        prep_expanded_minutes=24,
        strength_minutes=26,
        conditioning_minutes=18,
        set_multiplier=0.75,
        mobility_drills=3,
        rest_seconds=45,
    ),
    Tier.BRAWLER: TierConfig(
        tier=Tier.BRAWLER,
        protocol_id="bvs_heavyweight_phase_2",
        cycle=("D1", "D2", "D3", "D4", "D5", "D6", None, None),
        cycle_structure="6_on_2_off",
        prep_minutes=32,
        prep_expanded_minutes=45,
        strength_minutes=40,
        conditioning_minutes=22,
        set_multiplier=1.0,
        mobility_drills=3,
        rest_seconds=60,
        requires_waiver=True,
        max_recommended_weeks=16,
        deload_every_cycles=5,  # 8-day cycles: every 40 days
    ),
}

REST_CAP_SECONDS = 60
DELOAD_SET_MULTIPLIER = 0.6
DELOAD_RPE_DELTA = -2
AMRAP_ROUND_REST_SECONDS = 30
