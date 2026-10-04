import { type Point as CurvePoint, rollSeed, type Share, verifyMoveRollShare } from '@bored-games/deck';
import { faces } from '@bored-games/dice';
import { isRollEntry } from '@bored-games/game-kit';
import type { Hex, ParsedRollShares } from '@bored-games/protocol';
import type { EventStoreV2 } from './store.ts';
import type { GameCtx } from './types.ts';

/*
 * Dice under protocol 2 (PROTOCOL-v2 §6.2; build plan D-E layer 8). A game action that makes the module's
 * `rolls(state)` list grow by r entries requests the rolls (M, 0) … (M, r−1), M being its Move's id (the requesting
 * move). Every seat contributes `D = x_k·H(M, n)` with its proof in a roll Shares event (`move` M, `pos` n); the
 * contribution is checked by `verifyMoveRollShare`, so a proof for one requesting move fails for any other. Once every
 * seat's verified contribution to (M, n) is held, the faces are `faces(rollSeed(D in seat order), count, sides)`.
 *
 * The roll store is keyed by (seat, M, n): per requesting move, the first valid contribution of each seat to each
 * index, by ascending event id (every valid contribution of a (seat, M, n) has the same `D`, so the choice never
 * changes a seed). Validity is a pool apart from the held set (D066): every roll Shares event with a seated signer is
 * held in `EventStoreV2` whatever happens here.
 */

/** A roll a game action requested: (M, n), with the module's roll id and its entry's `count` and `sides`. */
export interface RollRef {
  /** The requesting move M. */
  readonly move: Hex;
  /** The roll index n within M (0 for the first roll M requested). */
  readonly n: number;
  /** The module's roll id (`rolls(state)[…].id`), which `{type:'beacon', id}` names. */
  readonly id: number;
  readonly count: number;
  readonly sides: number;
}

/** The contribution checks kept for the life of a session: each roll Shares event's proofs, by event id. */
export class RollCaches {
  /** Null when every contribution of the event verifies against its requesting move's points; else why not. */
  readonly proofs = new Map<Hex, string | null>();
}

/**
 * The rolls the game action of move `move` requested (PROTOCOL-v2 §6.2, V2-31): the entries `rolls(after)` holds
 * beyond `rolls(before)`, in list order, as (M, 0) … (M, r−1). An entry that is not a protocol 2 roll entry (no
 * `count` and `sides`) gets 0 for both, so its faces can never be derived.
 */
export function appendedRolls(ctx: GameCtx, before: unknown, after: unknown, move: Hex): RollRef[] {
  const rolls = ctx.module.rolls;
  if (typeof rolls !== 'function') return [];
  const had = rolls(before).length;
  return rolls(after)
    .slice(had)
    .map((e, n) => ({
      move,
      n,
      id: e.id,
      count: isRollEntry(e) ? e.count : 0,
      sides: isRollEntry(e) ? e.sides : 0,
    }));
}

/**
 * Why roll Shares event `ev` by `seat` has a contribution that does not verify against its requesting move's point
 * (context deck id `roll`, position n: V2-32), or null when every one does. Independent of how many rolls the move
 * requested; cached per event.
 */
export function rollProofProblem(
  ctx: GameCtx,
  caches: RollCaches,
  seat: number,
  ev: ParsedRollShares,
): string | null {
  const known = caches.proofs.get(ev.id);
  if (known !== undefined) return known;
  let out: string | null = null;
  for (const { pos, share } of ev.shares) {
    if (!verifyMoveRollShare(ctx.keys[seat] as CurvePoint, ctx.rootId, ev.moveId, pos, share)) {
      out = `the contribution to roll ${pos} of move ${ev.moveId} does not verify`;
      break;
    }
  }
  caches.proofs.set(ev.id, out);
  return out;
}

/**
 * Why roll Shares event `ev` by `seat` is invalid as a whole, given that its requesting move requested `requested`
 * rolls (PROTOCOL-v2 §4.2): an index the move did not request, or a contribution that does not verify. Null when
 * valid.
 */
export function rollEventProblem(
  ctx: GameCtx,
  caches: RollCaches,
  seat: number,
  ev: ParsedRollShares,
  requested: number,
): string | null {
  const over = ev.shares.find((x) => x.pos >= requested);
  if (over !== undefined)
    return `move ${ev.moveId} requested ${requested} roll${requested === 1 ? '' : 's'}, not roll ${over.pos}`;
  return rollProofProblem(ctx, caches, seat, ev);
}

/**
 * The roll store for requesting move `move`, which requested `requested` rolls: `out[n][k]` is seat k's kept
 * contribution to (M, n), the one in its valid roll Shares event with the lowest id, or null.
 */
export function contributions(
  ctx: GameCtx,
  store: EventStoreV2,
  caches: RollCaches,
  move: Hex,
  requested: number,
): (Share | null)[][] {
  const out: (Share | null)[][] = Array.from({ length: requested }, () =>
    Array.from({ length: ctx.seats }, () => null),
  );
  for (const { ev, seat } of store.rollsFor(move)) {
    if (rollEventProblem(ctx, caches, seat, ev, requested) !== null) continue;
    for (const { pos, share } of ev.shares) {
      const slots = out[pos] as (Share | null)[];
      if (slots[seat] === null) slots[seat] = share;
    }
  }
  return out;
}

/**
 * The faces of roll `ref` (PROTOCOL-v2 §6.2, V2-35): the seed is the SHA-256 of the `D` points in seat order, 33
 * compressed bytes each (`rollSeed`), and `faces` draws `count` faces in `1..sides`. Null while a seat's contribution
 * is missing, or when the entry's `count` and `sides` are outside what `faces` draws (a module bug: the roll can
 * never be derived).
 */
export function deriveFaces(ref: RollRef, slots: readonly (Share | null)[]): number[] | null {
  const shares: Share[] = [];
  for (const s of slots) {
    if (s === null) return null;
    shares.push(s);
  }
  if (shares.length === 0) return null;
  try {
    return faces(rollSeed(shares), ref.count, ref.sides);
  } catch {
    return null;
  }
}
