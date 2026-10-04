import type { Hex } from '@bored-games/protocol';
import type { ResultId } from '../types.ts';
import { attestedResults, resultValid, type Scoring } from './results.ts';
import type { SideLines } from './sides.ts';
import type { EventStoreV2 } from './store.ts';
import type { Fork, GameCtx } from './types.ts';

/*
 * The cutoff (PROTOCOL-v2 §5.4; build plan D-E layer 6): when the walk ends at a fork at P signed by E, a result X
 * **stands** against it when
 * - (a) every seat other than E has signed at least one valid end attestation of X's identity, with either key,
 *   counting every end attestation ever held (a later one never withdraws an earlier one);
 * - (b) no seat other than E has signed, off X's line, a held Move (neither on X's path nor with its `prev` at or past
 *   X's head), a held Shares event of either variant (its anchor neither on X's path nor at or past X's head; an
 *   unresolved anchor is off the line) or a held end attestation (its head likewise). The test is global, over the
 *   held set (D066, V2-56), valid or not; events at or past X's head never block (they concern values granted after
 *   X's end); Timeout claims, Resigns, Secret reveals, stats attestations and Device notes are not read;
 * - (c) no other valid result meets (a) and (b).
 * Only valid results are candidates (§5.3, `resultValid`), and only those some seat validly attested (a result no
 * seat attested cannot meet (a)). A valid result's head lies on the walk up to P or past one of the fork's
 * successors: a valid line that left the walk below P would be a fork there (`tools/protocol-model` `standingAt`
 * checks it the same way).
 *
 * Cost (§11 item 10, build plan risk 10): rule (a) is checked first, so only results every seat but E attested are
 * judged further; each is judged valid from its line's fold (`SideLines`, folded once per line and set of held Moves
 * and Shares events), and rule (b) is one pass over the held events.
 */

/**
 * The one result that stands against `fork` (signed by E), or null when none or several do (then the game stops at
 * P, §5.6). `scoring` gives a Resign's scoring position (memoised by the caller).
 */
export function standingResult(
  ctx: GameCtx,
  store: EventStoreV2,
  sides: SideLines,
  fork: Fork,
  scoring: (head: Hex, k: number) => Scoring | null,
): ResultId | null {
  const E = fork.seat;
  let one: ResultId | null = null;
  let count = 0;
  for (const { result, seats } of attestedResults(store, ctx.seats).values()) {
    // (a) Every seat other than E attested it, the forfeiting seats included.
    let all = true;
    for (let x = 0; x < ctx.seats; x++) if (x !== E && !seats.has(x)) all = false;
    if (!all) continue;
    // A candidate's head is on the walk up to P, or at or past one of the fork's successors.
    if (!store.atOrPast(fork.at, result.head) && !fork.successors.some((s) => store.atOrPast(result.head, s)))
      continue;
    if (!resultValid(ctx, store, sides, result, scoring)) continue;
    // (b) Nothing off its line by a seat other than E.
    if (offLine(ctx, store, E, result.head)) continue;
    one = result;
    count++;
  }
  // (c) Alone.
  return count === 1 ? one : null;
}

/**
 * Whether a seat other than E signed a held Move, Shares event or end attestation off the line of `head` (rule (b)):
 * a Move neither on the path (the root, the head and its line) nor with its `prev` at or past the head; a Shares
 * event whose anchor, or an end attestation whose head, is neither on the path nor at or past the head. An id the
 * client does not hold is neither (§5.1), so an unresolved anchor or head is off the line.
 */
export function offLine(ctx: GameCtx, store: EventStoreV2, E: number, head: Hex): boolean {
  const path = new Set<Hex>([ctx.rootId, ...(store.lineIds(head) ?? [])]);
  const past = pastOf(store, head);
  const on = (id: Hex): boolean => path.has(id) || past(id);
  for (const h of store.moves.values())
    if (h.seat !== E && !path.has(h.m.id) && !past(h.m.prevId)) return true;
  for (const x of store.cardShares.values()) if (x.seat !== E && !on(x.ev.anchorId)) return true;
  for (const x of store.rollShares.values()) if (x.seat !== E && !on(x.ev.anchorId)) return true;
  for (const x of store.ends.values()) if (x.seat !== E && !on(x.ev.headId)) return true;
  return false;
}

/**
 * Whether an id is at or past `head` (PROTOCOL-v2 §5.1): it is `head`, or the `prev` links of held moves lead from it
 * down to `head`. Memoised along each walk down, so a pass over every held event costs one step per held move.
 */
function pastOf(store: EventStoreV2, head: Hex): (id: Hex) => boolean {
  const memo = new Map<Hex, boolean>([[head, true]]);
  return (id: Hex): boolean => {
    const seen: Hex[] = [];
    let at = id;
    let out = false;
    // Each step goes to a held move's prev; the bound only guards against a cycle no signed event can make.
    for (let i = 0; i <= store.moves.size; i++) {
      const known = memo.get(at);
      if (known !== undefined) {
        out = known;
        break;
      }
      const h = store.moves.get(at);
      if (h === undefined) break;
      seen.push(at);
      at = h.m.prevId;
    }
    for (const x of seen) memo.set(x, out);
    return out;
  };
}
