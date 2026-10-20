"""Nutrition engine — The Six Pack Diet Plan (Rehan Jalali) rules.

- Calories: 12-14 kcal per lb of lean body mass. The floor (12) is raised by
  the day's measured/estimated session expenditure and capped at 14.
- Carb curfew: complex carbs only at breakfast and post-workout/lunch;
  dinner is lean protein + fibrous cruciferous vegetables. The curfew alert
  ignores the whole VEG category (fibrous, non-starchy vegetables: crucifers
  and leafy greens), because foods scanned or typed in carry only a category,
  not a botanical family.
- No dairy (hydrolysed whey isolate in water is the protocol's one exception).
- Sodium: 1,500-2,000 mg/day, alert on any single meal above 500 mg.
- Flaxseed oil 1 tbsp twice a day, CLA with meals.

Macro split beyond the calorie formula (protein 1.1 g/lb LBM, fat >= 25 %)
is this app's choice, not part of the source protocol.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal

LB_PER_KG = 2.20462
KCAL_PER_LB_LBM_FLOOR = 12
KCAL_PER_LB_LBM_CEILING = 14
PROTEIN_G_PER_LB_LBM = 1.1
FAT_MIN_FRACTION = 0.25
FLAX_FAT_G = 2 * 13.6  # two tablespoons
SODIUM_MIN_MG = 1500
SODIUM_MAX_MG = 2000
SODIUM_MEAL_MAX_MG = 500
CURFEW_CARB_ALLOWANCE_G = 10  # non-vegetable carbs tolerated at dinner
BOER_MIN_FRACTION, BOER_MAX_FRACTION = 0.5, 0.95  # plausible lean share of body weight


class Dairy(StrEnum):
    NONE = "none"
    TRACES = "traces"  # "may contain milk"
    CONTAINS = "contains"
    ISOLATE = "isolate"  # hydrolysed whey isolate: allowed by the protocol


class Meal(StrEnum):
    BREAKFAST = "breakfast"
    POST_WORKOUT = "post_workout"
    SNACK = "snack"
    DINNER = "dinner"


class Category(StrEnum):
    CARB = "carb"
    PROTEIN = "protein"
    VEG = "veg"  # fibrous, non-starchy vegetables (exempt from the carb curfew)
    FAT = "fat"
    SUPPLEMENT = "supplement"


@dataclass(frozen=True)
class Staple:
    id: str
    name: str
    category: Category
    kcal: float  # per 100 g
    protein: float
    carbs: float
    fat: float
    sodium_mg: float
    default_g: float
    dairy: Dairy = Dairy.NONE


# Approximate per-100 g values (USDA FoodData Central, cooked unless noted).
STAPLES: dict[str, Staple] = {
    s.id: s
    for s in [
        Staple("oats", "Aveia em flocos (crua)", Category.CARB, 379, 13.2, 67.7, 6.5, 6, 60),
        Staple("sweet_potato", "Batata-doce assada", Category.CARB, 90, 2.0, 20.7, 0.2, 36, 200),
        Staple("brown_rice", "Arroz integral cozido", Category.CARB, 123, 2.7, 25.6, 1.0, 4, 150),
        Staple("wild_salmon", "Salmão selvagem", Category.PROTEIN, 182, 25.4, 0, 8.1, 56, 180),
        Staple("chicken_breast", "Peito de frango", Category.PROTEIN, 165, 31.0, 0, 3.6, 74, 180),
        Staple("turkey_breast", "Peito de peru", Category.PROTEIN, 147, 30.1, 0, 2.1, 99, 180),
        Staple("egg_whites", "Claras de ovo", Category.PROTEIN, 52, 10.9, 0.7, 0.2, 166, 200),
        Staple("broccoli", "Brócolis", Category.VEG, 35, 2.4, 7.2, 0.4, 41, 200),
        Staple("brussels_sprouts", "Couve-de-bruxelas", Category.VEG, 36, 2.6, 7.1, 0.5, 21, 200),
        Staple("spinach", "Espinafre", Category.VEG, 23, 2.9, 3.6, 0.4, 79, 100),
        Staple("flaxseed_oil", "Óleo de linhaça", Category.FAT, 884, 0, 0, 100, 0, 13.6),
        Staple("whey_isolate_hydrolyzed", "Whey isolado hidrolisado (com água)", Category.SUPPLEMENT,
               370, 87, 2, 1, 300, 30, Dairy.ISOLATE),
    ]
}

SUPPLEMENTS: list[tuple[str, str, Meal]] = [
    ("flaxseed_oil:breakfast", "Óleo de linhaça · 1 colher de sopa", Meal.BREAKFAST),
    ("cla:breakfast", "CLA (ácido linoleico conjugado) · 1 cápsula", Meal.BREAKFAST),
    ("whey_isolate:post_workout", "Whey isolado hidrolisado · com água", Meal.POST_WORKOUT),
    ("cla:post_workout", "CLA (ácido linoleico conjugado) · 1 cápsula", Meal.POST_WORKOUT),
    ("flaxseed_oil:dinner", "Óleo de linhaça · 1 colher de sopa", Meal.DINNER),
    ("cla:dinner", "CLA (ácido linoleico conjugado) · 1 cápsula", Meal.DINNER),
]

# Fraction of each macro per meal. Carbs only before the curfew.
SPLIT: dict[Meal, dict[str, float]] = {
    Meal.BREAKFAST: {"protein": 0.25, "carbs": 0.5, "fat": 0.25},
    Meal.POST_WORKOUT: {"protein": 0.25, "carbs": 0.5, "fat": 0.15},
    Meal.SNACK: {"protein": 0.25, "carbs": 0.0, "fat": 0.30},
    Meal.DINNER: {"protein": 0.25, "carbs": 0.0, "fat": 0.30},
}

SUGGESTIONS: dict[Meal, list[str]] = {
    Meal.BREAKFAST: ["oats", "egg_whites", "flaxseed_oil"],
    Meal.POST_WORKOUT: ["sweet_potato", "brown_rice", "chicken_breast", "whey_isolate_hydrolyzed"],
    Meal.SNACK: ["turkey_breast", "spinach"],
    Meal.DINNER: ["wild_salmon", "chicken_breast", "turkey_breast", "broccoli", "brussels_sprouts", "spinach"],
}


@dataclass(frozen=True)
class LeanMass:
    kg: float
    source: Literal["body_fat", "boer", "assumed"]


def lean_mass(weight_kg: float, body_fat_pct: float | None, height_cm: float | None, sex: str | None) -> LeanMass:
    if body_fat_pct is not None:
        return LeanMass(round(weight_kg * (1 - body_fat_pct / 100), 1), "body_fat")
    if height_cm and sex in ("male", "female"):
        if sex == "male":
            kg = 0.407 * weight_kg + 0.267 * height_cm - 19.2
        else:
            kg = 0.252 * weight_kg + 0.473 * height_cm - 48.3
        # Boer is a regression: at extreme height/weight it can exceed body weight (or collapse).
        kg = min(max(kg, BOER_MIN_FRACTION * weight_kg), BOER_MAX_FRACTION * weight_kg)
        return LeanMass(round(kg, 1), "boer")
    assumed_bf = {"male": 15, "female": 25}.get(sex or "", 20)
    return LeanMass(round(weight_kg * (1 - assumed_bf / 100), 1), "assumed")


@dataclass(frozen=True)
class Macros:
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


@dataclass(frozen=True)
class Targets:
    lbm: LeanMass
    kcal_floor: float
    kcal_ceiling: float
    session_kcal: float
    total: Macros
    by_meal: dict[Meal, Macros]
    sodium_min_mg: int = SODIUM_MIN_MG
    sodium_max_mg: int = SODIUM_MAX_MG


def targets(lbm: LeanMass, session_kcal: float) -> Targets:
    lbm_lb = lbm.kg * LB_PER_KG
    floor, ceiling = KCAL_PER_LB_LBM_FLOOR * lbm_lb, KCAL_PER_LB_LBM_CEILING * lbm_lb
    kcal = min(ceiling, floor + max(0.0, session_kcal))
    protein = PROTEIN_G_PER_LB_LBM * lbm_lb
    fat = max(FAT_MIN_FRACTION * kcal / 9, FLAX_FAT_G)
    carbs = max(0.0, (kcal - 4 * protein - 9 * fat) / 4)
    by_meal = {}
    for meal, split in SPLIT.items():
        p, c, f = protein * split["protein"], carbs * split["carbs"], fat * split["fat"]
        by_meal[meal] = Macros(round(4 * p + 4 * c + 9 * f), round(p), round(c), round(f))
    return Targets(
        lbm=lbm,
        kcal_floor=round(floor),
        kcal_ceiling=round(ceiling),
        session_kcal=round(session_kcal),
        total=Macros(round(kcal), round(protein), round(carbs), round(fat)),
        by_meal=by_meal,
    )


@dataclass(frozen=True)
class Entry:
    id: str
    meal: Meal
    name: str
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    sodium_mg: float
    dairy: Dairy
    category: Category | None = None


@dataclass(frozen=True)
class Alert:
    level: Literal["red", "amber", "info"]
    code: str
    message: str
    meal: Meal | None = None
    entry_id: str | None = None


@dataclass
class Totals:
    kcal: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    sodium_mg: float = 0

    def add(self, e: Entry) -> None:
        self.kcal += e.kcal
        self.protein_g += e.protein_g
        self.carbs_g += e.carbs_g
        self.fat_g += e.fat_g
        self.sodium_mg += e.sodium_mg

    def rounded(self) -> Totals:
        return Totals(*(round(v) for v in (self.kcal, self.protein_g, self.carbs_g, self.fat_g, self.sodium_mg)))


@dataclass
class DayAudit:
    total: Totals
    by_meal: dict[Meal, Totals] = field(default_factory=dict)
    alerts: list[Alert] = field(default_factory=list)


MEAL_LABEL = {
    Meal.BREAKFAST: "café da manhã",
    Meal.POST_WORKOUT: "pós-treino/almoço",
    Meal.SNACK: "lanche",
    Meal.DINNER: "jantar",
}


def audit(entries: Iterable[Entry], t: Targets) -> DayAudit:
    entries = list(entries)
    total = Totals()
    by_meal = {m: Totals() for m in Meal}
    alerts: list[Alert] = []

    for e in entries:
        total.add(e)
        by_meal[e.meal].add(e)
        if e.dairy == Dairy.CONTAINS:
            alerts.append(Alert("red", "dairy", f"Laticínio detectado: {e.name}", e.meal, e.id))
        elif e.dairy == Dairy.TRACES:
            alerts.append(Alert("amber", "dairy_traces", f"Pode conter leite: {e.name}", e.meal, e.id))

    for meal, mt in by_meal.items():
        if mt.sodium_mg > SODIUM_MEAL_MAX_MG:
            alerts.append(Alert("red", "sodium_meal",
                                f"Sódio no {MEAL_LABEL[meal]}: {round(mt.sodium_mg)} mg (máx. {SODIUM_MEAL_MAX_MG})",
                                meal))
    curfew_carbs = sum(e.carbs_g for e in entries
                       if e.meal in (Meal.SNACK, Meal.DINNER) and e.category != Category.VEG)
    if curfew_carbs > CURFEW_CARB_ALLOWANCE_G:
        alerts.append(Alert("amber", "carb_curfew",
                            f"Toque de recolher: {round(curfew_carbs)} g de carboidrato após o pós-treino",
                            Meal.DINNER))
    if total.sodium_mg > SODIUM_MAX_MG:
        alerts.append(Alert("red", "sodium_day", f"Teto diário de sódio estourado: {round(total.sodium_mg)} mg"))
    elif total.sodium_mg > 0.9 * SODIUM_MAX_MG:
        alerts.append(Alert("amber", "sodium_day_near", f"Sódio do dia em {round(total.sodium_mg)} mg"))
    if t.total.kcal > 0 and total.kcal > 1.1 * t.total.kcal:
        alerts.append(Alert("amber", "kcal_over", f"Calorias {round(total.kcal)} acima da meta {round(t.total.kcal)}"))

    return DayAudit(total.rounded(), {m: v.rounded() for m, v in by_meal.items()}, alerts)


def entry_from_per100(
    *, id: str, meal: Meal, name: str, grams: float, kcal: float | None, protein: float | None,
    carbs: float | None, fat: float | None, sodium_mg: float | None, dairy: Dairy, category: Category | None,
) -> Entry:
    f = grams / 100
    return Entry(id, meal, name, (kcal or 0) * f, (protein or 0) * f, (carbs or 0) * f, (fat or 0) * f,
                 (sodium_mg or 0) * f, dairy, category)
