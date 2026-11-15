import {
  bestStreak,
  medalStates,
  mergeAttendance,
  newlyEarned,
  perfectWeeks,
  personalRecords,
  trainingStreak,
  weekOf,
  type AttendanceDay,
} from '../achievements';

const d = (day: string, planned: boolean, trained: boolean): AttendanceDay => ({ day, planned, trained });

// Mon 2026-11-02 … Sun 2026-11-15
const days = [
  d('2026-11-02', true, true),
  d('2026-11-03', true, false), // missed
  d('2026-11-04', true, true),
  d('2026-11-05', false, false), // rest
  d('2026-11-06', true, true),
  d('2026-11-07', true, true),
  d('2026-11-08', false, false),
  d('2026-11-09', true, true),
  d('2026-11-10', true, true),
  d('2026-11-11', false, false),
  d('2026-11-12', true, true),
  d('2026-11-13', true, true),
  d('2026-11-14', true, false), // today, not done yet
];

test('the streak skips rest days and today, and stops at a missed session', () => {
  expect(trainingStreak(days, '2026-11-14')).toBe(7);
  expect(trainingStreak(days, '2026-11-15')).toBe(0); // the 14th is now missed
  expect(bestStreak(days)).toBe(7);
});

test('weeks run Monday to Sunday', () => {
  expect(weekOf('2026-11-14')[0]).toBe('2026-11-09');
  expect(weekOf('2026-11-09')[6]).toBe('2026-11-15');
  expect(weekOf('2026-11-15')[0]).toBe('2026-11-09'); // Sunday belongs to the week before it
});

test('a perfect week has every planned session done, and the current week does not count yet', () => {
  expect(perfectWeeks(days, '2026-11-14')).toBe(0); // first week missed the 3rd
  expect(perfectWeeks(days, '2026-11-16')).toBe(0); // the 14th was missed
  const fixed = days.map((x) => (x.day === '2026-11-14' ? d(x.day, true, true) : x));
  expect(perfectWeeks(fixed, '2026-11-16')).toBe(1);
});

test('records count each time an exercise beats its own best', () => {
  const strength = [
    { history: [['2026-11-01', 100], ['2026-11-08', 105], ['2026-11-04', 98], ['2026-11-12', 104]] as [string, number][] },
    { history: [['2026-11-01', 50]] as [string, number][] },
  ];
  expect(personalRecords(strength)).toBe(1);
});

test('medals stay earned and report progress toward the goal', () => {
  const stats = { sessions: 12, bestStreak: 2, perfectWeeks: 0, records: 1, routineStreak: 0 };
  const fresh = newlyEarned(stats, {}).map((m) => m.id);
  expect(fresh).toEqual(['first_session', 'sessions_10', 'first_pr']);
  expect(newlyEarned(stats, { first_session: '2026-11-01', sessions_10: '2026-11-01', first_pr: 'x' })).toEqual([]);
  const states = medalStates({ ...stats, sessions: 0 }, { first_session: '2026-11-01' });
  expect(states.find((s) => s.medal.id === 'first_session')?.unlocked).toBe(true);
  expect(states.find((s) => s.medal.id === 'sessions_25')?.value).toBe(0);
});

test('saved history keeps trained days the report window no longer covers', () => {
  const merged = mergeAttendance([d('2026-08-01', true, true)], [d('2026-11-01', true, false), d('2026-08-01', true, false)]);
  expect(merged).toEqual([d('2026-08-01', true, true), d('2026-11-01', true, false)]);
});
