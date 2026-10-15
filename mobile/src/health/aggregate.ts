// Pure helpers to turn raw health samples into one readiness reading per night.

export type Interval = [number, number]; // epoch ms

/** Total length of a set of intervals, counting overlaps once (watch + phone often both log sleep). */
export function unionMs(intervals: Interval[]): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: Interval | null = null;
  for (const [a, b] of sorted) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

const HOUR = 3_600_000;

/** Night preceding `day` (local): previous day 18:00 to `day` 12:00. */
export function nightWindow(day: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number);
  return { start: new Date(y, m - 1, d - 1, 18), end: new Date(y, m - 1, d, 12) };
}

// HealthKit HKCategoryValueSleepAnalysis: 1 asleepUnspecified, 3 core, 4 deep, 5 REM.
const HK_ASLEEP = new Set([1, 3, 4, 5]);

export function sleepHoursHealthKit(samples: { value: number; startDate: Date; endDate: Date }[]): number | null {
  const asleep = samples.filter((s) => HK_ASLEEP.has(s.value));
  if (asleep.length === 0) return null;
  return round1(unionMs(asleep.map((s) => [+s.startDate, +s.endDate])) / HOUR);
}

// Health Connect SleepStageType: 1 AWAKE, 3 OUT_OF_BED; 2 SLEEPING, 4 LIGHT, 5 DEEP, 6 REM count as sleep.
const HC_AWAKE = new Set([0, 1, 3]);

export function sleepHoursHealthConnect(
  sessions: { startTime: string; endTime: string; stages?: { startTime: string; endTime: string; stage: number }[] }[],
): number | null {
  if (sessions.length === 0) return null;
  const intervals: Interval[] = [];
  for (const s of sessions) {
    if (s.stages && s.stages.length > 0) {
      for (const st of s.stages) {
        if (!HC_AWAKE.has(st.stage)) intervals.push([Date.parse(st.startTime), Date.parse(st.endTime)]);
      }
    } else {
      intervals.push([Date.parse(s.startTime), Date.parse(s.endTime)]);
    }
  }
  return round1(unionMs(intervals) / HOUR);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
