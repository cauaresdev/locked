import type { Block, Prescription, Session } from '../api/types';

/**
 * "Tenho só X minutos": fit today's session into a time budget, on the device (works offline).
 *
 * Steps, each one only while the estimate is still over the budget:
 *   1. drop the finisher (an optional block: the plan already drops it on red days and deloads);
 *   2. pair accessories into supersets (no rest between the two exercises of a pair);
 *   3. one set less on each accessory (never below 2);
 *   4. main lifts: rest capped at 2 min and one back-off set less (never below 1);
 *   5. timed circuits (AMRAP blocks) shortened to what is left, never below 5 min.
 * The warm-up is never touched, and no exercise is removed: block order and position stay the same, so
 * sets already logged, swaps and the rest of the session's progress keep pointing at the right exercise.
 */

export const BUDGET_OPTIONS = [30, 45, 60, 75] as const;
export const SUPERSET_CUE = 'supersérie: sem descanso até o próximo exercício';
const MIN_ACCESSORY_SETS = 2;
const MAIN_REST_CAP = 120;
const MIN_AMRAP_MINUTES = 5;

export interface Budgeted {
  session: Session;
  minutes: number; // estimate after the changes
  changes: string[]; // what was cut, for the athlete
  fits: boolean;
}

function work(rx: Prescription): number {
  if (rx.duration_seconds) return rx.duration_seconds;
  if (rx.hold_seconds) return rx.hold_seconds * (rx.unilateral ? 2 : 1);
  return rx.unilateral ? 70 : 40;
}

function rest(rx: Prescription, block: Block, cap: number): number {
  return Math.min(rx.rest_seconds ?? block.rest_seconds, cap);
}

function blockSeconds(block: Block, cap: number): number {
  if (block.execution_style !== 'straight_sets') return block.duration_minutes * 60;
  return block.exercises.reduce((s, rx) => s + rx.sets * (work(rx) + rest(rx, block, cap)), 0);
}

export function estimateMinutes(session: Session): number {
  const seconds = session.blocks.reduce((s, b) => s + blockSeconds(b, session.rest_cap_seconds), 0);
  return Math.ceil(seconds / 60);
}

const isFinisher = (b: Block) => b.kind === 'conditioning' && b.execution_style === 'straight_sets';
const isAccessory = (rx: Prescription) => rx.modality === 'hypertrophy' && rx.set_role == null;
const isMainLift = (b: Block) => b.kind === 'strength' && b.execution_style === 'straight_sets';

function mapExercises(s: Session, fn: (rx: Prescription, block: Block, i: number) => Prescription): Session {
  return { ...s, blocks: s.blocks.map((b) => ({ ...b, exercises: b.exercises.map((rx, i) => fn(rx, b, i)) })) };
}

function supersetAccessories(s: Session): Session {
  return {
    ...s,
    blocks: s.blocks.map((b) => {
      if (!isMainLift(b)) return b;
      const out = [...b.exercises];
      for (let i = 0; i + 1 < out.length; i++) {
        const [a, next] = [out[i], out[i + 1]];
        // Two accessories in a row, neither already half of a superset (rest 0 on the first, or right after one).
        const free = (k: number) => out[k].rest_seconds !== 0 && !(k > 0 && out[k - 1].rest_seconds === 0);
        if (!isAccessory(a) || !isAccessory(next) || !free(i) || !free(i + 1)) continue;
        const sets = Math.min(a.sets, next.sets); // the pair alternates set for set
        out[i] = { ...a, sets, rest_seconds: 0, cues: [SUPERSET_CUE, ...a.cues] };
        out[i + 1] = { ...next, sets };
        i++;
      }
      return { ...b, exercises: out };
    }),
  };
}

export function fitToBudget(session: Session, budgetMinutes: number | null): Budgeted {
  const before = estimateMinutes(session);
  if (budgetMinutes == null || !session.is_training_day || before <= budgetMinutes) {
    return { session, minutes: before, changes: [], fits: true };
  }
  let s = session;
  const changes: string[] = [];
  const over = () => estimateMinutes(s) > budgetMinutes;

  if (s.blocks.some(isFinisher)) {
    s = { ...s, blocks: s.blocks.filter((b) => !isFinisher(b)) }; // always the last block: indices stay put
    changes.push('sem finalizador');
  }
  if (over()) {
    const paired = supersetAccessories(s);
    if (estimateMinutes(paired) < estimateMinutes(s)) {
      s = paired;
      changes.push('acessórios em supersérie');
    }
  }
  if (over()) {
    const trimmed = mapExercises(s, (rx) =>
      isAccessory(rx) && rx.sets > MIN_ACCESSORY_SETS ? { ...rx, sets: rx.sets - 1 } : rx);
    if (estimateMinutes(trimmed) < estimateMinutes(s)) {
      s = trimmed;
      changes.push('1 série a menos nos acessórios');
    }
  }
  if (over()) {
    const main = mapExercises(s, (rx, b) => {
      if (!isMainLift(b) || isAccessory(rx)) return rx;
      const sets = rx.set_role === 'backoff' && rx.sets > 1 ? rx.sets - 1 : rx.sets;
      const r = rx.rest_seconds ?? b.rest_seconds;
      return { ...rx, sets, rest_seconds: r > MAIN_REST_CAP ? MAIN_REST_CAP : rx.rest_seconds };
    });
    if (estimateMinutes(main) < estimateMinutes(s)) {
      s = main;
      changes.push('descanso dos básicos até 2 min e 1 back-off a menos');
    }
  }
  if (over()) {
    const amraps = s.blocks.filter((b) => b.execution_style === 'amrap');
    const others = estimateMinutes({ ...s, blocks: s.blocks.filter((b) => b.execution_style !== 'amrap') });
    if (amraps.length) {
      const each = Math.max(MIN_AMRAP_MINUTES, Math.floor((budgetMinutes - others) / amraps.length));
      s = {
        ...s,
        blocks: s.blocks.map((b) =>
          b.execution_style === 'amrap' && b.duration_minutes > each ? { ...b, duration_minutes: each } : b),
      };
      changes.push(`circuito de ${each} min`);
    }
  }
  const minutes = estimateMinutes(s);
  return { session: { ...s, target_duration_minutes: minutes }, minutes, changes, fits: minutes <= budgetMinutes };
}
