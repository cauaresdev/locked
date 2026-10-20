import type { FoodEntryInput, SetLog } from '../api/types';

type MockParams = (string | number | null)[];
interface MockSqlite {
  exec(sql: string): void;
  prepare(sql: string): { run(...p: MockParams): { changes: number | bigint }; all(...p: MockParams): unknown[]; get(...p: MockParams): unknown };
}
type MockNode = { getBuiltinModule(id: string): { DatabaseSync: new (path: string) => MockSqlite } };

// Real db.ts + sync.ts over an in-memory SQLite (node:sqlite), with the API mocked.
jest.mock('expo-sqlite', () => {
  const node = process as unknown as MockNode;
  const d = new (node.getBuiltinModule('node:sqlite').DatabaseSync)(':memory:');
  (globalThis as { mockSqlite?: unknown }).mockSqlite = d;
  return {
    openDatabaseSync: () => ({
      execAsync: async (sql: string) => void d.exec(sql),
      runAsync: async (sql: string, ...p: MockParams) => ({ changes: Number(d.prepare(sql).run(...p).changes) }),
      getAllAsync: async (sql: string, ...p: MockParams) => d.prepare(sql).all(...p),
      getFirstAsync: async (sql: string, ...p: MockParams) => d.prepare(sql).get(...p) ?? null,
      withTransactionAsync: async (fn: () => Promise<void>) => {
        d.exec('BEGIN'); // throws if another transaction is open on the connection, like the real one
        try {
          await fn();
          d.exec('COMMIT');
        } catch (e) {
          d.exec('ROLLBACK');
          throw e;
        }
      },
    }),
  };
});

jest.mock('expo-sqlite/kv-store', () => {
  const m = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (k: string) => m.get(k) ?? null,
      setItemSync: (k: string, v: string) => void m.set(k, v),
      removeItemSync: (k: string) => void m.delete(k),
    },
  };
});

jest.mock('../api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(code: number, message: string) {
      super(message);
      this.status = code;
    }
  }
  return {
    ApiError,
    api: {
      postLogs: jest.fn(async () => ({})),
      deleteLog: jest.fn(async () => undefined),
      postFood: jest.fn(async () => ({})),
      deleteFood: jest.fn(async () => undefined),
      postTelemetry: jest.fn(async () => ({})),
    },
  };
});

/* eslint-disable import/first */
import { api, ApiError } from '../api/client';
import {
  clearLocalData,
  deleteFoodEntry,
  enqueueFood,
  enqueueLogs,
  pendingFood,
  pendingFoodDeletes,
  pendingLogDeletes,
  pendingLogs,
  pendingTotal,
  undoLog,
} from '../storage/db';
import { flushAll, flushNutrition, flushOutbox } from '../sync';
/* eslint-enable import/first */

const mocked = api as unknown as Record<keyof typeof api, jest.Mock>;
const log = (id: string) => ({ id, day: '2026-10-16', exercise_id: 'squat', set_index: 0 }) as unknown as SetLog;
const food = (id: string) => ({ id, day: '2026-10-16', meal: 'snack', name: 'Ovo', grams: 50 }) as FoodEntryInput;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 1));
};

beforeEach(async () => {
  jest.clearAllMocks();
  await clearLocalData();
});

test('schema is versioned', async () => {
  await pendingTotal();
  const d = (globalThis as unknown as { mockSqlite: MockSqlite }).mockSqlite;
  expect(d.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
});

test('overlapping writes do not collide on the shared connection', async () => {
  await Promise.all([enqueueLogs([log('a'), log('b')]), enqueueLogs([log('c')]), undoLog('b'), enqueueFood(food('f'))]);
  expect((await pendingLogs()).map((l) => l.id).sort()).toEqual(['a', 'c']);
  expect(await pendingLogDeletes()).toEqual(['b']);
});

test('concurrent flushAll calls send each item once', async () => {
  await enqueueLogs([log('a'), log('b'), log('c')]);
  await Promise.all([flushAll('ath'), flushAll('ath'), flushAll('ath')]);
  expect(mocked.postLogs).toHaveBeenCalledTimes(1);
  expect(mocked.postLogs.mock.calls[0][1].map((l: SetLog) => l.id)).toEqual(['a', 'b', 'c']);
  expect(await pendingLogs()).toEqual([]);
});

test('concurrent callers share the run in progress', async () => {
  await enqueueLogs([log('a')]);
  const a = flushOutbox('ath');
  const b = flushOutbox('ath');
  expect(b).toBe(a);
  expect(await a).toBe(1);
});

test('items enqueued during a run go up in the same flush', async () => {
  const gate = deferred();
  mocked.postLogs.mockImplementationOnce(async () => gate.promise);
  await enqueueLogs([log('a')]);
  const first = flushAll('ath');
  await until(() => mocked.postLogs.mock.calls.length === 1);
  await enqueueLogs([log('b')]);
  const second = flushAll('ath');
  gate.resolve();
  await Promise.all([first, second]);
  expect(mocked.postLogs.mock.calls.map((c) => c[1].map((l: SetLog) => l.id))).toEqual([['a'], ['b']]);
});

test('undo while the POST is in flight deletes the set on the server afterwards', async () => {
  const gate = deferred();
  const order: string[] = [];
  mocked.postLogs.mockImplementationOnce(async () => {
    await gate.promise;
    order.push('post');
  });
  mocked.deleteLog.mockImplementationOnce(async () => void order.push('delete'));
  await enqueueLogs([log('a')]);
  const run = flushAll('ath');
  await until(() => mocked.postLogs.mock.calls.length === 1);
  await undoLog('a');
  gate.resolve();
  await run;
  expect(mocked.deleteLog).toHaveBeenCalledWith('ath', 'a');
  expect(order).toEqual(['post', 'delete']);
  expect(await pendingLogDeletes()).toEqual([]);
});

test('food deletes are queued offline and a 404 counts as done', async () => {
  await enqueueFood(food('f1'));
  await deleteFoodEntry('f1');
  expect(await pendingFood()).toEqual([]);
  expect(await pendingFoodDeletes()).toEqual(['f1']);
  expect(await pendingTotal()).toBe(1);

  mocked.deleteFood.mockRejectedValueOnce(new TypeError('Network request failed'));
  await flushNutrition('ath');
  expect(await pendingFoodDeletes()).toEqual(['f1']);

  mocked.deleteFood.mockRejectedValueOnce(new ApiError(404, 'not found'));
  await flushAll('ath');
  expect(await pendingFoodDeletes()).toEqual([]);
  expect(mocked.postFood).not.toHaveBeenCalled();
});

test('a food delete waits for the in-flight POST of the same entry', async () => {
  const gate = deferred();
  const order: string[] = [];
  mocked.postFood.mockImplementationOnce(async () => {
    await gate.promise;
    order.push('post');
  });
  mocked.deleteFood.mockImplementationOnce(async () => void order.push('delete'));
  await enqueueFood(food('f2'));
  const run = flushNutrition('ath');
  await until(() => mocked.postFood.mock.calls.length === 1);
  await deleteFoodEntry('f2');
  const other = flushNutrition('ath'); // e.g. the scanner flushing at the same time
  gate.resolve();
  await Promise.all([run, other]);
  expect(order).toEqual(['post', 'delete']);
});
