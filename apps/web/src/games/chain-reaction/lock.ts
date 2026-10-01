/*
 * The submit lock of the game screen, pure so it can be tested without a DOM. A move submitted from state
 * `seq` keeps the controls locked until the state moves on, the controller reports the publish finished
 * (`busy` falls), or the submission fails (`onAct` throws or rejects). A double click never sends two moves.
 */

export interface LockInput {
  /** False while the viewer may not act at all. */
  canAct: boolean;
  /** The controller is building and sending a move. */
  busy: boolean;
  /** The state seq a move was submitted from, or null. */
  sentAt: number | null;
  /** The current state seq. */
  seq: number;
}

export function isLocked(s: LockInput): boolean {
  return !s.canAct || s.busy || s.sentAt === s.seq;
}

export interface SubmitHooks<A> {
  /** Records the seq a move was sent from, or null to release the lock. */
  setSentAt(seq: number | null): void;
  onAct(a: A): void | Promise<void>;
}

/**
 * Submit `a` unless locked: lock at `s.seq`, then call `onAct`. When `onAct` throws or its promise rejects,
 * the lock is released so the player can try again. Returns whether the move was submitted.
 */
export function submitUnderLock<A>(a: A, s: LockInput, hooks: SubmitHooks<A>): boolean {
  if (isLocked(s)) return false;
  hooks.setSentAt(s.seq);
  const release = (): void => hooks.setSentAt(null);
  try {
    const r = hooks.onAct(a);
    if (r !== undefined) r.then(undefined, release);
  } catch {
    release();
  }
  return true;
}
