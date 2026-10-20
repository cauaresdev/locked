import type { Prescription, Session } from '../api/types';

/** In-session progress, persisted per day so a crash or app kill loses nothing. */
export interface Progress {
  checked: Record<string, boolean>; // checklist items, key `${block}:${exercise}`
  setsDone: Record<string, number>; // straight-set exercises, key `${block}:${exercise}`
  logIds: Record<string, string[]>; // ids of the sets logged per item, oldest first (for undo)
  swaps: Record<string, Prescription>; // exercises the athlete swapped for an alternative
  amrapRounds: Record<number, number>; // block order -> completed rounds
  amrapEndsAt?: Record<number, number>; // block order -> when its clock runs out (survives leaving the screen)
  amrapDone?: Record<number, boolean>; // block order -> clock ran out or the athlete closed the block
  startedAt: number | null;
  finishedAt: number | null;
}

export const emptyProgress = (): Progress => ({
  checked: {},
  setsDone: {},
  logIds: {},
  swaps: {},
  amrapRounds: {},
  amrapEndsAt: {},
  amrapDone: {},
  startedAt: null,
  finishedAt: null,
});

/** The session as the athlete is doing it: swapped exercises replace the planned ones. */
export function applySwaps(session: Session, p: Progress): Session {
  if (Object.keys(p.swaps).length === 0) return session;
  return {
    ...session,
    blocks: session.blocks.map((b) => ({
      ...b,
      exercises: b.exercises.map((rx, i) => p.swaps[itemKey(b.order, i)] ?? rx),
    })),
  };
}

/** Progress after logging a set of `key`. */
export function withSetLogged(p: Progress, key: string, logId: string): Progress {
  return {
    ...p,
    setsDone: { ...p.setsDone, [key]: (p.setsDone[key] ?? 0) + 1 },
    logIds: { ...p.logIds, [key]: [...(p.logIds[key] ?? []), logId] },
  };
}

/** Progress after undoing the last set of `key`, and the id of that set (null if none). */
export function withLastSetUndone(p: Progress, key: string): { progress: Progress; logId: string | null } {
  const ids = p.logIds[key] ?? [];
  const done = p.setsDone[key] ?? 0;
  if (done === 0) return { progress: p, logId: null };
  return {
    progress: {
      ...p,
      setsDone: { ...p.setsDone, [key]: done - 1 },
      logIds: { ...p.logIds, [key]: ids.slice(0, -1) },
      finishedAt: null,
    },
    logId: ids.length > 0 ? ids[ids.length - 1] : null,
  };
}

export const itemKey = (blockOrder: number, exerciseIndex: number) => `${blockOrder}:${exerciseIndex}`;

export function blockComplete(session: Session, blockOrder: number, p: Progress): boolean {
  const block = session.blocks.find((b) => b.order === blockOrder);
  if (!block) return false;
  switch (block.execution_style) {
    case 'checklist':
      return block.exercises.every((_, i) => p.checked[itemKey(block.order, i)]);
    case 'straight_sets':
      return block.exercises.every((rx, i) => (p.setsDone[itemKey(block.order, i)] ?? 0) >= rx.sets);
    case 'amrap':
      // Progress saved before amrapDone existed: a logged round was enough.
      if (!p.amrapDone) return (p.amrapRounds[block.order] ?? 0) > 0;
      return !!p.amrapDone[block.order];
  }
}

/**
 * A block is locked while any earlier block flagged mandatory_lock is
 * incomplete: strength work cannot start if joint prep was skipped.
 */
export function blockLocked(session: Session, blockOrder: number, p: Progress): boolean {
  return session.blocks.some(
    (b) => b.order < blockOrder && b.mandatory_lock && !blockComplete(session, b.order, p),
  );
}

export function sessionComplete(session: Session, p: Progress): boolean {
  return session.blocks.every((b) => blockComplete(session, b.order, p));
}
