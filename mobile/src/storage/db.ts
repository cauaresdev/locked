import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';

import type {
  Athlete,
  FoodEntryInput,
  NutritionDay,
  Progress as ProgressReport,
  Routine,
  Session,
  SetLog,
  TelemetrySample,
} from '../api/types';
import { emptyProgress, type Progress } from '../engine/progress';

// Offline-first local store: gyms in basements have no signal.
const db = SQLite.openDatabaseSync('knightfall.db');

// Append-only: each entry upgrades the schema by one PRAGMA user_version.
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS sessions (day TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, live INTEGER NOT NULL, fetched_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS progress (day TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS telemetry_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS food_outbox (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS nutrition_cache (day TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS log_deletes (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS rejected (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, json TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);`,
  'CREATE TABLE IF NOT EXISTS food_deletes (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL);',
];

async function upgrade(): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  for (let v = row?.user_version ?? 0; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

let ready: Promise<void> | null = null;

function migrate(): Promise<void> {
  ready ??= upgrade().catch((e) => {
    ready = null; // let the next call retry
    throw e;
  });
  return ready;
}

// The connection is shared and BEGIN is not exclusive on it: two overlapping transactions
// would fail and one's ROLLBACK would undo the other. Every write goes through this queue.
let tail: Promise<unknown> = Promise.resolve();

function write<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(async () => {
    await migrate();
    return fn();
  });
  tail = run.catch(() => {});
  return run;
}

const txn = (fn: () => Promise<void>) => write(() => db.withTransactionAsync(fn));
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

export async function cacheSession(day: string, session: Session, live: boolean): Promise<void> {
  // One statement, so a schedule prefetch racing a live fetch can never clobber the
  // live (readiness-adjusted) session for the same day.
  await write(() =>
    db.runAsync(
      `INSERT INTO sessions (day, json, live, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET json = excluded.json, live = excluded.live, fetched_at = excluded.fetched_at
       WHERE excluded.live = 1 OR sessions.live = 0`,
      day,
      JSON.stringify(session),
      live ? 1 : 0,
      Date.now(),
    ),
  );
}

/** Drop cached sessions (e.g. after the cycle was shifted), keeping in-session progress. */
export async function clearSessionCache(): Promise<void> {
  await write(() => db.runAsync('DELETE FROM sessions'));
}

export async function cachedSession(day: string): Promise<Session | null> {
  await migrate();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM sessions WHERE day = ?', day);
  return row ? (JSON.parse(row.json) as Session) : null;
}

export async function cachedRange(days: string[]): Promise<Record<string, Session>> {
  await migrate();
  if (days.length === 0) return {};
  const rows = await db.getAllAsync<{ day: string; json: string }>(
    `SELECT day, json FROM sessions WHERE day IN (${marks(days.length)})`,
    ...days,
  );
  return Object.fromEntries(rows.map((r) => [r.day, JSON.parse(r.json) as Session]));
}

export async function enqueueLogs(logs: SetLog[]): Promise<void> {
  await txn(async () => {
    for (const log of logs) {
      await db.runAsync(
        'INSERT OR IGNORE INTO outbox (id, json, created_at) VALUES (?, ?, ?)',
        log.id,
        JSON.stringify(log),
        Date.now(),
      );
    }
  });
}

export async function pendingLogs(limit = 200): Promise<SetLog[]> {
  await migrate();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM outbox ORDER BY created_at LIMIT ?',
    limit,
  );
  return rows.map((r) => JSON.parse(r.json) as SetLog);
}

export async function removeLogs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await write(() => db.runAsync(`DELETE FROM outbox WHERE id IN (${marks(ids.length)})`, ...ids));
}

/**
 * Undo a set: drop it from the outbox and queue a server-side delete. The POST may be in
 * flight (or have timed out after the server stored it), and DELETE is idempotent.
 */
export async function undoLog(id: string): Promise<void> {
  await txn(async () => {
    await db.runAsync('DELETE FROM outbox WHERE id = ?', id);
    await db.runAsync('INSERT OR IGNORE INTO log_deletes (id, created_at) VALUES (?, ?)', id, Date.now());
  });
}

export async function pendingLogDeletes(): Promise<string[]> {
  await migrate();
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM log_deletes ORDER BY created_at LIMIT 200');
  return rows.map((r) => r.id);
}

export async function removeLogDelete(id: string): Promise<void> {
  await write(() => db.runAsync('DELETE FROM log_deletes WHERE id = ?', id));
}

export async function pendingCount(): Promise<number> {
  await migrate();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
  return row?.n ?? 0;
}

/** Everything still waiting to upload: set logs, food entries, deletes and telemetry batches. */
export async function pendingTotal(): Promise<number> {
  await migrate();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM outbox) + (SELECT COUNT(*) FROM food_outbox) + (SELECT COUNT(*) FROM telemetry_outbox)
          + (SELECT COUNT(*) FROM log_deletes) + (SELECT COUNT(*) FROM food_deletes) AS n`,
  );
  return row?.n ?? 0;
}

export async function loadProgress(day: string): Promise<Progress> {
  await migrate();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM progress WHERE day = ?', day);
  return row ? { ...emptyProgress(), ...(JSON.parse(row.json) as Progress) } : emptyProgress();
}

export async function saveProgress(day: string, p: Progress): Promise<void> {
  await write(() => db.runAsync('INSERT OR REPLACE INTO progress (day, json) VALUES (?, ?)', day, JSON.stringify(p)));
}

// --- telemetry outbox (HR / power samples, uploaded in batches) ---------------

export async function enqueueTelemetry(samples: TelemetrySample[]): Promise<void> {
  if (samples.length === 0) return;
  await write(() => db.runAsync('INSERT INTO telemetry_outbox (json) VALUES (?)', JSON.stringify(samples)));
}

export async function pendingTelemetry(maxSamples = 3000): Promise<{ ids: number[]; samples: TelemetrySample[] }> {
  await migrate();
  const rows = await db.getAllAsync<{ id: number; json: string }>('SELECT id, json FROM telemetry_outbox ORDER BY id LIMIT 50');
  const ids: number[] = [];
  const samples: TelemetrySample[] = [];
  for (const r of rows) {
    const chunk = JSON.parse(r.json) as TelemetrySample[];
    if (ids.length > 0 && samples.length + chunk.length > maxSamples) break;
    ids.push(r.id);
    samples.push(...chunk);
  }
  return { ids, samples };
}

export async function removeTelemetry(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await write(() => db.runAsync(`DELETE FROM telemetry_outbox WHERE id IN (${marks(ids.length)})`, ...ids));
}

// --- food outbox + nutrition cache ---------------------------------------------

export async function enqueueFood(entry: FoodEntryInput): Promise<void> {
  await write(() =>
    db.runAsync('INSERT OR IGNORE INTO food_outbox (id, json, created_at) VALUES (?, ?, ?)', entry.id,
      JSON.stringify(entry), Date.now()),
  );
}

export async function pendingFood(): Promise<FoodEntryInput[]> {
  await migrate();
  const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM food_outbox ORDER BY created_at LIMIT 200');
  return rows.map((r) => JSON.parse(r.json) as FoodEntryInput);
}

export async function removeFood(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await write(() => db.runAsync(`DELETE FROM food_outbox WHERE id IN (${marks(ids.length)})`, ...ids));
}

/** Delete a food entry: drop it if still queued and queue the server delete (same reasoning as undoLog). */
export async function deleteFoodEntry(id: string): Promise<void> {
  await txn(async () => {
    await db.runAsync('DELETE FROM food_outbox WHERE id = ?', id);
    await db.runAsync('INSERT OR IGNORE INTO food_deletes (id, created_at) VALUES (?, ?)', id, Date.now());
  });
}

export async function pendingFoodDeletes(): Promise<string[]> {
  await migrate();
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM food_deletes ORDER BY created_at LIMIT 200');
  return rows.map((r) => r.id);
}

export async function removeFoodDelete(id: string): Promise<void> {
  await write(() => db.runAsync('DELETE FROM food_deletes WHERE id = ?', id));
}

export async function cacheNutrition(n: NutritionDay): Promise<void> {
  await write(() => db.runAsync('INSERT OR REPLACE INTO nutrition_cache (day, json) VALUES (?, ?)', n.day, JSON.stringify(n)));
}

export async function cachedNutrition(day: string): Promise<NutritionDay | null> {
  await migrate();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM nutrition_cache WHERE day = ?', day);
  return row ? (JSON.parse(row.json) as NutritionDay) : null;
}

// --- items the server refused (kept for inspection instead of blocking the queues) ---

export type RejectedKind = 'log' | 'food' | 'telemetry';

export async function quarantine(kind: RejectedKind, items: { item: unknown; reason: string }[]): Promise<void> {
  if (items.length === 0) return;
  await txn(async () => {
    for (const { item, reason } of items) {
      await db.runAsync('INSERT INTO rejected (kind, json, reason, created_at) VALUES (?, ?, ?, ?)', kind,
        JSON.stringify(item), reason, Date.now());
    }
  });
}

export async function rejectedCount(): Promise<number> {
  await migrate();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM rejected');
  return row?.n ?? 0;
}

/** Wipes everything tied to the signed-in user (the owner marker stays, see localOwner). */
export async function clearLocalData(): Promise<void> {
  await write(() =>
    db.withTransactionAsync(() =>
      db.execAsync(`
        DELETE FROM sessions; DELETE FROM outbox; DELETE FROM progress; DELETE FROM log_deletes; DELETE FROM food_deletes;
        DELETE FROM telemetry_outbox; DELETE FROM food_outbox; DELETE FROM nutrition_cache; DELETE FROM rejected;
      `),
    ),
  );
  for (const key of [ATHLETE_KEY, DEVICES_KEY, HEALTH_KEY, PROGRESS_KEY, ROUTINE_KEY, REMINDERS_KEY]) {
    Storage.removeItemSync(key);
  }
  athleteMemo = undefined;
}

const ATHLETE_KEY = 'athlete';
const MUTE_KEY = 'comms_muted';
const DEVICES_KEY = 'ble_devices';
const HEALTH_KEY = 'health_sync';
const PROGRESS_KEY = 'progress_report';
const OWNER_KEY = 'local_owner';
const ROUTINE_KEY = 'routine_day';
const REMINDERS_KEY = 'routine_reminders';

export type DeviceRole = 'hr' | 'bike';
export type SavedDevices = Partial<Record<DeviceRole, { id: string; name: string }>>;

export function savedDevices(): SavedDevices {
  const raw = Storage.getItemSync(DEVICES_KEY);
  return raw ? (JSON.parse(raw) as SavedDevices) : {};
}

export function saveDevices(d: SavedDevices): void {
  Storage.setItemSync(DEVICES_KEY, JSON.stringify(d));
}

export function healthSyncEnabled(): boolean {
  return Storage.getItemSync(HEALTH_KEY) === '1';
}

export function setHealthSyncEnabled(on: boolean): void {
  Storage.setItemSync(HEALTH_KEY, on ? '1' : '0');
}

/** Last routine the server returned, so the Rotina tab and the Today card open instantly offline. */
export function cachedRoutine(day: string): Routine | null {
  const raw = Storage.getItemSync(ROUTINE_KEY);
  const r = raw ? (JSON.parse(raw) as Routine) : null;
  return r?.day === day ? r : null;
}

export function storeRoutine(r: Routine): void {
  Storage.setItemSync(ROUTINE_KEY, JSON.stringify(r));
}

export function routineRemindersEnabled(): boolean {
  return Storage.getItemSync(REMINDERS_KEY) === '1';
}

export function setRoutineRemindersEnabled(on: boolean): void {
  Storage.setItemSync(REMINDERS_KEY, on ? '1' : '0');
}

// Screens read the profile on every render (the live HR badge about once a second): parse it once.
// Only storeAthlete and clearLocalData write the key, and both refresh this copy.
let athleteMemo: { value: Athlete | null } | undefined;

export function storedAthlete(): Athlete | null {
  if (!athleteMemo) {
    const raw = Storage.getItemSync(ATHLETE_KEY);
    athleteMemo = { value: raw ? (JSON.parse(raw) as Athlete) : null };
  }
  return athleteMemo.value;
}

export function storeAthlete(a: Athlete): void {
  Storage.setItemSync(ATHLETE_KEY, JSON.stringify(a));
  Storage.setItemSync(OWNER_KEY, a.id);
  athleteMemo = { value: a };
}

/**
 * Athlete the local queues belong to. Survives clearLocalData and token loss, so a
 * different account signing in on this device never uploads someone else's data.
 */
export function localOwner(): string | null {
  return Storage.getItemSync(OWNER_KEY) ?? storedAthlete()?.id ?? null;
}

export function commsMuted(): boolean {
  return Storage.getItemSync(MUTE_KEY) === '1';
}

export function setCommsMuted(muted: boolean): void {
  Storage.setItemSync(MUTE_KEY, muted ? '1' : '0');
}

/**
 * Last progress report, so the Progress tab still shows something offline. Keyed by its
 * range: a 30-day report must not be shown under "90 dias".
 */
export function storedProgressReport(days: number): ProgressReport | null {
  const raw = Storage.getItemSync(PROGRESS_KEY);
  if (!raw) return null;
  const saved = JSON.parse(raw) as { days?: number; report?: ProgressReport };
  return saved.days === days && saved.report ? saved.report : null;
}

export function storeProgressReport(days: number, report: ProgressReport): void {
  Storage.setItemSync(PROGRESS_KEY, JSON.stringify({ days, report }));
}
