/**
 * Upload a queued batch without letting one bad item block the queue.
 *
 * When the server rejects the payload itself (400 / 413 / 422), the batch is
 * split in half and retried until the offending items are isolated: those are
 * returned as `rejected`, everything else is delivered. Any other failure
 * (offline, timeout, 5xx, 401) stops the upload and is returned as `error`, so
 * the caller keeps the undelivered items queued.
 */

export interface Rejected<T> {
  item: T;
  reason: string;
}

export interface Delivery<T> {
  sent: T[];
  rejected: Rejected<T>[];
  error: unknown;
}

const REJECTION_STATUS = new Set([400, 413, 422]);

export function isRejection(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && REJECTION_STATUS.has(status);
}

export async function deliver<T>(items: T[], send: (batch: T[]) => Promise<unknown>): Promise<Delivery<T>> {
  if (items.length === 0) return { sent: [], rejected: [], error: null };
  try {
    await send(items);
    return { sent: items, rejected: [], error: null };
  } catch (e) {
    if (!isRejection(e)) return { sent: [], rejected: [], error: e };
    if (items.length === 1) {
      return { sent: [], rejected: [{ item: items[0], reason: e instanceof Error ? e.message : String(e) }], error: null };
    }
    const mid = Math.ceil(items.length / 2);
    const left = await deliver(items.slice(0, mid), send);
    if (left.error) return left;
    const right = await deliver(items.slice(mid), send);
    return { sent: [...left.sent, ...right.sent], rejected: [...left.rejected, ...right.rejected], error: right.error };
  }
}
