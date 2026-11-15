import type { IconName } from '../components/Icon';
import { addDays } from './format';

/** One day of the training calendar: was a session planned, and was it done. */
export interface AttendanceDay {
  day: string;
  planned: boolean;
  trained: boolean;
}

/**
 * Planned sessions done in a row, newest first. Rest days don't break it; today's session still
 * ahead doesn't either (the day isn't over). A planned day that was trained counts even if it was
 * also a make-up.
 */
export function trainingStreak(days: AttendanceDay[], today: string): number {
  let n = 0;
  for (const d of [...days].sort((a, b) => b.day.localeCompare(a.day))) {
    if (d.day > today) continue;
    if (d.trained) n += 1;
    else if (d.planned && d.day !== today) break;
  }
  return n;
}

/** Longest run of planned sessions done without missing one. */
export function bestStreak(days: AttendanceDay[]): number {
  let best = 0;
  let run = 0;
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    if (d.trained) best = Math.max(best, ++run);
    else if (d.planned) run = 0;
  }
  return best;
}

/** Monday to Sunday of the week holding `day`. */
export function weekOf(day: string): string[] {
  const [y, m, d] = day.split('-').map(Number);
  const back = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
  const monday = addDays(day, -back);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Weeks before the current one in which every planned session was done (at least one planned). */
export function perfectWeeks(days: AttendanceDay[], today: string): number {
  const current = weekOf(today)[0];
  const weeks = new Map<string, { planned: number; missed: number }>();
  for (const d of days) {
    const monday = weekOf(d.day)[0];
    if (monday >= current) continue;
    const w = weeks.get(monday) ?? { planned: 0, missed: 0 };
    if (d.planned) w.planned += 1;
    if (d.planned && !d.trained) w.missed += 1;
    weeks.set(monday, w);
  }
  return [...weeks.values()].filter((w) => w.planned > 0 && w.missed === 0).length;
}

/** New bests in the e1RM history: every time an exercise beat its own previous best. */
export function personalRecords(strength: { history: [string, number][] }[]): number {
  let n = 0;
  for (const s of strength) {
    let best: number | null = null;
    for (const [, e1rm] of [...s.history].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (best != null && e1rm > best) n += 1;
      best = best == null ? e1rm : Math.max(best, e1rm);
    }
  }
  return n;
}

export interface Stats {
  sessions: number;
  bestStreak: number;
  perfectWeeks: number;
  records: number;
  routineStreak: number;
}

export interface Medal {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  goal: number;
  stat: keyof Stats;
}

export const MEDALS: Medal[] = [
  { id: 'first_session', title: 'Primeira sessão', description: 'Conclua seu primeiro treino.', icon: 'play', goal: 1, stat: 'sessions' },
  { id: 'sessions_10', title: '10 treinos', description: 'Conclua 10 treinos.', icon: 'dumbbell', goal: 10, stat: 'sessions' },
  { id: 'sessions_25', title: '25 treinos', description: 'Conclua 25 treinos.', icon: 'dumbbell', goal: 25, stat: 'sessions' },
  { id: 'sessions_50', title: '50 treinos', description: 'Conclua 50 treinos.', icon: 'trophy', goal: 50, stat: 'sessions' },
  { id: 'streak_3', title: 'Embalado', description: '3 treinos seguidos sem faltar.', icon: 'flame', goal: 3, stat: 'bestStreak' },
  { id: 'streak_7', title: 'Constante', description: '7 treinos seguidos sem faltar.', icon: 'flame', goal: 7, stat: 'bestStreak' },
  { id: 'streak_15', title: 'Inabalável', description: '15 treinos seguidos sem faltar.', icon: 'flame', goal: 15, stat: 'bestStreak' },
  { id: 'perfect_week', title: 'Semana perfeita', description: 'Todos os treinos de uma semana.', icon: 'star', goal: 1, stat: 'perfectWeeks' },
  { id: 'perfect_4', title: 'Mês perfeito', description: '4 semanas perfeitas.', icon: 'star', goal: 4, stat: 'perfectWeeks' },
  { id: 'first_pr', title: 'Primeiro recorde', description: 'Supere sua melhor marca em um exercício.', icon: 'bolt', goal: 1, stat: 'records' },
  { id: 'pr_10', title: 'Quebra-recordes', description: '10 recordes pessoais.', icon: 'medal', goal: 10, stat: 'records' },
  { id: 'routine_7', title: 'Rotina de ferro', description: '7 dias seguidos de rotina completa.', icon: 'moon', goal: 7, stat: 'routineStreak' },
];

export interface MedalState {
  medal: Medal;
  value: number;
  unlocked: boolean;
  unlockedOn: string | null;
}

/** Every medal with its progress. Once unlocked, a medal stays unlocked (`earned` remembers it). */
export function medalStates(stats: Stats, earned: Record<string, string>): MedalState[] {
  return MEDALS.map((medal) => {
    const value = Math.min(stats[medal.stat], medal.goal);
    const unlockedOn = earned[medal.id] ?? null;
    return { medal, value, unlocked: unlockedOn != null || value >= medal.goal, unlockedOn };
  });
}

/** Medals reached now that were not earned before. */
export function newlyEarned(stats: Stats, earned: Record<string, string>): Medal[] {
  return MEDALS.filter((m) => !(m.id in earned) && stats[m.stat] >= m.goal);
}

/** The week so far: sessions planned and done, Monday to Sunday. */
export function weekGoal(week: string[], planned: Set<string>, trained: Set<string>) {
  return {
    planned: week.filter((d) => planned.has(d)).length,
    done: week.filter((d) => trained.has(d)).length,
  };
}

/** A whole-week calendar from saved history plus what is known of the days ahead. */
export function mergeAttendance(saved: AttendanceDay[], fresh: AttendanceDay[]): AttendanceDay[] {
  const map = new Map(saved.map((d) => [d.day, d]));
  for (const d of fresh) {
    const old = map.get(d.day);
    // A day once seen trained stays trained (the report window moves on; history doesn't change).
    map.set(d.day, { day: d.day, planned: d.planned || !!old?.planned, trained: d.trained || !!old?.trained });
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}
