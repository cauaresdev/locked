"""Training programs (the API calls them tiers).

Brawler runs its own program (V2, see brawler_v2.py): 3 training days, active
recovery, 3 training days, full rest, with fixed primary lifts and per-exercise
rest. Vigilante and Dark Knight keep the original day templates (mandatory
mobility + heavy compound + finishing circuit) with less volume. The machine-first
splits (Full Body, Upper/Lower, Push/Pull/Legs, Batfleck) live in splits.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from .domain import Tier

# Cycle entry for a full rest day: no session at all (None is active recovery).
REST_DAY = "REST"


@dataclass(frozen=True)
class TierConfig:
    tier: Tier
    name: str
    description: str
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
    # "templates" (templates.py + Chaos Engine), "v2" (brawler_v2.py) or "split" (splits.py)
    program: str = "templates"
    # Weekly hard sets per muscle the program aims at (volume.py); muscles left out use the default band.
    volume_targets: dict[str, tuple[int, int]] = field(default_factory=dict)
    weekly: bool = False  # day 1 is a Monday: the program starts on the next one

    def start_on(self, today: date) -> date:
        """First day of the program when it is picked today."""
        return today + timedelta(days=(7 - today.weekday()) % 7) if self.weekly else today

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
        name="Vigilante",
        description="Protocolo funcional original em versão curta: mobilidade, força e circuito em 45 min.",
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
        name="Dark Knight",
        description="Protocolo funcional original em 60 min: mobilidade, força, carregamentos e circuito.",
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
        name="Brawler",
        description="O mais pesado: top sets, pliometria e AMRAP. Exige termo; no máximo 16 semanas seguidas.",
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
    Tier.FULL_BODY: TierConfig(
        tier=Tier.FULL_BODY,
        name="Full Body 3×",
        description="Corpo inteiro 3 vezes por ciclo, com máquinas primeiro. Bom para começar ou para semanas "
                    "corridas.",
        protocol_id="knightfall_full_body",
        cycle=("FB1", REST_DAY, "FB2", REST_DAY, "FB3", None, REST_DAY),
        cycle_structure="3_of_7",
        prep_minutes=8,
        prep_expanded_minutes=12,
        strength_minutes=45,
        conditioning_minutes=0,
        set_multiplier=1.0,
        mobility_drills=2,
        rest_seconds=90,
        program="split",
    ),
    Tier.UPPER_LOWER: TierConfig(
        tier=Tier.UPPER_LOWER,
        name="Upper / Lower 4×",
        description="Superior e inferior alternados: um dia de força e um de hipertrofia para cada metade do corpo.",
        protocol_id="knightfall_upper_lower",
        cycle=("UL1", "UL2", REST_DAY, "UL3", "UL4", None, REST_DAY),
        cycle_structure="4_of_7",
        prep_minutes=8,
        prep_expanded_minutes=12,
        strength_minutes=50,
        conditioning_minutes=0,
        set_multiplier=1.0,
        mobility_drills=2,
        rest_seconds=90,
        program="split",
    ),
    Tier.PUSH_PULL_LEGS: TierConfig(
        tier=Tier.PUSH_PULL_LEGS,
        name="Push / Pull / Legs 6×",
        description="Empurrar, puxar e pernas, duas vezes por ciclo. Volume alto, para quem treina quase todo dia.",
        protocol_id="knightfall_push_pull_legs",
        cycle=("PPL1", "PPL2", "PPL3", "PPL4", "PPL5", "PPL6", REST_DAY),
        cycle_structure="6_of_7",
        prep_minutes=7,
        prep_expanded_minutes=11,
        strength_minutes=55,
        conditioning_minutes=0,
        set_multiplier=1.0,
        mobility_drills=2,
        rest_seconds=90,
        program="split",
    ),
    Tier.BATFLECK: TierConfig(
        tier=Tier.BATFLECK,
        name="Batfleck",
        description="Hipertrofia da preparação de BvS: costas, ombros, trapézio e pescoço grandes, top sets nos "
                    "básicos e tiros na bike para manter a definição.",
        protocol_id="knightfall_batfleck",
        cycle=("BF1", "BF2", "BF3", None, "BF4", "BF5", REST_DAY),
        cycle_structure="3_1_2_1",
        prep_minutes=8,
        prep_expanded_minutes=12,
        strength_minutes=55,
        conditioning_minutes=8,
        set_multiplier=1.0,
        mobility_drills=2,
        rest_seconds=90,
        program="split",
    ),
    Tier.NORTON_FB: TierConfig(
        tier=Tier.NORTON_FB,
        name="Functional Bodybuilding",
        description="Walter Norton Jr.: superior e inferior com carregamentos pesados, potência no início e um dia "
                    "de agilidade e pescoço. Espessura de tronco, pegada e coluna blindada. Dia 1 = segunda.",
        protocol_id="knightfall_norton_fb",
        cycle=("N1", "N2", REST_DAY, "N3", REST_DAY, "N4", REST_DAY),
        cycle_structure="4_of_7",
        prep_minutes=8,
        prep_expanded_minutes=12,
        strength_minutes=60,
        conditioning_minutes=0,
        set_multiplier=1.0,
        mobility_drills=2,
        rest_seconds=120,
        program="split",
        weekly=True,
    ),
    Tier.CONJUGATE: TierConfig(
        tier=Tier.CONJUGATE,
        name="Conjugado tático",
        description="Westside adaptado: esforço máximo e esforço dinâmico para superior e inferior. Para quem já "
                    "agacha 1,8× e levanta 2,2× o peso do corpo. Dia 1 = segunda.",
        protocol_id="knightfall_conjugate",
        cycle=("CJ1", "CJ2", REST_DAY, "CJ3", REST_DAY, "CJ4", REST_DAY),
        cycle_structure="4_of_7",
        prep_minutes=8,
        prep_expanded_minutes=12,
        strength_minutes=60,
        conditioning_minutes=0,
        set_multiplier=1.0,
        mobility_drills=2,
        rest_seconds=120,
        program="split",
        weekly=True,
    ),
    Tier.GOTHAM_ARMOR: TierConfig(
        tier=Tier.GOTHAM_ARMOR,
        name="Armadura de Gotham",
        description="Proporção em V: ombros, dorsais, peitoral superior e trapézio com mais volume, pernas em "
                    "manutenção e duas janelas atléticas (saltos e um dia de sprint). Dia 1 = segunda.",
        protocol_id="knightfall_gotham_armor",
        cycle=("G1", "G2", None, "G3", "G4", "G5", REST_DAY),
        cycle_structure="2_1_3_1",
        prep_minutes=8,
        prep_expanded_minutes=12,
        strength_minutes=55,
        conditioning_minutes=0,
        set_multiplier=1.0,
        mobility_drills=2,
        rest_seconds=90,
        program="split",
        weekly=True,
        volume_targets={"shoulders": (16, 20), "back": (16, 18), "traps": (8, 10), "neck": (4, 6),
                        "quads": (6, 8), "hamstrings": (4, 6), "glutes": (0, 4), "calves": (3, 6),
                        "biceps": (6, 10), "triceps": (3, 6), "abs": (6, 10)},
    ),
}

REST_CAP_SECONDS = 60
V2_REST_CAP_SECONDS = 240  # 3–4 min after heavy top sets
SPLIT_REST_CAP_SECONDS = 240
DELOAD_SET_MULTIPLIER = 0.6
DELOAD_RPE_DELTA = -2
AMRAP_ROUND_REST_SECONDS = 30
