import type { Routine, RoutineItem } from '../../api/types';
import { isComplete, routineSummary, withCheck } from '../routine';

const item = (id: string, over: Partial<RoutineItem> = {}): RoutineItem => ({
  id,
  section: 'morning',
  kind: 'check',
  title: id,
  detail: null,
  done: false,
  auto: false,
  value: null,
  target: null,
  ...over,
});

function routine(items: RoutineItem[]): Routine {
  const done = items.filter((i) => i.done).length;
  return {
    day: '2026-10-30',
    wake_time: '04:00',
    bedtime: '20:00',
    screens_off: '19:00',
    sleep_target_hours: 8,
    water_target_ml: 3750,
    items,
    done,
    total: items.length,
    complete: isComplete(done, items.length),
    streak: 0,
    best_streak: 0,
    week: [{ day: '2026-10-30', done, total: items.length, complete: false }],
    options: [],
  };
}

test('80% of the items completes the day', () => {
  expect(isComplete(4, 5)).toBe(true);
  expect(isComplete(3, 5)).toBe(false);
  expect(isComplete(8, 10)).toBe(true);
  expect(isComplete(0, 0)).toBe(false);
});

test('a tick updates counts, completion and the week strip', () => {
  const r = routine([item('a', { done: true }), item('b', { done: true }), item('c', { done: true }), item('d'), item('e')]);
  const next = withCheck(r, 'd', { done: true });
  expect(next.done).toBe(4);
  expect(next.complete).toBe(true);
  expect(next.week[0]).toMatchObject({ done: 4, complete: true });
  expect(withCheck(next, 'd', { done: false }).complete).toBe(false);
});

test('auto items stay done and water is done at its target', () => {
  const r = routine([item('sleep', { done: true, auto: true }), item('water', { kind: 'water', value: 0, target: 3000 })]);
  expect(withCheck(r, 'sleep', { done: false }).items[0].done).toBe(true);
  expect(withCheck(r, 'water', { value: 2750 }).items[1].done).toBe(false);
  expect(withCheck(r, 'water', { value: 3000 }).items[1]).toMatchObject({ value: 3000, done: true });
});

test('summary says how many are left', () => {
  const r = routine([item('a', { done: true }), item('b'), item('c'), item('d'), item('e')]);
  expect(routineSummary(r)).toEqual({ headline: 'Faltam 3 para cumprir o dia', remaining: 3 });
});

test('a step count ticks steps at the target and keeps a manual tick below it', () => {
  const steps = item('steps', { kind: 'steps', target: 8000 });
  const counted = withCheck(routine([steps]), 'steps', { value: 9100 });
  expect(counted.items[0]).toMatchObject({ value: 9100, done: true, auto: true });
  const manual = withCheck(routine([{ ...steps, done: true }]), 'steps', { value: 3000 });
  expect(manual.items[0]).toMatchObject({ value: 3000, done: true, auto: false });
  const recount = withCheck(counted, 'steps', { value: 7000 }); // a watch never counts down, but a manual fix might
  expect(recount.items[0]).toMatchObject({ done: false, auto: false });
});
