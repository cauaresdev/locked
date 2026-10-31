import { isRecord, pctOf1rm, platesPerSide, sessionSummary, setE1rm } from '../athlete';

test('e1RM matches the server chart', () => {
  expect(pctOf1rm(1, 10)).toBe(1);
  expect(pctOf1rm(5, 10)).toBeCloseTo(0.863);
  expect(setE1rm(105, 5, 10)).toBe(121.7); // same number the backend test pins
  expect(setE1rm(100, 5, 5)).toBeNull(); // effort below 6 is too vague
  expect(setE1rm(null, 5, 8)).toBeNull();
});

test('a record needs a previous best and a real margin', () => {
  expect(isRecord(122.5, 121.7)).toBe(true);
  expect(isRecord(122, 121.7)).toBe(false);
  expect(isRecord(130, null)).toBe(false); // first time ever: nothing to beat
});

test('plates per side', () => {
  expect(platesPerSide(100, 'barbell')).toEqual({ plates: [25, 15], leftover: 0 });
  expect(platesPerSide(62.5, 'barbell')).toEqual({ plates: [20, 1.25], leftover: 0 });
  expect(platesPerSide(15, 'barbell')).toBeNull();
  expect(platesPerSide(180, 'leg_press')).toEqual({ plates: [25, 25, 25, 15], leftover: 0 });
  expect(platesPerSide(21, 'barbell')).toEqual({ plates: [], leftover: 0.5 });
  expect(platesPerSide(50, 'dumbbell')).toBeNull();
});

test('session summary', () => {
  const s = sessionSummary([
    { exercise: 'Supino', reps: 5, load_kg: 100, rpe: 8.5, record: true },
    { exercise: 'Supino', reps: 8, load_kg: 80, rpe: 7.5, record: false },
    { exercise: 'Paralelas', reps: 10, load_kg: null, rpe: 8, record: false },
  ]);
  expect(s).toEqual({ sets: 3, volumeKg: 1140, records: ['Supino'] });
});
