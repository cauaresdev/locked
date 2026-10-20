"""Barcode lookup via Open Food Facts, with dairy detection.

Dairy verdicts come primarily from OFF allergen/trace tags (en:milk), plus a
scan of ingredient tags for milk derivatives in EN/PT/ES/FR. Tags are matched
on whole hyphen-separated words, so "butternut-squash" is not butter, and
plant look-alikes (coconut milk, cocoa/nut butters, bean curd, cream of
tartar) are excluded. A hydrolysed whey isolate is classified separately
because the protocol allows it, and only when no other dairy is listed.
"""

from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass

import httpx

from .nutrition import Dairy

OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
OFF_FIELDS = ",".join([
    "product_name", "product_name_pt", "brands", "nutriments", "allergens_tags", "traces_tags",
    "ingredients_tags", "ingredients_text", "serving_quantity",
])
USER_AGENT = "ProjectKnightfall/0.2 (training app; contact: dev@knightfall.local)"

# Unambiguous milk derivatives.
MILK_WORDS = frozenset({
    "whey", "casein", "caseins", "caseinate", "caseinates", "caseina", "caseine", "lactose", "lactosa",
    "lactoserum", "lactalbumin", "lactoglobulin", "cheese", "cheeses", "queijo", "queijos", "queso", "quesos",
    "fromage", "fromages", "yogurt", "yoghurt", "iogurte", "yogur", "yaourt", "kefir", "ghee", "buttermilk",
    "milkfat", "requeijao", "dairy", "laticinio", "laticinios", "lacteo", "lacteos", "laitier", "laitiers",
})
# Milk words that plant products borrow ("coconut milk", "cocoa butter", "bean curd").
AMBIGUOUS_MILK_WORDS = frozenset({
    "milk", "leite", "leche", "lait", "butter", "manteiga", "mantequilla", "beurre", "cream", "creme", "nata",
    "curd", "coalhada",
})
NOT_MILK_WORDS = frozenset({
    "coconut", "coco", "almond", "amendoa", "amendoas", "amande", "almendra", "oat", "oats", "aveia", "avoine",
    "avena", "soy", "soya", "soja", "rice", "arroz", "riz", "cashew", "caju", "castanha", "castanhas", "nut",
    "nuts", "hazelnut", "avela", "noisette", "peanut", "amendoim", "cacahuete", "cacahuate", "arachide",
    "cocoa", "cacao", "cacau", "shea", "karite", "sesame", "gergelim", "sunflower", "girassol", "seed", "seeds",
    "sementes", "pistachio", "macadamia", "apple", "maca", "bean", "beans", "tofu", "tartar", "tartaro",
    "tartre", "vegetal", "vegetable", "plant", "body",
})
ISOLATE_WORDS = frozenset({"isolate", "isolated", "isolado", "isolada", "isolat", "isole", "isolee", "aislado",
                           "aislada"})
HYDROLYSED_WORDS = frozenset({"hydrolysed", "hydrolyzed", "hydrolysate", "hidrolisado", "hidrolisada",
                              "hydrolyse", "hydrolysee", "hidrolizado", "hidrolizada"})
# Generic parents OFF lists next to a whey isolate ("en:whey", "en:milk-proteins", "en:dairy"...).
ISOLATE_PARENT_WORDS = ISOLATE_WORDS | HYDROLYSED_WORDS | frozenset({
    "whey", "protein", "proteins", "proteina", "proteinas", "proteine", "proteines", "milk", "dairy", "lactoserum",
    "soro", "suero", "de", "do", "da", "del", "du", "leite", "leche", "lait", "lacteo", "lacteos", "laticinios",
})


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


def _words(tag: str) -> list[str]:
    name = tag.split(":", 1)[-1].lower()
    plain = "".join(c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c))
    return [w for w in plain.replace("_", "-").replace(" ", "-").split("-") if w]


def _is_milk(words: list[str]) -> bool:
    ws = set(words)
    if ws & MILK_WORDS:
        return True
    return bool(ws & AMBIGUOUS_MILK_WORDS) and not ws & NOT_MILK_WORDS


def _milk_tags(tags: list[str]) -> list[str]:
    return [tag.split(":", 1)[-1] for tag in tags if _is_milk(_words(tag))]


def _is_hydrolysed_isolate(words: list[str]) -> bool:
    ws = set(words)
    whey = bool({"whey", "lactoserum"} & ws or ({"soro", "suero"} & ws and {"leite", "leche"} & ws))
    return whey and bool(ws & ISOLATE_WORDS) and bool(ws & HYDROLYSED_WORDS)


def classify_dairy(p: dict) -> tuple[Dairy, str]:
    allergens = p.get("allergens_tags") or []
    ingredients = p.get("ingredients_tags") or []
    contains = sorted(set(_milk_tags(allergens) + _milk_tags(ingredients)))
    if contains:
        dairy_ingredients = [t for t in ingredients if _is_milk(_words(t))]
        isolates = [t for t in dairy_ingredients if _is_hydrolysed_isolate(_words(t))]
        # Every other dairy ingredient must be one of OFF's generic parents of that isolate.
        others = [t for t in dairy_ingredients if t not in isolates and not set(_words(t)) <= ISOLATE_PARENT_WORDS]
        if isolates and not others:
            return Dairy.ISOLATE, ", ".join(contains)
        return Dairy.CONTAINS, ", ".join(contains)
    traces = _milk_tags(p.get("traces_tags") or [])
    if traces:
        return Dairy.TRACES, ", ".join(sorted(set(traces)))
    return Dairy.NONE, ""


def _num(v) -> float | None:
    """A nutrient amount from OFF's loosely typed JSON; junk ("nan", "inf", negatives) reads as missing."""
    try:
        x = float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None
    return x if x is not None and math.isfinite(x) and x >= 0 else None


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
        # Crowd-sourced text: capped to the cache columns' size.
        name=str(p.get("product_name_pt") or p.get("product_name") or f"Produto {code}").strip()[:255],
        brand=str(p.get("brands"))[:255] if p.get("brands") else None,
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
        # Short: the lookup holds a worker thread, and the app falls back to manual entry.
        timeout=5,
    )
    if r.status_code == 404:
        return Product(barcode=code, found=False, name="Produto não encontrado")
    r.raise_for_status()
    return parse_product(code, r.json())
