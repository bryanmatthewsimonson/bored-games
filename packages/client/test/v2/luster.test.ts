import { readFileSync } from 'node:fs';
import { type Ciphertext, makeShare } from '@bored-games/deck';
import { createRng } from '@bored-games/game-kit';
import { DECK_OFFSETS, type LusterState, luster } from '@bored-games/luster';
import {
  cardSharesTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  type NostrEvent,
  parseSharesV2,
  resignTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameSession } from '../../src/session.ts';
import { openSession } from '../../src/session-api.ts';
import type { Duty, Identity } from '../../src/types.ts';
import { gameRecord } from '../../src/v2/record.ts';
import type { GameSessionV2 } from '../../src/v2/session.ts';
import { GOLDEN_MODULES, type GoldenFixture, goldenSession, identityOf } from '../golden-v1/fold.ts';
import { MODULES, NOW } from '../helpers.ts';
import {
  type AnyModule,
  act,
  actionAt,
  buildAuto,
  decider,
  inOrders,
  quick,
  replay,
  runAuto,
  send,
  shuffleAll,
  type V2Table,
  v2Session,
  v2Table,
} from './helpers-v2.ts';

/*
 * Luster under protocol 2 (build plan T18; PROTOCOL-v2 §6.3): its refills and blind reservations are prompt releases
 * (§6.1), and the Luster audit's findings are closed by the generic v2 session: F1 (a lone equivocator reads a blind
 * reservation from the automatic shares and signs a rival: the fork stops the game on it, and nothing is played or
 * released on either side), F2 (two devices of an honest seat: the outbox rule discards the stale device's move, and
 * a seat never releases its own card) and F3 (a stale saved release is never sent once its position could be the
 * seat's own). An owed reveal keeps its timeout (D060); Resign stays refused (D052). A v1 Luster game in progress
 * still folds under v1 (§2). Vector 6's Luster cases are in prompt-release.test.ts.
 */

const REGISTRY = new Map([...MODULES, [luster.id, luster as AnyModule]]);
type Action = { type: string; actor: number; deck?: string; pos?: number; card?: number };
type Tier = 'tier-1' | 'tier-2' | 'tier-3';

const stateOf = (s: GameSessionV2): LusterState => s.view().state as LusterState;
const physical = (deck: string, pos: number): number => DECK_OFFSETS[deck as keyof typeof DECK_OFFSETS] + pos;
const legalOf = (s: GameSessionV2): Action[] => s.legalActions() as Action[];
/** The blind reservation of the top of `tier` (an unseen card, dealt to the actor). */
const blindOf = (s: GameSessionV2, tier: Tier): Action | undefined =>
  legalOf(s).find((a) => a.type === 'reserve' && a.deck === tier && a.pos === stateOf(s).decks[tier].next);
/** A reservation of a face-up card of `tier` (the market refills from the top of the tier: a public reveal). */
const displayOf = (s: GameSessionV2, tier: Tier): Action | undefined =>
  legalOf(s).find((a) => a.type === 'reserve' && a.deck === tier && a.pos !== stateOf(s).decks[tier].next);
const takeOf = (s: GameSessionV2): Action | undefined => legalOf(s).find((a) => a.type === 'take');
const releaseOf = (duties: readonly Duty[]): Extract<Duty, { kind: 'release' }> | undefined =>
  duties.find((d): d is Extract<Duty, { kind: 'release' }> => d.kind === 'release');
const positionsOf = (ev: NostrEvent): number[] => parseSharesV2(ev).shares.map((s) => s.pos);
const isShares = (ev: NostrEvent): boolean => ev.kind === 7453;
/** The card of a player's reserved slot at `deck`/`pos` in `s`'s view (null: hidden; undefined: not reserved). */
const reservedCard = (s: GameSessionV2, seat: number, deck: string, pos: number): number | null | undefined =>
  stateOf(s).players[seat]?.reserved.find((h) => h.deck === deck && h.pos === pos)?.card;
/** The pubkey of each seat's session key. */
const keyOf = (t: V2Table, seat: number): Hex => getPublicKey((t.game.ids[seat] as Identity).sessionSk);

/** The seats in turn order after `k` (3 seats). */
const after = (k: number): [number, number] => [(k + 1) % 3, (k + 2) % 3];

describe('Luster under protocol 2, 3 seats (T18)', () => {
  let base: V2Table;
  beforeAll(() => {
    base = v2Table(luster as AnyModule, 3, 'v2-luster-t18', luster.defaultRules(), REGISTRY);
    shuffleAll(base);
    runAuto(base);
  }, 600_000);

  it('a refill and a blind reservation: every seat releases the refill, the others release the blind card, and only its owner learns it', () => {
    const t = replay(base);
    expect(t.spectator.deckSteps()).toHaveLength(12);
    // A reservation from the display: the market refills from the top of tier 1, a public reveal every seat owes.
    const k = decider(t) as number;
    const s = t.players[k] as GameSessionV2;
    const display = displayOf(s, 'tier-1');
    const p = physical('tier-1', stateOf(s).decks['tier-1'].next);
    const move = act(t, k, display);
    expect(t.spectator.view().pending).toMatchObject({ type: 'reveal', positions: [p] });
    expect(t.spectator.view().owed.reveal).toEqual([0, 1, 2]);
    for (const x of t.players) {
      expect(x.duties()).toEqual([{ kind: 'release', positions: [p], anchor: move.id }]);
      expect(x.canResign()).toBe(false);
    }
    const refills = runAuto(t, ['release']);
    expect(refills.map((r) => r.seat).sort()).toEqual([0, 1, 2]);
    for (const r of refills) expect(positionsOf(r.ev)).toEqual([p]);
    expect(t.spectator.view().owed.reveal).toEqual([]);
    const shown = (x: GameSessionV2): unknown =>
      stateOf(x)
        .market.flat()
        .find((h) => h !== null && physical(h.deck, h.pos) === p)?.card;
    expect(typeof shown(t.spectator)).toBe('number');
    for (const x of t.players) expect(shown(x)).toBe(shown(t.spectator));

    // A blind reservation of the top of tier 2 by the next seat: the two others release it, never its owner.
    const j = decider(t) as number;
    const sj = t.players[j] as GameSessionV2;
    const next = stateOf(sj).decks['tier-2'].next;
    const q = physical('tier-2', next);
    const blind = act(t, j, blindOf(sj, 'tier-2'));
    for (const [seat, x] of t.players.entries())
      expect(releaseOf(x.duties())).toEqual(
        seat === j ? undefined : { kind: 'release', positions: [q], anchor: blind.id },
      );
    const released = runAuto(t, ['release']);
    expect(released.map((r) => r.seat).sort()).toEqual(after(j).sort());
    expect(reservedCard(sj, j, 'tier-2', next)).toEqual(expect.any(Number));
    for (const x of [...t.players.filter((_, seat) => seat !== j), t.spectator])
      expect(reservedCard(x, j, 'tier-2', next)).toBeNull();
    // Nothing of the owner's card is ever released by its owner: no Shares event of seat j holds q.
    for (const ev of t.log.filter(isShares))
      if (ev.pubkey === keyOf(t, j)) expect(positionsOf(ev)).not.toContain(q);
  });

  it('audit F1: E reserves blind, reads the card from the automatic releases and signs a rival take: the game stops on E, with E last, and nothing more is released or played', () => {
    const t = replay(base);
    const e = decider(t) as number;
    const [n, m] = after(e);
    const se = t.players[e] as GameSessionV2;
    const h = se.view().head;
    const take = takeOf(se);
    const top = stateOf(se).decks['tier-1'].next;
    const p = physical('tier-1', top);
    // A: the blind reservation. Every honest client releases its share of p for E at once, and E reads the card.
    const a = act(t, e, blindOf(se, 'tier-1'));
    const released = runAuto(t, ['release']);
    expect(released.map((r) => r.seat).sort()).toEqual([n, m].sort());
    expect(reservedCard(se, e, 'tier-1', top)).toEqual(expect.any(Number));
    // B: a rival on the same prev, signed by E's own tooling.
    const b = actionAt(t, e, h.id, h.seq + 1, take);
    expect(new Set(send(t, b))).toEqual(new Set(['accepted']));
    for (const x of t.all) {
      const v = x.view();
      expect(v.fork).toEqual({ at: h.id, seat: e, certificate: [a.id, b.id].sort() });
      expect(v.stop).toEqual({ at: h.id, seat: e, cancelled: false });
      expect(v.equivocators).toEqual([e]);
      expect(v.owed.reveal).toEqual([]);
      expect(x.waitingFor()).toEqual([]);
      expect(x.legalActions()).toEqual([]);
      // 3 seats: E last and rated; the others unrated, by `standings` at P.
      expect(v.outcome?.places[e]).toBe(3);
      expect((gameRecord(v)?.rated ?? []).map((r, k) => (r ? k : -1)).filter((k) => k >= 0)).toEqual([e]);
    }
    // Stopped: no seat owes a release, a decision or a roll; only the after-stop Secret reveal (§7.3).
    for (const x of t.players) {
      expect(x.duties()).toEqual([{ kind: 'secret' }]);
      expect(() => x.buildRelease(t.game.rnd, NOW)).toThrow(/no release duty/);
      expect(() => x.buildAction(take, t.game.rnd, NOW)).toThrow();
      expect(x.canResign()).toBe(false);
      expect(x.timeoutTarget(NOW + 10 * 86400)).toBeNull();
    }
    // N, the next seat, cannot play on either side; a move it signed anyway (on B, a blind reservation of the card E
    // read) changes nothing and nobody releases a share of it.
    const sn = v2Session(t.game, n, REGISTRY);
    for (const ev of t.log.filter((x) => x.id !== a.id)) sn.receive(ev, NOW);
    expect(sn.view().fork).toBeNull();
    const onB = sn.buildAction(blindOf(sn, 'tier-1'), t.game.rnd, NOW);
    send(t, onB);
    for (const x of t.all) expect(x.view().stop).toEqual({ at: h.id, seat: e, cancelled: false });
    for (const x of t.players) expect(releaseOf(x.duties())).toBeUndefined();
    // No share of p went out after the fork, though p is N's card on B: the only ones are those released on A, for E
    // (N's included: p was E's card there, and E's reading it is what the stop makes worthless).
    const sharesOfP = t.log.filter((ev) => isShares(ev) && positionsOf(ev).includes(p));
    expect(sharesOfP.map((ev) => ev.id).sort()).toEqual(released.map((r) => r.ev.id).sort());
  });

  it('audit F1 in split arrival orders: N sees the rival first and plays on it, M releases on the blind side first; every client stops on E, and N’s card on the rival side is never released', () => {
    const t = replay(base);
    const e = decider(t) as number;
    const [n, m] = after(e);
    const se = t.players[e] as GameSessionV2;
    const h = se.view().head;
    const take = takeOf(se);
    const top = stateOf(se).decks['tier-1'].next;
    const p = physical('tier-1', top);
    const a = se.buildAction(blindOf(se, 'tier-1'), t.game.rnd, NOW);
    const b = actionAt(t, e, h.id, h.seq + 1, take);
    const [pn, pm] = [t.players[n] as GameSessionV2, t.players[m] as GameSessionV2];
    const events: NostrEvent[] = [a, b];
    // M holds A only: it releases p for E (an honest prompt release).
    pm.receive(a, NOW);
    const mRelease = pm.buildRelease(t.game.rnd, NOW);
    expect(positionsOf(mRelease)).toEqual([p]);
    events.push(mRelease);
    // N holds B only (and M's release, which waits for nothing): it is N's turn on B, and N reserves the top of tier 1
    // blind, the very card E read on A.
    pn.receive(b, NOW);
    pn.receive(mRelease, NOW);
    expect(pn.view().fork).toBeNull();
    expect(pn.duties()).toEqual([{ kind: 'decide' }]);
    const nBlind = pn.buildAction(blindOf(pn, 'tier-1'), t.game.rnd, NOW);
    pn.receive(nBlind, NOW);
    events.push(nBlind);
    // M receives N's move on B: it now holds the fork, and releases nothing for N.
    pm.receive(b, NOW);
    pm.receive(nBlind, NOW);
    expect(pm.view().fork).toMatchObject({ at: h.id, seat: e });
    expect(releaseOf(pm.duties())).toBeUndefined();
    expect(() => pm.buildRelease(t.game.rnd, NOW)).toThrow(/no release duty/);
    // N receives A: the fork; N never released p on either side.
    pn.receive(a, NOW);
    expect(pn.view().fork).toMatchObject({ at: h.id, seat: e });
    // Every client converges on the stop, whatever the order.
    const all = [...t.log, ...events];
    const reference = inOrders(t, all, 'luster-f1-split', 3);
    for (const x of reference.all) {
      expect(x.view().stop).toEqual({ at: h.id, seat: e, cancelled: false });
      expect(x.view().outcome?.places[e]).toBe(3);
    }
    for (const x of reference.players) expect(x.duties()).toEqual([{ kind: 'secret' }]);
    // The shares of p ever published: M's only. N's own layer of p (its card on B) never went out.
    expect(events.filter((ev) => isShares(ev) && positionsOf(ev).includes(p)).map((ev) => ev.pubkey)).toEqual(
      [keyOf(t, m)],
    );
  });

  it('audit F2: two devices of an honest seat, the phone reserves blind and the lagging tablet signs a take on the same prev: the outbox rule discards the tablet’s move, and neither device releases the seat’s own card', () => {
    const t = replay(base);
    const k = decider(t) as number;
    const phone = t.players[k] as GameSessionV2;
    const tablet = v2Session(t.game, k, REGISTRY);
    for (const ev of t.log) tablet.receive(ev, NOW);
    const top = stateOf(phone).decks['tier-1'].next;
    const p = physical('tier-1', top);
    // The tablet, behind, signs a take on the head; it is saved, not yet sent.
    const stale = tablet.buildAction(takeOf(tablet), t.game.rnd, NOW);
    tablet.receive(stale, NOW);
    // The phone reserves blind and publishes.
    const a = act(t, k, blindOf(phone, 'tier-1'));
    tablet.receive(a, NOW);
    // The tablet now holds a fork of its own seat that no other client has: the outbox rule discards its move.
    expect(tablet.vetSaved(stale, [stale.id])).toEqual({
      discard: expect.stringMatching(/another move of yours/),
    });
    // Rebuilt without it (the controller does so on a discard), the tablet follows the phone: no fork, and neither
    // device owes a release of p, its own card.
    const fresh = v2Session(t.game, k, REGISTRY);
    for (const ev of t.log) fresh.receive(ev, NOW);
    expect(fresh.view().fork).toBeNull();
    for (const x of [phone, fresh]) expect(releaseOf(x.duties())).toBeUndefined();
    const released = runAuto(t, ['release']);
    expect(released.map((r) => r.seat).sort()).toEqual(after(k).sort());
    for (const r of released) fresh.receive(r.ev, NOW);
    // Both devices read the card; nobody else does.
    expect(reservedCard(fresh, k, 'tier-1', top)).toEqual(reservedCard(phone, k, 'tier-1', top));
    expect(reservedCard(fresh, k, 'tier-1', top)).toEqual(expect.any(Number));
    expect(reservedCard(t.spectator, k, 'tier-1', top)).toBeNull();
    for (const ev of t.log.filter(isShares))
      if (ev.pubkey === keyOf(t, k)) expect(positionsOf(ev)).not.toContain(p);
    for (const x of t.all) expect(x.view().equivocators).toEqual([]);
  });

  it('audit F3: a release saved on a side that loses is never sent once its position is the seat’s own card, and a release holding an own card is discarded on the chain too', () => {
    const t = replay(base);
    const e = decider(t) as number;
    const [hs] = after(e);
    const se = t.players[e] as GameSessionV2;
    const h = se.view().head;
    const top = stateOf(se).decks['tier-1'].next;
    const p = physical('tier-1', top);
    // A: E reserves from the display, so the market refills from the top of tier 1 (p, public on A). B: E takes.
    const a = se.buildAction(displayOf(se, 'tier-1'), t.game.rnd, NOW);
    const b = actionAt(t, e, h.id, h.seq + 1, takeOf(se));
    // H's tablet holds A only and saves its release of p, which no relay confirms.
    const tablet = v2Session(t.game, hs, REGISTRY);
    for (const ev of [...t.log, a]) tablet.receive(ev, NOW);
    expect(releaseOf(tablet.duties())).toEqual({ kind: 'release', positions: [p], anchor: a.id });
    const saved = tablet.buildRelease(t.game.rnd, NOW);
    tablet.receive(saved, NOW);
    expect(tablet.vetSaved(saved, [saved.id])).toBe('send');
    // Everyone else holds B only. H's phone, next on B, reserves the top of tier 1 blind: p is H's own card there.
    send(t, b);
    const blind = act(t, hs, blindOf(t.players[hs] as GameSessionV2, 'tier-1'));
    const onB = runAuto(t, ['release']);
    expect(onB.map((r) => r.seat).sort()).toEqual([e, after(hs)[0]].sort());
    // The tablet syncs: B and the phone's move. It holds the fork, and the saved release is discarded, never sent.
    for (const ev of [b, blind, ...onB.map((r) => r.ev)]) tablet.receive(ev, NOW);
    expect(tablet.view().fork).toMatchObject({ at: h.id, seat: e });
    expect(tablet.vetSaved(saved, [saved.id])).toEqual({ discard: expect.any(String) });
    expect(tablet.duties()).toEqual([{ kind: 'secret' }]);
    // Rebuilt without the release (the controller drops a discarded event), the tablet holds no share of p by H.
    const fresh = v2Session(t.game, hs, REGISTRY);
    for (const ev of [...t.log, a]) fresh.receive(ev, NOW);
    expect(fresh.heldSet().filter((x) => x.seat === hs && x.at === a.id)).toEqual([]);

    // With no fork at all: a release of my own card, saved by a faulty build, is discarded at the head too.
    const u = replay(base);
    const k = decider(u) as number;
    const sk = u.players[k] as GameSessionV2;
    const own = physical('tier-1', stateOf(sk).decks['tier-1'].next);
    const mine = act(u, k, blindOf(sk, 'tier-1'));
    runAuto(u, ['release']);
    const forged = forgedRelease(u, k, mine.id, own);
    expect(sk.vetSaved(forged, [forged.id])).toEqual({ discard: expect.stringMatching(/your own card/) });
  });

  it('an owed reveal keeps its timeout (D060): a seat that never releases a refill is stalled though it is not its turn, and is timed out', () => {
    const t = replay(base);
    const k = decider(t) as number;
    // y decides next; x's app is closed.
    const [y, x] = after(k);
    const move = act(t, k, displayOf(t.players[k] as GameSessionV2, 'tier-1'));
    // k and y release; x does not.
    for (const seat of [k, y]) {
      const s = t.players[seat] as GameSessionV2;
      send(t, buildAuto(t, seat, releaseOf(s.duties()) as Duty));
    }
    const v = t.spectator.view();
    expect(v.pending.type).toBe('reveal');
    expect(v.owed.reveal).toEqual([x]);
    expect(t.spectator.waitingFor()).toEqual([x]);
    // Not x's turn (y decides once the refill is revealed), but the game waits on x.
    for (const seat of [k, y]) {
      const s = t.players[seat] as GameSessionV2;
      expect(s.duties()).toEqual([]);
      expect(s.timeoutTarget(NOW)).toBeNull();
      expect(s.timeoutTarget(NOW + 259200 + 1)).toBe(x);
    }
    const claimer = t.players[y] as GameSessionV2;
    const claim = claimer.buildTimeout(x, t.game.rnd, NOW + 259200 + 1);
    for (const s of t.all) s.receive(claim, NOW + 259200 + 1);
    for (const s of t.all) {
      s.tick(NOW + 259200 + 1);
      expect(s.view().result).toEqual({ kind: 'claim', head: move.id, forfeit: [x] });
      expect(s.view().outcome?.places[x]).toBe(3);
    }
  });

  it('a v2 Luster game plays to its end with blind reservations bought: every card revealed on time, the audit passes', () => {
    const t = replay(base);
    const rng = createRng('v2-luster-whole');
    let blinds = 0;
    for (let i = 0; i < 2000 && t.spectator.view().result === null; i++) {
      runAuto(t, ['release']);
      const k = decider(t);
      if (k === null) break;
      const s = t.players[k] as GameSessionV2;
      const legal = legalOf(s);
      // Prefer buying a reserved card, then a blind reservation now and then, else the sims' quick policy.
      const buyReserved = legal.find(
        (a) =>
          a.type === 'buy' &&
          stateOf(s).players[k]?.reserved.some((r) => r.deck === a.deck && r.pos === a.pos && r.private),
      );
      const blind =
        rng.int(4) === 0
          ? legal.find((a) => a.type === 'reserve' && a.pos === stateOf(s).decks[a.deck as Tier]?.next)
          : undefined;
      if (buyReserved !== undefined) blinds++;
      act(t, k, buyReserved ?? blind ?? quick(legal, k, rng));
    }
    runAuto(t);
    const v = t.spectator.view();
    expect(v.phase).toBe('done');
    expect(v.audit).toBe('pass');
    expect(blinds).toBeGreaterThan(0);
    // No seat ever released a card dealt to itself.
    const final = stateOf(t.spectator);
    for (const ev of t.log.filter(isShares)) {
      const seat = [0, 1, 2].find((k) => keyOf(t, k) === ev.pubkey) as number;
      for (const pos of positionsOf(ev))
        expect(luster.dealt(final).find((d) => d.pos === pos)?.to ?? null).not.toBe(seat);
    }
  }, 600_000);
});

/**
 * A card Shares event by `seat` holding its own share of `pos`, anchored on `anchor`, built by hand (a faulty or stale
 * build: the session never offers one): the share verifies against the final deck.
 */
function forgedRelease(t: V2Table, seat: number, anchor: Hex, pos: number): NostrEvent {
  const s = t.players[seat] as GameSessionV2;
  const final = (s as unknown as { finalDeck(): { deck: readonly Ciphertext[] } }).finalDeck();
  const id = t.game.ids[seat] as Identity;
  const share = makeShare(
    id.deckSecret,
    final.deck[pos] as Ciphertext,
    { rootId: t.game.rootId, deckId: luster.decks(luster.defaultRules())[0]?.id as string, pos },
    t.game.rnd,
  );
  return finalizeEvent(
    cardSharesTemplate({ rootId: t.game.rootId, anchorId: anchor, shares: [{ pos, share }] }, NOW),
    id.sessionSk,
    t.game.rnd,
  );
}

describe('Resign stays refused for Luster under protocol 2 (D052)', () => {
  it('at every seat count, no seat may resign, no Resign can be built, and a Resign signed anyway is rejected', () => {
    const { min, max } = luster.seatRange(luster.defaultRules());
    for (let seats = min; seats <= max; seats++) {
      const t = v2Table(
        luster as AnyModule,
        seats,
        `v2-luster-resign-${seats}`,
        luster.defaultRules(),
        REGISTRY,
      );
      for (const s of t.players) {
        expect(s.canResign()).toBe(false);
        expect(() => s.buildResign(t.game.rnd, NOW)).toThrow(/not allowed/);
      }
      const id = t.game.ids[0] as Identity;
      const forged = finalizeEvent(
        resignTemplate({ rootId: t.game.rootId, headId: t.game.rootId, secret: id.deckSecret }, NOW, '2'),
        id.sessionSk,
        t.game.rnd,
      );
      for (const s of t.all)
        expect(s.receive(forged, NOW)).toEqual({
          status: 'rejected',
          reason: 'resigning is not allowed in this game',
        });
    }
  });
});

describe('a v1 Luster game in progress still folds under v1 (PROTOCOL-v2 §2, §6.3)', () => {
  it('V2-03: openSession gives a protocol 1 session for a proto 1 Luster root, owing v1 prompt shares, and folds as GameSession does', () => {
    const fx = JSON.parse(
      readFileSync(new URL('../golden-v1/luster-honest.json', import.meta.url), 'utf8'),
    ) as GoldenFixture;
    const opened = openSession({
      modules: GOLDEN_MODULES,
      table: fx.table,
      joins: fx.joins,
      root: fx.root,
      me: identityOf(fx.identities[0] as (typeof fx.identities)[number]),
      rootSeenAt: fx.root.created_at,
    });
    expect(opened).toBeInstanceOf(GameSession);
    expect(opened.proto).toBe(1);
    const checked = (opened as unknown as { shuffleChecked: Map<Hex, boolean> }).shuffleChecked;
    for (const step of fx.trusted) checked.set(step, true);
    const reference = goldenSession(fx, 0);
    const kinds = new Set<string>();
    for (const ev of fx.events) {
      expect(opened.receive(ev, fx.root.created_at)).toEqual(reference.receive(ev, fx.root.created_at));
      for (const d of opened.duties()) kinds.add(d.kind);
    }
    // v1's Luster-only share duty (`DeckSpec.promptShares`), never a v2 release.
    expect(kinds.has('share')).toBe(true);
    expect(kinds.has('release')).toBe(false);
    expect(opened.view()).toEqual(reference.view());
    expect(opened.view().phase).toBe('done');
  });
});
