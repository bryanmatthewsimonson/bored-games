import type { Hex } from '@bored-games/protocol';
import { LineFold } from './line.ts';
import type { DeckCaches } from './shares.ts';
import type { EventStoreV2 } from './store.ts';
import type { GameCtx } from './types.ts';

/*
 * Side lines (PROTOCOL-v2 §5.1 "Lines"; build plan D-E): the line of a held move h is h and its ancestors through
 * `prev`, down to the root, and it is **valid** when every move on it is valid at its prev, judged on the state
 * folded along that line (owed shares included; a shuffle step's proof verifies). The walk folds one line; the stop
 * (T10: the H1 cancel test and the M1 equivocators, §5.2, §5.6) and the cutoff (T11) also need lines off it.
 *
 * Each side line is folded from the root with a fresh `LineFold` over the same held events and crypto caches, so it
 * reaches exactly the points any client holding those events reaches (V2-20). The verdicts are memoised for one set
 * of held events: a `SideLines` is made after each change and dropped with it. A fold that fails marks the first
 * move that is not valid, and with it every line through that move; a fold that succeeds marks every prefix valid.
 *
 * Cost (§11 item 10): a fold is linear in the line's length, with every proof cached per event, and it stops at the
 * first move that is not valid. Callers fold only the lines a rule needs: the M1 scan only at a prev holding two
 * moves of one signer and seq, the H1 test only for game actions at or past the fork.
 */

export class SideLines {
  private readonly ctx: GameCtx;
  private readonly store: EventStoreV2;
  private readonly caches: DeckCaches;
  /** Ids (the root included) whose line is known to be valid. */
  private readonly valid = new Set<Hex>();
  /** Ids whose line is known not to be valid (not held to the root, or a move on it not valid at its prev). */
  private readonly invalid = new Set<Hex>();

  constructor(ctx: GameCtx, store: EventStoreV2, caches: DeckCaches) {
    this.ctx = ctx;
    this.store = store;
    this.caches = caches;
    this.valid.add(ctx.rootId);
  }

  /** Whether the line of `id` (the root, or a held move) is held to the root and valid. */
  isValid(id: Hex): boolean {
    if (this.valid.has(id)) return true;
    if (this.invalid.has(id)) return false;
    return this.fold(id) !== null;
  }

  /**
   * The fold of `id`'s line, its head at `id`, when that line is held and valid; null otherwise. The returned fold
   * may be used to judge the held moves on `id` (`LineFold.judge`), never to link more.
   */
  fold(id: Hex): LineFold | null {
    const ids = this.store.lineIds(id);
    if (ids === null) {
      this.invalid.add(id);
      return null;
    }
    if (ids.some((x) => this.invalid.has(x))) {
      this.invalid.add(id);
      return null;
    }
    const fold = new LineFold(this.ctx, this.store, this.caches);
    for (const x of ids) {
      const h = this.store.moves.get(x);
      if (h === undefined) {
        this.invalid.add(id);
        return null;
      }
      let j = fold.judge(h);
      if (j.kind === 'unproven') j = fold.prove(h);
      if (j.kind !== 'valid') {
        this.invalid.add(x);
        this.invalid.add(id);
        return null;
      }
      fold.link(h, j);
      this.valid.add(x);
    }
    return fold;
  }
}
