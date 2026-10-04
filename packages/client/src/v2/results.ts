import { type Hex, logHash, type ParsedEndAttest } from '@bored-games/protocol';
import type { ResultId } from '../types.ts';
import { type EventStoreV2, resultKey } from './store.ts';
import type { GameCtx } from './types.ts';
import type { Walk } from './walk.ts';

/*
 * Results and end attestations (PROTOCOL-v2 §4.3, §5.3; build plan D-E layer 5). Built so far (T7): this client's
 * own `over` result, and each end attestation's consistency with the line to its head. Claims and Resigns as
 * results are T12, and validity without a clock for results off the walk (the cutoff's candidates) T11.
 */

/**
 * This client's own result with no fork held (PROTOCOL-v2 §5.5): the module over at the walk's head is
 * `(over, head, [])`. Null while the game is live, and while the walk ends at a fork (the cutoff decides then).
 */
export function ownResult(ctx: GameCtx, w: Walk): ResultId | null {
  if (w.fork !== null) return null;
  const head = w.line.points[w.line.points.length - 1];
  if (head === undefined || head.state === null) return null;
  if (ctx.module.pending(head.state).type !== 'over') return null;
  return { kind: 'over', head: head.id, forfeit: [] };
}

/** The log hash of the line to `head` (PROTOCOL-v2 §4.3): its move ids from move 1, or null while not all held. */
export function lineLogHash(store: EventStoreV2, head: Hex): Hex | null {
  const ids = store.lineIds(head);
  return ids === null ? null : logHash(ids);
}

/**
 * An end attestation judged against the held events (PROTOCOL-v2 §4.3 "Consistency"): `valid` once the line to its
 * head is held and its `logHash` is that line's; `unresolved` until then; `mismatch` when the hashes differ, which
 * makes it invalid for every purpose.
 */
export function endVerdict(store: EventStoreV2, a: ParsedEndAttest): 'valid' | 'unresolved' | 'mismatch' {
  const hash = lineLogHash(store, a.headId);
  if (hash === null) return 'unresolved';
  return hash === a.end.logHash ? 'valid' : 'mismatch';
}

/** The identity an end attestation names (PROTOCOL-v2 §5.3). */
export function attestedResult(a: ParsedEndAttest): ResultId {
  return { kind: a.end.kind, head: a.headId, forfeit: [...a.end.forfeit] };
}

/**
 * The seats that signed a valid end attestation of result `r`, with either key (PROTOCOL-v2 §4.3, V2-11), ascending.
 * Every one counts, not only a seat's latest (§5.4 (a)).
 */
export function endAttestedSeats(store: EventStoreV2, r: ResultId): number[] {
  const key = resultKey(r);
  const seats = new Set<number>();
  for (const e of store.ends.values()) {
    if (resultKey(attestedResult(e.ev)) !== key) continue;
    if (endVerdict(store, e.ev) === 'valid') seats.add(e.seat);
  }
  return [...seats].sort((a, b) => a - b);
}
