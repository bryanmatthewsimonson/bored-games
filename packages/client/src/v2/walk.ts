import type { Share } from '@bored-games/deck';
import type { Hex } from '@bored-games/protocol';
import { LineFold } from './line.ts';
import type { RollRef } from './rolls.ts';
import type { DeckCaches, LineShares } from './shares.ts';
import type { EventStoreV2 } from './store.ts';
import type { Fork, GameCtx, HeldMove, Judgement, Line } from './types.ts';

/*
 * The walk (PROTOCOL-v2 §5.1; build plan D-E layer 3): from the root, at head h, C(h) is the set of held moves on
 * prev h, with seq one more, that are valid-looking at h. Two or more end the walk at a fork at h (§5.2); exactly one
 * that is also valid links, and the walk goes on; otherwise the walk ends at h. No branch is ever chosen, so the
 * walk is a function of the held events alone: every client that holds the same events walks the same chain.
 *
 * A well-formed shuffle step is valid-looking without its proof: the proof is checked only when the step is the one
 * valid-looking successor of its prev, so two well-formed steps by one seat on one prev are a fork with no proof
 * verified (V2-14). A step whose proof fails stays valid-looking (it is part of C(h) for good) but never links.
 *
 * It is recomputed from the root after every change (build plan D-E: simple first), with the crypto results cached
 * (`DeckCaches`). In a deckless game, whole judgements are cached by (move id, length of the action log at its prev).
 * A move's prev fixes its line; the log length at the prev counts the derived rolls applied there, which is all the
 * prev's state depends on besides the line (review of T6/T7, L2):
 * - a game action is valid only while a player decision is pending, so every beacon below the prev on a line that
 *   reaches it was resolved, with faces fixed by the seats' deck keys, and the rolls derived at each earlier point are
 *   exactly those that let the module pend a decision;
 * - only at the prev itself can a beacon still wait for contributions, and each roll derived there adds one log
 *   entry, so a successor judged invalid while the beacon waited is judged again once the roll is derived.
 * Without dice the log length is fixed by the line, and the key is the move id's alone, in effect. With a deck,
 * judgements also depend on the card shares held, so they are not cached.
 */

export interface Walk {
  /** The walk's moves, in seq order. */
  readonly chain: readonly HeldMove[];
  /** The fold along the chain: `line.points[i]` at seq `i`, the last one the head. */
  readonly line: Line;
  /** The line's card shares at the head, from the final deck on; null before it and in a deckless game. */
  readonly shares: LineShares | null;
  /** The fork the walk ends at, or null. */
  readonly fork: Fork | null;
  /** The judgement of every held move whose prev is on the walk, by id. */
  readonly judged: ReadonlyMap<Hex, Judgement>;
  /** The rolls the chain's game actions requested, by the module's roll id (PROTOCOL-v2 §6.2, V2-31). */
  readonly rolls: ReadonlyMap<number, RollRef>;
  /** How many rolls each requesting move on the chain requested, by move id. */
  readonly requests: ReadonlyMap<Hex, number>;
  /** The roll store for a requesting move on the chain, from the held events: `[n][seat]` (none for another move). */
  readonly contributions: (move: Hex) => (Share | null)[][];
}

/** Whether a judgement makes a move part of C(h): valid-looking (and maybe valid). */
export const looksValid = (j: Judgement): boolean =>
  j.kind === 'valid' || j.kind === 'looking' || j.kind === 'unproven';

/** Whether `j` may be cached by move id where judgements depend on the line alone. */
const settled = (j: Judgement): boolean =>
  j.kind === 'invalid' || j.kind === 'valid' || (j.kind === 'looking' && j.final);

/**
 * Walk the held events of `store` from the root. `cache` keeps whole judgements where they never change (a deckless
 * game, by move id and the log length at its prev); `caches` keeps the crypto results.
 */
export function walk(
  ctx: GameCtx,
  store: EventStoreV2,
  cache: Map<string, Judgement>,
  caches: DeckCaches,
): Walk {
  const cacheable = ctx.deckId === null;
  const fold = new LineFold(ctx, store, caches);
  const judged = new Map<Hex, Judgement>();
  let fork: Fork | null = null;
  for (;;) {
    const looking: { h: HeldMove; j: Judgement }[] = [];
    for (const h of store.kidsOf(fold.point.id)) {
      const key = `${h.m.id}|${fold.point.logLength}`;
      let j = cacheable ? cache.get(key) : undefined;
      if (j === undefined) {
        j = fold.judge(h);
        if (cacheable && settled(j)) cache.set(key, j);
      }
      judged.set(h.m.id, j);
      if (looksValid(j)) looking.push({ h, j });
    }
    if (looking.length >= 2) {
      // Every valid-looking successor is signed by the seat pending at P (or the step's seat): E (§5.2).
      const first = looking[0] as { h: HeldMove };
      fork = {
        at: fold.point.id,
        seq: fold.point.seq,
        seat: first.h.seat,
        successors: looking.map((x) => x.h.m.id),
      };
      break;
    }
    const only = looking[0];
    if (only === undefined) break;
    let j = only.j;
    if (j.kind === 'unproven') {
      j = fold.prove(only.h);
      judged.set(only.h.m.id, j);
    }
    if (j.kind !== 'valid') break;
    fold.link(only.h, j);
  }
  return {
    chain: fold.chain,
    line: { points: fold.points, log: fold.log, events: fold.events },
    shares: fold.shares,
    fork,
    judged,
    rolls: fold.rolls,
    requests: fold.requests,
    contributions: (move) => fold.contributionsOf(move),
  };
}
