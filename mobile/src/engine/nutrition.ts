import type { Alert, FoodEntry, FoodEntryInput, Meal, NutritionDay, Product, Staple, Totals } from '../api/types';

export const SODIUM_MEAL_MAX_MG = 500;

export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Café da manhã',
  post_workout: 'Pós-treino / Almoço',
  snack: 'Lanche',
  dinner: 'Jantar',
};

const scale = (per100: number | null | undefined, grams: number) => Math.round(((per100 ?? 0) * grams) / 10) / 10;

export function entryFromStaple(id: string, day: string, meal: Meal, s: Staple, grams: number): FoodEntryInput {
  return {
    id,
    day,
    meal,
    name: s.name,
    grams,
    staple_id: s.id,
    // Nutrients are sent too so an offline-queued entry renders before the server resolves it.
    kcal: scale(s.kcal, grams),
    protein_g: scale(s.protein, grams),
    carbs_g: scale(s.carbs, grams),
    fat_g: scale(s.fat, grams),
    sodium_mg: scale(s.sodium_mg, grams),
    dairy: s.dairy,
    category: s.category,
  };
}

export function entryFromProduct(id: string, day: string, meal: Meal, p: Product, grams: number): FoodEntryInput {
  return {
    id,
    day,
    meal,
    name: p.brand ? `${p.name} (${p.brand})` : p.name,
    grams,
    barcode: p.barcode,
    kcal: scale(p.kcal_100g, grams),
    protein_g: scale(p.protein_100g, grams),
    carbs_g: scale(p.carbs_100g, grams),
    fat_g: scale(p.fat_100g, grams),
    sodium_mg: scale(p.sodium_mg_100g, grams),
    dairy: p.dairy,
  };
}

/**
 * Immediate scanner verdict for a portion, given the sodium already eaten in
 * the target meal: dairy is always red, and so is pushing the meal over 500 mg.
 */
export function portionAlerts(p: Product, grams: number, mealSodiumSoFar: number): Alert[] {
  const out: Alert[] = [];
  const base = { meal: null, entry_id: null };
  if (p.dairy === 'contains') out.push({ ...base, level: 'red', code: 'dairy', message: `CONTÉM LATICÍNIO (${p.dairy_evidence})` });
  else if (p.dairy === 'traces') out.push({ ...base, level: 'amber', code: 'dairy_traces', message: 'Pode conter traços de leite' });
  else if (p.dairy === 'isolate')
    out.push({ ...base, level: 'info', code: 'whey_isolate', message: 'Whey isolado hidrolisado: exceção do protocolo' });
  if (p.sodium_mg_100g == null) {
    out.push({ ...base, level: 'amber', code: 'sodium_unknown', message: 'Sódio não informado no rótulo' });
  } else {
    const sodium = scale(p.sodium_mg_100g, grams);
    const total = mealSodiumSoFar + sodium;
    if (total > SODIUM_MEAL_MAX_MG) {
      out.push({
        ...base,
        level: 'red',
        code: 'sodium_meal',
        message: `${Math.round(sodium)} mg de sódio → refeição com ${Math.round(total)} mg (máx. ${SODIUM_MEAL_MAX_MG})`,
      });
    }
  }
  return out;
}

const addTotals = (t: Totals, e: FoodEntryInput): Totals => ({
  kcal: Math.round(t.kcal + (e.kcal ?? 0)),
  protein_g: Math.round(t.protein_g + (e.protein_g ?? 0)),
  carbs_g: Math.round(t.carbs_g + (e.carbs_g ?? 0)),
  fat_g: Math.round(t.fat_g + (e.fat_g ?? 0)),
  sodium_mg: Math.round(t.sodium_mg + (e.sodium_mg ?? 0)),
});

/** Overlay entries still waiting in the offline outbox onto the last known day. */
export function withPending(day: NutritionDay, pending: FoodEntryInput[]): NutritionDay {
  const known = new Set(day.entries.map((e) => e.id));
  const fresh = pending.filter((p) => p.day === day.day && !known.has(p.id));
  if (fresh.length === 0) return day;
  const entries: FoodEntry[] = [
    ...day.entries,
    ...fresh.map((p) => ({
      id: p.id,
      day: p.day,
      meal: p.meal,
      name: p.name,
      barcode: p.barcode ?? null,
      grams: p.grams,
      kcal: p.kcal ?? 0,
      protein_g: p.protein_g ?? 0,
      carbs_g: p.carbs_g ?? 0,
      fat_g: p.fat_g ?? 0,
      sodium_mg: p.sodium_mg ?? 0,
      dairy: p.dairy ?? 'none',
      category: p.category ?? null,
    })),
  ];
  return {
    ...day,
    entries,
    consumed: fresh.reduce(addTotals, day.consumed),
    meals: day.meals.map((m) => ({
      ...m,
      consumed: fresh.filter((p) => p.meal === m.meal).reduce(addTotals, m.consumed),
    })),
  };
}
