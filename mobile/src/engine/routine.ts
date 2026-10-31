import type { Routine, RoutineCheck, RoutineItem } from '../api/types';

export const SECTION_TITLE: Record<RoutineItem['section'], string> = {
  morning: 'Manhã',
  day: 'Durante o dia',
  night: 'Noite',
};

// Same rule as the server (routine.COMPLETE_SHARE): a day is complete at 80% of its items.
const COMPLETE_SHARE = 0.8;

export function isComplete(done: number, total: number): boolean {
  return total > 0 && done >= Math.ceil(total * COMPLETE_SHARE - 1e-9);
}

/**
 * The routine as it will look once the server stores this tick, shown before the answer arrives.
 * Items ticked by data stay done; water is done at its target.
 */
export function withCheck(r: Routine, itemId: string, check: RoutineCheck): Routine {
  const items = r.items.map((i) => {
    if (i.id !== itemId) return i;
    if (i.kind === 'water') {
      const value = check.value ?? i.value ?? 0;
      return { ...i, value, done: i.target != null && value >= i.target };
    }
    return { ...i, done: (i.auto && i.done) || !!check.done };
  });
  const done = items.filter((i) => i.done).length;
  const complete = isComplete(done, r.total);
  const week = r.week.map((d) => (d.day === r.day ? { ...d, done, complete } : d));
  return { ...r, items, done, complete, week };
}

export function routineSummary(r: Routine): { headline: string; remaining: number } {
  const needed = Math.max(0, Math.ceil(r.total * COMPLETE_SHARE - 1e-9) - r.done);
  if (r.done === r.total && r.total > 0) return { headline: 'Rotina completa. Nível Batman.', remaining: 0 };
  if (r.complete) return { headline: 'Dia cumprido. Feche o resto se der.', remaining: 0 };
  return { headline: `Faltam ${needed} para cumprir o dia`, remaining: needed };
}
