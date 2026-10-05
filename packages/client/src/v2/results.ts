import { type Hex, logHash, type ParsedEndAttest } from '@bored-games/protocol';
import type { ResultId } from '../types.ts';
import type { LineFold } from './line.ts';
import type { SideLines } from './sides.ts';
import { type EventStoreV2, resultKey } from './store.ts';
import type { GameCtx, HeldMove, LinePoint } from './types.ts';
import { looksValid, type Walk } from './walk.ts';

/*
 * Results and end attestations (PROTOCOL-v2 §4.3, §5.3; build plan D-E layer 5): this client's own `over` result with
 * no fork held (the session adds the claims and Resigns it counts itself, T12), each end attestation's validity, the
 * validity of a result from the held events without a clock (§5.3, V2-17), and a Resign's scoring position S along
 * its named head's line (§8.3, V2-43). All are functions of the held events: the cutoff (`cutoff.ts`) reads them.
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
  const known = store.lineHashes.get(head);
  if (known !== undefined) return known;
  const ids = store.lineIds(head);
  if (ids === null) return null;
  const hash = logHash(ids);
  store.lineHashes.set(head, hash);
  return hash;
}

/**
 * An end attestation's log hash against the held events (PROTOCOL-v2 §4.3 "Consistency"): `valid` once the line to
 * its head is held and its `logHash` is that line's; `unresolved` until then; `mismatch` when the hashes differ.
 */
export function endVerdict(store: EventStoreV2, a: ParsedEndAttest): 'valid' | 'unresolved' | 'mismatch' {
  const hash = lineLogHash(store, a.headId);
  if (hash === null) return 'unresolved';
  return hash === a.end.logHash ? 'valid' : 'mismatch';
}

/**
 * Why a held end attestation is invalid, or null (PROTOCOL-v2 §4.3): a seat in `forfeit` that the game does not
 * have, or a log hash that does not match the line to its head (V2-12). An invalid one counts for no result and
 * satisfies no duty; it stays held, and counts for rule (b) by its head and for the rebroadcast (§5.4 (b), V2-56).
 * An unresolved one (its head's line not held) is not invalid yet, but counts for nothing until it resolves.
 */
export function endProblem(store: EventStoreV2, seats: number, a: ParsedEndAttest): string | null {
  const outside = a.end.forfeit.find((k) => k >= seats);
  if (outside !== undefined) return `there is no seat ${outside}`;
  if (endVerdict(store, a) === 'mismatch')
    return "the end attestation's log hash does not match the line to its head";
  return null;
}

/** Whether a held end attestation counts for its result (§4.3, §5.4 (a)): resolved, with no `endProblem`. */
export function endCounts(store: EventStoreV2, seats: number, a: ParsedEndAttest): boolean {
  return endProblem(store, seats, a) === null && endVerdict(store, a) === 'valid';
}

/** The identity an end attestation names (PROTOCOL-v2 §5.3). */
export function attestedResult(a: ParsedEndAttest): ResultId {
  return { kind: a.end.kind, head: a.headId, forfeit: [...a.end.forfeit] };
}

/**
 * The seats that signed a valid end attestation of result `r`, with either key (PROTOCOL-v2 §4.3, V2-11), ascending.
 * Every one counts, not only a seat's latest (§5.4 (a)); an invalid one (`endProblem`) never does.
 */
export function endAttestedSeats(store: EventStoreV2, seats: number, r: ResultId): number[] {
  const key = resultKey(r);
  const out = new Set<number>();
  for (const e of store.ends.values()) {
    if (resultKey(attestedResult(e.ev)) !== key) continue;
    if (endCounts(store, seats, e.ev)) out.add(e.seat);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Every result identity some held end attestation validly names, with the seats that attested it (§5.4 (a)): the
 * cutoff's candidates (a result that no seat attested cannot meet rule (a), since every game has two seats or more).
 * By result key, ascending.
 */
export function attestedResults(
  store: EventStoreV2,
  seats: number,
): Map<string, { result: ResultId; seats: Set<number> }> {
  const out = new Map<string, { result: ResultId; seats: Set<number> }>();
  for (const e of store.ends.values()) {
    if (!endCounts(store, seats, e.ev)) continue;
    const result = attestedResult(e.ev);
    const key = resultKey(result);
    let g = out.get(key);
    if (g === undefined) {
      g = { result, seats: new Set() };
      out.set(key, g);
    }
    g.seats.add(e.seat);
  }
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A Resign's scoring position: `fold` holds the named head's line and the moves after it; S is at `seq` on it. */
export interface Scoring {
  readonly fold: LineFold;
  readonly seq: number;
}

/**
 * A Resign's scoring position S (PROTOCOL-v2 §8.3, v1 §8.3 steps 2–3): from its named head H along H's line forward,
 * following the unique valid successor while there is exactly one valid-looking successor and it is valid, and
 * stopping at the first held fork past H (V2-43). On that line, S0 is H moved forward to just after the resigning
 * seat k's last game action, and S extends S0 through the contiguous moves signed by the seat pending at S0 (a
 * player decision), unless that is k. Null when H's line is not held or not valid.
 */
export function resignScoring(
  ctx: GameCtx,
  store: EventStoreV2,
  sides: SideLines,
  head: Hex,
  k: number,
): Scoring | null {
  const fold = sides.extend(head);
  if (fold === null) return null;
  const start = fold.point.seq;
  const forward: HeldMove[] = [];
  for (;;) {
    const looking: { h: HeldMove; j: ReturnType<LineFold['judge']> }[] = [];
    for (const h of store.kidsOf(fold.point.id)) {
      const j = fold.judge(h);
      if (looksValid(j)) looking.push({ h, j });
    }
    const only = looking[0];
    if (looking.length !== 1 || only === undefined) break;
    const j = only.j.kind === 'unproven' ? fold.prove(only.h) : only.j;
    if (j.kind !== 'valid') break;
    fold.link(only.h, j);
    forward.push(only.h);
  }
  let i = -1;
  for (const [n, h] of forward.entries()) if (h.seat === k && h.m.content.type === 'action') i = n;
  const s0 = fold.points[start + i + 1] as LinePoint;
  const p = s0.phase === 'play' && s0.state !== null ? ctx.module.pending(s0.state) : null;
  if (p !== null && p.type === 'player' && p.seat !== k)
    while (i + 1 < forward.length && (forward[i + 1] as HeldMove).seat === p.seat) i++;
  return { fold, seq: start + i + 1 };
}

/** The point at `s`: S on its line. */
export function scoringPoint(s: Scoring): LinePoint {
  return s.fold.points[s.seq] as LinePoint;
}

/**
 * Whether a Resign by seat k naming `head` cancels (v1 §8.3, PROTOCOL-v2 §5.3): its head comes before the first game
 * action (the root, or a shuffle step) and the line to its scoring position holds no game action by k.
 */
export function resignCancels(ctx: GameCtx, s: Scoring, headSeq: number, k: number): boolean {
  if (headSeq > ctx.shuffleSteps) return false;
  return !s.fold.chain.slice(0, s.seq).some((h) => h.seat === k && h.m.content.type === 'action');
}

/**
 * Whether result `r` is valid from the held events, with no clock (PROTOCOL-v2 §5.3, V2-17): every forfeiting seat
 * is a seat; its head is the root or a held move whose line is valid; and
 * - `over`: no forfeiting seat, and the module is over at the head;
 * - `claim`: one or more forfeiting seats, the module not over at the head, a game action on the line to the head,
 *   and a held Timeout claim naming that head signed by a seat not in the list (no stall check: rule (a) asks every
 *   seat but E, the forfeiting seats included, to attest it);
 * - `resign`: one seat k, a held valid Resign by k naming the head, that does not cancel.
 * `scoring` gives a Resign's scoring position (memoised by the caller).
 */
export function resultValid(
  ctx: GameCtx,
  store: EventStoreV2,
  sides: SideLines,
  r: ResultId,
  scoring: (head: Hex, k: number) => Scoring | null,
): boolean {
  if (r.forfeit.some((k) => !Number.isSafeInteger(k) || k < 0 || k >= ctx.seats)) return false;
  const p = sides.point(r.head);
  if (p === null) return false;
  const over = p.state !== null && ctx.module.pending(p.state).type === 'over';
  switch (r.kind) {
    case 'over':
      return r.forfeit.length === 0 && over;
    case 'claim': {
      if (r.forfeit.length === 0 || over || p.seq <= ctx.shuffleSteps) return false;
      for (const c of store.claims.values())
        if (c.ev.headId === r.head && !r.forfeit.includes(c.seat)) return true;
      return false;
    }
    case 'resign': {
      const k = r.forfeit[0];
      if (r.forfeit.length !== 1 || k === undefined) return false;
      let held = false;
      for (const x of store.resigns.values()) if (x.seat === k && x.ev.headId === r.head) held = true;
      if (!held) return false;
      const s = scoring(r.head, k);
      return s !== null && !resignCancels(ctx, s, p.seq, k);
    }
  }
}

/** A result's key, re-exported for the layers above. */
export { resultKey };
