import type { Progress as ProgressReport } from '../api/types';
import { storeAchievements, storedAchievements, type AchievementsStore } from '../storage/db';
import {
  bestStreak,
  mergeAttendance,
  newlyEarned,
  perfectWeeks,
  personalRecords,
  trainingStreak,
  type AttendanceDay,
  type Medal,
  type Stats,
} from './achievements';

export function statsOf(store: AchievementsStore, today: string, routineStreak: number): Stats & { streak: number } {
  return {
    sessions: store.attendance.filter((d) => d.trained).length,
    bestStreak: bestStreak(store.attendance),
    streak: trainingStreak(store.attendance, today),
    perfectWeeks: perfectWeeks(store.attendance, today),
    records: store.records,
    routineStreak,
  };
}

/**
 * Folds a fresh progress report (and today's session, finished on this device before the server
 * heard of it) into the saved history, and returns the medals this just earned.
 */
export function updateAchievements(
  report: ProgressReport | null,
  today: string,
  finishedToday: boolean,
  routineStreak: number,
): { store: AchievementsStore; newly: Medal[] } {
  const saved = storedAchievements();
  const local: AttendanceDay[] = finishedToday ? [{ day: today, planned: true, trained: true }] : [];
  const attendance = mergeAttendance(saved.attendance, [...(report?.attendance ?? []), ...local]);
  const records = Math.max(saved.records, report ? personalRecords(report.strength) : 0);
  const draft = { ...saved, attendance, records };
  const newly = newlyEarned(statsOf(draft, today, routineStreak), saved.earned);
  const store = { ...draft, earned: { ...saved.earned, ...Object.fromEntries(newly.map((m) => [m.id, today])) } };
  storeAchievements(store);
  return { store, newly };
}
