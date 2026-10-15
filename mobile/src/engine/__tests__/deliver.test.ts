import { deliver, isRejection } from '../deliver';

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Fake endpoint that rejects any batch containing a "bad" item. */
function endpoint(bad: Set<number>, failWith?: number) {
  const accepted: number[] = [];
  let calls = 0;
  const send = async (batch: number[]) => {
    calls++;
    if (failWith) throw new HttpError(failWith);
    if (batch.some((x) => bad.has(x))) throw new HttpError(422);
    accepted.push(...batch);
  };
  return { send, accepted, calls: () => calls };
}

test('a clean batch goes in one request', async () => {
  const ep = endpoint(new Set());
  const r = await deliver([1, 2, 3], ep.send);
  expect(r).toEqual({ sent: [1, 2, 3], rejected: [], error: null });
  expect(ep.calls()).toBe(1);
});

test('bad items are isolated and the rest is delivered', async () => {
  const items = Array.from({ length: 200 }, (_, i) => i);
  const ep = endpoint(new Set([17, 150]));
  const r = await deliver(items, ep.send);
  expect(r.error).toBeNull();
  expect(r.rejected.map((x) => x.item)).toEqual([17, 150]);
  expect(r.rejected[0].reason).toBe('HTTP 422');
  expect(r.sent.sort((a, b) => a - b)).toEqual(items.filter((x) => x !== 17 && x !== 150));
  expect(ep.accepted.length).toBe(198);
  expect(ep.calls()).toBeLessThan(40); // bisection, not one request per item
});

test('network / server failures stop without dropping anything', async () => {
  for (const status of [500, 401, 503]) {
    const r = await deliver([1, 2, 3], endpoint(new Set(), status).send);
    expect(r.sent).toEqual([]);
    expect(r.rejected).toEqual([]);
    expect(r.error).toBeInstanceOf(HttpError);
  }
  const offline = await deliver([1], async () => {
    throw new TypeError('Network request failed');
  });
  expect(offline.error).toBeInstanceOf(TypeError);
  expect(isRejection(new TypeError('x'))).toBe(false);
});
