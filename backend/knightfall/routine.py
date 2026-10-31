"""Batfleck daily routine: the habits around the training that the BvS prep ran on.

Wake early, fasted cardio, water by the litre, sunlight, supplements, the
session, evening mobility, screens off and an early bedtime so the sleep target
fits before the alarm. Every item can be ticked by hand; some also tick
themselves from data the app already has (last night's sleep, the Early Bird
check-in and window, the day's logged sets, the supplement checklist).

A day counts as complete at COMPLETE_SHARE of its items, so one miss does not
break a streak but a lazy day does. Pure logic: the API gathers the data.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

Section = Literal["morning", "day", "night"]
Kind = Literal["check", "water"]
DayType = Literal["training", "recovery", "rest"]

COMPLETE_SHARE = 0.8
WATER_ML_PER_KG = 35
WATER_ML_PER_KG_ATHLETE = 45  # carb-cycling plan: heavy, explosive training; no extra on top
WATER_TRAINING_EXTRA_ML = 500
WATER_STEP_ML = 250
WAKE_GRACE_MIN = 30  # a check-in up to this long after the alarm still counts as on time
SLEEP_TOLERANCE_H = 0.25
DEFAULT_SLEEP_TARGET_H = 8.0
EVENING_MOBILITY = ("Troca de quadril 90/90", "World's Greatest Stretch", "Rotação torácica",
                    "Alongamento Brettzel", "Respiração 4-7-8 (4 ciclos)")


@dataclass(frozen=True)
class ItemDef:
    id: str
    section: Section
    kind: Kind = "check"
    default_on: bool = True
    required: bool = False  # cannot be switched off


ITEMS: tuple[ItemDef, ...] = (
    ItemDef("sleep", "morning", required=True),
    ItemDef("wake", "morning"),
    ItemDef("water_wake", "morning"),
    ItemDef("fasted_cardio", "morning"),
    ItemDef("sunlight", "morning"),
    ItemDef("cold_shower", "morning", default_on=False),
    ItemDef("water", "day", kind="water", required=True),
    ItemDef("training", "day", required=True),
    ItemDef("supplements", "day"),
    ItemDef("steps", "day"),
    ItemDef("mobility", "night"),
    ItemDef("wind_down", "night", default_on=False),
    ItemDef("screens_off", "night"),
    ItemDef("bedtime", "night"),
)
ITEM_IDS = {i.id: i for i in ITEMS}
OPTIONAL_IDS = tuple(i.id for i in ITEMS if not i.required)
DEFAULT_ENABLED = frozenset(i.id for i in ITEMS if i.default_on)

OPTION_TITLES = {
    "wake": "Acordar no horário",
    "water_wake": "Água ao acordar",
    "fasted_cardio": "Cardio em jejum (Early Bird)",
    "sunlight": "Luz do sol pela manhã",
    "cold_shower": "Banho frio",
    "supplements": "Suplementos",
    "steps": "Passos",
    "mobility": "Mobilidade noturna",
    "wind_down": "Desacelerar antes de dormir",
    "screens_off": "Telas desligadas",
    "bedtime": "Horário de dormir",
}


def enabled_items(stored: str | None) -> frozenset[str]:
    """Stored as a comma list of the optional items switched on; NULL = the defaults."""
    if stored is None:
        return DEFAULT_ENABLED
    on = {x for x in stored.split(",") if x in ITEM_IDS}
    return frozenset(on | {i.id for i in ITEMS if i.required})


def encode_enabled(ids: Iterable[str]) -> str:
    return ",".join(sorted(set(ids) & set(OPTIONAL_IDS)))


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _hhmm(minutes: float) -> str:
    m = round(minutes) % (24 * 60)
    return f"{m // 60:02d}:{m % 60:02d}"


def bedtime(wake_time: str, sleep_target_h: float) -> str:
    return _hhmm(_minutes(wake_time) - sleep_target_h * 60)


def screens_off_time(wake_time: str, sleep_target_h: float) -> str:
    return _hhmm(_minutes(wake_time) - sleep_target_h * 60 - 60)


def water_target_ml(bodyweight_kg: float, day_type: DayType, goal: str = "cut") -> int:
    if goal == "cycle":
        base = bodyweight_kg * WATER_ML_PER_KG_ATHLETE
    else:
        base = bodyweight_kg * WATER_ML_PER_KG + (WATER_TRAINING_EXTRA_ML if day_type == "training" else 0)
    return int(math.ceil(base / WATER_STEP_ML) * WATER_STEP_ML)


def woke_on_time(woke_at_local: datetime | None, wake_time: str) -> bool:
    if woke_at_local is None:
        return False
    late = woke_at_local.hour * 60 + woke_at_local.minute - _minutes(wake_time)
    return late <= WAKE_GRACE_MIN


@dataclass(frozen=True)
class DayData:
    """What the API knows about one day besides the manual ticks."""

    day_type: DayType
    sleep_hours: float | None = None  # last night (the readiness entry of this day)
    woke_at_local: datetime | None = None  # Early Bird check-in, athlete's local time
    early_bird_complete: bool = False
    trained: bool = False  # sets logged
    supplements_taken: int = 0
    supplements_total: int = 0


@dataclass(frozen=True)
class Check:
    done: bool = False
    value: float | None = None


@dataclass(frozen=True)
class ItemState:
    id: str
    section: Section
    kind: Kind
    title: str
    detail: str | None
    done: bool
    auto: bool  # ticked by data, not by hand
    value: float | None = None
    target: float | None = None


@dataclass(frozen=True)
class Settings:
    wake_time: str
    sleep_target_h: float
    bodyweight_kg: float
    enabled: frozenset[str]
    goal: str = "cut"


def _fmt_h(h: float) -> str:
    whole = int(h)
    minutes = round((h - whole) * 60)
    if minutes == 60:
        whole, minutes = whole + 1, 0
    return f"{whole} h" if minutes == 0 else f"{whole} h {minutes:02d}"


def _litres(ml: float) -> str:
    return f"{ml / 1000:.2f}".rstrip("0").rstrip(".").replace(".", ",") + " L"


def items_for(cfg: Settings, data: DayData, checks: Mapping[str, Check]) -> list[ItemState]:
    """The day's routine, in order. Rest days drop the training item."""
    out: list[ItemState] = []
    bed = bedtime(cfg.wake_time, cfg.sleep_target_h)

    def add(item_id: str, title: str, detail: str | None, auto_done: bool, **kw) -> None:
        manual = checks.get(item_id, Check())
        done = kw.pop("done", None)
        out.append(ItemState(item_id, ITEM_IDS[item_id].section, ITEM_IDS[item_id].kind, title, detail,
                             done if done is not None else (auto_done or manual.done), auto_done, **kw))

    for item in ITEMS:
        if item.id not in cfg.enabled:
            continue
        match item.id:
            case "sleep":
                slept = data.sleep_hours
                ok = slept is not None and slept >= cfg.sleep_target_h - SLEEP_TOLERANCE_H
                detail = (f"{_fmt_h(slept)} de {_fmt_h(cfg.sleep_target_h)} na noite passada" if slept is not None
                          else f"Meta: {_fmt_h(cfg.sleep_target_h)}. Sincronize o relógio ou registre em Hoje.")
                add("sleep", "Sono", detail, ok)
            case "wake":
                add("wake", f"Acordar às {cfg.wake_time}", "Toque em \"Acordei\" no Early Bird ao levantar",
                    woke_on_time(data.woke_at_local, cfg.wake_time))
            case "water_wake":
                add("water_wake", "500 ml de água ao acordar", "Antes do café e do cardio", False)
            case "fasted_cardio":
                add("fasted_cardio", "Cardio em jejum", "20 min a 70–80% da FC máx. (frequência cardíaca máxima)",
                    data.early_bird_complete)
            case "sunlight":
                add("sunlight", "Luz do sol", "10 min ao ar livre pela manhã: acerta o relógio do sono", False)
            case "cold_shower":
                add("cold_shower", "Banho frio", "2 a 3 min no fim do banho", False)
            case "water":
                target = water_target_ml(cfg.bodyweight_kg, data.day_type, cfg.goal)
                drunk = checks.get("water", Check()).value or 0.0
                add("water", f"Água · {_litres(target)}", f"{_litres(drunk)} de {_litres(target)}", False,
                    done=drunk >= target, value=drunk, target=float(target))
            case "training":
                if data.day_type == "rest":
                    continue
                title = "Treino do dia" if data.day_type == "training" else "Recuperação ativa"
                add("training", title, "Marca sozinho quando você registra séries", data.trained)
            case "supplements":
                total = data.supplements_total
                add("supplements", "Suplementos", f"{data.supplements_taken} de {total} na aba Nutrição",
                    total > 0 and data.supplements_taken >= total)
            case "steps":
                add("steps", "8.000 passos", "Confira no relógio ou no celular", False)
            case "mobility":
                add("mobility", "Mobilidade noturna · 10 min", " · ".join(EVENING_MOBILITY), False)
            case "wind_down":
                add("wind_down", "Desacelerar", "Leitura ou respiração, luz baixa, sem trabalho", False)
            case "screens_off":
                add("screens_off", f"Telas desligadas às {screens_off_time(cfg.wake_time, cfg.sleep_target_h)}",
                    "Celular fora do quarto", False)
            case "bedtime":
                add("bedtime", f"Na cama às {bed}", f"Para dormir {_fmt_h(cfg.sleep_target_h)} até as "
                    f"{cfg.wake_time}", False)
    return out


@dataclass(frozen=True)
class Score:
    done: int
    total: int

    @property
    def complete(self) -> bool:
        return self.total > 0 and self.done >= math.ceil(self.total * COMPLETE_SHARE - 1e-9)


def score(items: Iterable[ItemState]) -> Score:
    items = list(items)
    return Score(sum(1 for i in items if i.done), len(items))


def streak(complete_days: set[date], today: date) -> int:
    """Consecutive complete days ending today, or yesterday while today is still in progress."""
    day = today if today in complete_days else today - timedelta(days=1)
    n = 0
    while day in complete_days:
        n += 1
        day -= timedelta(days=1)
    return n


def best_streak(complete_days: set[date]) -> int:
    best = 0
    for d in complete_days:
        if d - timedelta(days=1) in complete_days:
            continue
        n = 0
        while d + timedelta(days=n) in complete_days:
            n += 1
        best = max(best, n)
    return best
