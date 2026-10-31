"""Weekly hard sets per muscle group.

Each logged set counts once for the muscle its movement trains first (a bench
press is chest, a row is back): direct sets only, no fractional credit for the
helpers. Hypertrophy work is usually dosed at roughly 10–20 hard sets per muscle
per week; the app shows where each muscle sits against that band.
Prep, cardio, carries and sprints do not count.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import date, timedelta

from .catalog import EXERCISES
from .domain import Pattern
from .records import SetRecord

MUSCLES = ("chest", "back", "shoulders", "traps", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves",
           "abs", "neck")
MUSCLE_LABEL = {
    "chest": "Peito", "back": "Costas", "shoulders": "Ombros", "traps": "Trapézio", "biceps": "Bíceps",
    "triceps": "Tríceps", "quads": "Quadríceps", "hamstrings": "Posterior de coxa", "glutes": "Glúteos",
    "calves": "Panturrilha", "abs": "Abdômen", "neck": "Pescoço",
}
TARGET_SETS = (10, 20)  # weekly hard sets per muscle for hypertrophy

PATTERN_MUSCLE: dict[Pattern, str] = {
    Pattern.PUSH_HORIZONTAL: "chest",
    Pattern.CHEST_FLY: "chest",
    Pattern.PULL_VERTICAL: "back",
    Pattern.PULL_HORIZONTAL: "back",
    Pattern.PUSH_VERTICAL: "shoulders",
    Pattern.SHOULDERS: "shoulders",
    Pattern.REAR_DELT: "shoulders",
    Pattern.TRAPS: "traps",
    Pattern.SQUAT: "quads",
    Pattern.LUNGE: "quads",
    Pattern.KNEE_EXTENSION: "quads",
    Pattern.HINGE: "hamstrings",
    Pattern.KNEE_FLEXION: "hamstrings",
    Pattern.HIP_ISOLATION: "glutes",
    Pattern.CALVES: "calves",
    Pattern.CORE_FLEXION: "abs",
    Pattern.CORE_ANTI_ROTATION: "abs",
    Pattern.NECK: "neck",
}
GLUTE_HINGES = {"barbell_hip_thrust", "single_leg_hip_thrust", "smith_hip_thrust", "cable_pull_through"}
NOT_STRENGTH = {"jump_squat", "box_jump", "broad_jump", "jumping_lunge", "burpee", "med_ball_slam",
                "med_ball_chest_pass", "wall_ball"}  # plyometrics / conditioning, not hard sets


def muscle_of(exercise_id: str) -> str | None:
    ex = EXERCISES.get(exercise_id)
    if ex is None or exercise_id in NOT_STRENGTH:
        return None
    if ex.pattern == Pattern.ARMS:  # curls train the biceps; everything else in the arm pool is triceps
        return "biceps" if "curl" in exercise_id else "triceps"
    if exercise_id in GLUTE_HINGES:
        return "glutes"
    return PATTERN_MUSCLE.get(ex.pattern)


def weekly_sets(records: Iterable[SetRecord], today: date) -> tuple[Counter[str], Counter[str]]:
    """Sets per muscle in the 7 days ending today, and in the 7 days before those."""
    this_week, last_week = Counter[str](), Counter[str]()
    start = today - timedelta(days=6)
    for r in records:
        muscle = muscle_of(r.exercise_id)
        if muscle is None or r.performed_on > today:
            continue
        if r.performed_on >= start:
            this_week[muscle] += 1
        elif r.performed_on >= start - timedelta(days=7):
            last_week[muscle] += 1
    return this_week, last_week
