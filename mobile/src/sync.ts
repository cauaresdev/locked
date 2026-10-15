import { api } from './api/client';
import type { Session } from './api/types';
import { deliver } from './engine/deliver';
import { addDays } from './engine/format';
import {
  cacheSession,
  cachedSession,
  pendingFood,
  pendingLogs,
  pendingTelemetry,
  quarantine,
  removeFood,
  removeLogs,
  removeTelemetry,
  storeAthlete,
} from './storage/db';

export const PREFETCH_DAYS = 16; // two Brawler cycles

export type Source = 'live' | 'cache';

/** Today's session: live (readiness-adjusted) when reachable, cache otherwise. */
export async function loadSession(athleteId: string, day: string): Promise<{ session: Session; source: Source }> {
  try {
    const session = await api.session(athleteId, day);
    await cacheSession(day, session, true);
    return { session, source: 'live' };
  } catch (err) {
    const cached = await cachedSession(day);
    if (cached) return { session: cached, source: 'cache' };
    throw err;
  }
}

/** Cache the upcoming schedule so the next sessions work with no signal. */
export async function prefetchSchedule(athleteId: string, today: string, cycleStart: string): Promise<boolean> {
  // The server's schedule starts at the program start when that is still ahead.
  const first = cycleStart > today ? cycleStart : today;
  try {
    const sessions = await api.schedule(athleteId, first, PREFETCH_DAYS);
    await Promise.all(sessions.map((s, i) => cacheSession(addDays(first, i), s, false)));
    return true;
  } catch {
    return false;
  }
}

/** Upload queued set logs. Ids are client UUIDs, so retries are idempotent. */
export async function flushOutbox(athleteId: string): Promise<number> {
  let sent = 0;
  for (;;) {
    const batch = await pendingLogs();
    if (batch.length === 0) return sent;
    const r = await deliver(batch, (logs) => api.postLogs(athleteId, logs));
    await quarantine('log', r.rejected);
    await removeLogs([...r.sent, ...r.rejected.map((x) => x.item)].map((l) => l.id));
    sent += r.sent.length;
    if (r.error) return sent;
  }
}

export async function refreshAthlete(athleteId: string): Promise<void> {
  try {
    storeAthlete(await api.athlete(athleteId));
  } catch {
    // offline: keep the stored profile
  }
}

/** Upload queued food entries (client UUIDs, idempotent). */
export async function flushFood(athleteId: string): Promise<number> {
  let sent = 0;
  for (;;) {
    const batch = await pendingFood();
    if (batch.length === 0) return sent;
    const r = await deliver(batch, (entries) => api.postFood(athleteId, entries));
    await quarantine('food', r.rejected);
    await removeFood([...r.sent, ...r.rejected.map((x) => x.item)].map((e) => e.id));
    sent += r.sent.length;
    if (r.error) return sent;
  }
}

/** Upload buffered HR / power samples. The server dedupes on (kind, timestamp). */
export async function flushTelemetry(athleteId: string): Promise<number> {
  let sent = 0;
  for (;;) {
    const { ids, samples } = await pendingTelemetry();
    if (ids.length === 0) return sent;
    const r = await deliver(samples, (batch) => api.postTelemetry(athleteId, batch));
    // A failed upload may have delivered part of the batch; resending it is harmless (server dedupes).
    if (r.error) return sent + r.sent.length;
    await quarantine('telemetry', r.rejected);
    await removeTelemetry(ids);
    sent += r.sent.length;
  }
}

export async function flushAll(athleteId: string): Promise<void> {
  await flushOutbox(athleteId);
  await flushFood(athleteId);
  await flushTelemetry(athleteId);
}
