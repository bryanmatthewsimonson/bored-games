import { type Ciphertext, type Point as CurvePoint, cardOf, combine, ownShare } from '@bored-games/deck';
import type { Audit, Hex, Outcome } from '@bored-games/protocol';
import { auditOrder, failEveryone } from '../audit.ts';
import { equivocators } from './equivocators.ts';
import type { SideLines } from './sides.ts';
import type { EventStoreV2 } from './store.ts';
import type { GameCtx, LinePoint } from './types.ts';
import type { Walk } from './walk.ts';

/*
 * The stop and its scoring (PROTOCOL-v2 §5.6), and the after-stop Secret phase with its partial audit (§7.3, review
 * H2); build plan D-E layer 7. Everything here is a function of the held events: no clock, no arrival order.
 *
 * Built in T10 for a walk that ends at a fork with no result standing (the cutoff, which can make a result stand
 * against the fork instead, is T11). The stop ends the game at P, the fork's prev, and is never resumed:
 * - **Cancelled** only when no game action is held at or past P on any line whose every move is valid (review H1):
 *   the test is on what was played, not on where P is.
 * - Otherwise **scored**: every equivocator of the M1 scan (§5.2), E included, shares the last places; the other
 *   seats are ranked by `standings` at P, ties sharing places, with the standings as scores; when the walk up to P
 *   holds no game action (P before play), every other seat shares first place and every score is 0. The reason is
 *   `stop`. What is rated is the stats record's (`record.ts`): with 2 seats the whole result, a loss for E (a tie
 *   when both seats equivocated); with 3 or more only the equivocators' last places.
 * - **After a stop in a deck game whose final deck exists at P** (every shuffle step on P's line linked; below that
 *   there is no card to audit, so no secret is owed and none recorded as withheld) every seat owes its Secret reveal. The places are fixed at the stop: a missing
 *   secret only records the seat as "secret withheld". Once the held secrets and verified shares decrypt every
 *   position of the final deck at P, the partial audit replays the action log up to P in full mode, with no outcome
 *   comparison; until then the game is "audit incomplete". Only a proven failure moves a seat: a failed seat shares
 *   the last places with the equivocators, rated last like them (coordinator ruling after T10, D067: with 2 seats a
 *   failed non-forker ties with E, so a proven cheat never keeps a rated win). A verdict that fails every seat
 *   demotes nobody.
 */

/** The stop at the walk's fork (PROTOCOL-v2 §5.6). */
export interface Stop {
  /** P: the fork's prev (the root or a move on the walk), the walk's head. */
  readonly at: Hex;
  readonly seq: number;
  /** E: the seat that signed the fork. */
  readonly seat: number;
  /** No game action is held at or past P on a valid line (H1): no result, no rating, E only recorded. */
  readonly cancelled: boolean;
  /** The walk up to P holds no game action: P is the root, a shuffle step, or the head before the first action. */
  readonly beforePlay: boolean;
  /** Every equivocator of the M1 scan, E included, ascending (§5.2). */
  readonly equivocators: readonly number[];
  /** The scores: the module's `standings` at P, or all 0 before play. */
  readonly scores: readonly number[];
}

/** The stop at `w`'s fork, which must be held (`w.fork` not null). */
export function stopAt(ctx: GameCtx, store: EventStoreV2, w: Walk, sides: SideLines): Stop {
  const fork = w.fork;
  if (fork === null) throw new Error('stopAt: the walk holds no fork');
  const head = w.line.points[w.line.points.length - 1] as LinePoint;
  const beforePlay = !w.chain.some((h) => h.m.content.type === 'action');
  const scores = beforePlay ? new Array<number>(ctx.seats).fill(0) : standingsAt(ctx, head);
  return {
    at: fork.at,
    seq: fork.seq,
    seat: fork.seat,
    // Past the first game action, P is itself a game action on the walk (a valid line): played.
    cancelled: beforePlay && !played(store, w, sides),
    beforePlay,
    equivocators: equivocators(ctx, store, w, sides),
    scores,
  };
}

/** The module's `standings` at `p` as integers, one per seat (0 where a module returns less). */
function standingsAt(ctx: GameCtx, p: LinePoint): number[] {
  let raw: readonly number[] = [];
  try {
    if (p.state !== null) raw = ctx.module.standings(p.state);
  } catch {
    raw = [];
  }
  return Array.from({ length: ctx.seats }, (_, k) => {
    const x = raw[k];
    return typeof x === 'number' && Number.isFinite(x) ? x : 0;
  });
}

/**
 * Whether a held game action at or past P lies on a valid line (H1). The fork's successors are judged on the walk;
 * any other game action at or past P needs its line folded (`SideLines`), shallowest first, until one is valid.
 */
function played(store: EventStoreV2, w: Walk, sides: SideLines): boolean {
  const fork = w.fork;
  if (fork === null) return false;
  for (const id of fork.successors) {
    const h = store.moves.get(id);
    if (h?.m.content.type === 'action' && w.judged.get(id)?.kind === 'valid') return true;
  }
  const actions = [...store.moves.values()]
    .filter((h) => h.shape === null && h.m.content.type === 'action' && h.m.seq > fork.seq)
    .filter((h) => store.atOrPast(h.m.id, fork.at))
    .sort((a, b) => a.m.seq - b.m.seq || (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0));
  for (const h of actions) if (sides.isValid(h.m.id)) return true;
  return false;
}

/**
 * The places of a scored stop: the seats that are neither equivocators nor `demoted` by `scores` (descending, ties
 * sharing a place), then every equivocator and every demoted seat (a proven audit failure, D067) sharing the last
 * place.
 */
export function stopPlaces(
  seats: number,
  scores: readonly number[],
  eq: readonly number[],
  demoted: readonly number[],
): number[] {
  const last = new Set([...eq, ...demoted]);
  const top = Array.from({ length: seats }, (_, k) => k).filter((k) => !last.has(k));
  return Array.from({ length: seats }, (_, k) => {
    if (last.has(k)) return top.length + 1;
    return 1 + top.filter((j) => (scores[j] as number) > (scores[k] as number)).length;
  });
}

/** The outcome of a scored stop (§5.6), with the seats a proven audit failure demoted (§7.3). */
export function stopOutcome(ctx: GameCtx, stop: Stop, demoted: readonly number[]): Outcome {
  return {
    places: stopPlaces(ctx.seats, stop.scores, stop.equivocators, demoted),
    reason: 'stop',
    scores: [...stop.scores],
  };
}

/** The partial audit after a stop (§7.3): nothing to audit, not runnable yet, or its verdict. */
export type AfterStopAudit =
  | { readonly state: 'none' }
  | { readonly state: 'incomplete' }
  | { readonly state: 'ran'; readonly verdict: Audit };

/**
 * The partial audit up to P (§7.3), from the held secrets (`secrets[k]`, verified against `X_k`, or null) and the
 * verified card shares on the walk up to P. `none` when P precedes the final deck (there is no card to audit);
 * `incomplete` while some position lacks, for some seat, both that seat's secret and its verified share; otherwise
 * the verdict: a position that decrypts to no card fails every seat, and so does a refused setup or a rejected
 * derived reveal or roll; the first game action the full-mode replay rejects fails its actor.
 */
export function partialAudit(ctx: GameCtx, w: Walk, secrets: readonly (bigint | null)[]): AfterStopAudit {
  const head = w.line.points[w.line.points.length - 1] as LinePoint;
  const shares = w.shares;
  if (ctx.deckId === null || head.deckKey === null || shares === null) return { state: 'none' };
  for (let pos = 0; pos < ctx.deckSize; pos++)
    for (let k = 0; k < ctx.seats; k++)
      if (secrets[k] === null && !shares.has(k, pos)) return { state: 'incomplete' };
  const order: number[] = [];
  for (let pos = 0; pos < ctx.deckSize; pos++) {
    const ct = head.deck[pos] as Ciphertext;
    const slots = shares.slots(pos);
    const Ds: CurvePoint[] = [];
    for (let k = 0; k < ctx.seats; k++) {
      const x = secrets[k] ?? null;
      Ds.push(x !== null ? ownShare(x, ct) : (slots[k] as { D: CurvePoint }).D);
    }
    const card = cardOf(ctx.cards, combine(ct, Ds));
    if (card === null)
      return { state: 'ran', verdict: failEveryone(ctx.seats, `deck position ${pos} decrypts to no card`) };
    order.push(card);
  }
  const verdict = auditOrder({
    module: ctx.module,
    rules: ctx.rules,
    seats: ctx.seats,
    deckId: ctx.deckId,
    order,
    log: w.line.log.slice(0, head.logLength),
  });
  return { state: 'ran', verdict };
}

/**
 * The seats a partial-audit verdict demotes after a stop (§7.3) to the shared last places: the failed seats that are
 * not equivocators (already last), unless the verdict fails every seat (no single seat is proven to blame: nobody is
 * demoted).
 */
export function demotedBy(verdict: Audit, seats: number, eq: readonly number[]): number[] {
  if (verdict === 'pass') return [];
  const failed = [...new Set(verdict.fail)].filter((k) => Number.isSafeInteger(k) && k >= 0 && k < seats);
  if (failed.length >= seats) return [];
  return failed.filter((k) => !eq.includes(k)).sort((a, b) => a - b);
}
