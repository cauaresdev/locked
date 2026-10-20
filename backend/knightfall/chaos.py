"""Chaos Engine: per-cycle variant rotation.

Patterns stay fixed (pull, push, carry, squat...). Every new cycle each slot
gets a different exercise and, when the catalog allows it, a different
implement or modality than the previous cycle (dumbbells -> cables,
isometric -> explosive), to avoid neural accommodation and repetitive strain.

Selection is deterministic for (seed, template, cycle_index, equipment), so
the server and an offline device that cached a schedule always agree.
Candidates are ordered by exercise id (not catalog position), so adding an
exercise only changes cycles where it actually becomes a candidate pick; a
golden-schedule test pins the output so such changes are deliberate.

An equipment profile restricts the catalog to the implements the athlete has
(bodyweight is always available); bodyweight stand-ins fill patterns the
profile cannot cover otherwise. A slot with nothing available falls back to
the full catalog rather than leaving a hole in the session; the generator
tells the athlete which implement is missing.
"""

from __future__ import annotations

import random
import threading
from dataclasses import dataclass
from functools import lru_cache

from .catalog import EXERCISES, by_pattern
from .domain import Implement, Modality, Pattern
from .templates import MAX_DRILLS, TEMPLATES, Slot, Variant

Equipment = frozenset[Implement] | None  # None = a full gym


def available(ex_id: str, equipment: Equipment) -> bool:
    if equipment is None:
        return True
    implement = EXERCISES[ex_id].implement
    return implement == Implement.BODYWEIGHT or implement in equipment


@dataclass(frozen=True)
class DaySelection:
    cardio: Variant
    roller: Variant
    drills: tuple[Variant, ...]
    strength: tuple[Variant, ...]
    conditioning: tuple[Variant, ...]


def candidates(
    pattern: Pattern, modalities: tuple[Modality, ...], equipment: Equipment = None, stand_ins: bool = False
) -> list[Variant]:
    """Variants for a slot: available regular exercises, else available stand-ins, else everything.

    `stand_ins=True` (swaps) offers every available exercise, stand-ins included.
    """
    return list(_candidates(pattern, modalities, equipment, stand_ins))


@lru_cache(maxsize=4096)
def _candidates(
    pattern: Pattern, modalities: tuple[Modality, ...], equipment: Equipment, stand_ins: bool
) -> tuple[Variant, ...]:
    every = sorted(
        ((ex.id, mod) for ex in by_pattern(pattern) for mod in modalities if mod in ex.variants),
        key=lambda c: (c[0], modalities.index(c[1])),
    )
    usable = [c for c in every if available(c[0], equipment)]
    regular = [c for c in usable if not EXERCISES[c[0]].stand_in]
    return tuple((usable if stand_ins else regular or usable) or every)


def _changes_stimulus(candidate: Variant, prev: Variant) -> bool:
    ex, prev_ex = EXERCISES[candidate[0]], EXERCISES[prev[0]]
    return ex.id != prev_ex.id and (ex.implement != prev_ex.implement or candidate[1] != prev[1])


def pick(
    candidates: list[Variant],
    rng: random.Random,
    prev: Variant | None,
    used: set[str],
) -> Variant:
    """Pick a variant, relaxing constraints until something qualifies.

    `used` holds exercise names, not ids: the catalog lists some movements under two patterns
    (a prep drill and a core lift), and the same day must not show one twice.
    """
    fresh = [c for c in candidates if EXERCISES[c[0]].name not in used] or candidates
    if not fresh:
        raise ValueError("no catalog variant for slot")
    if prev is None:
        return rng.choice(fresh)
    tiers = (
        [c for c in fresh if _changes_stimulus(c, prev)],
        [c for c in fresh if c[0] != prev[0]],
        [c for c in fresh if c != prev],  # same exercise, other modality
        fresh,
    )
    return rng.choice(next(t for t in tiers if t))


def _select_slot(
    s: Slot, k: int, rng: random.Random, prev: Variant | None, used: set[str], equipment: Equipment
) -> Variant:
    if k == 0 and s.canonical is not None and available(s.canonical[0], equipment):
        return s.canonical
    return pick(candidates(s.pattern, s.modalities, equipment), rng, prev, used)


def _select_fixed(
    pattern: Pattern, canonical: str | None, k: int, rng: random.Random, prev: Variant | None, used: set[str],
    equipment: Equipment,
) -> Variant:
    if k == 0 and canonical is not None and available(canonical, equipment):
        return (canonical, Modality.PREP)
    return pick(candidates(pattern, (Modality.PREP,), equipment), rng, prev, used)


def _next_selection(
    seed: str, template_id: str, k: int, prev: DaySelection | None, equipment: Equipment
) -> DaySelection:
    t = TEMPLATES[template_id]
    rng = random.Random(f"{seed}:{template_id}:{k}")
    used: set[str] = set()

    def take(v: Variant) -> Variant:
        used.add(EXERCISES[v[0]].name)
        return v

    cardio = take(_select_fixed(Pattern.CARDIO, t.canonical_cardio, k, rng, prev and prev.cardio, used, equipment))
    roller = take(_select_fixed(Pattern.MYOFASCIAL, t.canonical_roller, k, rng, prev and prev.roller, used,
                                equipment))

    drills = []
    for i in range(MAX_DRILLS):
        canonical = t.canonical_drills[i] if i < len(t.canonical_drills) else None
        drills.append(take(_select_fixed(
            Pattern.MOBILITY, canonical, k, rng, prev.drills[i] if prev else None, used, equipment)))

    # Pinned slots first, then the scarcest: when a pattern appears in both blocks (D3 hinge/lunge),
    # the slot with fewer options picks before the other can take the only change it had.
    slots = [(b, i, sl) for b, block in enumerate((t.strength, t.conditioning)) for i, sl in enumerate(block)]
    prevs = (prev.strength, prev.conditioning) if prev else None
    slots.sort(key=lambda x: (not (k == 0 and x[2].canonical is not None),
                              len(candidates(x[2].pattern, x[2].modalities, equipment))))
    chosen: dict[tuple[int, int], Variant] = {}
    for b, i, sl in slots:
        chosen[b, i] = take(_select_slot(sl, k, rng, prevs[b][i] if prevs else None, used, equipment))
    strength = tuple(chosen[0, i] for i in range(len(t.strength)))
    conditioning = tuple(chosen[1, i] for i in range(len(t.conditioning)))
    return DaySelection(cardio, roller, tuple(drills), strength, conditioning)


@dataclass
class _Chain:
    cycles: list[DaySelection]
    lock: threading.Lock


# One chain per (athlete seed, day template, equipment): ~6 per athlete, each a few hundred
# bytes per cycle. 4096 keeps ~680 athletes warm (tens of MB after a year of cycles); past
# that, evicted chains are rebuilt from cycle 0 on the next request.
@lru_cache(maxsize=4096)
def _chain(seed: str, template_id: str, equipment: Equipment) -> _Chain:
    return _Chain([], threading.Lock())


# The API serves sync routes from a thread pool; two requests extending the same
# chain at once would append out of order and shift every later cycle. Each chain
# has its own lock, so one athlete walking far ahead does not block the others.
_cache_lock = threading.Lock()


def select_day(seed: str, template_id: str, cycle_index: int, equipment: Equipment = None) -> DaySelection:
    """Variants for one day template in a given cycle.

    Each cycle depends on the previous one (to force a change), so this walks
    the chain from cycle 0; computed cycles are memoised per (seed, template, equipment).
    """
    if cycle_index < 0:
        raise ValueError("cycle_index must be >= 0")
    with _cache_lock:
        chain = _chain(seed, template_id, equipment)
    with chain.lock:
        cycles = chain.cycles
        while len(cycles) <= cycle_index:
            cycles.append(_next_selection(seed, template_id, len(cycles), cycles[-1] if cycles else None, equipment))
        return cycles[cycle_index]
