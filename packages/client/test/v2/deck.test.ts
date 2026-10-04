import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { type Ciphertext, makeMoveRollShare, makeShare } from '@bored-games/deck';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import {
  cardSharesTemplate,
  finalizeEvent,
  type Hex,
  moveTemplate,
  type NostrEvent,
  type ParsedMove,
  parseMove,
  rollSharesTemplate,
  secretTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity } from '../../src/types.ts';
import type { GameSessionV2 } from '../../src/v2/session.ts';
import { MODULES, NOW } from '../helpers.ts';
import {
  type AnyModule,
  act,
  decider,
  quick,
  replay,
  runAuto,
  send,
  trustSteps,
  type V2Table,
  v2Session,
  v2Table,
} from './helpers-v2.ts';

/*
 * The protocol 2 session with a deck (build plan T8): the shuffle (PROTOCOL-v2 §5.1: a well-formed step is
 * valid-looking without its proof), the deal (a card Shares event anchored on the last shuffle step), card Shares
 * events verified against the line's final deck and held whatever their validity (D065), derived reveals, learns,
 * the slow path, the Secret phase and the full audit at `over`. Chain Reaction, 3 seats. Prompt release has its own
 * file (`prompt-release.test.ts`).
 */

const protoTags = (ev: { tags: string[][] }): string[][] => ev.tags.filter((tag) => tag[0] === 'proto');
const anchorOf = (ev: NostrEvent): string | undefined =>
  ev.tags.find((t) => t[0] === 'e' && t[3] === 'anchor')?.[1];
const positionsOf = (ev: NostrEvent): number[] =>
  (JSON.parse(ev.content) as { shares: { pos: number }[] }).shares.map((s) => s.pos);
const crState = (s: GameSessionV2): ChainReactionState => s.view().state as ChainReactionState;

/** What the base table looked like before each shuffle step, after the shuffle, and after the deal. */
interface Snap {
  phase: string;
  head: number;
  pending: unknown;
  duties: unknown[];
  waiting: number[];
}
const snap = (t: V2Table): Snap => ({
  phase: t.spectator.view().phase,
  head: t.spectator.view().head.seq,
  pending: t.spectator.view().pending,
  duties: t.players.map((s) => s.duties()),
  waiting: t.spectator.waitingFor(),
});

let base: V2Table;
/** The base table's log up to the last shuffle step (before the deal). */
let shuffled: NostrEvent[];
const trace: Snap[] = [];
let deals: { seat: number; ev: NostrEvent }[] = [];

beforeAll(() => {
  base = v2Table(chainReaction, 3, 'v2-deck');
  trace.push(snap(base));
  for (let k = 0; k < 3; k++) {
    const ev = (base.players[k] as GameSessionV2).buildShuffle(base.game.rnd, NOW);
    trustSteps(base.all, [ev]);
    send(base, ev);
    trace.push(snap(base));
  }
  shuffled = [...base.log];
  deals = runAuto(base).map(({ seat, ev }) => ({ seat, ev }));
  trace.push(snap(base));
}, 120_000);

describe('GameSessionV2 with a deck: shuffle and deal (Chain Reaction)', () => {
  it('V2-01 (partial) shuffles in seat order, then deals: each seat one card Shares event anchored on the last step, all at proto 2', () => {
    // Before each step, the next shuffler is pending and owes the step; nobody else owes anything.
    for (let k = 0; k < 3; k++) {
      expect(trace[k]).toMatchObject({
        phase: 'shuffle',
        head: k,
        pending: { type: 'player', seat: k, decision: 'shuffle' },
        waiting: [k],
      });
      expect(trace[k]?.duties).toEqual([0, 1, 2].map((j) => (j === k ? [{ kind: 'shuffle' }] : [])));
    }
    // After the last step: the deal, every seat stalled until its deal is in.
    expect(trace[3]).toMatchObject({ phase: 'deal', head: 3, waiting: [0, 1, 2] });
    expect(trace[3]?.duties).toEqual([[{ kind: 'deal' }], [{ kind: 'deal' }], [{ kind: 'deal' }]]);
    const last = shuffled[2] as NostrEvent;
    for (const ev of shuffled) expect(protoTags(ev)).toEqual([['proto', '2']]);
    expect(deals.map((d) => d.seat)).toEqual([0, 1, 2]);
    const dealt = chainReaction.dealt(crState(base.spectator));
    for (const { seat, ev } of deals) {
      expect(protoTags(ev)).toEqual([['proto', '2']]);
      expect(anchorOf(ev)).toBe(last.id);
      // Every position dealt to another seat or to nobody, sorted; never the seat's own hand.
      const want = dealt
        .filter((d) => d.to !== seat)
        .map((d) => d.pos)
        .sort((a, b) => a - b);
      expect(positionsOf(ev)).toEqual(want);
    }
    // After the deal: play, the setup tiles revealed, each seat's hand learned; the deck steps are the chain's.
    expect(trace[4]).toMatchObject({ phase: 'play', head: 3 });
    expect(base.spectator.deckSteps()).toEqual(shuffled.map((e) => e.id));
    for (const [seat, s] of base.players.entries()) {
      const hand = crState(s).players[seat]?.hand ?? [];
      expect(hand).toHaveLength(6);
      expect(hand.every((h) => h.tile !== null)).toBe(true);
      // Other seats' hands stay hidden.
      for (const [other, p] of crState(s).players.entries())
        if (other !== seat) expect(p.hand.every((h) => h.tile === null)).toBe(true);
    }
    expect(crState(base.spectator).players.every((p) => p.hand.every((h) => h.tile === null))).toBe(true);
    expect(base.spectator.view().events.length).toBeGreaterThan(0);
  });

  it('a card Shares event that arrives before the final deck waits (stored), and counts once the shuffle is complete', () => {
    const late = v2Session(base.game, null);
    trustSteps([late], shuffled);
    for (const { ev } of deals) expect(late.receive(ev, NOW)).toEqual({ status: 'stored' });
    expect(late.view().phase).toBe('shuffle');
    for (const ev of shuffled) late.receive(ev, NOW);
    expect(late.view()).toMatchObject({ phase: 'play', head: { seq: 3 } });
    expect(canonicalJson(late.view())).toBe(canonicalJson(base.spectator.view()));
  });

  it('V2-14 treats two well-formed shuffle steps of one seat on one prev as a fork, their proofs unverified', () => {
    const step1 = parseMove(shuffled[0], 108, '2') as ParsedMove;
    const c = step1.content as Extract<ParsedMove['content'], { type: 'shuffle' }>;
    const id0 = base.game.ids[0] as Identity;
    // Two rivals of step 1 by seat 0 whose proofs do not verify (the deck reordered): both are well-formed.
    const rival = (deck: Ciphertext[], at: number): NostrEvent =>
      finalizeEvent(
        moveTemplate(
          { rootId: base.game.rootId, prevId: base.game.rootId, seq: 1, content: { ...c, deck } },
          at,
          '2',
        ),
        id0.sessionSk,
        base.game.rnd,
      );
    const a = rival([...c.deck].reverse(), NOW);
    const b = rival([...c.deck.slice(1), c.deck[0] as Ciphertext], NOW + 1);
    const fresh = replay(base, []);
    const s = fresh.spectator;
    const checked = (s as unknown as { caches: { shuffleOk: Map<Hex, boolean> } }).caches.shuffleOk;
    // Alone, a step whose proof fails is valid-looking but never links: the walk ends at the root.
    expect(s.receive(a, NOW)).toEqual({ status: 'stored' });
    expect(s.view()).toMatchObject({ head: { seq: 0 }, fork: null, phase: 'shuffle' });
    expect(checked.get(a.id)).toBe(false);
    // A second well-formed step on the same prev: a fork at the root, signed by seat 0, with no proof checked.
    expect(s.receive(b, NOW)).toEqual({ status: 'accepted' });
    expect(checked.has(b.id)).toBe(false);
    expect(s.view().fork).toEqual({ at: base.game.rootId, seat: 0, certificate: [a.id, b.id].sort() });
    expect(s.forkSteps()).toEqual([a.id, b.id].sort());
    // In a game already dealt, a rival of step 1 forks at the root as well; its proof is never checked, and no seat
    // owes anything any more.
    const dealt = replay(base);
    expect(dealt.spectator.receive(b, NOW)).toEqual({ status: 'accepted' });
    const checked2 = (dealt.spectator as unknown as { caches: { shuffleOk: Map<Hex, boolean> } }).caches
      .shuffleOk;
    expect(checked2.has(b.id)).toBe(false);
    for (const p of dealt.players) p.receive(b, NOW);
    expect(dealt.spectator.view().fork).toMatchObject({ at: base.game.rootId, seat: 0 });
    expect(dealt.players.map((p) => p.duties())).toEqual([[], [], []]);
    expect(dealt.spectator.waitingFor()).toEqual([]);
    // A step by the wrong seat is not well-formed: rejected, held, and no fork.
    const wrong = finalizeEvent(
      moveTemplate({ rootId: base.game.rootId, prevId: base.game.rootId, seq: 1, content: c }, NOW + 2, '2'),
      (base.game.ids[1] as Identity).sessionSk,
      base.game.rnd,
    );
    const other = replay(base);
    expect(other.spectator.receive(wrong, NOW)).toEqual({
      status: 'rejected',
      reason: 'shuffle step 1 must be signed by seat 0',
    });
    expect(other.spectator.view().fork).toBeNull();
  });
});

describe('GameSessionV2 with a deck: card Shares events against the final deck (Chain Reaction)', () => {
  /** A card Shares event by `seat` with its shares of `positions` made against `deck`, anchored on `anchor`. */
  function sharesEvent(
    seat: number,
    positions: number[],
    deck: readonly Ciphertext[],
    anchor: Hex,
  ): NostrEvent {
    const id = base.game.ids[seat] as Identity;
    const shares = positions.map((pos) => ({
      pos,
      share: makeShare(
        id.deckSecret,
        deck[pos % deck.length] as Ciphertext,
        { rootId: base.game.rootId, deckId: 'tiles', pos },
        base.game.rnd,
      ),
    }));
    return finalizeEvent(
      cardSharesTemplate({ rootId: base.game.rootId, anchorId: anchor, shares }, NOW),
      id.sessionSk,
      base.game.rnd,
    );
  }
  const stepDeck = (i: number): Ciphertext[] =>
    ((parseMove(shuffled[i], 108, '2') as ParsedMove).content as { deck: Ciphertext[] }).deck;

  it('V2-08 accepts a card Shares event in a game with a deck, and rejects (but holds) a roll Shares event in a game that does not roll', () => {
    const t = replay(base, shuffled);
    const deal = (deals[0] as { ev: NostrEvent }).ev;
    expect(send(t, deal)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    const id1 = base.game.ids[1] as Identity;
    const roll = finalizeEvent(
      rollSharesTemplate(
        {
          rootId: base.game.rootId,
          anchorId: (shuffled[2] as NostrEvent).id,
          moveId: (shuffled[2] as NostrEvent).id,
          shares: [
            {
              pos: 0,
              share: makeMoveRollShare(
                id1.deckSecret,
                base.game.rootId,
                (shuffled[2] as NostrEvent).id,
                0,
                base.game.rnd,
              ),
            },
          ],
        },
        NOW,
      ),
      id1.sessionSk,
      base.game.rnd,
    );
    expect(t.spectator.receive(roll, NOW)).toEqual({
      status: 'rejected',
      reason: 'a roll Shares event in a game that does not roll',
    });
    expect(t.spectator.heldSet().map((x) => x.id)).toContain(roll.id);
  });

  it('V2-56 (partial) holds card Shares events whose shares fail against the final deck or lie outside it; a seat that released on another deck never deals here (§6.1 condition 4)', () => {
    const t = replay(base, shuffled);
    const last = (shuffled[2] as NostrEvent).id;
    // Seat 1's deal made against step 2's deck (a rival deck, as after a shuffle fork): every share fails.
    const elsewhere = sharesEvent(1, [0, 1, 2], stepDeck(1), last);
    expect(t.spectator.receive(elsewhere, NOW)).toEqual({
      status: 'rejected',
      reason: 'the share for position 0 does not verify',
    });
    // A position outside the 108-tile deck.
    const outside = sharesEvent(2, [200], stepDeck(2), last);
    expect(t.spectator.receive(outside, NOW)).toEqual({
      status: 'rejected',
      reason: 'position 200 is outside the deck',
    });
    for (const s of t.players) {
      s.receive(elsewhere, NOW);
      s.receive(outside, NOW);
    }
    // Both stay held (rule (b) and the rebroadcast count them), and are rejected again on receipt.
    const held = t.spectator.heldSet().map((x) => x.id);
    expect(held).toEqual(expect.arrayContaining([elsewhere.id, outside.id]));
    expect(t.spectator.receive(elsewhere, NOW).status).toBe('rejected');
    // Seats 1 and 2 each hold a Shares event of their own that fails against the final deck: neither owes a deal
    // any more (never deal twice); seat 0 still does.
    expect(t.players.map((s) => s.duties())).toEqual([[{ kind: 'deal' }], [], []]);
    expect(() => t.players[1]?.buildDeal(base.game.rnd, NOW)).toThrow(/no deal duty/);
    // Seat 0 deals; the deal never completes without seats 1 and 2, which stay stalled.
    runAuto(t);
    expect(t.spectator.view().phase).toBe('deal');
    expect(t.spectator.waitingFor()).toEqual([1, 2]);
  });
});

describe('GameSessionV2 with a deck: play to the end (Chain Reaction)', () => {
  let game: V2Table;
  /** The seats' automatic events after each move, by move. */
  const autos: { move: NostrEvent; mover: number; auto: ReturnType<typeof runAuto> }[] = [];

  beforeAll(() => {
    game = replay(base);
    const rng = createRng('v2-deck-play');
    for (let i = 0; i < 400; i++) {
      const k = decider(game);
      if (k === null) break;
      const move = act(game, k, quick(game.players[k]?.legalActions() ?? [], k, rng));
      autos.push({ move, mover: k, auto: runAuto(game, ['release']) });
    }
  }, 600_000);

  it('V2-39 (partial) plays a 3-seat game to over with prompt releases; end attestations, then secrets, then the full audit passes', () => {
    const v = game.spectator.view();
    expect(v.result).toMatchObject({ kind: 'over', forfeit: [] });
    // Every draw was released at once by the other seats, never by the drawer.
    const releases = autos.flatMap((a) => a.auto.map((x) => ({ mover: a.mover, ...x })));
    expect(releases.length).toBeGreaterThan(10);
    for (const a of autos)
      for (const r of a.auto) {
        expect(r.duty.kind).toBe('release');
        expect(r.seat).not.toBe(a.mover);
        // Anchored on the head when built: the move that granted the positions.
        expect(anchorOf(r.ev)).toBe(a.move.id);
      }
    // Over: the result first, the audit pending until every secret is in.
    expect(v.phase).toBe('end');
    expect(v.outcome).toBeNull();
    expect(v.audit).toBe('pending');
    expect(game.players.map((s) => s.duties())).toEqual([
      [{ kind: 'end' }],
      [{ kind: 'end' }],
      [{ kind: 'end' }],
    ]);
    runAuto(game, ['end']);
    expect(game.spectator.view().endAttested).toEqual([0, 1, 2]);
    expect(game.players.map((s) => s.duties())).toEqual([
      [{ kind: 'secret' }],
      [{ kind: 'secret' }],
      [{ kind: 'secret' }],
    ]);
    expect(game.spectator.waitingFor()).toEqual([0, 1, 2]);
    // Two secrets in: still end, waiting for the third.
    const secrets = [0, 1, 2].map((k) => (game.players[k] as GameSessionV2).buildSecret(game.game.rnd, NOW));
    for (const ev of secrets) expect(protoTags(ev)).toEqual([['proto', '2']]);
    expect(send(game, secrets[0] as NostrEvent)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    expect(send(game, secrets[2] as NostrEvent)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    expect(game.spectator.view()).toMatchObject({ phase: 'end', audit: 'pending' });
    expect(game.spectator.waitingFor()).toEqual([1]);
    send(game, secrets[1] as NostrEvent);
    const done = game.spectator.view();
    expect(done).toMatchObject({ phase: 'done', audit: 'pass', forfeits: [] });
    const declared = chainReaction.outcome(done.state as ChainReactionState);
    expect(done.outcome).toEqual(declared);
    for (const s of game.players) expect(canonicalJson(s.view().outcome)).toBe(canonicalJson(declared));
    expect(game.players.map((s) => s.duties())).toEqual([
      [{ kind: 'attest' }],
      [{ kind: 'attest' }],
      [{ kind: 'attest' }],
    ]);
    expect(game.spectator.waitingFor()).toEqual([]);
  });

  it('V2-39 (partial) applies a failed full audit with a deck to places and scores, never to the result', () => {
    // A registry whose full-mode engine rejects seat 1's first placement: the replay fails seat 1, which moves to
    // the last place. The view-mode game is unchanged, so the same events fold to the same result.
    const strict: AnyModule = {
      ...chainReaction,
      apply: (s: ChainReactionState, a: unknown) => {
        const x = a as { type?: string; actor?: number };
        if (s.mode === 'full' && x.type === 'place' && x.actor === 1)
          return { ok: false, error: { code: 'audit', message: 'test: refused in full mode' } };
        return chainReaction.apply(s, a as never);
      },
    };
    const registry = new Map([...MODULES, [chainReaction.id, strict]]);
    const s = v2Session(game.game, null, registry);
    trustSteps([s], shuffled);
    for (const ev of game.log) s.receive(ev, NOW);
    // Every seat's secret (this test does not rely on the one before it having sent them).
    for (const id of game.game.ids)
      s.receive(
        finalizeEvent(
          secretTemplate({ rootId: game.game.rootId, deckSecret: id.deckSecret }, NOW, '2'),
          id.sessionSk,
          game.game.rnd,
        ),
        NOW,
      );
    const v = s.view();
    expect(v.phase).toBe('done');
    const reference = game.spectator.view();
    expect(v.result).toEqual(reference.result);
    expect(v.audit).toMatchObject({ fail: [1] });
    expect(v.forfeits).toEqual([1]);
    expect(v.outcome?.reason).toBe('forfeit');
    expect(v.outcome?.places[1]).toBe(3);
    expect(v.outcome?.scores).toEqual(reference.outcome?.scores);
  });

  it('reaches the same views and duties from the same events in other arrival orders, with duplicates', () => {
    // The deal and the first 24 moves with their releases, shuffled, some delivered twice.
    const cut = game.log.indexOf((autos[24] as { move: NostrEvent }).move);
    const prefix = game.log.slice(0, cut);
    const reference = replay(base, prefix);
    const want = canonicalJson({
      views: reference.all.map((s) => s.view()),
      duties: reference.players.map((s) => s.duties()),
      waiting: reference.spectator.waitingFor(),
    });
    for (const seed of ['order-a', 'order-b']) {
      const rng = createRng(seed);
      const order = prefix.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [order[i], order[j]] = [order[j] as number, order[i] as number];
      }
      for (let d = 0; d < 6; d++) order.splice(rng.int(order.length + 1), 0, rng.int(prefix.length));
      const t = replay(base, prefix, order);
      expect(
        canonicalJson({
          views: t.all.map((s) => s.view()),
          duties: t.players.map((s) => s.duties()),
          waiting: t.spectator.waitingFor(),
        }),
      ).toBe(want);
    }
  });
});
