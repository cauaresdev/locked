import type { NutritionDay, Product, Staple } from '../../api/types';
import { entryFromProduct, entryFromStaple, portionAlerts, withPending, withoutDeleted } from '../nutrition';

const product = (over: Partial<Product> = {}): Product => ({
  barcode: '789', found: true, name: 'Sopa', brand: null, kcal_100g: 350, protein_100g: 8, carbs_100g: 60,
  fat_100g: 8, sodium_mg_100g: 2000, serving_g: 60, dairy: 'none', dairy_evidence: '', alerts: [], ...over,
});

it('scales staples and products per gram', () => {
  const oats: Staple = { id: 'oats', name: 'Aveia', category: 'carb', kcal: 379, protein: 13.2, carbs: 67.7, fat: 6.5,
    sodium_mg: 6, default_g: 60, dairy: 'none' };
  expect(entryFromStaple('1', '2026-03-02', 'breakfast', oats, 80)).toMatchObject({ kcal: 303.2, carbs_g: 54.2,
    staple_id: 'oats', category: 'carb' });
  expect(entryFromProduct('2', '2026-03-02', 'dinner', product(), 60)).toMatchObject({ sodium_mg: 1200, barcode: '789' });
});

it('flags dairy and meal sodium immediately', () => {
  expect(portionAlerts(product({ sodium_mg_100g: 100 }), 100, 0)).toEqual([]);
  expect(portionAlerts(product({ sodium_mg_100g: 100 }), 100, 450).map((a) => a.code)).toEqual(['sodium_meal']);
  expect(portionAlerts(product({ dairy: 'contains', dairy_evidence: 'milk', sodium_mg_100g: 0 }), 50, 0)
    .map((a) => a.level)).toEqual(['red']);
  expect(portionAlerts(product({ sodium_mg_100g: null }), 50, 0).map((a) => a.code)).toEqual(['sodium_unknown']);
});

it('overlays pending entries onto the cached day', () => {
  const zero = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sodium_mg: 0 };
  const day = { day: '2026-03-02', entries: [], consumed: zero,
    meals: [{ meal: 'dinner', consumed: zero }, { meal: 'breakfast', consumed: zero }] } as unknown as NutritionDay;
  const pending = [entryFromProduct('x', '2026-03-02', 'dinner', product(), 60),
    entryFromProduct('y', '2026-03-03', 'dinner', product(), 60)];
  const out = withPending(day, pending);
  expect(out.entries.map((e) => e.id)).toEqual(['x']);
  expect(out.consumed.sodium_mg).toBe(1200);
  expect(out.meals[0].consumed.sodium_mg).toBe(1200);
  expect(out.meals[1].consumed.sodium_mg).toBe(0);
});

it('hides entries whose delete is still queued', () => {
  const zero = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sodium_mg: 0 };
  const day = { day: '2026-03-02', entries: [], consumed: zero, alerts: [],
    meals: [{ meal: 'dinner', consumed: zero }, { meal: 'breakfast', consumed: zero }] } as unknown as NutritionDay;
  const both = withPending(day, [entryFromProduct('x', '2026-03-02', 'dinner', product(), 60),
    entryFromProduct('z', '2026-03-02', 'breakfast', product(), 30)]);
  const out = withoutDeleted({ ...both, alerts: [{ level: 'red', code: 'sodium_meal', message: '', meal: 'dinner', entry_id: 'x' }] },
    ['x', 'unknown']);
  expect(out.entries.map((e) => e.id)).toEqual(['z']);
  expect(out.alerts).toEqual([]);
  expect(out.consumed.sodium_mg).toBe(600);
  expect(out.meals[0].consumed.sodium_mg).toBe(0);
  expect(out.meals[1].consumed.sodium_mg).toBe(600);
  expect(withoutDeleted(both, [])).toBe(both);
});
