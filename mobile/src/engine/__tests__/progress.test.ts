import type { Prescription, Session } from '../../api/types';
import { blockLocked, emptyProgress, itemKey, sessionComplete } from '../progress';
import { addDays, clock, repsToLog, rxSummary, workSeconds } from '../format';

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

  it('completes when all sets and one AMRAP round are done', () => {
    const p = emptyProgress();
    p.checked = { [itemKey(1, 0)]: true, [itemKey(1, 1)]: true };
    p.setsDone[itemKey(2, 0)] = 2;
    expect(sessionComplete(session, p)).toBe(false);
    p.amrapRounds[3] = 4;
    expect(sessionComplete(session, p)).toBe(true);
  });
});

describe('format', () => {
  it('summarises prescriptions', () => {
    expect(rxSummary(rx({ sets: 6, reps: 4, tempo: { eccentric: 4, bottom_pause: 0, concentric: 4, top_pause: 1 },
      target_rpe: 8 }))).toBe('6 × 4 @ 4-0-4-1 · RPE 8');
    expect(rxSummary(rx({ mode: 'timed', sets: 4, duration_seconds: 60, suggested_load_kg: 27 }))).toBe('4 × 60 s · 27 kg');
    expect(rxSummary(rx({ mode: 'timed', duration_seconds: 900, intensity: '70% HR_MAX' }))).toBe('15 min · 70% HR_MAX');
    expect(rxSummary(rx({ mode: 'hold', sets: 2, hold_seconds: 15 }))).toBe('2 × 15 s iso');
    expect(rxSummary(rx({ reps_sequence: [5, 5, 5] }))).toBe('5-5-5');
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
