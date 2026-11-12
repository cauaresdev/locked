jest.mock('expo-notifications', () => ({}));

/* eslint-disable import/first */
import { parseTime } from '../engine/format';
import { trainingReminderPlan } from '../notifications';
/* eslint-enable import/first */

const day = (d: string, training = true) =>
  ({ day: d, is_training_day: training, day_name: 'Superior A', target_duration_minutes: 62 });

test('pre-workout meal and heads-up on training days only, never in the past', () => {
  const now = new Date(2026, 10, 6, 17, 0); // 17:00 on the 6th
  const plan = trainingReminderPlan('18:30', [day('2026-11-06'), day('2026-11-07', false), day('2026-11-08')], now);
  expect(plan.map((p) => p.id)).toEqual(['training-2026-11-06-go', 'training-2026-11-08-meal', 'training-2026-11-08-go']);
  expect(plan[0].date).toEqual(new Date(2026, 10, 6, 18, 15)); // 17:00 meal already gone
  expect(plan[1].date).toEqual(new Date(2026, 10, 8, 17, 0));
  expect(plan[1].body).toContain('Treino às 18:30');
  expect(plan[2].body).toBe('Superior A · cerca de 62 min. Aqueça e abra o app.');
});

test('typed training times are normalised', () => {
  expect(parseTime('18:30')).toBe('18:30');
  expect(parseTime('1830')).toBe('18:30');
  expect(parseTime('7:05')).toBe('07:05');
  expect(parseTime('18h30')).toBe('18:30');
  expect(parseTime('25:00')).toBeNull();
  expect(parseTime('abc')).toBeNull();
});
