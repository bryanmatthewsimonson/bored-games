import type { Hex } from '@bored-games/protocol';
import type { SideLines } from './sides.ts';
import type { EventStoreV2 } from './store.ts';
import type { GameCtx, HeldMove, Judgement } from './types.ts';
import { looksValid, type Walk } from './walk.ts';

/*
 * The global M1 scan (PROTOCOL-v2 §5.2 "Every equivocator is recorded", review M1, V2-50; build plan D-E layer 4).
 * A seat F is an equivocator when the client holds two distinct Moves signed by F with the same `prev` Q and the
 * same `seq`, both valid-looking at Q (both well-formed, for shuffle steps), where Q is the root or a held move whose
 * line is valid. Q need not be on the walk: such a pair is a certificate against F wherever it lies. The topmost
 * fork on the walk still fixes P and E, and E is always one.
 *
 * Only a walk that ends at a fork is scanned (as the model, `tools/protocol-model` `stop3`). With no fork held there
 * is none to find: a pair at a Q whose line is valid would put two valid-looking moves in C(R) at the point R where
 * Q's line leaves the walk (or at Q itself, on the walk), and the walk would end at a fork there.
 *
 * Cost: a structural pass over the held moves finds the prevs that hold two well-shaped moves of one signer and one
 * seq. A Q on the walk is judged from the walk's own judgements; only a Q off it needs a side-line fold (`SideLines`),
 * once per Q.
 */

/** The seats with two valid-looking moves on one prev and seq (§5.2), ascending; `walk.fork`'s seat included. */
export function equivocators(ctx: GameCtx, store: EventStoreV2, w: Walk, sides: SideLines): number[] {
  const out = new Set<number>();
  if (w.fork === null) return [];
  out.add(w.fork.seat);
  const onWalk = new Set<Hex>([ctx.rootId, ...w.chain.map((h) => h.m.id)]);
  for (const [q, pairs] of candidates(store)) {
    let judge: ((h: HeldMove) => Judgement | undefined) | null = null;
    if (onWalk.has(q)) judge = (h) => w.judged.get(h.m.id);
    else {
      const fold = sides.fold(q);
      if (fold !== null) judge = (h) => fold.judge(h);
    }
    if (judge === null) continue;
    for (const group of pairs) {
      const seat = (group[0] as HeldMove).seat;
      if (out.has(seat)) continue;
      let looking = 0;
      for (const h of group) {
        const j = judge(h);
        if (j !== undefined && looksValid(j)) looking++;
        if (looking >= 2) break;
      }
      if (looking >= 2) out.add(seat);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The prevs (the root or any id) holding two or more held moves of one signer and one seq, none of a bad shape (a
 * bad shape is never valid-looking): by prev, the groups of such moves. Ascending by prev, then by seat and seq.
 */
function candidates(store: EventStoreV2): Map<Hex, HeldMove[][]> {
  const byKey = new Map<string, HeldMove[]>();
  for (const h of store.moves.values()) {
    if (h.shape !== null) continue;
    const key = `${h.m.prevId}|${h.seat}|${h.m.seq}`;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [h]);
    else list.push(h);
  }
  const out = new Map<Hex, HeldMove[][]>();
  for (const key of [...byKey.keys()].sort()) {
    const list = byKey.get(key) as HeldMove[];
    if (list.length < 2) continue;
    const q = (list[0] as HeldMove).m.prevId;
    const groups = out.get(q);
    if (groups === undefined) out.set(q, [list]);
    else groups.push(list);
  }
  return out;
}
