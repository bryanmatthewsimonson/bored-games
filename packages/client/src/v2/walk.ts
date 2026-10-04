import type { Hex } from '@bored-games/protocol';
import { LineFold } from './line.ts';
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
 * (`DeckCaches`). Whole judgements are cached by move id only in a deckless game without dice, where they are a
 * function of the move's line alone (a move's prev fixes its whole line); with a deck they also depend on the
 * shares held, and with dice on the contributions (review L2).
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
}

/** Whether a judgement makes a move part of C(h): valid-looking (and maybe valid). */
export const looksValid = (j: Judgement): boolean =>
  j.kind === 'valid' || j.kind === 'looking' || j.kind === 'unproven';

/** Whether `j` may be cached by move id where judgements depend on the line alone. */
const settled = (j: Judgement): boolean =>
  j.kind === 'invalid' || j.kind === 'valid' || (j.kind === 'looking' && j.final);

/**
 * Walk the held events of `store` from the root. `cache` keeps whole judgements by move id where they never change
 * (a deckless game without dice); `caches` keeps the crypto results.
 */
export function walk(
  ctx: GameCtx,
  store: EventStoreV2,
  cache: Map<Hex, Judgement>,
  caches: DeckCaches,
): Walk {
  const cacheable = ctx.deckId === null && typeof ctx.module.rolls !== 'function';
  const fold = new LineFold(ctx, store, caches);
  const judged = new Map<Hex, Judgement>();
  let fork: Fork | null = null;
  for (;;) {
    const looking: { h: HeldMove; j: Judgement }[] = [];
    for (const h of store.kidsOf(fold.point.id)) {
      let j = cacheable ? cache.get(h.m.id) : undefined;
      if (j === undefined) {
        j = fold.judge(h);
        if (cacheable && settled(j)) cache.set(h.m.id, j);
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
  };
}
