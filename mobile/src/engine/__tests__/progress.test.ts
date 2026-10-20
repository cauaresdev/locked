import type { Prescription, Session } from '../../api/types';
import {
  applySwaps,
  blockLocked,
  emptyProgress,
  itemKey,
  sessionComplete,
  withLastSetUndone,
  withSetLogged,
} from '../progress';
import { addDays, clock, formatKgM, parseDecimal, repsToLog, rxSummary, workSeconds } from '../format';

const rx = (over: Partial<Prescription>): Prescription => ({
  exercise_id: 'x',
  name: 'X',
  pattern: 'pull_vertical',
  implement: 'bodyweight',
  modality: 'strength',
  mode: 'reps',
  sets: 1,
  duration_seconds: null,
  reps: null,
  reps_per_side: null,
  reps_sequence: null,
  hold_seconds: null,
  intra_set_rest_seconds: null,
  tempo: null,
  unilateral: false,
  target_rpe: null,
  suggested_load_kg: null,
  intensity: null,
  cues: [],
  ...over,
});

const session: Session = {
  protocol_id: 'p',
  tier: 'brawler',
  cycle_index: 0,
  cycle_day: 1,
  cycle_length: 8,
  cycle_structure: '6_on_2_off',
  deload: false,
  is_training_day: true,
  day_name: 'Pull + Carry',
  target_duration_minutes: 94,
  rest_cap_seconds: 60,
  readiness: null,
  notices: [],
  blocks: [
    { order: 1, kind: 'prep', name: 'Prep', duration_minutes: 32, execution_style: 'checklist', mandatory_lock: true,
      rest_seconds: 0, exercises: [rx({ mode: 'timed', duration_seconds: 900 }), rx({ reps: 5 })] },
    { order: 2, kind: 'strength', name: 'Str', duration_minutes: 40, execution_style: 'straight_sets',
      mandatory_lock: false, rest_seconds: 60, exercises: [rx({ sets: 2, reps: 4 })] },
    { order: 3, kind: 'conditioning', name: 'AMRAP', duration_minutes: 22, execution_style: 'amrap',
      mandatory_lock: false, rest_seconds: 30, exercises: [rx({ reps: 15 })] },
  ],
};

describe('block lock', () => {
  it('locks strength and conditioning until prep is fully checked', () => {
    const p = emptyProgress();
    expect(blockLocked(session, 1, p)).toBe(false);
    expect(blockLocked(session, 2, p)).toBe(true);
    p.checked[itemKey(1, 0)] = true;
    expect(blockLocked(session, 2, p)).toBe(true);
    p.checked[itemKey(1, 1)] = true;
    expect(blockLocked(session, 2, p)).toBe(false);
    expect(blockLocked(session, 3, p)).toBe(false);
  });

  it('completes only once the AMRAP block is closed, not on its first round', () => {
    const p = emptyProgress();
    p.checked = { [itemKey(1, 0)]: true, [itemKey(1, 1)]: true };
    p.setsDone[itemKey(2, 0)] = 2;
    p.amrapRounds[3] = 1;
    expect(sessionComplete(session, p)).toBe(false); // minutes of AMRAP still left
    p.amrapDone = { 3: true };
    expect(sessionComplete(session, p)).toBe(true);
  });

  it('keeps progress saved before amrapDone existed complete', () => {
    const { amrapDone: _, amrapEndsAt: __, ...old } = emptyProgress();
    old.checked = { [itemKey(1, 0)]: true, [itemKey(1, 1)]: true };
    old.setsDone[itemKey(2, 0)] = 2;
    old.amrapRounds[3] = 4;
    expect(sessionComplete(session, old)).toBe(true);
  });
});

describe('format', () => {
  it('summarises prescriptions', () => {
    expect(rxSummary(rx({ sets: 6, reps: 4, tempo: { eccentric: 4, bottom_pause: 0, concentric: 4, top_pause: 1 },
      target_rpe: 8 }))).toBe('6 × 4 · cadência 4-0-4-1 s · esforço 8/10 (RPE)');
    expect(rxSummary(rx({ mode: 'timed', sets: 4, duration_seconds: 60, suggested_load_kg: 27 }))).toBe('4 × 60 s · 27 kg');
    expect(rxSummary(rx({ mode: 'timed', duration_seconds: 900, intensity: '70% HR_MAX' }))).toBe('15 min · 70% HR_MAX');
    expect(rxSummary(rx({ mode: 'hold', sets: 2, hold_seconds: 15 }))).toBe('2 × 15 s isometria');
    expect(rxSummary(rx({ reps_sequence: [5, 5, 5] }))).toBe('5-5-5');
    expect(rxSummary(rx({ reps: 5, suggested_load_kg: 82.5 }))).toBe('5 · 82,5 kg');
  });

  it('parses numbers typed the Brazilian way', () => {
    expect(parseDecimal('82,5')).toBe(82.5);
    expect(parseDecimal('82.5')).toBe(82.5);
    expect(parseDecimal('1.500')).toBe(1500);
    expect(parseDecimal('1.500,5')).toBe(1500.5);
    expect(parseDecimal(' 12 ')).toBe(12);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('1,2,3')).toBeNull();
  });

  it('formats load capacity with pt-BR decimals', () => {
    expect(formatKgM(9999)).toBe('9.999');
    expect(formatKgM(12345)).toBe('12,3 k');
    expect(formatKgM(2_500_000)).toBe('2,50 M');
  });

  it('computes per-set work', () => {
    expect(repsToLog(rx({ reps_per_side: 6 }))).toBe(6);
    expect(repsToLog(rx({ reps_sequence: [5, 5, 5] }))).toBe(5);
    expect(workSeconds(rx({ mode: 'hold', hold_seconds: 2, reps_per_side: 8 }))).toBe(32);
    expect(workSeconds(rx({ mode: 'timed', duration_seconds: 40, unilateral: true }))).toBe(80);
  });

  it('formats clocks and dates', () => {
    expect(clock(61)).toBe('01:01');
    expect(clock(-3)).toBe('00:00');
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
  });
});

describe('undo and swaps', () => {
  it('logs and undoes sets in order', () => {
    let p = emptyProgress();
    p = withSetLogged(p, '2:0', 'a');
    p = withSetLogged(p, '2:0', 'b');
    expect(p.setsDone['2:0']).toBe(2);
    const first = withLastSetUndone({ ...p, finishedAt: 123 }, '2:0');
    expect(first.logId).toBe('b');
    expect(first.progress.setsDone['2:0']).toBe(1);
    expect(first.progress.finishedAt).toBeNull(); // the session is open again
    const second = withLastSetUndone(first.progress, '2:0');
    expect(second.logId).toBe('a');
    expect(withLastSetUndone(second.progress, '2:0').logId).toBeNull(); // nothing left
  });

  it('applies swaps to the session the athlete sees', () => {
    const alt = rx({ exercise_id: 'swapped', name: 'Swapped', sets: 2 });
    const p = { ...emptyProgress(), swaps: { [itemKey(2, 0)]: alt } };
    const view = applySwaps(session, p);
    expect(view.blocks.find((b) => b.order === 2)!.exercises[0].exercise_id).toBe('swapped');
    expect(applySwaps(session, emptyProgress())).toBe(session);
  });
});
