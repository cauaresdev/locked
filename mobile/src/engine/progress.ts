import type { Session } from '../api/types';

/** In-session progress, persisted per day so a crash or app kill loses nothing. */
export interface Progress {
  checked: Record<string, boolean>; // checklist items, key `${block}:${exercise}`
  setsDone: Record<string, number>; // straight-set exercises, key `${block}:${exercise}`
  amrapRounds: Record<number, number>; // block order -> completed rounds
  startedAt: number | null;
  finishedAt: number | null;
}

export const emptyProgress = (): Progress => ({
  checked: {},
  setsDone: {},
  amrapRounds: {},
  startedAt: null,
  finishedAt: null,
});

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
      return (p.amrapRounds[block.order] ?? 0) > 0;
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
