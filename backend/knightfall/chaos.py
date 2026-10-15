"""Chaos Engine: per-cycle variant rotation.

Patterns stay fixed (pull, push, carry, squat...). Every new cycle each slot
gets a different exercise and, when the catalog allows it, a different
implement or modality than the previous cycle (dumbbells -> cables,
isometric -> explosive), to avoid neural accommodation and repetitive strain.

Selection is deterministic for (seed, template, cycle_index), so the server
and an offline device that cached a schedule always agree.
"""

from __future__ import annotations

import random
import threading
from dataclasses import dataclass
from functools import lru_cache

from .catalog import EXERCISES, by_pattern
from .domain import Modality, Pattern
from .templates import MAX_DRILLS, TEMPLATES, Slot, Variant


@dataclass(frozen=True)
class DaySelection:
    cardio: Variant
    roller: Variant
    drills: tuple[Variant, ...]
    strength: tuple[Variant, ...]
    conditioning: tuple[Variant, ...]


def _candidates(pattern: Pattern, modalities: tuple[Modality, ...]) -> list[Variant]:
    return [
        (ex.id, mod)
        for ex in by_pattern(pattern)
        for mod in modalities
        if mod in ex.variants
    ]


def _changes_stimulus(candidate: Variant, prev: Variant) -> bool:
    ex, prev_ex = EXERCISES[candidate[0]], EXERCISES[prev[0]]
    return ex.id != prev_ex.id and (ex.implement != prev_ex.implement or candidate[1] != prev[1])


def pick(
    candidates: list[Variant],
    rng: random.Random,
    prev: Variant | None,
    used: set[str],
) -> Variant:
    """Pick a variant, relaxing constraints until something qualifies."""
    fresh = [c for c in candidates if c[0] not in used] or candidates
    if not fresh:
        raise ValueError("no catalog variant for slot")
    if prev is None:
        return rng.choice(fresh)
    tiers = (
        [c for c in fresh if _changes_stimulus(c, prev)],
        [c for c in fresh if c[0] != prev[0]],
        fresh,
    )
    return rng.choice(next(t for t in tiers if t))


def _select_slot(
    s: Slot, k: int, rng: random.Random, prev: Variant | None, used: set[str]
) -> Variant:
    if k == 0 and s.canonical is not None:
        return s.canonical
    return pick(_candidates(s.pattern, s.modalities), rng, prev, used)


def _select_fixed(
    pattern: Pattern, canonical: str | None, k: int, rng: random.Random, prev: Variant | None, used: set[str]
) -> Variant:
    if k == 0 and canonical is not None:
        return (canonical, Modality.PREP)
    return pick(_candidates(pattern, (Modality.PREP,)), rng, prev, used)


def _next_selection(seed: str, template_id: str, k: int, prev: DaySelection | None) -> DaySelection:
    t = TEMPLATES[template_id]
    rng = random.Random(f"{seed}:{template_id}:{k}")
    used: set[str] = set()

    def take(v: Variant) -> Variant:
        used.add(v[0])
        return v

    cardio = take(_select_fixed(Pattern.CARDIO, t.canonical_cardio, k, rng, prev and prev.cardio, used))
    roller = take(_select_fixed(Pattern.MYOFASCIAL, t.canonical_roller, k, rng, prev and prev.roller, used))

    drills = []
    for i in range(MAX_DRILLS):
        canonical = t.canonical_drills[i] if i < len(t.canonical_drills) else None
        drills.append(take(_select_fixed(
            Pattern.MOBILITY, canonical, k, rng, prev.drills[i] if prev else None, used)))

    strength = tuple(
        take(_select_slot(s, k, rng, prev.strength[i] if prev else None, used))
        for i, s in enumerate(t.strength)
    )
    conditioning = tuple(
        take(_select_slot(s, k, rng, prev.conditioning[i] if prev else None, used))
        for i, s in enumerate(t.conditioning)
    )
    return DaySelection(cardio, roller, tuple(drills), strength, conditioning)


@lru_cache(maxsize=1024)
def _chain(seed: str, template_id: str) -> list[DaySelection]:
    return []


# The API serves sync routes from a thread pool; two requests extending the same
# chain at once would append out of order and shift every later cycle.
_chain_lock = threading.Lock()


def select_day(seed: str, template_id: str, cycle_index: int) -> DaySelection:
    """Variants for one day template in a given cycle.

    Each cycle depends on the previous one (to force a change), so this walks
    the chain from cycle 0; computed cycles are memoised per (seed, template).
    """
    if cycle_index < 0:
        raise ValueError("cycle_index must be >= 0")
    with _chain_lock:
        chain = _chain(seed, template_id)
        while len(chain) <= cycle_index:
            chain.append(_next_selection(seed, template_id, len(chain), chain[-1] if chain else None))
        return chain[cycle_index]
