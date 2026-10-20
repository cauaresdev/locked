import { api, ApiError } from './api/client';
import type { Session } from './api/types';
import { deliver, isRejection } from './engine/deliver';
import { addDays } from './engine/format';
import {
  cacheSession,
  cachedSession,
  pendingFood,
  pendingFoodDeletes,
  pendingLogDeletes,
  pendingLogs,
  pendingTelemetry,
  quarantine,
  removeFood,
  removeFoodDelete,
  removeLogDelete,
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

// --- single-flight uploads -------------------------------------------------------
// Many screens trigger a sync at once (focus, session end, timers). Concurrent callers share
// the run in progress; a call that arrives mid-run makes it go round once more, so whatever
// was enqueued meanwhile is not left behind. All uploads also run one at a time, so a delete
// can never overtake the POST of the same item.

const runs = new Map<string, { promise: Promise<number>; again: boolean }>();
let lane: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = lane.then(fn);
  lane = run.catch(() => {});
  return run;
}

function singleFlight(key: string, fn: () => Promise<number>): Promise<number> {
  const current = runs.get(key);
  if (current) {
    current.again = true;
    return current.promise;
  }
  const state = { promise: Promise.resolve(0), again: false };
  state.promise = (async () => {
    let total = 0;
    try {
      do {
        state.again = false;
        total += await fn();
      } while (state.again);
      return total;
    } finally {
      runs.delete(key);
    }
  })();
  runs.set(key, state);
  return state.promise;
}

const gone = (e: unknown) => e instanceof ApiError && e.status === 404;

/** Upload queued set logs. Ids are client UUIDs, so retries are idempotent. */
export function flushOutbox(athleteId: string): Promise<number> {
  return singleFlight(`logs:${athleteId}`, () =>
    serial(async () => {
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
    }),
  );
}

export async function refreshAthlete(athleteId: string): Promise<void> {
  try {
    storeAthlete(await api.athlete(athleteId));
  } catch {
    // offline: keep the stored profile
  }
}

/** Upload queued food entries (client UUIDs, idempotent). */
export function flushFood(athleteId: string): Promise<number> {
  return singleFlight(`food:${athleteId}`, () =>
    serial(async () => {
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
    }),
  );
}

/** Upload buffered HR / power samples. The server dedupes on (kind, timestamp). */
export function flushTelemetry(athleteId: string): Promise<number> {
  return singleFlight(`telemetry:${athleteId}`, () =>
    serial(async () => {
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
    }),
  );
}

/** Queued server deletes. DELETE is idempotent: 404 (or a malformed id) counts as done. */
async function drainDeletes(
  pending: () => Promise<string[]>,
  send: (id: string) => Promise<unknown>,
  done: (id: string) => Promise<void>,
): Promise<number> {
  let sent = 0;
  for (;;) {
    const ids = await pending();
    if (ids.length === 0) return sent;
    for (const id of ids) {
      try {
        await send(id);
      } catch (e) {
        if (!gone(e) && !isRejection(e)) return sent;
      }
      await done(id);
      sent++;
    }
  }
}

/** Undone sets. Run after the outbox, so the POST of the same set always lands first. */
export function flushLogDeletes(athleteId: string): Promise<number> {
  return singleFlight(`log-deletes:${athleteId}`, () =>
    serial(() => drainDeletes(pendingLogDeletes, (id) => api.deleteLog(athleteId, id), removeLogDelete)),
  );
}

/** Removed food entries. Run after flushFood for the same reason as flushLogDeletes. */
export function flushFoodDeletes(athleteId: string): Promise<number> {
  return singleFlight(`food-deletes:${athleteId}`, () =>
    serial(() => drainDeletes(pendingFoodDeletes, (id) => api.deleteFood(athleteId, id), removeFoodDelete)),
  );
}

/** Food entries and their deletes, in order (Nutrition / scanner). */
export async function flushNutrition(athleteId: string): Promise<void> {
  await flushFood(athleteId);
  await flushFoodDeletes(athleteId);
}

export async function flushAll(athleteId: string): Promise<void> {
  await singleFlight(`all:${athleteId}`, async () => {
    await flushOutbox(athleteId);
    await flushLogDeletes(athleteId); // after the outbox: the POST of an undone set goes up first
    await flushFood(athleteId);
    await flushFoodDeletes(athleteId);
    await flushTelemetry(athleteId);
    return 0;
  });
}
