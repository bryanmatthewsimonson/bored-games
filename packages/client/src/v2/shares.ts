import {
  type Ciphertext,
  type Point as CurvePoint,
  cardOf,
  combine,
  type Share,
  type ShareCtx,
  verifyShare,
} from '@bored-games/deck';
import type { DealtPosition } from '@bored-games/game-kit';
import type { Hex, PosShare } from '@bored-games/protocol';
import { owedPositions, ShareStore } from '../shares.ts';
import type { EventStoreV2 } from './store.ts';
import type { GameCtx } from './types.ts';

/*
 * Card shares under protocol 2 (PROTOCOL-v2 §4.2, §6.1; build plan D-E layers 2 and 8). Every held card Shares event
 * is verified against a line's final deck, once per (event, final-deck key), and the events whose every share
 * verifies feed that final deck's **pool**: at most one share per (seat, position), the first valid one (v1 §5.4;
 * every valid share of a (seat, position) has the same `D`, so which one is kept never changes a decryption). The
 * pool is validity only: the held set (D066) is the event store, and an event that fails here stays held there.
 *
 * A line's shares at a point are its final deck's pool plus the shares and reveals of the game actions linked on the
 * line up to that point (`LineShares`). Every query records the positions it read (`touched`), for callers that need
 * to know which positions a fold depended on.
 */

/** The share context of position `pos` of the game's deck (v1 §5.4): the whole deck id, a packet position. */
export function shareCtx(ctx: GameCtx, pos: number): ShareCtx {
  return { rootId: ctx.rootId, deckId: ctx.deckId as string, pos };
}

/**
 * Decrypt a position from shares that were all verified already, against this position's ciphertext and their
 * seats' keys: the pool's (`poolFor`), a linked game action's (its proofs are checked before it links) and a move's
 * reveal (checked with its proofs). `slots` holds one share per seat in seat order, null only for `own`'s seat;
 * `own` is the caller's own layer of a position dealt to it. The card index, or null when a slot is missing or the
 * point is no card. (`decryptPosition` would verify every share again, for nothing.)
 */
export function decryptVerified(
  ct: Ciphertext,
  slots: readonly (Share | null)[],
  cards: ReadonlyMap<string, number>,
  own: { readonly seat: number; readonly D: CurvePoint } | null = null,
): number | null {
  const Ds: CurvePoint[] = [];
  for (const [k, slot] of slots.entries()) {
    if (own !== null && k === own.seat) Ds.push(own.D);
    else if (slot === null) return null;
    else Ds.push(slot.D);
  }
  return cardOf(cards, combine(ct, Ds));
}

/** The crypto results kept for the life of a session, each a function of its key alone (build plan D-E). */
export class DeckCaches {
  /** Shuffle proofs, by step id: a step's prev fixes its input. */
  readonly shuffleOk = new Map<Hex, boolean>();
  /** Card Shares events against a final deck, by `${event}|${deckKey}`: null when every share verifies. */
  readonly sharesOk = new Map<string, string | null>();
  /** A game action's shares and reveals against its line's final deck, by move id (its prev fixes the line). */
  readonly moveProofs = new Map<Hex, string | null>();
  /** A game action's reveal of `pos` checked against the claimed card, by `${move}|${pos}`: null when it matches. */
  readonly moveReveals = new Map<string, string | null>();
  /** Public decryptions, by `${deckKey}|${pos}`: the card, or null when the position decrypts to no card. */
  readonly cards = new Map<string, number | null>();
  /** The viewer's own learns, by `${deckKey}|${pos}`. */
  readonly learns = new Map<string, number | null>();
  /** Each final deck's pool, by deck key. */
  readonly pools = new Map<Hex, Pool>();
}

/** One final deck's pool of verified card shares, and the held events already judged against it. */
export interface Pool {
  readonly shares: ShareStore;
  readonly judged: Set<Hex>;
}

/**
 * Why card Shares event `ev`, signed by `seat`, is not valid against final deck `deck` (key `deckKey`): a position
 * outside the deck, or a share that does not verify against the seat's deck key (the whole event is rejected, as v1
 * `foldShares`). Null when every share verifies. Cached per (event, deck key).
 */
export function cardSharesProblem(
  ctx: GameCtx,
  caches: DeckCaches,
  deckKey: Hex,
  deck: readonly Ciphertext[],
  id: Hex,
  seat: number,
  shares: readonly PosShare[],
): string | null {
  const key = `${id}|${deckKey}`;
  const known = caches.sharesOk.get(key);
  if (known !== undefined) return known;
  let out: string | null = null;
  for (const { pos, share } of shares) {
    if (pos >= ctx.deckSize) {
      out = `position ${pos} is outside the deck`;
      break;
    }
    if (!verifyShare(ctx.keys[seat] as CurvePoint, deck[pos] as Ciphertext, share, shareCtx(ctx, pos))) {
      out = `the share for position ${pos} does not verify`;
      break;
    }
  }
  caches.sharesOk.set(key, out);
  return out;
}

/**
 * The pool of final deck `deck` (key `deckKey`), brought up to date with every held card Shares event: each one not
 * judged against this deck yet is verified, and kept when every share verifies. A function of the held events.
 */
export function poolFor(
  ctx: GameCtx,
  store: EventStoreV2,
  caches: DeckCaches,
  deckKey: Hex,
  deck: readonly Ciphertext[],
): Pool {
  let pool = caches.pools.get(deckKey);
  if (pool === undefined) {
    pool = { shares: new ShareStore(ctx.seats), judged: new Set() };
    caches.pools.set(deckKey, pool);
  }
  if (pool.judged.size === store.cardShares.size) return pool;
  for (const [id, { ev, seat }] of store.cardShares) {
    if (pool.judged.has(id)) continue;
    pool.judged.add(id);
    if (cardSharesProblem(ctx, caches, deckKey, deck, id, seat, ev.shares) !== null) continue;
    for (const { pos, share } of ev.shares) pool.shares.add(seat, pos, share);
  }
  return pool;
}

/**
 * A line's card shares at one point: its final deck's pool, plus the shares and reveals carried by the game actions
 * linked on the line so far (`add`). Every read records the positions it looked at in `touched`.
 */
export class LineShares {
  private readonly seats: number;
  private readonly pool: ShareStore;
  private readonly extra: ShareStore;
  /** The positions read since the caller last cleared it. */
  readonly touched = new Set<number>();

  constructor(seats: number, pool: ShareStore) {
    this.seats = seats;
    this.pool = pool;
    this.extra = new ShareStore(seats);
  }

  /** Whether `seat`'s verified share of `pos` is held on this line. */
  has(seat: number, pos: number): boolean {
    this.touched.add(pos);
    return this.pool.has(seat, pos) || this.extra.has(seat, pos);
  }

  /** Keep `share`, carried by a linked game action, as `seat`'s share of `pos` unless one is held already. */
  add(seat: number, pos: number, share: Share): void {
    if (!this.pool.has(seat, pos)) this.extra.add(seat, pos, share);
  }

  /** `pos`'s shares in seat order, with `without`'s slot left empty. */
  slots(pos: number, without: number | null = null): (Share | null)[] {
    this.touched.add(pos);
    const a = this.pool.slots(pos, without);
    const b = this.extra.slots(pos, without);
    return a.map((s, k) => s ?? b[k] ?? null);
  }

  /** Whether every seat except `except` (or every seat, for null) has a share of `pos` on this line. */
  covered(pos: number, except: number | null = null): boolean {
    for (let k = 0; k < this.seats; k++) if (k !== except && !this.has(k, pos)) return false;
    this.touched.add(pos);
    return true;
  }

  /** The positions `seat` owes on `dealt` (dealt to another seat or to nobody) and has not shared, ascending. */
  missing(seat: number, dealt: readonly DealtPosition[]): number[] {
    return owedPositions(dealt, seat).filter((pos) => !this.has(seat, pos));
  }
}
