"""Armor Load — "Capacidade de Carga Operacional".

Gamification metric (not physics): total load moved in carries, sled pushes
and weighted pull-ups, expressed in kg·m. Timed carries/pushes without a
logged distance are converted with a typical loaded walking speed.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from .catalog import EXERCISES
from .records import SetRecord

CARRY_SPEED_M_S = 1.1
SLED_SPEED_M_S = 1.0
PULL_UP_ROM_M = 0.6


@dataclass
class ArmorLoad:
    total_kg_m: float = 0.0
    by_kind: dict[str, float] = field(default_factory=lambda: {"carry": 0.0, "sled": 0.0, "weighted_pull": 0.0})


def set_armor_kg_m(r: SetRecord, bodyweight_kg: float) -> tuple[str, float] | None:
    ex = EXERCISES.get(r.exercise_id)
    if ex is None or ex.armor is None:
        return None
    if ex.armor == "weighted_pull":
        if not r.reps:
            return None
        return ex.armor, (bodyweight_kg + (r.load_kg or 0.0)) * r.reps * PULL_UP_ROM_M
    if not r.load_kg:
        return None
    speed = CARRY_SPEED_M_S if ex.armor == "carry" else SLED_SPEED_M_S
    distance = r.distance_m if r.distance_m is not None else (r.duration_seconds or 0) * speed
    return ex.armor, r.load_kg * distance


def armor_load(records: Iterable[SetRecord], bodyweight_kg: float) -> ArmorLoad:
    out = ArmorLoad()
    for r in records:
        hit = set_armor_kg_m(r, bodyweight_kg)
        if hit is None:
            continue
        kind, value = hit
        out.by_kind[kind] += value
        out.total_kg_m += value
    out.total_kg_m = round(out.total_kg_m, 1)
    out.by_kind = {k: round(v, 1) for k, v in out.by_kind.items()}
    return out
