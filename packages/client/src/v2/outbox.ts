import type { Ciphertext } from '@bored-games/deck';
import {
  type Hex,
  KIND,
  type ParsedCardShares,
  type ParsedEndAttest,
  type ParsedMove,
  type ParsedResign,
  type ParsedRollShares,
  parseAttestV2,
  parseDeviceNote,
  parseResign,
  parseSecret,
  parseSharesV2,
  parseTimeout,
} from '@bored-games/protocol';
import { parsePartitionMove } from '../partitioned-deck.ts';
import type { CountedResult, ResultId } from '../types.ts';
import { attestedResult, lineLogHash } from './results.ts';
import { rollEventProblem } from './rolls.ts';
import { cardSharesProblem, type DeckCaches } from './shares.ts';
import type { SideLines } from './sides.ts';
import { type EventStoreV2, resultKey } from './store.ts';
import type { GameCtx, HeldMove } from './types.ts';
import { looksValid, type Walk } from './walk.ts';

/*
 * The client rules on saved events and gossip (PROTOCOL-v2 §9.1, §9.2; build plan T13): `vetSaved`, what a device
 * does with an event it saved that no relay has confirmed, once it has synced with every counted relay, and
 * `rebroadcast`, the held events it must publish again so that every honest client comes to hold them (A3). Both are
 * functions of the held events and the walk; neither changes the session.
 *
 * `vetSaved` never lets an honest device publish something that forks its own seat or shares its own card: a saved
 * event is sent only when it still fits what the device holds after its sync, it waits while what it builds on may
 * still arrive, and otherwise it is discarded (removed from storage and logged by the controller). The deal is the
 * exception: it is kept and never rebuilt (v1 §6.1, §9), so it waits where any other event would be discarded.
 */

/** What `vetSaved` decides for one saved event (PROTOCOL-v2 §9.2). */
export type Verdict = 'send' | 'wait' | { readonly discard: string };

/** What the session lends the outbox rules: its fixed context, held events, walk and decisions, read only. */
export interface OutboxCtx {
  readonly ctx: GameCtx;
  readonly store: EventStoreV2;
  readonly walk: Walk;
  readonly caches: DeckCaches;
  /** This client's seat with its session key and npub, or null for a spectator. */
  readonly me: { readonly seat: number; readonly session: Hex; readonly npub: Hex } | null;
  sides(): SideLines;
  /** The game has a result, a counted claim or Resign, or a saved one waiting for its events (no longer live). */
  ended(): boolean;
  /** The game's result: this client's own with no fork held, or the one standing against the fork. */
  result(): ResultId | null;
  /** The claim or Resign counted with no fork held, or the saved one still waiting for its events. */
  counted(): CountedResult | null;
  /** The saved counted result while it waits for its events (`awaitingCounted`), or null. */
  awaiting(): CountedResult | null;
  canResign(): boolean;
  chainSeq(id: Hex): number | null;
  branchOf(id: Hex): 'chain' | 'ahead' | 'side' | 'unknown';
  /** Why held Shares event `id` is invalid, or null (the session's own check). */
  sharesProblem(id: Hex): string | null;
}

const discard = (why: string): Verdict => ({ discard: why });

const GONE = 'what it was built on is gone: not held after the sync, and not one of your saved events';

/** The `kind` of an untrusted value, or null. Never throws. */
function kindOf(ev: unknown): number | null {
  try {
    if (typeof ev !== 'object' || ev === null) return null;
    const kind: unknown = (ev as { kind?: unknown }).kind;
    return typeof kind === 'number' ? kind : null;
  } catch {
    return null;
  }
}

/**
 * What to do with saved event `ev`, signed by this client's seat and never confirmed by a relay, after a sync with
 * every counted relay (PROTOCOL-v2 §9.2; the controller runs it in that order: moves first, in seq order, then the
 * deal, then the other events, since a saved move that is sent can change the head the rest are judged on):
 * - **A Move**: discarded if another move of its seat on its `prev` is held (one that may still be valid-looking
 *   there: a move of a bad shape or judged invalid at its prev forks nothing, D063), while a fork is held, if its
 *   `prev` is held but not on the chain, or on the chain below the head (unless the move itself is on the chain:
 *   this client folded it in); it waits while its `prev` is not held, or is a move still ahead of the head (it
 *   extends the head and waits for shares or a roll, as v1's controller); otherwise (its `prev` is the head) it is sent,
 *   unless this client judges it invalid there.
 * - **A card Shares event other than the deal** (a prompt release): sent only if its anchor is on the chain, no fork
 *   is held, the game has no result, its shares verify against the final deck, and every position in it is dealt at
 *   the head to another seat or to nobody with no other verified share by this seat held (a saved share of a
 *   position now dealt to its own seat is never sent: the Luster audit's F3); it waits while its anchor is not held
 *   or is a move still ahead of the head; otherwise it is discarded.
 * - **The deal** (a card Shares event anchored on a move at the last shuffle step): sent only if its anchor is on the
 *   chain, no fork is held, no other deal of its seat is held, and it verifies against the final deck; otherwise it
 *   waits: it is kept and never discarded (v1 §6.1, §9: a seat deals once).
 * - **A roll Shares event**: sent only if its requesting move and anchor are on the chain, no fork is held, the game
 *   has no result and the session would accept it; it waits while either is not held or still ahead of the head;
 *   otherwise it is discarded.
 * - **An end attestation**: sent only while no fork is held and this client still computes that result (identity
 *   and log hash); it waits while a saved counted result of that identity waits for its events; otherwise discarded.
 * - **A Resign** (as v1 §9): discarded if another Resign of its seat is held, or the game is no longer live (unless
 *   the game's result or counted Resign is this seat's Resign naming that head); otherwise sent.
 * - **A Secret reveal**: sent once the game is no longer live or a fork is held (this client owes or may owe it);
 *   while the game is live here it waits, so a deck secret is never published mid-game. **A Timeout claim, stats
 *   attestation or Device note** is sent (republished as in v1).
 * Anything that does not parse at proto 2 for this game, or is not signed by this seat, is discarded. Never throws:
 * an internal error answers `wait` (nothing is sent, nothing is lost).
 *
 * `unconfirmed` (required, the contract with the controller): the ids of every event of this seat still in the outbox,
 * saved and confirmed by no relay, `ev` included or not, with no id of an event the controller already discarded. A
 * Shares event whose anchor or requesting move is not held waits only while that id is in `unconfirmed` (this seat's
 * own saved move, not vetted or not fed yet); otherwise, after the full sync this rule runs after, the move is gone
 * (a saved move of this seat that was discarded, or one no relay holds) and the event is discarded with it, the deal
 * included (it was built on a deck that never became public here; review of T13, L-3).
 */
export function vetSaved(o: OutboxCtx, ev: unknown, unconfirmed: Iterable<Hex>): Verdict {
  try {
    const pending = new Set(unconfirmed);
    const me = o.me;
    if (me === null) return discard('a spectator has no saved events');
    const kind = kindOf(ev);
    const rootId = o.ctx.rootId;
    const parsed = parseFor(o, kind, ev);
    if (typeof parsed === 'string') return discard(`it does not parse as an event of this game: ${parsed}`);
    if (parsed.rootId !== rootId) return discard('it is for another game');
    const byNpub = parsed.kind === 'end' || parsed.kind === 'stats';
    if (parsed.pubkey !== me.session && !(byNpub && parsed.pubkey === me.npub))
      return discard('it is not signed by your seat in this game');
    switch (parsed.kind) {
      case 'move':
        return vetMove(o, me.seat, parsed.ev);
      case 'shares':
        return vetCardShares(o, me.seat, parsed.ev, pending);
      case 'roll':
        return vetRoll(o, me.seat, parsed.ev, pending);
      case 'end':
        return vetEnd(o, parsed.ev);
      case 'resign':
        return vetResign(o, me.seat, parsed.ev);
      case 'secret':
        return o.ended() || o.walk.fork !== null ? 'send' : 'wait';
      default:
        return 'send';
    }
  } catch {
    return 'wait';
  }
}

type Parsed =
  | { kind: 'move'; rootId: Hex; pubkey: Hex; ev: ParsedMove }
  | { kind: 'shares'; rootId: Hex; pubkey: Hex; ev: ParsedCardShares }
  | { kind: 'roll'; rootId: Hex; pubkey: Hex; ev: ParsedRollShares }
  | { kind: 'end'; rootId: Hex; pubkey: Hex; ev: ParsedEndAttest }
  | { kind: 'resign'; rootId: Hex; pubkey: Hex; ev: ParsedResign }
  | { kind: 'secret' | 'claim' | 'stats' | 'device'; rootId: Hex; pubkey: Hex };

/** `ev` parsed at proto 2 by its kind, or why it does not parse. */
function parseFor(o: OutboxCtx, kind: number | null, ev: unknown): Parsed | string {
  try {
    switch (kind) {
      case KIND.move: {
        const m = parsePartitionMove(ev, o.ctx.deckSize, o.ctx.partitions, '2');
        return { kind: 'move', rootId: m.rootId, pubkey: m.pubkey, ev: m };
      }
      case KIND.shares: {
        const s = parseSharesV2(ev);
        return s.type === 'shares'
          ? { kind: 'shares', rootId: s.rootId, pubkey: s.pubkey, ev: s }
          : { kind: 'roll', rootId: s.rootId, pubkey: s.pubkey, ev: s };
      }
      case KIND.attest: {
        const a = parseAttestV2(ev);
        return a.variant === 'end'
          ? { kind: 'end', rootId: a.rootId, pubkey: a.pubkey, ev: a }
          : { kind: 'stats', rootId: a.rootId, pubkey: a.pubkey };
      }
      case KIND.resign: {
        const r = parseResign(ev, o.ctx.deckId !== null, '2');
        return { kind: 'resign', rootId: r.rootId, pubkey: r.pubkey, ev: r };
      }
      case KIND.reveal: {
        const s = parseSecret(ev, '2');
        return { kind: 'secret', rootId: s.rootId, pubkey: s.pubkey };
      }
      case KIND.timeout: {
        const t = parseTimeout(ev, '2');
        return { kind: 'claim', rootId: t.rootId, pubkey: t.pubkey };
      }
      case KIND.device: {
        const d = parseDeviceNote(ev);
        return { kind: 'device', rootId: d.rootId, pubkey: d.pubkey };
      }
      default:
        return `kind ${String(kind)} is not an in-game event`;
    }
  } catch (e) {
    return e instanceof Error ? e.message : 'invalid event';
  }
}

/**
 * Whether held move `h` can never be valid-looking at its prev: a bad shape, or judged invalid there (by the walk,
 * or on its prev's side line when that line is valid). A move whose prev's line is not held or not valid cannot be
 * judged, so it counts as one that may be valid-looking (the conservative side: the saved move is discarded).
 */
function neverLooks(o: OutboxCtx, h: HeldMove): boolean {
  if (h.shape !== null) return true;
  const j = o.walk.judged.get(h.m.id);
  if (j !== undefined) return j.kind === 'invalid';
  const fold = o.sides().fold(h.m.prevId);
  return fold !== null && fold.judge(h).kind === 'invalid';
}

/** The saved Move rule (§9.2): see `vetSaved`. */
function vetMove(o: OutboxCtx, seat: number, m: ParsedMove): Verdict {
  const { store, walk } = o;
  const p = m.prevId;
  if (store.kidsOf(p).some((h) => h.seat === seat && h.m.id !== m.id && !neverLooks(o, h)))
    return discard('another move of yours on that position is held');
  // Already on this client's chain (folded in): sent, also while a fork is held. A fork lies at or above a chain
  // move, never below it, so sending adds nothing new, and §9.1 republishes every chain move anyway; discarding it
  // would let a rebuild without it ask this seat to move again there, a fork of its own (review of T13, M-1).
  if (o.chainSeq(m.id) !== null) return 'send';
  if (walk.fork !== null) return discard('the game is stopped at a fork');
  if (!store.held(p)) return 'wait';
  const at = o.chainSeq(p);
  // A prev that extends the head and waits for something (shares or a roll) may still link: wait, as v1's
  // controller (D056 fix round 2). Any other prev off the chain: the game went another way.
  if (at === null) return place(o, p) === 'ahead' ? 'wait' : discard('the game went another way');
  if (m.seq !== at + 1) return discard('it does not follow its parent');
  if (at !== walk.chain.length) return discard('the game has moved on');
  const held = store.moves.get(m.id);
  if (held !== undefined && neverLooks(o, held)) {
    const j = walk.judged.get(m.id);
    return discard(`the game refuses it (${held.shape ?? (j?.kind === 'invalid' ? j.why : 'invalid')})`);
  }
  return 'send';
}

/** Where a held id sits for a Shares event's rule: on the chain, still ahead of the head, or elsewhere. */
function place(o: OutboxCtx, id: Hex): 'chain' | 'ahead' | 'off' | 'missing' {
  if (!o.store.held(id)) return 'missing';
  if (o.chainSeq(id) !== null) return 'chain';
  return o.branchOf(id) === 'ahead' && o.walk.fork === null ? 'ahead' : 'off';
}

/** The walk's final deck and its key, or null before the shuffle is complete on it (and in a deckless game). */
function finalDeck(o: OutboxCtx): { key: Hex; deck: readonly Ciphertext[] } | null {
  if (o.ctx.deckId === null) return null;
  const point = o.walk.line.points[o.ctx.shuffleSteps];
  if (point === undefined || point.deckKey === null) return null;
  return { key: point.deckKey, deck: point.deck };
}

/** Whether held id `id` is a move at the last shuffle step: the anchor of a deal (v1 §6.1, PROTOCOL-v2 §6.1). */
function dealAnchor(o: OutboxCtx, id: Hex): boolean {
  return o.ctx.deckId !== null && o.store.moves.get(id)?.m.seq === o.ctx.shuffleSteps;
}

/** The saved card Shares rule (§9.2): the deal, or a prompt release. See `vetSaved`. */
function vetCardShares(o: OutboxCtx, seat: number, s: ParsedCardShares, pending: ReadonlySet<Hex>): Verdict {
  const { ctx, store, walk } = o;
  if (ctx.deckId === null) return discard('a card Shares event in a game without a deck');
  // Its anchor not held: it waits while the anchor is this seat's own saved move still in the outbox (the deal cannot
  // be told from a release then); otherwise the anchor is gone after the sync, and the event goes with it.
  if (!store.held(s.anchorId)) return pending.has(s.anchorId) ? 'wait' : discard(GONE);
  if (dealAnchor(o, s.anchorId)) return vetDeal(o, seat, s);
  const anchor = place(o, s.anchorId);
  if (anchor === 'ahead') return 'wait';
  if (anchor !== 'chain') return discard('the game went another way');
  if (walk.fork !== null) return discard('the game is stopped at a fork');
  if (o.ended()) return discard('the game is over');
  const final = finalDeck(o);
  if (final === null) return discard('the deck is not complete at its anchor');
  const bad = cardSharesProblem(ctx, o.caches, final.key, final.deck, s.id, seat, s.shares);
  if (bad !== null) return discard(`the game refuses it (${bad})`);
  const head = walk.line.points[walk.line.points.length - 1];
  const dealt = head?.state === null || head === undefined ? [] : ctx.module.dealt(head.state);
  const released = releasedBy(o, seat, s.id, final);
  for (const { pos } of s.shares) {
    const d = dealt.find((x) => x.deck === ctx.deckId && x.pos === pos);
    if (d === undefined) return discard('that card is not drawn');
    if (d.to === seat) return discard('it would reveal your own card');
    if (released.has(pos)) return discard('that card is already released');
  }
  return 'send';
}

/**
 * The positions of the final deck for which this client holds a verified share by `seat` other than in event
 * `except`: in another of its card Shares events that verifies against the final deck, or carried by one of its game
 * actions on the chain (linked, so its proofs verified).
 */
function releasedBy(
  o: OutboxCtx,
  seat: number,
  except: Hex,
  final: { key: Hex; deck: readonly Ciphertext[] },
): Set<number> {
  const out = new Set<number>();
  for (const [id, x] of o.store.cardShares) {
    if (id === except || x.seat !== seat) continue;
    if (cardSharesProblem(o.ctx, o.caches, final.key, final.deck, id, seat, x.ev.shares) !== null) continue;
    for (const { pos } of x.ev.shares) out.add(pos);
  }
  for (const h of o.walk.chain) {
    if (h.seat !== seat || h.m.content.type !== 'action') continue;
    for (const { pos } of [...h.m.content.shares, ...h.m.content.reveals]) out.add(pos);
  }
  return out;
}

/** The saved deal (§9.2, v1 §6.1, §9): sent when it fits the walk's deck, otherwise kept (`wait`), never discarded. */
function vetDeal(o: OutboxCtx, seat: number, s: ParsedCardShares): Verdict {
  const { ctx, store, walk } = o;
  if (walk.fork !== null) return 'wait';
  if (o.chainSeq(s.anchorId) !== ctx.shuffleSteps) return 'wait';
  for (const [id, x] of store.cardShares)
    if (id !== s.id && x.seat === seat && dealAnchor(o, x.ev.anchorId)) return 'wait';
  const final = finalDeck(o);
  if (final === null) return 'wait';
  if (cardSharesProblem(ctx, o.caches, final.key, final.deck, s.id, seat, s.shares) !== null) return 'wait';
  // Never a position dealt to this seat at the deal (an honest deal holds none: a guard, not a rule).
  const point = walk.line.points[ctx.shuffleSteps];
  const dealt = point?.state === null || point === undefined ? [] : ctx.module.dealt(point.state);
  const mine = new Set(dealt.filter((d) => d.deck === ctx.deckId && d.to === seat).map((d) => d.pos));
  if (s.shares.some(({ pos }) => mine.has(pos))) return 'wait';
  return 'send';
}

/** The saved roll Shares rule (§9.2): see `vetSaved`. */
function vetRoll(o: OutboxCtx, seat: number, s: ParsedRollShares, pending: ReadonlySet<Hex>): Verdict {
  if (typeof o.ctx.module.rolls !== 'function')
    return discard('a roll Shares event in a game that does not roll');
  const move = place(o, s.moveId);
  const anchor = place(o, s.anchorId);
  for (const [id, at] of [
    [s.moveId, move],
    [s.anchorId, anchor],
  ] as const)
    if (at === 'missing' && !pending.has(id)) return discard(GONE);
  if (move === 'missing' || anchor === 'missing') return 'wait';
  if (o.walk.fork !== null) return discard('the game is stopped at a fork');
  if (o.ended()) return discard('the game is over');
  if (move === 'off' || anchor === 'off') return discard('the game went another way');
  if (move === 'ahead' || anchor === 'ahead') return 'wait';
  const bad = o.store.rollShares.has(s.id)
    ? o.sharesProblem(s.id)
    : rollEventProblem(o.ctx, o.caches.rolls, seat, s, o.walk.requests.get(s.moveId) ?? 0);
  if (bad !== null) return discard(`the game refuses it (${bad})`);
  return 'send';
}

/** The saved end attestation rule (§9.2): see `vetSaved`. */
function vetEnd(o: OutboxCtx, a: ParsedEndAttest): Verdict {
  if (o.walk.fork !== null) return discard('a fork is held');
  const id = resultKey(attestedResult(a));
  const r = o.result();
  if (r !== null && resultKey(r) === id) {
    if (lineLogHash(o.store, a.headId) !== a.end.logHash)
      return discard("its log hash does not match the result's line");
    return 'send';
  }
  const w = o.awaiting();
  if (w !== null && resultKey({ kind: w.kind, head: w.head, forfeit: w.forfeit }) === id) return 'wait';
  return discard('this client no longer computes that result');
}

/** The saved Resign rule (§9.2, as v1 §9): see `vetSaved`. */
function vetResign(o: OutboxCtx, seat: number, r: ParsedResign): Verdict {
  const { store } = o;
  for (const pool of [store.resigns, store.waitingResigns])
    for (const [id, x] of pool)
      if (id !== r.id && x.seat === seat) return discard('another resignation of yours is held');
  const mine = (x: { kind: string; head: Hex; forfeit: readonly number[] } | null): boolean =>
    x !== null && x.kind === 'resign' && x.head === r.headId && x.forfeit[0] === seat;
  if (mine(o.result()) || mine(o.counted())) return 'send';
  if (o.canResign()) return 'send';
  return discard('the game is over');
}

/**
 * The events this client must publish again (PROTOCOL-v2 §9.1), as ids ascending (the chain in seq order), to the
 * root's relays and its player's own relays; `rootOnly` goes to the root's relays (a SHOULD). The lists are disjoint;
 * the controller publishes each once after first holding it, and after each sync only to relays that lack it.
 */
export interface Rebroadcast {
  /** Both moves of the fork the walk ends at (the fork certificate), or none. */
  certificate: Hex[];
  /** Every move on the walk, in seq order. */
  chain: Hex[];
  /** This seat's held Shares events and end attestations, whatever their validity (empty for a spectator). */
  own: Hex[];
  /**
   * Every other held event the fold, the cutoff or the audit reads, by any seat, within §9.1's bounds: the other
   * seats' Shares events and end attestations (every held one, D066), Timeout claims and Resigns kept or waiting
   * under the caps (D069), one Secret reveal per seat (the lowest id), and the Moves: at most two per signer and prev
   * (valid-looking ones first, then the lowest ids), plus every Move a held event names (a Shares event's anchor, a
   * roll Shares event's requesting move, an end attestation's head, a held Move's prev, a claim's or Resign's head).
   */
  other: Hex[];
  /** Each seat's latest stats attestation and its Device notes at its highest `n` (at most two, the lowest ids). */
  rootOnly: Hex[];
}

const sortIds = (ids: Iterable<Hex>): Hex[] => [...ids].sort();

/**
 * The §9.1 rebroadcast set (see `Rebroadcast`): a function of the held events and the walk, less `unconfirmed`.
 * `unconfirmed` (required, the same contract as `vetSaved`'s): the ids of every event of this seat still in the
 * outbox, confirmed by no relay. None of them is ever listed, wherever it would sit (the certificate, the chain, a
 * named move): this seat's own unconfirmed events follow the outbox rule (§9.2) alone, since a folded-in move the
 * rule would discard (another device's rival is now held) would otherwise go out as a fork certificate and fork the
 * seat (review of T13, H-1). Vet the outbox, and rebuild after any discard, before rebroadcasting after a sync.
 */
export function rebroadcast(o: OutboxCtx, unconfirmed: Iterable<Hex>): Rebroadcast {
  const { store, walk } = o;
  // This seat's own events still in the outbox go out only through the outbox rule (§9.1, review of T13, H-1).
  const pending = new Set(unconfirmed);
  const out = (ids: Iterable<Hex>): Hex[] => [...ids].filter((id) => !pending.has(id));
  const mySeat = o.me?.seat ?? null;
  const chain = walk.chain.map((h) => h.m.id);
  const certificate = walk.fork === null ? [] : sortIds(walk.fork.successors).slice(0, 2);
  const taken = new Set<Hex>([...chain, ...certificate]);
  const other = new Set<Hex>();
  const keep = (id: Hex): void => {
    if (store.moves.has(id) && !taken.has(id)) other.add(id);
  };
  // Every Move a held event names, regardless of the per-signer cap (review R2).
  for (const x of store.cardShares.values()) keep(x.ev.anchorId);
  for (const x of store.rollShares.values()) {
    keep(x.ev.anchorId);
    keep(x.ev.moveId);
  }
  for (const x of store.ends.values()) keep(x.ev.headId);
  for (const h of store.moves.values()) keep(h.m.prevId);
  for (const pool of [store.claims, store.waitingClaims, store.resigns, store.waitingResigns])
    for (const x of pool.values()) keep(x.ev.headId);
  // At most two Moves per signer and prev: valid-looking ones first, so a junk move never crowds out a certificate.
  const groups = new Map<string, HeldMove[]>();
  for (const h of store.moves.values()) {
    const key = `${h.m.prevId}|${h.seat}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [h]);
    else list.push(h);
  }
  for (const list of groups.values()) {
    if (list.length <= 2) {
      for (const h of list) keep(h.m.id);
      continue;
    }
    const looking = lookingAt(o, (list[0] as HeldMove).m.prevId);
    const ranked = list
      .map((h) => ({ id: h.m.id, rank: h.shape === null && looking(h) ? 0 : 1 }))
      .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const x of ranked.slice(0, 2)) keep(x.id);
  }
  const own = new Set<Hex>();
  const add = (id: Hex, seat: number): void => {
    (seat === mySeat ? own : other).add(id);
  };
  for (const [id, x] of store.cardShares) add(id, x.seat);
  for (const [id, x] of store.rollShares) add(id, x.seat);
  for (const [id, x] of store.ends) add(id, x.seat);
  for (const pool of [store.claims, store.waitingClaims, store.resigns, store.waitingResigns])
    for (const id of pool.keys()) other.add(id);
  const secrets = new Map<number, Hex>();
  for (const [id, x] of store.secrets) {
    const held = secrets.get(x.seat);
    if (held === undefined || id < held) secrets.set(x.seat, id);
  }
  for (const id of secrets.values()) other.add(id);
  const rootOnly = new Set<Hex>([...store.stats.values()].map((x) => x.id));
  const notes = new Map<number, { n: number; ids: Hex[] }>();
  for (const [id, x] of store.devices) {
    const at = notes.get(x.seat);
    if (at === undefined || x.ev.n > at.n) notes.set(x.seat, { n: x.ev.n, ids: [id] });
    else if (x.ev.n === at.n) at.ids.push(id);
  }
  for (const { ids } of notes.values()) for (const id of sortIds(ids).slice(0, 2)) rootOnly.add(id);
  return {
    certificate: out(certificate),
    chain: out(chain),
    own: out(sortIds(own)),
    other: out(sortIds(other)),
    rootOnly: out(sortIds(rootOnly)),
  };
}

/**
 * Whether a held move on prev `q` is valid-looking there (§5.1): read from the walk's judgements when `q` is on the
 * walk, from a side-line fold when `q`'s line is valid, and never otherwise (a pair there is no certificate).
 */
function lookingAt(o: OutboxCtx, q: Hex): (h: HeldMove) => boolean {
  if (q === o.ctx.rootId || o.chainSeq(q) !== null)
    return (h) => {
      const j = o.walk.judged.get(h.m.id);
      return j !== undefined && looksValid(j);
    };
  const fold = o.sides().fold(q);
  if (fold === null) return () => false;
  return (h) => looksValid(fold.judge(h));
}
