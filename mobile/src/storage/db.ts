import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';

import type { Athlete, FoodEntryInput, NutritionDay, Session, SetLog, TelemetrySample } from '../api/types';
import { emptyProgress, type Progress } from '../engine/progress';

// Offline-first local store: gyms in basements have no signal.
const db = SQLite.openDatabaseSync('knightfall.db');

let ready: Promise<void> | null = null;

function migrate(): Promise<void> {
  ready ??= db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (day TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, live INTEGER NOT NULL, fetched_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS progress (day TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS telemetry_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS food_outbox (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS nutrition_cache (day TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rejected (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, json TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
  return ready;
}

export async function cacheSession(day: string, session: Session, live: boolean): Promise<void> {
  await migrate();
  // A schedule prefetch must not clobber a live (readiness-adjusted) session for the same day.
  if (!live) {
    const existing = await db.getFirstAsync<{ live: number }>('SELECT live FROM sessions WHERE day = ?', day);
    if (existing?.live) return;
  }
  await db.runAsync(
    'INSERT OR REPLACE INTO sessions (day, json, live, fetched_at) VALUES (?, ?, ?, ?)',
    day,
    JSON.stringify(session),
    live ? 1 : 0,
    Date.now(),
  );
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
    `SELECT day, json FROM sessions WHERE day IN (${days.map(() => '?').join(',')})`,
    ...days,
  );
  return Object.fromEntries(rows.map((r) => [r.day, JSON.parse(r.json) as Session]));
}

export async function enqueueLogs(logs: SetLog[]): Promise<void> {
  await migrate();
  await db.withTransactionAsync(async () => {
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
  await migrate();
  if (ids.length === 0) return;
  await db.runAsync(`DELETE FROM outbox WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
}

export async function pendingCount(): Promise<number> {
  await migrate();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
  return row?.n ?? 0;
}

/** Everything still waiting to upload: set logs, food entries and telemetry batches. */
export async function pendingTotal(): Promise<number> {
  await migrate();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM outbox) + (SELECT COUNT(*) FROM food_outbox)
          + (SELECT COUNT(*) FROM telemetry_outbox) AS n`,
  );
  return row?.n ?? 0;
}

export async function loadProgress(day: string): Promise<Progress> {
  await migrate();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM progress WHERE day = ?', day);
  return row ? { ...emptyProgress(), ...(JSON.parse(row.json) as Progress) } : emptyProgress();
}

export async function saveProgress(day: string, p: Progress): Promise<void> {
  await migrate();
  await db.runAsync('INSERT OR REPLACE INTO progress (day, json) VALUES (?, ?)', day, JSON.stringify(p));
}

// --- telemetry outbox (HR / power samples, uploaded in batches) ---------------

export async function enqueueTelemetry(samples: TelemetrySample[]): Promise<void> {
  if (samples.length === 0) return;
  await migrate();
  await db.runAsync('INSERT INTO telemetry_outbox (json) VALUES (?)', JSON.stringify(samples));
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
  await migrate();
  if (ids.length === 0) return;
  await db.runAsync(`DELETE FROM telemetry_outbox WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
}

// --- food outbox + nutrition cache ---------------------------------------------

export async function enqueueFood(entry: FoodEntryInput): Promise<void> {
  await migrate();
  await db.runAsync('INSERT OR IGNORE INTO food_outbox (id, json, created_at) VALUES (?, ?, ?)', entry.id,
    JSON.stringify(entry), Date.now());
}

export async function pendingFood(): Promise<FoodEntryInput[]> {
  await migrate();
  const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM food_outbox ORDER BY created_at LIMIT 200');
  return rows.map((r) => JSON.parse(r.json) as FoodEntryInput);
}

export async function removeFood(ids: string[]): Promise<void> {
  await migrate();
  if (ids.length === 0) return;
  await db.runAsync(`DELETE FROM food_outbox WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
}

export async function cacheNutrition(n: NutritionDay): Promise<void> {
  await migrate();
  await db.runAsync('INSERT OR REPLACE INTO nutrition_cache (day, json) VALUES (?, ?)', n.day, JSON.stringify(n));
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
  await migrate();
  await db.withTransactionAsync(async () => {
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

/** Wipes everything tied to the signed-in user. */
export async function clearLocalData(): Promise<void> {
  await migrate();
  await db.execAsync(`
    DELETE FROM sessions; DELETE FROM outbox; DELETE FROM progress;
    DELETE FROM telemetry_outbox; DELETE FROM food_outbox; DELETE FROM nutrition_cache; DELETE FROM rejected;
  `);
  for (const key of [ATHLETE_KEY, DEVICES_KEY, HEALTH_KEY]) Storage.removeItemSync(key);
}

const ATHLETE_KEY = 'athlete';
const MUTE_KEY = 'comms_muted';
const DEVICES_KEY = 'ble_devices';
const HEALTH_KEY = 'health_sync';

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

export function storedAthlete(): Athlete | null {
  const raw = Storage.getItemSync(ATHLETE_KEY);
  return raw ? (JSON.parse(raw) as Athlete) : null;
}

export function storeAthlete(a: Athlete): void {
  Storage.setItemSync(ATHLETE_KEY, JSON.stringify(a));
}

export function commsMuted(): boolean {
  return Storage.getItemSync(MUTE_KEY) === '1';
}

export function setCommsMuted(muted: boolean): void {
  Storage.setItemSync(MUTE_KEY, muted ? '1' : '0');
}
