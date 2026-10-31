from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, Body, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from .. import nutrition as nu
from ..db import FoodEntry, FoodProduct, SupplementIntake, insert_new
from ..foods import Product, fetch_product
from .deps import AthleteDep, CurrentUser, Db, Http
from .schemas import (
    MAX_LOG_BATCH,
    AlertOut,
    Day,
    FoodEntryIn,
    FoodEntryOut,
    MacrosOut,
    MealPlanOut,
    NutritionDayOut,
    ProductOut,
    StapleOut,
    SupplementIn,
    SupplementOut,
    SyncResult,
    TotalsOut,
)
from .services import day_profile, reject_foreign_ids, session_energy

router = APIRouter(tags=["nutrition"])

PRODUCT_TTL = timedelta(days=30)
MISSING_PRODUCT_TTL = timedelta(days=1)
BARCODE_RE = re.compile(r"^\d{6,14}$")
SUPPLEMENT_IDS = nu.SUPPLEMENT_IDS


def _staple_out(st: nu.Staple) -> StapleOut:
    return StapleOut(id=st.id, name=st.name, category=st.category, kcal=st.kcal, protein=st.protein,
                     carbs=st.carbs, fat=st.fat, sodium_mg=st.sodium_mg, default_g=st.default_g, dairy=st.dairy)


def _alert_out(al: nu.Alert) -> AlertOut:
    return AlertOut(level=al.level, code=al.code, message=al.message, meal=al.meal, entry_id=al.entry_id)


def _macros(m: nu.Macros) -> MacrosOut:
    return MacrosOut(kcal=m.kcal, protein_g=m.protein_g, carbs_g=m.carbs_g, fat_g=m.fat_g)


def _totals(t: nu.Totals) -> TotalsOut:
    return TotalsOut(kcal=t.kcal, protein_g=t.protein_g, carbs_g=t.carbs_g, fat_g=t.fat_g, sodium_mg=t.sodium_mg)


def _entry(row: FoodEntry) -> nu.Entry:
    return nu.Entry(row.id, nu.Meal(row.meal), row.name, row.kcal, row.protein_g, row.carbs_g, row.fat_g,
                    row.sodium_mg, nu.Dairy(row.dairy), nu.Category(row.category) if row.category else None)


def _entry_out(row: FoodEntry) -> FoodEntryOut:
    return FoodEntryOut(id=row.id, day=row.day, meal=nu.Meal(row.meal), name=row.name, barcode=row.barcode,
                        grams=row.grams, kcal=round(row.kcal, 1), protein_g=round(row.protein_g, 1),
                        carbs_g=round(row.carbs_g, 1), fat_g=round(row.fat_g, 1), sodium_mg=round(row.sodium_mg),
                        dairy=nu.Dairy(row.dairy), category=nu.Category(row.category) if row.category else None)


def day_targets(s: Db, a, day: date, session_kcal: float) -> tuple[nu.Targets, str, bool]:
    """The day's targets for the athlete's goal, with the carb-cycling day kind and whether it has power work."""
    lbm = nu.lean_mass(a.bodyweight_kg, a.body_fat_pct, a.height_cm, a.sex)
    kind, power = day_profile(s, a, day)
    if a.nutrition_goal == "cycle":
        return nu.cycle_targets(lbm, a.bodyweight_kg, kind), kind, power  # type: ignore[arg-type]
    return nu.targets(lbm, session_kcal, a.nutrition_goal), kind, power


@router.get("/athletes/{athlete_id}/nutrition/{day}", response_model=NutritionDayOut)
def nutrition_day(day: Day, a: AthleteDep, s: Db) -> NutritionDayOut:
    session_kcal, source, training = session_energy(s, a, day)
    t, kind, power = day_targets(s, a, day, session_kcal)
    rows = list(s.scalars(select(FoodEntry).where(FoodEntry.athlete_id == a.id, FoodEntry.day == day)
                          .order_by(FoodEntry.created_at)))
    audit = nu.audit((_entry(r) for r in rows), t)
    taken = set(s.scalars(select(SupplementIntake.item_id)
                          .where(SupplementIntake.athlete_id == a.id, SupplementIntake.day == day)))
    return NutritionDayOut(
        goal=a.nutrition_goal,
        day_kind=kind if a.nutrition_goal == "cycle" else None,
        day=day,
        is_training_day=training,
        lbm_kg=t.lbm.kg,
        lbm_source=t.lbm.source,
        kcal_floor=t.kcal_floor,
        kcal_ceiling=t.kcal_ceiling,
        session_kcal=t.session_kcal,
        session_kcal_source=source,  # type: ignore[arg-type]
        target=_macros(t.total),
        sodium_min_mg=t.sodium_min_mg,
        sodium_max_mg=t.sodium_max_mg,
        consumed=_totals(audit.total),
        meals=[
            MealPlanOut(
                meal=m,
                target=_macros(t.by_meal[m]),
                carb_curfew=t.goal != "cycle" and nu.SPLIT[m]["carbs"] == 0,
                suggestions=[_staple_out(nu.STAPLES[i]) for i in nu.SUGGESTIONS[m]],
                consumed=_totals(audit.by_meal[m]),
            )
            # The plan's meals, plus any other one that has food logged (e.g. after switching plans).
            for m in nu.Meal if m in t.by_meal or audit.by_meal[m].kcal > 0
        ],
        alerts=[_alert_out(x) for x in audit.alerts],
        supplements=[SupplementOut(item_id=i, label=label, meal=m, taken=i in taken)
                     for i, label, m in nu.supplements_for(a.nutrition_goal, power)],
        entries=[_entry_out(r) for r in rows],
    )


def _resolve(s: Db, item: FoodEntryIn) -> nu.Entry:
    common = dict(id=str(item.id), meal=item.meal, name=item.name, grams=item.grams)
    if item.staple_id is not None:
        st = nu.STAPLES.get(item.staple_id)
        if st is None:
            raise HTTPException(422, f"unknown staple {item.staple_id!r}")
        return nu.entry_from_per100(**common, kcal=st.kcal, protein=st.protein, carbs=st.carbs, fat=st.fat,
                                    sodium_mg=st.sodium_mg, dairy=st.dairy, category=st.category)
    if item.barcode is not None and item.kcal is None:
        p = s.get(FoodProduct, item.barcode)
        if p is None or not p.found:
            raise HTTPException(422, f"barcode {item.barcode} not looked up; send nutrients manually")
        return nu.entry_from_per100(**common, kcal=p.kcal_100g, protein=p.protein_100g, carbs=p.carbs_100g,
                                    fat=p.fat_100g, sodium_mg=p.sodium_mg_100g, dairy=nu.Dairy(p.dairy),
                                    category=item.category)
    return nu.Entry(str(item.id), item.meal, item.name, item.kcal or 0, item.protein_g or 0, item.carbs_g or 0,
                    item.fat_g or 0, item.sodium_mg or 0, item.dairy, item.category)


@router.post("/athletes/{athlete_id}/food-entries", response_model=SyncResult)
def post_food_entries(
    body: Annotated[list[FoodEntryIn], Body(max_length=MAX_LOG_BATCH)], a: AthleteDep, s: Db
) -> SyncResult:
    ids = [str(i.id) for i in body]
    reject_foreign_ids(s, FoodEntry, ids, a)
    # Already-stored retries skip nutrient resolution; the insert itself is ON CONFLICT DO NOTHING.
    stored = set(s.scalars(select(FoodEntry.id).where(FoodEntry.id.in_(ids)))) if ids else set()
    rows = []
    for item in body:
        if str(item.id) in stored:
            continue
        e = _resolve(s, item)
        rows.append(dict(
            id=e.id, athlete_id=a.id, day=item.day, meal=e.meal.value, name=e.name, barcode=item.barcode,
            grams=item.grams, kcal=e.kcal, protein_g=e.protein_g, carbs_g=e.carbs_g, fat_g=e.fat_g,
            sodium_mg=e.sodium_mg, dairy=e.dairy.value, category=e.category.value if e.category else None,
        ))
    accepted = insert_new(s, FoodEntry, rows)
    s.commit()
    return SyncResult(accepted=accepted, duplicates=len(body) - accepted)


@router.delete("/athletes/{athlete_id}/food-entries/{entry_id}", status_code=204)
def delete_food_entry(entry_id: str, a: AthleteDep, s: Db) -> None:
    s.execute(delete(FoodEntry).where(FoodEntry.id == entry_id, FoodEntry.athlete_id == a.id))
    s.commit()


@router.put("/athletes/{athlete_id}/supplements/{day}", response_model=list[SupplementOut])
def put_supplement(day: Day, body: SupplementIn, a: AthleteDep, s: Db) -> list[SupplementOut]:
    if body.item_id not in SUPPLEMENT_IDS:
        raise HTTPException(422, f"unknown supplement {body.item_id!r}")
    row = s.get(SupplementIntake, (a.id, day, body.item_id))
    if body.taken and row is None:
        s.add(SupplementIntake(athlete_id=a.id, day=day, item_id=body.item_id))
    elif not body.taken and row is not None:
        s.delete(row)
    s.commit()
    taken = set(s.scalars(select(SupplementIntake.item_id)
                          .where(SupplementIntake.athlete_id == a.id, SupplementIntake.day == day)))
    return [SupplementOut(item_id=i, label=label, meal=m, taken=i in taken) for i, label, m in nu.SUPPLEMENTS]


@router.get("/foods/staples", response_model=list[StapleOut])
def staples(_: CurrentUser) -> list[StapleOut]:
    return [_staple_out(st) for st in nu.STAPLES.values()]


def product_alerts(p: Product | FoodProduct) -> list[AlertOut]:
    out: list[AlertOut] = []
    dairy = nu.Dairy(p.dairy)
    if dairy == nu.Dairy.CONTAINS:
        out.append(AlertOut(level="red", code="dairy", message=f"CONTÉM LATICÍNIO ({p.dairy_evidence})",
                            meal=None, entry_id=None))
    elif dairy == nu.Dairy.TRACES:
        out.append(AlertOut(level="amber", code="dairy_traces", message="Pode conter traços de leite",
                            meal=None, entry_id=None))
    elif dairy == nu.Dairy.ISOLATE:
        out.append(AlertOut(level="info", code="whey_isolate",
                            message="Whey isolado hidrolisado: exceção permitida pelo protocolo", meal=None,
                            entry_id=None))
    if p.sodium_mg_100g is not None:
        portion = p.serving_g or 100
        sodium = p.sodium_mg_100g * portion / 100
        if sodium > nu.SODIUM_MEAL_MAX_MG:
            msg = f"{round(sodium)} mg de sódio em {round(portion)} g — acima do limite por refeição"
            out.append(AlertOut(level="red", code="sodium_portion", message=msg, meal=None, entry_id=None))
        elif p.sodium_mg_100g > 400:
            out.append(AlertOut(level="amber", code="sodium_high", message="Alto teor de sódio", meal=None,
                                entry_id=None))
    return out


def _product_out(p: FoodProduct) -> ProductOut:
    return ProductOut(barcode=p.barcode, found=p.found, name=p.name, brand=p.brand, kcal_100g=p.kcal_100g,
                      protein_100g=p.protein_100g, carbs_100g=p.carbs_100g, fat_100g=p.fat_100g,
                      sodium_mg_100g=p.sodium_mg_100g, serving_g=p.serving_g, dairy=nu.Dairy(p.dairy),
                      dairy_evidence=p.dairy_evidence, alerts=product_alerts(p) if p.found else [])


@router.get("/foods/barcode/{code}", response_model=ProductOut)
def barcode(code: str, _: CurrentUser, s: Db, http: Http) -> ProductOut:
    if not BARCODE_RE.match(code):
        raise HTTPException(422, "invalid barcode")
    cached = s.get(FoodProduct, code)
    now = datetime.now(timezone.utc)
    if cached is not None:
        fetched = cached.fetched_at if cached.fetched_at.tzinfo else cached.fetched_at.replace(tzinfo=timezone.utc)
        if now - fetched < (PRODUCT_TTL if cached.found else MISSING_PRODUCT_TTL):
            return _product_out(cached)
    try:
        p = fetch_product(http, code)
    except httpx.HTTPError:
        if cached is not None:
            return _product_out(cached)  # stale beats nothing
        raise HTTPException(503, "Base de alimentos indisponível; registre manualmente.") from None
    row = cached or FoodProduct(barcode=code)
    for f in ("name", "brand", "kcal_100g", "protein_100g", "carbs_100g", "fat_100g", "sodium_mg_100g",
              "serving_g", "dairy_evidence", "found"):
        setattr(row, f, getattr(p, f))
    row.dairy = p.dairy.value
    row.fetched_at = now
    s.add(row)
    try:
        s.commit()
    except IntegrityError:  # a concurrent first lookup of the same code cached it first
        s.rollback()
        row = s.get(FoodProduct, code) or row
    return _product_out(row)
