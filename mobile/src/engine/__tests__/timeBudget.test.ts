import type { Block, Prescription, Session } from '../../api/types';
import { estimateMinutes, fitToBudget, SUPERSET_CUE } from '../timeBudget';

const rx = (id: string, over: Partial<Prescription> = {}): Prescription => ({
  exercise_id: id, name: id, pattern: 'push_horizontal', implement: 'machine', modality: 'hypertrophy', mode: 'reps',
  sets: 3, duration_seconds: null, reps: 10, reps_per_side: null, reps_sequence: null, hold_seconds: null,
  intra_set_rest_seconds: null, reps_max: 12, distance_m: null, rest_seconds: 60, set_role: null, last_set: null,
  best_e1rm_kg: null, warmup_sets: [], amrap_last_set: false, tempo: null, unilateral: false, target_rpe: 8,
  suggested_load_kg: null, intensity: null, cues: [], ...over,
});

const block = (order: number, kind: Block['kind'], exercises: Prescription[], over: Partial<Block> = {}): Block => ({
  order, kind, name: kind, duration_minutes: 8, execution_style: 'straight_sets', mandatory_lock: false,
  rest_seconds: 90, exercises, ...over,
});

const session: Session = {
  protocol_id: 'p', tier: 'upper_lower', cycle_index: 0, cycle_day: 1, cycle_length: 7, cycle_structure: '4_of_7',
  meso_week: 1, meso_length: 6, is_training_day: true, day_name: 'Superior', target_duration_minutes: 80,
  rest_cap_seconds: 240, readiness: null, deload: false, notices: [],
  blocks: [
    block(1, 'prep', [rx('bike', { mode: 'timed', modality: 'prep', duration_seconds: 300, sets: 1, target_rpe: null })],
      { execution_style: 'checklist', mandatory_lock: true }),
    block(2, 'strength', [
      rx('bench', { modality: 'strength', set_role: 'top', sets: 1, rest_seconds: 180 }),
      rx('bench', { modality: 'strength', set_role: 'backoff', sets: 3, rest_seconds: 150 }),
      rx('row', { modality: 'strength', sets: 3, rest_seconds: 150 }),
    ]),
    block(3, 'strength', [rx('fly', { sets: 4 }), rx('lateral', { sets: 4 }), rx('curl'), rx('pressdown')]),
    block(4, 'conditioning', [rx('walk', { mode: 'timed', duration_seconds: 600, sets: 1, rest_seconds: 0 })]),
  ],
};

test('no budget, or a session that already fits, is left alone', () => {
  expect(fitToBudget(session, null).session).toBe(session);
  expect(fitToBudget(session, 500).changes).toEqual([]);
});

test('cuts in order: finisher, supersets, accessory sets, then main rest and back-offs', () => {
  const full = estimateMinutes(session);
  const loose = fitToBudget(session, full - 5);
  expect(loose.changes).toEqual(['sem finalizador']);
  expect(loose.session.blocks.map((b) => b.order)).toEqual([1, 2, 3]);

  const tight = fitToBudget(session, 30);
  expect(tight.changes).toEqual(['sem finalizador', 'acessórios em supersérie', '1 série a menos nos acessórios',
    'descanso dos básicos até 2 min e 1 back-off a menos']);
  const [, main, acc] = tight.session.blocks;
  expect(main.exercises.map((x) => [x.sets, x.rest_seconds])).toEqual([[1, 120], [2, 120], [3, 120]]);
  expect(acc.exercises.map((x) => [x.exercise_id, x.sets, x.rest_seconds])).toEqual([
    ['fly', 3, 0], ['lateral', 3, 60], ['curl', 2, 0], ['pressdown', 2, 60]]);
  expect(acc.exercises[0].cues[0]).toBe(SUPERSET_CUE);
  expect(tight.session.target_duration_minutes).toBe(tight.minutes);
  expect(tight.minutes).toBeLessThan(full);
  // Same exercises at the same positions: logged sets and swaps keep their keys.
  expect(tight.session.blocks[0]).toEqual(session.blocks[0]); // the warm-up is never touched
});

test('says when even the shortest version does not fit', () => {
  const r = fitToBudget(session, 10);
  expect(r.fits).toBe(false);
  expect(r.minutes).toBeGreaterThan(10);
});

test('timed circuits shrink to what is left', () => {
  const amrap: Session = {
    ...session,
    blocks: [session.blocks[0], block(2, 'conditioning', [rx('burpee')], { execution_style: 'amrap', duration_minutes: 20 })],
  };
  const r = fitToBudget(amrap, 18);
  expect(r.session.blocks[1].duration_minutes).toBe(10);
  expect(r.changes).toEqual(['circuito de 10 min']);
});
