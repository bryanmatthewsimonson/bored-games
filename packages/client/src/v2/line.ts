import {
  type Ciphertext,
  type Point as CurvePoint,
  ownShare,
  type Share,
  verifyShare,
  verifyShuffle,
} from '@bored-games/deck';
import { canonicalJson, deepFreeze, type Pending, type RevealAction } from '@bored-games/game-kit';
import type { Hex, ParsedMove, PosShare } from '@bored-games/protocol';
import type { LoggedAction } from '../audit.ts';
import { shuffleStepGroup, shuffleStepSeat } from '../partitioned-deck.ts';
import { appendedRolls, contributions, deriveFaces, type RollRef } from './rolls.ts';
import { type DeckCaches, decryptVerified, LineShares, poolFor, shareCtx } from './shares.ts';
import type { EventStoreV2 } from './store.ts';
import type { GameCtx, HeldMove, Judgement, LinePoint } from './types.ts';

/*
 * One line's fold (build plan D-E layer 2): from the root, each move judged at its prev's point (PROTOCOL-v2 §5.1:
 * valid-looking, valid) and, when it links, the point after it. A function of the game's context, the held events
 * and the moves linked: every client that folds the same line over the same held events reaches the same points.
 *
 * With a deck (T8): shuffle steps (partitioned by `shuffleStepSeat` and `shuffleStepGroup`, v1 §5.5) build the
 * deck; after the last one the module is set up in view mode and the deal starts. The deal completes once every
 * seat's verified share of every position dealt to another seat or to nobody is held (v1 §6.1). From then on the
 * fold applies derived reveals (v1 §6.3) and the viewer's learns (v1 §6.4) at each point, as far as the held shares
 * allow: the shares of the final deck's pool (every held card Shares event that verifies against it, whatever its
 * anchor) and those carried by the game actions linked so far on this line.
 *
 * With dice (T9, PROTOCOL-v2 §6.2): each linked game action that makes `rolls(state)` grow requests the new rolls
 * (M, 0) … (M, r−1). While the module pends `{type:'beacon', id}` for a requested roll whose every seat's verified
 * contribution is held (the roll store, `rolls.ts`), the fold applies `{type:'rolled', actor:'beacon', id, dice}`
 * with the derived faces and logs it at the point's seq, beside the derived reveals, as often as it can.
 */

/** True when a seat's action claims to be the derived dice: players never send those (PROTOCOL-v2 §6.2, D058). */
export function playerSentDice(action: unknown): boolean {
  return action !== null && typeof action === 'object' && (action as { type?: unknown }).type === 'rolled';
}

/**
 * Why held move `m` by `seat` can never be valid, whatever its prev's state, or null (the checks of v1's
 * `moveShape`): a shuffle step where a game action belongs or the reverse, a shuffle step by the wrong seat (one
 * that passes is **well-formed**, §5.1), and any share or reveal in a deckless game (a dice game included,
 * PROTOCOL-v2 §3 on §4.4).
 */
export function moveShape(ctx: GameCtx, m: ParsedMove, seat: number): string | null {
  const c = m.content;
  if (m.seq <= ctx.shuffleSteps) {
    if (c.type !== 'shuffle') return `move ${m.seq} must be a shuffle step`;
    const expected = shuffleStepSeat(m.seq - 1, ctx.partitions);
    if (expected === null) return `move ${m.seq} cannot be a shuffle step: the game has no deck`;
    if (seat !== expected) return `shuffle step ${m.seq} must be signed by seat ${expected}`;
    const group = shuffleStepGroup(m.seq - 1, ctx.partitions);
    // v1 §5.5: the step's deck holds exactly its group's size (a parse with another group's size is not its step).
    if (group === null || c.deck.length !== group.size) return 'shuffle output has the wrong group size';
    return null;
  }
  if (c.type !== 'action') return `move ${m.seq} must be a game action`;
  if (ctx.deckId === null && (c.shares.length > 0 || c.reveals.length > 0))
    return 'a deckless game carries no shares or reveals';
  return null;
}

/** The module's pending decision at `p`, or null before the module is set up. */
export function pendingAt(ctx: GameCtx, p: LinePoint): Pending | null {
  return p.state === null ? null : ctx.module.pending(p.state);
}

/** The seat that signs the shuffle step after point `p` (seq `p.seq + 1`), or null once the shuffle is done. */
export function nextShuffler(ctx: GameCtx, p: LinePoint): number | null {
  return p.seq < ctx.shuffleSteps ? shuffleStepSeat(p.seq, ctx.partitions) : null;
}

/** Whether every seat holds a verified share of every position `dealt` assigns to another seat or nobody. */
function dealComplete(ctx: GameCtx, shares: LineShares, state: unknown): boolean {
  const dealt = ctx.module.dealt(state);
  for (let k = 0; k < ctx.seats; k++) if (shares.missing(k, dealt).length > 0) return false;
  return true;
}

/**
 * One line folded from the root, a move at a time. `point` is the current head; `judge` judges a held move whose
 * prev is the head, and `link` appends a valid one. The caller owns the order: the walk links the one valid
 * successor at each head, a side-line fold (T11) the moves of a given line.
 */
export class LineFold {
  readonly ctx: GameCtx;
  private readonly store: EventStoreV2;
  private readonly caches: DeckCaches;
  /** One point per head, `points[i]` at seq `i`; the last is the current head. */
  readonly points: LinePoint[];
  /** The interleaved action log (v1 §7): game actions and derived reveals, in fold order. */
  readonly log: LoggedAction[];
  /** The module events of every `apply` and `learn`, in fold order. */
  readonly events: unknown[];
  /** The linked moves, in seq order. */
  readonly chain: HeldMove[];
  /** The line's card shares at the head, from the final deck on; null before it and in a deckless game. */
  shares: LineShares | null = null;
  /** The rolls the linked game actions requested, by the module's roll id (V2-31). */
  readonly rolls = new Map<number, RollRef>();
  /** How many rolls each linked requesting move requested, by move id (only game actions that requested some). */
  readonly requests = new Map<Hex, number>();
  /** Every roll requested on the line, in link order (`prefix` rebuilds `rolls` and `requests` from it). */
  private readonly rollLog: RollRef[];

  /**
   * A fold at the root, or, with `from`, a copy of `from.fold` cut back to its point at seq `from.seq` (`prefix`):
   * the same points, log, events and chain up to that point, its card shares rebuilt from the final deck's pool and
   * the linked game actions' shares, and its rolls from the moves linked so far. A fold depends only on its line and
   * the held events, so the copy is the fold a fresh `LineFold` reaches by linking those moves again (review of T10,
   * L3: side lines start from the nearest folded ancestor).
   */
  constructor(
    ctx: GameCtx,
    store: EventStoreV2,
    caches: DeckCaches,
    from: { readonly fold: LineFold; readonly seq: number } | null = null,
  ) {
    this.ctx = ctx;
    this.store = store;
    this.caches = caches;
    if (from !== null) {
      const src = from.fold;
      const p = src.points[from.seq];
      if (p === undefined) throw new Error(`LineFold: no point at seq ${from.seq}`);
      this.points = src.points.slice(0, from.seq + 1);
      this.chain = src.chain.slice(0, from.seq);
      this.log = src.log.slice(0, p.logLength);
      this.events = src.events.slice(0, p.eventsLength);
      const linked = new Set(this.chain.map((h) => h.m.id));
      this.rollLog = [];
      for (const ref of src.rollLog) {
        if (!linked.has(ref.move)) break;
        this.rollLog.push(ref);
        this.rolls.set(ref.id, ref);
        this.requests.set(ref.move, (this.requests.get(ref.move) ?? 0) + 1);
      }
      if (p.deckKey !== null) {
        this.shares = new LineShares(ctx.seats, poolFor(ctx, store, caches, p.deckKey, p.deck).shares);
        for (const h of this.chain) {
          const c = h.m.content;
          if (c.type === 'action')
            for (const { pos, share } of [...c.shares, ...c.reveals]) this.shares.add(h.seat, pos, share);
        }
      }
      return;
    }
    this.points = [];
    this.log = [];
    this.events = [];
    this.chain = [];
    this.rollLog = [];
    if (ctx.deckId === null) {
      // A deckless game starts in play, its view-mode state set up at once.
      const state = this.setUp();
      this.points.push(this.settle({ ...this.blank(), phase: 'play', state }));
    } else {
      this.points.push({ ...this.blank(), phase: 'shuffle', state: null, deck: ctx.initialDeck });
    }
  }

  private blank(): LinePoint {
    return {
      id: this.ctx.rootId,
      seq: 0,
      phase: 'shuffle',
      state: null,
      logLength: 0,
      eventsLength: 0,
      deck: [],
      deckKey: null,
      learned: [],
    };
  }

  /** A copy of this fold cut back to its point at seq `seq` (see the constructor); this fold is unchanged. */
  prefix(seq: number): LineFold {
    return new LineFold(this.ctx, this.store, this.caches, { fold: this, seq });
  }

  /** The current head. */
  get point(): LinePoint {
    return this.points[this.points.length - 1] as LinePoint;
  }

  /** The module's view-mode state at the start of play (after the shuffle, or at once without a deck). */
  private setUp(): unknown {
    const { ctx } = this;
    const r = ctx.module.setup({ rules: ctx.rules, seats: ctx.seats, mode: 'view', viewer: ctx.viewer });
    // validateRoot accepted these rules and this seat count, so setup cannot fail for a sound module.
    if (!r.ok) throw new Error(`module setup failed: ${r.error.message}`);
    return deepFreeze(r.value);
  }

  /**
   * Judge held move `h` at the head (PROTOCOL-v2 §5.1). A shuffle step that is well-formed is `unproven` (its proof
   * is checked by `prove`, only when needed). A game action is valid-looking when it is not a player-sent roll, a
   * player decision is pending and its signer is that seat, every share and reveal proof verifies, the module
   * accepts the action, and its reveals are exactly the positions `revealsOf` names, each decrypting to the claimed
   * card. It is valid when its seat's owed shares as of the head (v1 §6.2) are all held, in the move or elsewhere.
   * It waits (not valid-looking yet) during the deal, while a public reveal or a beacon is pending (invalid at that
   * point, judged again once the reveal or the rolls are derived: PROTOCOL-v2 §6.2, V2-33), and while another seat's
   * share of a revealed position is missing. A module that throws judges the move invalid.
   */
  judge(h: HeldMove): Judgement {
    const { ctx } = this;
    const p = this.point;
    const { m, seat } = h;
    if (m.seq !== p.seq + 1) return { kind: 'invalid', why: `seq ${m.seq} does not follow its prev` };
    if (h.shape !== null) return { kind: 'invalid', why: h.shape };
    const c = m.content;
    if (c.type === 'shuffle') return { kind: 'unproven' };
    if (p.phase === 'deal') return { kind: 'wait', why: 'the deal is not complete' };
    if (p.state === null) return { kind: 'invalid', why: 'the game is not in play' };
    try {
      // Faces are derived from the contributions; a seat that sends them is inventing the roll (PROTOCOL-v2 §6.2).
      if (playerSentDice(c.action)) return { kind: 'invalid', why: 'a player does not send the dice' };
      const pending = ctx.module.pending(p.state);
      if (pending.type === 'reveal') return { kind: 'wait', why: 'a public reveal is pending' };
      // Invalid at this point while the beacon waits, not for good: judged again once the rolls are derived here
      // (PROTOCOL-v2 §6.2, V2-33). So it waits, like a move behind a pending public reveal.
      if (pending.type === 'beacon')
        return { kind: 'wait', why: 'a beacon is pending: judged again once its rolls are derived' };
      if (pending.type !== 'player') return { kind: 'invalid', why: 'no player decision is pending' };
      if (seat !== pending.seat)
        return { kind: 'invalid', why: `move ${m.seq} must be signed by seat ${pending.seat}` };
      const proofs = this.moveProofs(m.id, seat, c.shares, c.reveals);
      if (proofs !== null) return { kind: 'invalid', why: proofs };
      const r = ctx.module.apply(p.state, c.action);
      if (!r.ok)
        return { kind: 'invalid', why: `the module rejects the action: ${r.error.code}: ${r.error.message}` };
      const claims = ctx.module.revealsOf(p.state, c.action);
      const claimed = claims.map((l) => l.pos).sort((a, b) => a - b);
      const shown = c.reveals.map((x) => x.pos);
      if (claims.some((l) => l.deck !== ctx.deckId) || canonicalJson(claimed) !== canonicalJson(shown))
        return { kind: 'invalid', why: 'the reveals do not match the positions the action shows' };
      if (claims.length > 0) {
        const shares = this.shares as LineShares;
        let missing = false;
        for (const claim of claims) {
          if (!shares.covered(claim.pos, seat)) {
            missing = true;
            continue;
          }
          const reveal = (c.reveals.find((x) => x.pos === claim.pos) as PosShare).share;
          const bad = this.revealProblem(m.id, seat, claim.pos, claim.card, reveal);
          if (bad !== null) return { kind: 'invalid', why: bad };
        }
        if (missing) return { kind: 'wait', why: "another seat's share of a revealed position is missing" };
      }
      if (this.shares !== null) {
        const brought = new Set(c.shares.map((x) => x.pos));
        const owed = this.shares.missing(seat, ctx.module.dealt(p.state)).filter((pos) => !brought.has(pos));
        if (owed.length > 0)
          return {
            kind: 'looking',
            why: `the shares of positions ${owed.join(', ')} are owed`,
            final: false,
          };
      }
      return { kind: 'valid', state: r.state, events: r.events };
    } catch (e) {
      return { kind: 'invalid', why: `the module threw: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * Check the proof of a well-formed shuffle step judged `unproven` at the head: `valid` when it verifies, otherwise
   * valid-looking for good (`looking`, final), since a well-formed step stays part of C(h) (§5.1). Cached per step.
   */
  prove(h: HeldMove): Judgement {
    const { ctx } = this;
    const c = h.m.content;
    if (c.type !== 'shuffle') return { kind: 'invalid', why: 'not a shuffle step' };
    let ok = this.caches.shuffleOk.get(h.m.id);
    if (ok === undefined) {
      const step = h.m.seq - 1;
      const group = shuffleStepGroup(step, ctx.partitions);
      const input = group === null ? [] : this.point.deck.slice(group.offset, group.offset + group.size);
      try {
        ok =
          group !== null &&
          verifyShuffle(input, c.deck, ctx.X, c.proof, {
            rootId: ctx.rootId,
            seat: h.seat,
            deckId: group.id,
          });
      } catch {
        ok = false;
      }
      this.caches.shuffleOk.set(h.m.id, ok);
    }
    return ok
      ? { kind: 'valid', state: null, events: [] }
      : { kind: 'looking', why: 'the shuffle proof does not verify', final: true };
  }

  /** A game action's shares and reveals against the line's final deck and its signer's key; null when all verify. */
  private moveProofs(
    id: Hex,
    seat: number,
    shares: readonly PosShare[],
    reveals: readonly PosShare[],
  ): string | null {
    if (shares.length === 0 && reveals.length === 0) return null;
    const known = this.caches.moveProofs.get(id);
    if (known !== undefined) return known;
    const { ctx } = this;
    const deck = this.point.deck;
    const check = (list: readonly PosShare[], what: string): string | null => {
      for (const { pos, share } of list) {
        if (pos >= ctx.deckSize) return `the ${what} for position ${pos} is outside the deck`;
        if (!verifyShare(ctx.keys[seat] as CurvePoint, deck[pos] as Ciphertext, share, shareCtx(ctx, pos)))
          return `the ${what} for position ${pos} does not verify`;
      }
      return null;
    };
    const out = check(shares, 'share') ?? check(reveals, 'reveal');
    this.caches.moveProofs.set(id, out);
    return out;
  }

  /** Whether `seat`'s reveal of `pos`, with the other seats' shares, decrypts to `card`; null when it does. */
  private revealProblem(
    id: Hex,
    seat: number,
    pos: number,
    card: number,
    reveal: PosShare['share'],
  ): string | null {
    const key = `${id}|${pos}`;
    const known = this.caches.moveReveals.get(key);
    if (known !== undefined) return known;
    const { ctx } = this;
    const slots = (this.shares as LineShares).slots(pos, seat);
    slots[seat] = reveal;
    const got = decryptVerified(this.point.deck[pos] as Ciphertext, slots, ctx.cards);
    const out = got === card ? null : `the reveal of position ${pos} is not the claimed card`;
    this.caches.moveReveals.set(key, out);
    return out;
  }

  /** Link valid move `h` at the head, given its judgement: the point after it, settled. */
  link(h: HeldMove, j: Extract<Judgement, { kind: 'valid' }>): void {
    const { ctx } = this;
    const p = this.point;
    const c = h.m.content;
    this.chain.push(h);
    if (c.type === 'shuffle') {
      const group = shuffleStepGroup(h.m.seq - 1, ctx.partitions);
      const deck =
        group === null
          ? p.deck
          : [...p.deck.slice(0, group.offset), ...c.deck, ...p.deck.slice(group.offset + group.size)];
      if (h.m.seq < ctx.shuffleSteps) {
        this.points.push({ ...p, id: h.m.id, seq: h.m.seq, deck });
        return;
      }
      // The last shuffle step: the final deck is complete, the module is set up and the deal starts.
      this.shares = new LineShares(ctx.seats, poolFor(ctx, this.store, this.caches, h.m.id, deck).shares);
      const state = this.setUp();
      this.points.push(
        this.settle({ ...p, id: h.m.id, seq: h.m.seq, deck, deckKey: h.m.id, phase: 'deal', state }),
      );
      return;
    }
    if (this.shares !== null)
      for (const { pos, share } of [...c.shares, ...c.reveals]) this.shares.add(h.seat, pos, share);
    const requested = appendedRolls(ctx, p.state, j.state, h.m.id);
    if (requested.length > 0) this.requests.set(h.m.id, requested.length);
    for (const ref of requested) {
      this.rolls.set(ref.id, ref);
      this.rollLog.push(ref);
    }
    this.log.push({ actor: h.seat, action: c.action, seq: h.m.seq });
    for (const e of j.events) this.events.push(deepFreeze(e));
    const state = deepFreeze(j.state);
    this.points.push(
      this.settle({
        ...p,
        id: h.m.id,
        seq: h.m.seq,
        state,
        logLength: this.log.length,
        eventsLength: this.events.length,
      }),
    );
  }

  /**
   * Take every step the held shares and contributions allow at point `p` (as v1's `advance`): the deal completes,
   * derived reveals apply in ascending position order while the module pends a covered public reveal, and derived
   * rolls while it pends a beacon whose contributions are all held (both logged at `p.seq`), the phase becomes `end`
   * once the module is over, and the viewer learns each card dealt to it whose other shares are all held (from the
   * play phase on, after the setup reveals).
   */
  private settle(p: LinePoint): LinePoint {
    const { ctx } = this;
    const shares = this.shares;
    let { phase, state } = p;
    if (state === null) return p;
    if (phase === 'deal' && shares !== null && dealComplete(ctx, shares, state)) phase = 'play';
    if (phase === 'play') state = this.derive(state, p);
    if (phase === 'play' && ctx.module.pending(state).type === 'over') phase = 'end';
    let learned = p.learned;
    if ((phase === 'play' || phase === 'end') && shares !== null && ctx.viewer !== null) {
      const r = this.learnPrivate(state, p, learned);
      state = r.state;
      learned = r.learned;
    }
    return { ...p, phase, state, learned, logLength: this.log.length, eventsLength: this.events.length };
  }

  /** Derived reveals and derived rolls at point `p`, in the order the module pends them, until neither applies. */
  private derive(start: unknown, p: LinePoint): unknown {
    let state = start;
    for (;;) {
      const before = state;
      if (this.shares !== null) state = this.revealPublic(state, p);
      state = this.deriveRolls(state, p);
      if (state === before) return state;
    }
  }

  /** Seat contributions to the rolls of requesting move `move` linked on this line: `[n][seat]` (the roll store). */
  contributionsOf(move: Hex): (Share | null)[][] {
    return contributions(this.ctx, this.store, this.caches.rolls, move, this.requests.get(move) ?? 0);
  }

  /**
   * Derived rolls (PROTOCOL-v2 §6.2) at point `p`, logged with `p.seq`: while the module pends `{type:'beacon', id}`
   * for a roll (M, n) a game action on this line requested, and every seat's verified contribution to it is held,
   * apply `{type:'rolled', actor:'beacon', id, dice}` with `faces(rollSeed(…), count, sides)` (V2-35).
   */
  private deriveRolls(start: unknown, p: LinePoint): unknown {
    const { ctx } = this;
    if (typeof ctx.module.rolls !== 'function') return start;
    let state = start;
    for (;;) {
      const pending = ctx.module.pending(state);
      if (pending.type !== 'beacon') return state;
      const ref = this.rolls.get(pending.id);
      if (ref === undefined) return state;
      const dice = deriveFaces(ref, this.contributionsOf(ref.move)[ref.n] ?? []);
      if (dice === null) return state;
      const action = { type: 'rolled' as const, actor: 'beacon' as const, id: pending.id, dice };
      const r = ctx.module.apply(state, action);
      // The module pended this roll, and its faces are in range: a sound module accepts them; stop otherwise.
      if (!r.ok) return state;
      state = deepFreeze(r.state);
      for (const e of r.events) this.events.push(deepFreeze(e));
      this.log.push({ actor: 'beacon', action, seq: p.seq });
    }
  }

  /** Derived reveals (v1 §6.3) at point `p`, logged with `p.seq`. */
  private revealPublic(start: unknown, p: LinePoint): unknown {
    const { ctx } = this;
    const shares = this.shares as LineShares;
    let state = start;
    for (;;) {
      const pending = ctx.module.pending(state);
      if (pending.type !== 'reveal' || pending.deck !== ctx.deckId || pending.positions.length === 0)
        return state;
      const positions = [...pending.positions].sort((a, b) => a - b);
      if (!positions.every((pos) => shares.covered(pos))) return state;
      for (const pos of positions) {
        const card = this.publicCard(p, pos);
        // With verified shuffles and shares every position decrypts to a card the module accepts; stop otherwise.
        if (card === null) return state;
        const action: RevealAction = { type: 'reveal', actor: 'deck', deck: ctx.deckId as string, pos, card };
        const r = ctx.module.apply(state, action);
        if (!r.ok) return state;
        state = deepFreeze(r.state);
        for (const e of r.events) this.events.push(deepFreeze(e));
        this.log.push({ actor: 'deck', action, seq: p.seq });
      }
    }
  }

  /** The card at public position `pos` of `p`'s final deck, from every seat's held share; cached per deck. */
  private publicCard(p: LinePoint, pos: number): number | null {
    const key = `${p.deckKey}|${pos}`;
    const known = this.caches.cards.get(key);
    if (known !== undefined) return known;
    const { ctx } = this;
    const slots = (this.shares as LineShares).slots(pos);
    const card = decryptVerified(p.deck[pos] as Ciphertext, slots, ctx.cards);
    this.caches.cards.set(key, card);
    return card;
  }

  /** The viewer's learns (v1 §6.4) at point `p`: each position dealt to it whose other seats' shares are held. */
  private learnPrivate(
    start: unknown,
    p: LinePoint,
    known: readonly number[],
  ): { state: unknown; learned: readonly number[] } {
    const { ctx } = this;
    const shares = this.shares as LineShares;
    const me = ctx.viewer as number;
    let state = start;
    let learned = known;
    for (const d of ctx.module.dealt(state)) {
      if (d.to !== me || d.deck !== ctx.deckId || learned.includes(d.pos)) continue;
      if (!shares.covered(d.pos, me)) continue;
      learned = [...learned, d.pos].sort((a, b) => a - b);
      const card = this.ownCard(p, d.pos);
      if (card === null) continue;
      const r = ctx.module.learn(state, { deck: ctx.deckId as string, pos: d.pos, card });
      if (!r.ok) continue;
      state = deepFreeze(r.state);
      for (const e of r.events) this.events.push(deepFreeze(e));
    }
    return { state, learned };
  }

  /** The card at position `pos` dealt to the viewer, with its own layer; cached per deck. */
  private ownCard(p: LinePoint, pos: number): number | null {
    const key = `${p.deckKey}|${pos}`;
    const known = this.caches.learns.get(key);
    if (known !== undefined) return known;
    const { ctx } = this;
    const me = ctx.viewer as number;
    const ct = p.deck[pos] as Ciphertext;
    const own = { seat: me, D: ownShare(ctx.viewerSecret as bigint, ct) };
    const slots = (this.shares as LineShares).slots(pos, me);
    const card = decryptVerified(ct, slots, ctx.cards, own);
    this.caches.learns.set(key, card);
    return card;
  }
}
