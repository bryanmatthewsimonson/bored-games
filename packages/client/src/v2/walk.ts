import type { Hex } from '@bored-games/protocol';
import type { LoggedAction } from '../audit.ts';
import { judge, link, rootPoint } from './line.ts';
import type { EventStoreV2 } from './store.ts';
import type { Fork, GameCtx, HeldMove, Judgement, Line, LinePoint } from './types.ts';

/*
 * The walk (PROTOCOL-v2 §5.1; build plan D-E layer 3): from the root, at head h, C(h) is the set of held moves on
 * prev h, with seq one more, that are valid-looking at h. Two or more end the walk at a fork at h (§5.2); exactly one
 * that is also valid links, and the walk goes on; otherwise the walk ends at h. No branch is ever chosen, so the
 * walk is a function of the held events alone: every client that holds the same events walks the same chain.
 *
 * It is recomputed from the root after every change (build plan D-E: simple first). Judgements are cached by move
 * id only while they are a function of the move's line alone, as every judgement of a deckless game without dice
 * is: a move's prev fixes its whole line.
 */

export interface Walk {
  /** The walk's moves, in seq order. */
  readonly chain: readonly HeldMove[];
  /** The fold along the chain: `line.points[i]` at seq `i`, the last one the head. */
  readonly line: Line;
  /** The fork the walk ends at, or null. */
  readonly fork: Fork | null;
  /** The judgement of every held move whose prev is on the walk, by id. */
  readonly judged: ReadonlyMap<Hex, Judgement>;
}

/** Whether a judgement makes a move part of C(h): valid-looking (and maybe valid). */
export const looksValid = (j: Judgement): boolean => j.kind === 'valid' || j.kind === 'looking';

/** Whether `j` may be cached by move id: it cannot change while the move's line stays as it is. */
const settled = (j: Judgement): boolean =>
  j.kind === 'invalid' || j.kind === 'valid' || (j.kind === 'looking' && j.final);

/** Walk the held events of `store` from the root. `cache` keeps the judgements that never change, by move id. */
export function walk(ctx: GameCtx, store: EventStoreV2, cache: Map<Hex, Judgement>): Walk {
  const cacheable = ctx.deckId === null;
  const chain: HeldMove[] = [];
  const log: LoggedAction[] = [];
  const events: unknown[] = [];
  const judged = new Map<Hex, Judgement>();
  let point: LinePoint = rootPoint(ctx);
  const points: LinePoint[] = [point];
  let fork: Fork | null = null;
  for (;;) {
    const looking: { h: HeldMove; j: Judgement }[] = [];
    for (const h of store.kidsOf(point.id)) {
      let j = cacheable ? cache.get(h.m.id) : undefined;
      if (j === undefined) {
        j = judge(ctx, point, h);
        if (cacheable && settled(j)) cache.set(h.m.id, j);
      }
      judged.set(h.m.id, j);
      if (looksValid(j)) looking.push({ h, j });
    }
    if (looking.length >= 2) {
      // Every valid-looking successor is signed by the seat pending at P (or the step's seat): E (§5.2).
      const first = looking[0] as { h: HeldMove };
      fork = { at: point.id, seq: point.seq, seat: first.h.seat, successors: looking.map((x) => x.h.m.id) };
      break;
    }
    const only = looking[0];
    if (only === undefined || only.j.kind !== 'valid') break;
    point = link(ctx, only.h, only.j, log, events);
    chain.push(only.h);
    points.push(point);
  }
  return { chain, line: { points, log, events }, fork, judged };
}
