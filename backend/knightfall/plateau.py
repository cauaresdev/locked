"""Plateau detection and the once-per-mesocycle effort calibration set.

Plateau: a main strength lift whose estimated 1RM has not set a new best (by
at least PLATEAU_MARGIN) in its last PLATEAU_EXPOSURES sessions, within the
last PLATEAU_WINDOW_DAYS. One stalled lift gets a note (change the variation
or the rep range); two or more at once point at fatigue, not the lift, and the
note suggests bringing the deload forward.

Calibration: RPE drives every load the app prescribes, and people misjudge
their reserve, mostly by underrating it. On the last loading week of each
mesocycle, the last set of the first main lift done on a machine, smith,
leg press, hack or cable (stations with safeties: no spotter needed) goes to
technical failure. That set, logged at RPE 10, is a true rep max; the 1RM
estimate takes it in as its best recent set, so the next loads correct
themselves.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, timedelta

from .catalog import EXERCISES
from .domain import BlockKind, Implement, Modality, Prescription, Session
from .records import SetRecord
from .strength import e1rm_history

PLATEAU_EXPOSURES = 3
PLATEAU_MIN_EARLIER = 1  # sessions before those, to compare against
PLATEAU_WINDOW_DAYS = 56
PLATEAU_MARGIN = 1.01  # a new best must beat the old one by 1 %: estimates wobble by about that

CALIBRATION_SAFE = frozenset({
    Implement.MACHINE, Implement.SMITH, Implement.LEG_PRESS, Implement.HACK_SQUAT, Implement.CHEST_PRESS,
    Implement.ROW_MACHINE, Implement.LAT_PULLDOWN, Implement.SHOULDER_PRESS, Implement.CABLE,
    Implement.LEG_EXTENSION, Implement.LEG_CURL,
})
CALIBRATION_CUE = ("última série: máximo de repetições até a falha técnica (a última repetição limpa) e marque "
                   "esforço 10; calibra as cargas do próximo mesociclo")


def stalled(history: Sequence[SetRecord], exercise_id: str, today: date) -> bool:
    since = today - timedelta(days=PLATEAU_WINDOW_DAYS)
    points = [p for p in e1rm_history(history, exercise_id) if since <= p.day < today]
    if len(points) < PLATEAU_EXPOSURES + PLATEAU_MIN_EARLIER:
        return False
    recent, earlier = points[-PLATEAU_EXPOSURES:], points[:-PLATEAU_EXPOSURES]
    return max(p.e1rm_kg for p in recent) < max(p.e1rm_kg for p in earlier) * PLATEAU_MARGIN


def _main_lifts(session: Session) -> list[Prescription]:
    seen: dict[str, Prescription] = {}
    for b in session.blocks:
        if b.kind != BlockKind.STRENGTH:
            continue
        for rx in b.exercises:
            if (rx.modality == Modality.STRENGTH and rx.implement != Implement.BODYWEIGHT
                    and rx.set_role != "backoff" and rx.exercise_id not in seen):
                seen[rx.exercise_id] = rx
    return list(seen.values())


def plateau_notices(session: Session, history: Sequence[SetRecord]) -> list[str]:
    if not session.is_training_day or session.deload or not history:
        return []
    today = max(r.performed_on for r in history) + timedelta(days=1)  # history ends the day before the session
    names = [rx.name for rx in _main_lifts(session) if stalled(history, rx.exercise_id, today)]
    if not names:
        return []
    if len(names) >= 2:
        return [f"{', '.join(names)}: sem recorde nos últimos {PLATEAU_EXPOSURES} treinos de cada. Vários "
                "básicos parados ao mesmo tempo costumam ser fadiga: considere antecipar o deload (uma semana "
                "leve) e confira sono e calorias."]
    return [f"{names[0]}: sem recorde nos últimos {PLATEAU_EXPOSURES} treinos. Se continuar, troque a variação "
            "(\"Usar sempre esta troca\") ou mude a faixa de repetições no próximo mesociclo."]


def with_calibration_set(rxs: list[Prescription]) -> list[Prescription]:
    """The main block with its first safe lift's last set marked to go to technical failure."""
    for i, rx in enumerate(rxs):
        ex = EXERCISES[rx.exercise_id]
        if (rx.modality == Modality.STRENGTH and rx.target_rpe is not None and rx.set_role != "backoff"
                and ex.implement in CALIBRATION_SAFE):
            out = list(rxs)
            out[i] = rx.model_copy(update={"amrap_last_set": True, "cues": [*rx.cues, CALIBRATION_CUE]})
            return out
    return rxs
