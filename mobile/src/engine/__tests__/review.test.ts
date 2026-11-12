import type { Progress } from '../../api/types';
import { weeklyReview } from '../review';

const today = '2026-11-08'; // a Sunday
const days = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(2026, 10, 8 - (n - 1 - i));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});
const week = days(7);
const vol = (muscle: string, label: string, sets: number, min = 10, max = 20) =>
  ({ muscle, label, sets, previous_sets: sets, target_min: min, target_max: max });

function report(over: Partial<Progress> = {}): Progress {
  return {
    days: 30,
    strength: [
      { exercise_id: 'bench', name: 'Supino', e1rm_kg: 104, history: [['2026-10-28', 100], ['2026-11-05', 104]] },
      { exercise_id: 'squat', name: 'Hack', e1rm_kg: 150, history: [['2026-10-27', 150], ['2026-11-04', 150]] },
    ],
    muscle_volume: [vol('chest', 'Peito', 12), vol('back', 'Costas', 14), vol('quads', 'Quadríceps', 11),
      vol('neck', 'Pescoço', 0)],
    weight: { entries: [{ day: '2026-11-01', weight_kg: 90, trend_kg: 90 }, { day: today, weight_kg: 89.5, trend_kg: 89.5 }],
      trend_kg: 89.5, profile_weight_kg: 89.5 },
    readiness: week.map((day) => ({ day, score: 80, level: 'green', hrv_ms: null, hrv_method: 'rmssd', resting_hr: null,
      sleep_hours: 7.8, soreness: null })),
    armor_cycles: [],
    diet: week.map((day) => ({ day, kcal: 2400, kcal_target: 2450, protein_g: 190, protein_target_g: 200 })),
    attendance: week.map((day, i) => ({ day, planned: i % 2 === 0, trained: i % 2 === 0 })),
    ...over,
  } as Progress;
}

const ctx = { today, sleepTargetHours: 8, goal: 'cut' as const, bedtime: '21:30' };

test('a solid week says so and judges the numbers', () => {
  const r = weeklyReview(report(), ctx);
  expect(r.from).toBe('2026-11-02');
  expect(r.stats).toEqual([
    { label: 'Treinos', value: '4 de 4', ok: true },
    { label: 'Sono médio', value: '7,8 h', ok: true },
    { label: 'Força', value: '1 subiram · 0 caíram', ok: true },
    { label: 'Músculos na faixa', value: '3 de 3', ok: true }, // neck has the default band: not judged
    { label: 'Peso (média 7 dias)', value: '−0,5 kg', ok: true },
    { label: 'Dieta na meta', value: '7 de 7 dias', ok: true },
  ]);
  expect(r.actions).toEqual([expect.stringContaining('Semana sólida')]);
});

test('a rough week gets at most three actions, most important first', () => {
  const r = weeklyReview(report({
    attendance: week.map((day, i) => ({ day, planned: i % 2 === 0, trained: i === 0 })),
    readiness: week.map((day) => ({ day, score: 50, level: 'amber', hrv_ms: null, hrv_method: 'rmssd', resting_hr: null,
      sleep_hours: 6, soreness: null })),
    weight: { entries: [{ day: '2026-11-01', weight_kg: 90, trend_kg: 90 }, { day: today, weight_kg: 90.4, trend_kg: 90.4 }],
      trend_kg: 90.4, profile_weight_kg: 90.4 },
    diet: week.map((day) => ({ day, kcal: 2400, kcal_target: 2450, protein_g: 120, protein_target_g: 200 })),
  }), ctx);
  expect(r.actions).toHaveLength(3);
  expect(r.actions[0]).toContain('1 de 4 treinos');
  expect(r.actions[1]).toContain('Deite às 21:30');
  expect(r.actions[2]).toContain('não desceu no cut');
});

test('volume is a problem only when the athlete actually trained', () => {
  const lowChest = report({ muscle_volume: [vol('chest', 'Peito', 6), vol('back', 'Costas', 14)] });
  expect(weeklyReview(lowChest, ctx).actions[0]).toContain('peito (6 de 10)');
  const skipped = report({
    muscle_volume: [vol('chest', 'Peito', 6)],
    attendance: week.map((day, i) => ({ day, planned: i % 2 === 0, trained: false })),
  });
  expect(weeklyReview(skipped, ctx).actions.join(' ')).not.toContain('peito');
});

test('two lifts falling together read as fatigue', () => {
  const r = weeklyReview(report({ strength: [
    { exercise_id: 'a', name: 'Supino', e1rm_kg: 95, history: [['2026-10-28', 100], ['2026-11-05', 95]] },
    { exercise_id: 'b', name: 'Hack', e1rm_kg: 140, history: [['2026-10-27', 150], ['2026-11-04', 140]] },
  ] }), ctx);
  expect(r.actions[0]).toContain('Supino e Hack caíram');
});
