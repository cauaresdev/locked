"""Barcode lookup via Open Food Facts, with dairy detection.

Dairy verdicts come from OFF allergen/trace tags plus a scan of ingredient
tags for milk derivatives (whey, casein, lactose, butter...). A hydrolysed
whey isolate is classified separately because the protocol allows it.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from .nutrition import Dairy

OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
OFF_FIELDS = ",".join([
    "product_name", "product_name_pt", "brands", "nutriments", "allergens_tags", "traces_tags",
    "ingredients_tags", "ingredients_text", "serving_quantity",
])
USER_AGENT = "ProjectKnightfall/0.2 (training app; contact: dev@knightfall.local)"

MILK_MARKERS = (
    "milk", "whey", "casein", "caseinate", "lactose", "butter", "cream", "cheese", "yogurt", "yoghurt",
    "lactoserum", "buttermilk", "ghee", "milkfat", "milk-fat", "curd", "kefir", "leite", "soro-de-leite",
    "lactalbumin", "lactoglobulin",
)
NOT_MILK = ("coconut-milk", "almond-milk", "oat-milk", "soy-milk", "rice-milk", "cocoa-butter", "peanut-butter",
            "shea-butter", "nut-butter")


@dataclass(frozen=True)
class Product:
    barcode: str
    found: bool
    name: str
    brand: str | None = None
    kcal_100g: float | None = None
    protein_100g: float | None = None
    carbs_100g: float | None = None
    fat_100g: float | None = None
    sodium_mg_100g: float | None = None
    serving_g: float | None = None
    dairy: Dairy = Dairy.NONE
    dairy_evidence: str = ""


def _milk_tags(tags: list[str]) -> list[str]:
    hits = []
    for tag in tags:
        name = tag.split(":", 1)[-1]
        if any(n in name for n in NOT_MILK):
            continue
        if any(m in name for m in MILK_MARKERS):
            hits.append(name)
    return hits


def classify_dairy(p: dict) -> tuple[Dairy, str]:
    allergens = p.get("allergens_tags") or []
    ingredients = p.get("ingredients_tags") or []
    contains = sorted(set(_milk_tags(allergens) + _milk_tags(ingredients)))
    if contains:
        text = " ".join([p.get("product_name") or "", p.get("ingredients_text") or "", *ingredients]).lower()
        hydrolysed = any(w in text for w in ("hydrolys", "hydrolyz", "hidrolis"))
        only_whey = all("whey" in c or "lactoserum" in c or c == "milk" for c in contains)
        if hydrolysed and "isolat" in text and only_whey:
            return Dairy.ISOLATE, ", ".join(contains)
        return Dairy.CONTAINS, ", ".join(contains)
    traces = _milk_tags(p.get("traces_tags") or [])
    if traces:
        return Dairy.TRACES, ", ".join(sorted(set(traces)))
    return Dairy.NONE, ""


def _num(v) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def parse_product(code: str, payload: dict) -> Product:
    if payload.get("status") != 1 or not payload.get("product"):
        return Product(barcode=code, found=False, name="Produto não encontrado")
    p = payload["product"]
    n = p.get("nutriments") or {}
    kcal = _num(n.get("energy-kcal_100g"))
    if kcal is None and (kj := _num(n.get("energy_100g"))) is not None:
        kcal = kj / 4.184
    sodium_g = _num(n.get("sodium_100g"))
    if sodium_g is None and (salt := _num(n.get("salt_100g"))) is not None:
        sodium_g = salt * 0.4
    dairy, evidence = classify_dairy(p)
    return Product(
        barcode=code,
        found=True,
        name=(p.get("product_name_pt") or p.get("product_name") or f"Produto {code}").strip(),
        brand=(p.get("brands") or None),
        kcal_100g=round(kcal, 1) if kcal is not None else None,
        protein_100g=_num(n.get("proteins_100g")),
        carbs_100g=_num(n.get("carbohydrates_100g")),
        fat_100g=_num(n.get("fat_100g")),
        sodium_mg_100g=round(sodium_g * 1000, 1) if sodium_g is not None else None,
        serving_g=_num(p.get("serving_quantity")),
        dairy=dairy,
        dairy_evidence=evidence[:500],
    )


def fetch_product(client: httpx.Client, code: str) -> Product:
    r = client.get(
        OFF_URL.format(code=code),
        params={"fields": OFF_FIELDS},
        headers={"User-Agent": USER_AGENT},
        timeout=10,
    )
    if r.status_code == 404:
        return Product(barcode=code, found=False, name="Produto não encontrado")
    r.raise_for_status()
    return parse_product(code, r.json())
