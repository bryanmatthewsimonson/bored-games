import type { Hex } from '@bored-games/protocol';
import type { LineFold } from './line.ts';
import type { EventStoreV2 } from './store.ts';
import type { HeldMove, Judgement, LinePoint } from './types.ts';
import type { Walk } from './walk.ts';

/*
 * Side lines (PROTOCOL-v2 §5.1 "Lines"; build plan D-E): the line of a held move h is h and its ancestors through
 * `prev`, down to the root, and it is **valid** when every move on it is valid at its prev, judged on the state
 * folded along that line (owed shares included; a shuffle step's proof verifies). The walk folds one line; the stop
 * (T10: the H1 cancel test and the M1 equivocators, §5.2, §5.6) and the cutoff (T11: the validity of a result, §5.3,
 * and a Resign's scoring position, §8.3) also need lines off it.
 *
 * A side line is folded from its nearest ancestor already folded (review of T10, L3): the walk's own fold seeds the
 * root and every move on the chain, and each line folded since adds its moves. A fold is a function of its line and
 * the held events, so a prefix copy of a folded line (`LineFold.prefix`) is the fold a fresh `LineFold` reaches over
 * the same moves (V2-20); every proof is cached per event besides. A move judged invalid marks every line through it.
 *
 * Lifetime: a line's validity can change only when a Move (a missing ancestor arrives) or a Shares event (a share or
 * a contribution a move owed, a final deck's pool) is held, so the session keeps one `SideLines` across every other
 * intake (secrets, attestations, claims, Resigns, Device notes) and makes a new one, with the new walk, on those two.
 *
 * Cost (§11 item 10): a junk move costs one judgement at its prev (read from the walk's judgements when the prev is
 * on the chain) plus, once per prev, a prefix copy of the fold there; a valid side line costs one judgement per move
 * not folded before. Callers fold only the lines a rule needs: the M1 scan only at a prev holding two moves of one
 * signer and seq, the H1 test only for game actions at or past the fork, the cutoff only for results attested by
 * every seat but E.
 */

/** Where a move (or the root) on a folded valid line sits: the fold that linked it, and its seq there. */
interface Placed {
  readonly fold: LineFold;
  readonly seq: number;
}

export class SideLines {
  private readonly store: EventStoreV2;
  private readonly walk: Walk;
  /** Ids (the root included) whose line is known to be valid, with a fold that holds the point there. */
  private readonly valid = new Map<Hex, Placed>();
  /** Ids whose line is known not to be valid (not held to the root, or a move on it not valid at its prev). */
  private readonly invalid = new Set<Hex>();
  /** Folds whose head is the id: returned by `fold`, used to judge the moves on that id. Never linked further. */
  private readonly tips = new Map<Hex, LineFold>();
  /** The ids on the chain (the root included), whose successors' judgements the walk holds. */
  private readonly onChain = new Set<Hex>();

  constructor(store: EventStoreV2, walk: Walk) {
    this.store = store;
    this.walk = walk;
    const base = walk.fold;
    for (const [seq, p] of base.points.entries()) {
      this.valid.set(p.id, { fold: base, seq });
      this.onChain.add(p.id);
    }
    this.tips.set(base.point.id, base);
  }

  /** Whether the line of `id` (the root, or a held move) is held to the root and valid. */
  isValid(id: Hex): boolean {
    if (this.valid.has(id)) return true;
    if (this.invalid.has(id)) return false;
    return this.fold(id) !== null;
  }

  /** The point at `id` on its line, when that line is held and valid; null otherwise. */
  point(id: Hex): LinePoint | null {
    return this.fold(id)?.point ?? null;
  }

  /**
   * The fold of `id`'s line, its head at `id`, when that line is held and valid; null otherwise. The returned fold
   * is shared: use it to judge the held moves on `id` (`LineFold.judge`), never to link more (`extend` gives a copy
   * that may be linked).
   */
  fold(id: Hex): LineFold | null {
    const tip = this.tips.get(id);
    if (tip !== undefined) return tip;
    if (this.invalid.has(id)) return null;
    const placed = this.valid.get(id);
    if (placed !== undefined) return this.tipAt(id, placed);
    const ids = this.store.lineIds(id);
    if (ids === null) return this.fail(id);
    // The nearest ancestor on a folded valid line (the root always is).
    let j = ids.length - 1;
    while (j >= 0 && !this.valid.has(ids[j] as Hex)) j--;
    const from = j < 0 ? this.walk.fold.points[0]?.id : ids[j];
    const rest = ids.slice(j + 1);
    if (from === undefined || rest.some((x) => this.invalid.has(x))) return this.fail(id);
    // The first move off the folded lines, judged at its prev: from the walk's judgements when the prev is on the
    // chain, else on the fold there. A junk move stops here, with no copy made.
    const first = this.store.moves.get(rest[0] as Hex) as HeldMove;
    let at = this.tipAt(from, this.valid.get(from) as Placed);
    let j0 = this.onChain.has(from) ? this.walk.judged.get(first.m.id) : undefined;
    if (j0 === undefined) j0 = at.judge(first);
    if (j0.kind === 'unproven') j0 = at.prove(first);
    if (j0.kind !== 'valid') {
      this.invalid.add(first.m.id);
      return this.fail(id);
    }
    // Valid at its prev: link it and the rest on a copy of the fold at the prev.
    at = at.prefix(at.point.seq);
    at.link(first, j0);
    this.valid.set(first.m.id, { fold: at, seq: at.point.seq });
    for (const x of rest.slice(1)) {
      const h = this.store.moves.get(x) as HeldMove;
      let jx: Judgement = at.judge(h);
      if (jx.kind === 'unproven') jx = at.prove(h);
      if (jx.kind !== 'valid') {
        // The fold stays at the last valid move: a tip there.
        this.tips.set(at.point.id, at);
        this.invalid.add(x);
        return this.fail(id);
      }
      at.link(h, jx);
      this.valid.set(x, { fold: at, seq: at.point.seq });
    }
    this.tips.set(id, at);
    return at;
  }

  /**
   * A fresh fold of `id`'s line, its head at `id`, that the caller may link further (a Resign's scoring position
   * follows the line forward, §8.3); null when the line is not held or not valid.
   */
  extend(id: Hex): LineFold | null {
    const f = this.fold(id);
    return f === null ? null : f.prefix(f.point.seq);
  }

  /** The fold whose head is `id`, a valid id at `placed`: its own fold when that ends there, else a prefix copy. */
  private tipAt(id: Hex, placed: Placed): LineFold {
    const known = this.tips.get(id);
    if (known !== undefined) return known;
    const tip = placed.fold.point.id === id ? placed.fold : placed.fold.prefix(placed.seq);
    this.tips.set(id, tip);
    return tip;
  }

  private fail(id: Hex): null {
    this.invalid.add(id);
    return null;
  }
}
