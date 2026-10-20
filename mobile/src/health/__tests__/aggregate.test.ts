import { mean, nightWindow, sleepHoursHealthConnect, sleepHoursHealthKit, unionMs } from '../aggregate';

const H = 3_600_000;

it('unions overlapping intervals', () => {
  expect(unionMs([[0, 2 * H], [H, 3 * H], [5 * H, 6 * H]])).toBe(4 * H);
  expect(unionMs([])).toBe(0);
});

it('night window spans the evening before to midday', () => {
  const { start, end } = nightWindow('2026-03-01');
  expect([start.getDate(), start.getHours(), end.getDate(), end.getHours()]).toEqual([28, 18, 1, 12]);
});

it('counts only asleep HealthKit stages, de-duplicating sources', () => {
  const t0 = new Date('2026-03-01T23:00:00Z');
  const at = (h: number) => new Date(+t0 + h * H);
  const samples = [
    { value: 0, startDate: at(0), endDate: at(8) }, // in bed
    { value: 3, startDate: at(0.5), endDate: at(4) }, // core (watch)
    { value: 1, startDate: at(0.5), endDate: at(4) }, // unspecified (phone, duplicate)
    { value: 2, startDate: at(4), endDate: at(4.5) }, // awake
    { value: 5, startDate: at(4.5), endDate: at(7.5) }, // REM
  ];
  expect(sleepHoursHealthKit(samples)).toBe(6.5);
  expect(sleepHoursHealthKit([{ value: 0, startDate: at(0), endDate: at(8) }])).toBeNull();
});

it('uses Health Connect stages when present, else the session', () => {
  const s = (a: string, b: string, stages?: { startTime: string; endTime: string; stage: number }[]) =>
    ({ startTime: a, endTime: b, stages });
  expect(sleepHoursHealthConnect([s('2026-03-01T23:00:00Z', '2026-03-02T07:00:00Z')])).toBe(8);
  expect(
    sleepHoursHealthConnect([
      s('2026-03-01T23:00:00Z', '2026-03-02T07:00:00Z', [
        { startTime: '2026-03-01T23:00:00Z', endTime: '2026-03-02T03:00:00Z', stage: 4 },
        { startTime: '2026-03-02T03:00:00Z', endTime: '2026-03-02T04:00:00Z', stage: 1 },
        { startTime: '2026-03-02T04:00:00Z', endTime: '2026-03-02T07:00:00Z', stage: 6 },
      ]),
    ]),
  ).toBe(7);
  expect(sleepHoursHealthConnect([])).toBeNull();
});

it('treats Health Connect AWAKE_IN_BED (7) as awake', () => {
  const stages = [
    { startTime: '2026-03-01T22:00:00Z', endTime: '2026-03-01T23:00:00Z', stage: 7 }, // in bed, awake
    { startTime: '2026-03-01T23:00:00Z', endTime: '2026-03-02T05:00:00Z', stage: 5 },
    { startTime: '2026-03-02T05:00:00Z', endTime: '2026-03-02T06:00:00Z', stage: 7 },
  ];
  expect(sleepHoursHealthConnect([{ startTime: stages[0].startTime, endTime: stages[2].endTime, stages }])).toBe(6);
});

it('averages', () => {
  expect(mean([40, 50, 61])).toBe(50.3);
  expect(mean([])).toBeNull();
});
