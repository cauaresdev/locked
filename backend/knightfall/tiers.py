"""Adaptation tiers.

Brawler runs its own program (V2, see brawler_v2.py): 3 training days, active
recovery, 3 training days, full rest, with fixed primary lifts and per-exercise
rest. The lower tiers keep the original day templates (mandatory mobility +
heavy compound + finishing circuit) with less volume.
"""

from __future__ import annotations

from dataclasses import dataclass

from .domain import Tier

# Cycle entry for a full rest day: no session at all (None is active recovery).
REST_DAY = "REST"


@dataclass(frozen=True)
class TierConfig:
    tier: Tier
    protocol_id: str
    # One entry per cycle day: a day-template id, None for active recovery or REST_DAY.
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
    program: str = "templates"  # "templates" (templates.py + Chaos Engine) or "v2" (brawler_v2.py)

    @property
    def cycle_length(self) -> int:
        return len(self.cycle)

    @property
    def sessions_per_cycle(self) -> int:
        return sum(1 for d in self.cycle if d and d != REST_DAY)

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
        protocol_id="knightfall_brawler_v2",
        cycle=("V1", "V2", "V3", None, "V5", "V6", "V7", REST_DAY),
        cycle_structure="3_1_3_1",
        # Typical day; each V2 day sets its own block lengths.
        prep_minutes=8,
        prep_expanded_minutes=8,
        strength_minutes=35,
        conditioning_minutes=10,
        set_multiplier=1.0,
        mobility_drills=0,
        rest_seconds=120,
        requires_waiver=True,
        max_recommended_weeks=16,
        deload_every_cycles=5,  # 8-day cycles: every 40 days
        program="v2",
    ),
}

REST_CAP_SECONDS = 60
V2_REST_CAP_SECONDS = 240  # 3–4 min after heavy top sets
DELOAD_SET_MULTIPLIER = 0.6
DELOAD_RPE_DELTA = -2
AMRAP_ROUND_REST_SECONDS = 30
