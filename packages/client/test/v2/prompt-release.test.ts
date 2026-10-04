import { readFileSync } from 'node:fs';
import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { createRng, type Outcome } from '@bored-games/game-kit';
import { DECK_OFFSETS, type LusterState, luster } from '@bored-games/luster';
import {
  finalizeEvent,
  getPublicKey,
  moveTemplate,
  type NostrEvent,
  type ParsedMove,
  parseMove,
  parseSharesV2,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Checkpoint,
  type PromptReleaseVectors,
  promptReleaseFile,
} from '../../scripts/prompt-release-v2.ts';
import type { Duty, Identity } from '../../src/types.ts';
import { GameSessionV2 } from '../../src/v2/session.ts';
import { MODULES, NOW, ROOT_SEEN } from '../helpers.ts';
import {
  type AnyModule,
  act,
  decider,
  replay,
  runAuto,
  send,
  shuffleAll,
  trustSteps,
  type V2Table,
  v2Table,
} from './helpers-v2.ts';

/*
 * Prompt release (PROTOCOL-v2 §6.1, build plan T8): the `release` duty and `buildRelease`, under conditions 1–4,
 * with the positions dealt to another seat or to nobody that the seat has not shared yet, anchored on the head; the
 * slow path beside it; vector 6 for Chain Reaction (§12.2 item 6); and Luster's refill and blind reservation at
 * session level, where `DeckSpec.promptShares` plays no part.
 */

const FILE = new URL('../vectors/prompt-release-v2.json', import.meta.url);
const anchorOf = (ev: NostrEvent): string | undefined =>
  ev.tags.find((t) => t[0] === 'e' && t[3] === 'anchor')?.[1];
const positionsOf = (ev: NostrEvent): number[] =>
  (JSON.parse(ev.content) as { shares: { pos: number }[] }).shares.map((s) => s.pos);
const crOf = (s: GameSessionV2 | undefined): ChainReactionState =>
  (s as GameSessionV2).view().state as ChainReactionState;
const releaseOf = (duties: readonly Duty[]): Extract<Duty, { kind: 'release' }> | undefined =>
  duties.find((d): d is Extract<Duty, { kind: 'release' }> => d.kind === 'release');

describe('vector 6: prompt release in Chain Reaction (PROTOCOL-v2 §12.2 item 6)', () => {
  const file = readFileSync(FILE, 'utf8');
  const vectors = JSON.parse(file) as { checkpoints: Checkpoint[]; seats: number };
  const at = (label: Checkpoint['label']): Checkpoint =>
    vectors.checkpoints.find((c) => c.label === label) as Checkpoint;

  it('regenerates test/vectors/prompt-release-v2.json byte for byte', () => {
    expect(promptReleaseFile()).toBe(file);
  }, 120_000);

  it("folds the file's own signed events from the root, every shuffle proof verified, and owes exactly what each checkpoint lists (review of T8, L4)", () => {
    const v = JSON.parse(file) as PromptReleaseVectors;
    const ids: Identity[] = v.identities.map((x) => ({
      seat: x.seat,
      sessionSk: Uint8Array.from(Buffer.from(x.sessionSk, 'hex')),
      deckSecret: BigInt(`0x${x.deckSecret}`),
    }));
    const make = (me: Identity | null): GameSessionV2 =>
      GameSessionV2.create({
        modules: MODULES,
        table: v.table,
        joins: v.joins,
        root: v.root,
        me,
        rootSeenAt: ROOT_SEEN,
      });
    // The verifier checks every proof; the seats trust the steps it accepted (shuffle proofs are slow to check).
    const verifier = make(null);
    const seats = ids.map(make);
    let i = 0;
    for (const c of v.checkpoints) {
      for (; i < c.delivered; i++) {
        const ev = v.events[i] as NostrEvent;
        expect(verifier.receive(ev, NOW), `event ${i}`).toEqual({ status: 'accepted' });
        if ((JSON.parse(ev.content) as { type?: string }).type === 'shuffle') trustSteps(seats, [ev]);
        for (const s of seats) expect(s.receive(ev, NOW).status).toBe('accepted');
      }
      expect(verifier.view().head).toEqual(c.head);
      expect(seats.map((s) => s.duties())).toEqual(c.seats.map((x) => x.duty));
      for (const x of c.seats) {
        if (x.signed === null) continue;
        const parsed = parseSharesV2(x.signed);
        expect({ anchor: parsed.anchorId, positions: parsed.shares.map((y) => y.pos) }).toEqual(x.event);
      }
    }
    expect(i).toBe(v.events.length);
    // Every built Shares event verifies against the final deck: the deals were delivered, the draw's releases are not
    // in `events`, and the verifier accepts them now.
    for (const x of at('draw').seats)
      if (x.signed !== null) expect(verifier.receive(x.signed, NOW)).toEqual({ status: 'accepted' });
  }, 120_000);

  it('V2-26 never releases a position dealt to its own seat, nor an undealt one: the deal and a draw', () => {
    const deal = at('deal');
    for (const s of deal.seats) {
      const want = deal.dealt
        .filter((d) => d.to !== s.seat)
        .map((d) => d.pos)
        .sort((a, b) => a - b);
      expect(s.duty).toEqual([{ kind: 'deal' }]);
      expect(s.event?.positions).toEqual(want);
    }
    const draw = at('draw');
    expect(draw.dealt).toHaveLength(1);
    const drawn = draw.dealt[0] as { pos: number; to: number };
    // The drawer releases nothing (its own position); every other seat releases exactly the drawn position.
    for (const s of draw.seats) {
      if (s.seat === drawn.to) {
        expect(s.duty.some((d) => d.kind === 'release')).toBe(false);
        expect(s.event).toBeNull();
      } else {
        expect(releaseOf(s.duty)?.positions).toEqual([drawn.pos]);
        expect(s.event?.positions).toEqual([drawn.pos]);
      }
    }
    // An undealt position is never released: every released position is in `dealt` at the head.
    const dealtSoFar = new Set([...deal.dealt, ...draw.dealt].map((d) => d.pos));
    for (const c of [deal, draw])
      for (const s of c.seats)
        for (const pos of s.event?.positions ?? []) expect(dealtSoFar.has(pos)).toBe(true);
  });

  it('V2-27 (partial) anchors the deal on the last shuffle step and every release on the head it was built on', () => {
    for (const label of ['deal', 'draw'] as const) {
      const c = at(label);
      for (const s of c.seats) {
        if (s.event === null) continue;
        expect(s.event.anchor).toBe(c.head.id);
        const r = releaseOf(s.duty);
        if (r !== undefined) expect(r.anchor).toBe(c.head.id);
      }
    }
    expect(at('deal').head.seq).toBe(vectors.seats);
  });

  it('V2-25 (partial) releases nothing while a fork is held, the owed release included', () => {
    const fork = at('fork');
    expect(fork.fork).not.toBeNull();
    expect(fork.head).toEqual(at('draw').head);
    for (const s of fork.seats) expect(s.duty).toEqual([]);
  });
});

/** Chain Reaction over as soon as two tiles beyond the setup ones are placed and the next turn starts. */
const shortGame: AnyModule = {
  ...chainReaction,
  pending: (s: ChainReactionState) => (shortOver(s) ? { type: 'over' } : chainReaction.pending(s)),
  legalActions: (s: ChainReactionState, seat: number) =>
    shortOver(s) ? [] : chainReaction.legalActions(s, seat),
  outcome: (s: ChainReactionState): Outcome | null => {
    if (!shortOver(s)) return chainReaction.outcome(s);
    const scores = chainReaction.standings(s);
    return {
      places: scores.map((x) => 1 + scores.filter((y) => y > x).length),
      scores,
      reason: 'declared',
    };
  },
};
function shortOver(s: ChainReactionState): boolean {
  return s.phase.kind === 'place' && s.board.filter((c) => c !== null).length >= s.seats + 2;
}

describe('the release duty in Chain Reaction (3 seats)', () => {
  let base: V2Table;
  beforeAll(() => {
    base = v2Table(chainReaction, 3, 'v2-release');
    shuffleAll(base);
    runAuto(base);
  }, 120_000);

  /** From `t`, play `policy` moves until one deals a tile to its actor; returns that move, its actor and position. */
  function playToDraw(t: V2Table, seed: string): { move: NostrEvent; actor: number; pos: number } {
    const rng = createRng(seed);
    for (let i = 0; i < 100; i++) {
      const k = decider(t) as number;
      const before = chainReaction.dealt(t.spectator.view().state as ChainReactionState).length;
      const move = act(t, k, rng.pick(t.players[k]?.legalActions() ?? []));
      const after = chainReaction.dealt(t.spectator.view().state as ChainReactionState);
      if (after.length > before)
        return { move, actor: k, pos: (after[after.length - 1] as { pos: number }).pos };
    }
    throw new Error('no draw');
  }

  it('V2-25 (partial) publishes no card Shares event before the final deck is complete: no deal or release duty during the shuffle', () => {
    const t = replay(base, base.log.slice(0, 2));
    expect(t.spectator.view().phase).toBe('shuffle');
    expect(t.players.map((s) => s.duties())).toEqual([[], [], [{ kind: 'shuffle' }]]);
    for (const s of t.players) {
      expect(() => s.buildRelease(base.game.rnd, NOW)).toThrow(/no release duty/);
      expect(() => s.buildDeal(base.game.rnd, NOW)).toThrow(/no deal duty/);
    }
  });

  it('V2-29 (partial) owes one release of every granted position as soon as it links the granting move, before its own decision', () => {
    const t = replay(base);
    const draw = playToDraw(t, 'v2-29');
    for (const [seat, s] of t.players.entries()) {
      const r = releaseOf(s.duties());
      if (seat === draw.actor) {
        expect(r).toBeUndefined();
        continue;
      }
      expect(r).toEqual({ kind: 'release', positions: [draw.pos], anchor: draw.move.id });
      // The release comes first; the next seat's decision may follow in the same list.
      expect(s.duties()[0]).toEqual(r);
      const ev = s.buildRelease(base.game.rnd, NOW);
      expect(positionsOf(ev)).toEqual([draw.pos]);
      expect(anchorOf(ev)).toBe(draw.move.id);
    }
    // Once both releases are in, the drawer learns its tile, and nobody owes a release.
    runAuto(t, ['release']);
    const hand = crOf(t.players[draw.actor]).players[draw.actor]?.hand ?? [];
    expect(hand.find((h) => h.pos === draw.pos)?.tile).not.toBeNull();
    for (const s of t.players) expect(releaseOf(s.duties())).toBeUndefined();
    // Another seat's view does not learn it.
    const other = (draw.actor + 1) % 3;
    const theirs = crOf(t.players[other]).players[draw.actor]?.hand ?? [];
    expect(theirs.find((h) => h.pos === draw.pos)?.tile).toBeNull();
  });

  it("V2-28 still attaches every owed share to the seat's own game action (the slow path); a move without it is valid-looking but waits", () => {
    const t = replay(base);
    const draw = playToDraw(t, 'v2-28');
    const next = decider(t) as number;
    const late = [0, 1, 2].find((k) => k !== draw.actor && k !== next) as number;
    // Only the seat that is not next releases; the next seat's app releases nothing early.
    send(t, (t.players[late] as GameSessionV2).buildRelease(base.game.rnd, NOW));
    const learned = (): boolean =>
      (crOf(t.players[draw.actor]).players[draw.actor]?.hand ?? []).find((h) => h.pos === draw.pos)?.tile !==
      null;
    expect(learned()).toBe(false);
    expect(t.spectator.view().owed.reveal).toEqual([]);
    // The next seat's move carries its owed share of the drawn position.
    const s = t.players[next] as GameSessionV2;
    const legal = s.legalActions();
    const full = s.buildAction(legal[0], base.game.rnd, NOW);
    const parsed = parseMove(full, 108, '2') as ParsedMove;
    const c = parsed.content as Extract<ParsedMove['content'], { type: 'action' }>;
    expect(c.shares.map((x) => x.pos)).toEqual([draw.pos]);
    // The same move without that share: valid-looking (no fork, nothing rejected) but not valid, so it waits.
    const bare = finalizeEvent(
      moveTemplate(
        { rootId: base.game.rootId, prevId: parsed.prevId, seq: parsed.seq, content: { ...c, shares: [] } },
        NOW,
        '2',
      ),
      (base.game.ids[next] as Identity).sessionSk,
      base.game.rnd,
    );
    expect(send(t, bare)).toEqual(['stored', 'stored', 'stored', 'stored']);
    expect(t.spectator.view()).toMatchObject({ head: { id: draw.move.id }, fork: null });
    // Its seat's share arrives in a prompt release: the bare move links, and the drawer learns its tile.
    send(t, s.buildRelease(base.game.rnd, NOW));
    expect(t.spectator.view().head.id).toBe(bare.id);
    expect(learned()).toBe(true);
    // The other path: a fresh copy where the full move (with the share) links at once.
    const u = replay(base, t.log.slice(0, t.log.indexOf(bare)));
    expect(send(u, full)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
  });

  it('V2-25 (partial) releases nothing once it has a result, though positions are still owed', () => {
    const registry = new Map([...MODULES, [chainReaction.id, shortGame]]);
    const t = v2Table(shortGame, 3, 'v2-release-over', chainReaction.defaultRules(), registry);
    shuffleAll(t);
    runAuto(t);
    const rng = createRng('v2-release-over');
    for (let i = 0; i < 60 && t.spectator.view().result === null; i++) {
      const k = decider(t) as number;
      act(t, k, rng.pick(t.players[k]?.legalActions() ?? []));
      runAuto(t, ['release']);
    }
    const v = t.spectator.view();
    expect(v.result).toMatchObject({ kind: 'over' });
    // The last draw is still unreleased by the other seats, but the game is over: no release, only the end.
    const state = v.state as ChainReactionState;
    const lastDraw = state.deck.dealt[state.deck.dealt.length - 1] as { pos: number; to: number };
    expect(lastDraw.to).not.toBeNull();
    for (const [seat, s] of t.players.entries()) {
      expect(s.duties()).toEqual([{ kind: 'end' }]);
      expect(() => s.buildRelease(t.game.rnd, NOW)).toThrow(/no release duty/);
      if (seat !== lastDraw.to) expect(t.players[seat]?.view().phase).toBe('end');
    }
  });
});

describe('Luster under protocol 2: refills and blind reservations (2 seats)', () => {
  const registry = new Map([...MODULES, [luster.id, luster as AnyModule]]);
  let t: V2Table;
  beforeAll(() => {
    t = v2Table(luster as AnyModule, 2, 'v2-luster', luster.defaultRules(), registry);
    shuffleAll(t);
    runAuto(t);
  }, 300_000);

  const lusterState = (s: GameSessionV2): LusterState => s.view().state as LusterState;
  const physical = (deck: string, pos: number): number =>
    DECK_OFFSETS[deck as keyof typeof DECK_OFFSETS] + pos;

  it('shuffles 4 groups per seat (8 steps, partitioned by seat and group), deals, and plays; promptShares plays no part', () => {
    expect(t.spectator.deckSteps()).toHaveLength(8);
    // Step s is signed by seat floor(s / 4): seat 0 shuffles its four groups, then seat 1.
    const signers = t.log
      .slice(0, 8)
      .map((ev) => t.game.ids.findIndex((id) => getPublicKey(id.sessionSk) === ev.pubkey));
    expect(signers).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(t.spectator.view().phase).toBe('play');
    // `DeckSpec.promptShares` is true for Luster, but a v2 session never owes v1's `share` duty.
    expect(luster.decks(luster.defaultRules())[0]?.promptShares).toBe(true);
    for (const s of t.players) expect(s.duties().some((d) => d.kind === 'share')).toBe(false);
  });

  it('a refill after a reserve from the display: every seat releases the new public position, the reveal is derived, moves wait meanwhile', () => {
    const k = decider(t) as number;
    const s = t.players[k] as GameSessionV2;
    const state = lusterState(s);
    const onDisplay = new Set(
      luster
        .dealt(state)
        .filter((d) => d.to === null)
        .map((d) => d.pos),
    );
    const reserve = (s.legalActions() as { type: string; deck: string; pos: number }[]).find(
      (a) => a.type === 'reserve' && a.deck === 'tier-1' && onDisplay.has(physical(a.deck, a.pos)),
    );
    expect(reserve).toBeDefined();
    const move = act(t, k, reserve);
    const pending = t.spectator.view().pending;
    expect(pending.type).toBe('reveal');
    const refill = (pending as unknown as { positions: number[] }).positions;
    expect(refill).toHaveLength(1);
    // Both seats owe a share of the refill, the actor included; nobody can move meanwhile.
    expect(t.spectator.view().owed.reveal).toEqual([0, 1]);
    expect(t.spectator.waitingFor()).toEqual([0, 1]);
    for (const p of t.players) {
      expect(releaseOf(p.duties())).toEqual({ kind: 'release', positions: refill, anchor: move.id });
      expect(p.duties().some((d) => d.kind === 'decide')).toBe(false);
    }
    const released = runAuto(t, ['release']);
    expect(released.map((r) => r.seat).sort()).toEqual([0, 1]);
    const after = t.spectator.view();
    expect(after.pending.type).toBe('player');
    expect(after.owed.reveal).toEqual([]);
    // The refilled card is public now: the same card in every view.
    const card = (v: GameSessionV2): unknown =>
      lusterState(v)
        .market.flat()
        .find((h) => h !== null && physical(h.deck, h.pos) === refill[0])?.card;
    expect(card(t.spectator)).not.toBeNull();
    expect(card(t.spectator)).not.toBeUndefined();
    for (const p of t.players) expect(card(p)).toBe(card(t.spectator));
  });

  it('a blind reservation: only the other seat releases, the owner never releases its own layer, and only the owner learns the card', () => {
    const k = decider(t) as number;
    const s = t.players[k] as GameSessionV2;
    const next = lusterState(s).decks['tier-2'].next;
    const blind = (s.legalActions() as { type: string; deck: string; pos: number }[]).find(
      (a) => a.type === 'reserve' && a.deck === 'tier-2' && a.pos === next,
    );
    expect(blind).toBeDefined();
    const move = act(t, k, blind);
    const pos = physical('tier-2', next);
    const other = 1 - k;
    expect(releaseOf(t.players[k]?.duties() ?? [])).toBeUndefined();
    expect(releaseOf(t.players[other]?.duties() ?? [])).toEqual({
      kind: 'release',
      positions: [pos],
      anchor: move.id,
    });
    const released = runAuto(t, ['release']);
    expect(released.map((r) => r.seat)).toEqual([other]);
    expect(positionsOf((released[0] as { ev: NostrEvent }).ev)).toEqual([pos]);
    const slot = (v: GameSessionV2) =>
      lusterState(v).players[k]?.reserved.find((h) => h.deck === 'tier-2' && h.pos === next);
    expect(slot(t.players[k] as GameSessionV2)?.card).not.toBeNull();
    expect(slot(t.players[other] as GameSessionV2)?.card ?? null).toBeNull();
    expect(slot(t.spectator)?.card ?? null).toBeNull();
    // Nothing is owed any more: the owner's layer of its own card is never released.
    for (const p of t.players) expect(releaseOf(p.duties())).toBeUndefined();
  });
});
