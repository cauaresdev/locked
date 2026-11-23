import type { Progress as ProgressReport } from '../api/types';
import { storeAttendance, storedAttendance, type AttendanceStore } from '../storage/db';
import {
  bestStreak,
  mergeAttendance,
  perfectWeeks,
  personalRecords,
  trainingStreak,
  type AttendanceDay,
  type Stats,
} from './attendance';

export function statsOf(store: AttendanceStore, today: string): Stats {
  return {
    sessions: store.attendance.filter((d) => d.trained).length,
    streak: trainingStreak(store.attendance, today),
    bestStreak: bestStreak(store.attendance),
    perfectWeeks: perfectWeeks(store.attendance, today),
    records: store.records,
  };
}

/**
 * Folds a fresh progress report (and today's session, finished on this device before the server
 * heard of it) into the saved history, and returns it.
 */
export function updateAttendance(report: ProgressReport | null, today: string, finishedToday: boolean): AttendanceStore {
  const saved = storedAttendance();
  const local: AttendanceDay[] = finishedToday ? [{ day: today, planned: true, trained: true }] : [];
  const attendance = mergeAttendance(saved.attendance, [...(report?.attendance ?? []), ...local]);
  const records = Math.max(saved.records, report ? personalRecords(report.strength) : 0);
  const store = { attendance, records };
  storeAttendance(store);
  return store;
}
