import { bank } from '@bored-games/bank';
import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import {
  type Ciphertext,
  G,
  initialDeck,
  makeMoveRollShare,
  makeShare,
  shuffleDeck,
} from '@bored-games/deck';
import { createRng } from '@bored-games/game-kit';
import {
  cardSharesTemplate,
  endAttestTemplate,
  finalizeEvent,
  type Hex,
  logHash,
  type NostrEvent,
  parseMove,
  resignTemplate,
  rollSharesTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity, ResultId } from '../../src/types.ts';
import { GameSessionV2 } from '../../src/v2/session.ts';
import type { Walk } from '../../src/v2/walk.ts';
import { NOW, ROOT_SEEN } from '../helpers.ts';
import {
  type AnyModule,
  act,
  actionAt,
  decider,
  replay,
  runAuto,
  send,
  shuffleAll,
  signedMove,
  type V2Table,
  v2Session,
  v2Table,
} from './helpers-v2.ts';

/*
 * The outbox rule and the rebroadcast set (PROTOCOL-v2 §9.1, §9.2; build plan T13): `vetSaved` decides what a device
 * does with an event it saved and no relay confirmed, once it has synced (send, wait or discard), so an honest
 * device never forks its own seat or shares its own card; `rebroadcast` lists what it must publish again so that
 * every honest client comes to hold the events the fold, the cutoff and the audit read (A3). Both are the session
 * halves: the controller applies them (T16).
 */

const mv = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });
const walkOf = (s: GameSessionV2): Walk => (s as unknown as { current: Walk }).current;
const discarded = (why: RegExp) => ({ discard: expect.stringMatching(why) });

/** No saved event of this seat is still in the outbox (`vetSaved` and `rebroadcast`'s `unconfirmed`). */
const NONE: readonly Hex[] = [];

const chessTable = (seed: string): V2Table => v2Table(chess as AnyModule, 2, seed);

function play(t: V2Table, moves: [number, string][]): NostrEvent[] {
  return moves.map(([k, uci]) => act(t, k, mv(k, uci)));
}

const FOOLS_MATE: [number, string][] = [
  [0, 'f2f3'],
  [1, 'e7e5'],
  [0, 'g2g4'],
  [1, 'd8h4'],
];

/** An end attestation of `r` by `seat`'s session key with log hash `hash`. */
const endOf = (t: V2Table, seat: number, r: ResultId, hash: Hex, sk?: Uint8Array): NostrEvent =>
  finalizeEvent(
    endAttestTemplate(
      { rootId: t.game.rootId, headId: r.head, end: { kind: r.kind, forfeit: r.forfeit, logHash: hash } },
      NOW,
    ),
    sk ?? (t.game.ids[seat] as Identity).sessionSk,
    t.game.rnd,
  );

const claimOf = (t: V2Table, claimant: number, head: Hex, seat: number, at = NOW): NostrEvent =>
  finalizeEvent(
    timeoutTemplate({ rootId: t.game.rootId, headId: head, seat }, at, '2'),
    (t.game.ids[claimant] as Identity).sessionSk,
    t.game.rnd,
  );

const resignOf = (t: V2Table, seat: number, head: Hex, at = NOW): NostrEvent =>
  finalizeEvent(
    resignTemplate({ rootId: t.game.rootId, headId: head }, at, '2'),
    (t.game.ids[seat] as Identity).sessionSk,
    t.game.rnd,
  );

/** Every id a rebroadcast lists, in one set. */
const everything = (r: ReturnType<GameSessionV2['rebroadcast']>): Set<Hex> =>
  new Set([...r.certificate, ...r.chain, ...r.own, ...r.other, ...r.rootOnly]);

describe('vetSaved: saved Moves (Chess)', () => {
  it('V2-45 discards a stale move: its seat played that turn on another device, whose move is now held', () => {
    const t = chessTable('outbox-stale');
    const [m1, m2] = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
    ]) as [NostrEvent, NostrEvent];
    // White's tablet saved Nc3 on m2 while offline; the phone then played Nf3 on m2.
    const tablet = v2Session(t.game, 0);
    for (const ev of [m1, m2]) tablet.receive(ev, NOW);
    const saved = tablet.buildAction(mv(0, 'b1c3'), t.game.rnd, NOW);
    expect(tablet.vetSaved(saved, NONE)).toBe('send');
    const [phone] = play(t, [[0, 'g1f3']]) as [NostrEvent];
    tablet.receive(phone, NOW);
    expect(tablet.vetSaved(saved, NONE)).toEqual(discarded(/another move of yours on that position is held/));
    // Black answered on the phone's move: still discarded, and the phone's own move (folded in) is sent.
    const [m4] = play(t, [[1, 'b8c6']]) as [NostrEvent];
    tablet.receive(m4, NOW);
    expect(tablet.vetSaved(saved, NONE)).toEqual(discarded(/another move of yours/));
    expect(t.players[0]?.vetSaved(phone, NONE)).toBe('send');
    // Sending it would have forked White: the session confirms it is a rival on m2.
    expect(tablet.receive(saved, NOW).status).toBe('accepted');
    expect(tablet.view().fork).toMatchObject({ at: m2.id, seat: 0 });
  });

  it('V2-45 waits while its prev is not held, sends once its prev is the head, and discards once its prev is below the head or off the chain', () => {
    const t = chessTable('outbox-boundaries');
    const [m1, m2, m3, m4] = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
      [1, 'b8c6'],
    ]) as [NostrEvent, NostrEvent, NostrEvent, NostrEvent];
    // A White move saved on m4, vetted by a device that holds m1 only: its prev may still come.
    const saved = actionAt(t, 0, m4.id, 5, mv(0, 'f1c4'));
    const late = v2Session(t.game, 0);
    late.receive(m1, NOW);
    expect(late.vetSaved(saved, NONE)).toBe('wait');
    // m4 arrives but not m2 and m3: m4 is held, off the chain and above a gap (not ahead of the head): discarded.
    late.receive(m4, NOW);
    expect(late.vetSaved(saved, NONE)).toEqual(discarded(/the game went another way/));
    for (const ev of [m2, m3]) late.receive(ev, NOW);
    expect(late.vetSaved(saved, NONE)).toBe('send');
    // A White move saved on m1, where the chain went on past it (a move of another seat at seq 2).
    const old = actionAt(t, 0, m1.id, 2, mv(0, 'd2d4'));
    expect(late.vetSaved(old, NONE)).toEqual(discarded(/the game has moved on/));
    // A White move on Black's junk move at m2 (held, never valid): off the chain.
    const junk = actionAt(t, 1, m2.id, 3, mv(1, 'a7a2'));
    late.receive(junk, NOW);
    const onJunk = actionAt(t, 0, junk.id, 4, mv(0, 'd2d4'));
    expect(late.vetSaved(onJunk, NONE)).toEqual(discarded(/the game went another way/));
    // Black's junk does not count as "another move of its seat" for a Black move on m2 (it can never fork), but
    // m2 is below the head, so that one is discarded as moved on.
    send(t, junk);
    const black = t.players[1] as GameSessionV2;
    expect(black.vetSaved(actionAt(t, 1, m2.id, 3, mv(1, 'd7d6')), NONE)).toEqual(
      discarded(/the game has moved on/),
    );
  });

  it('V2-45 discards every saved move while a fork is held, and a move this client judges invalid at the head; never acts for a spectator or another seat', () => {
    const t = chessTable('outbox-fork');
    const [m1, m2] = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
    ]) as [NostrEvent, NostrEvent];
    const saved = actionAt(t, 0, m2.id, 3, mv(0, 'g1f3'));
    const white = t.players[0] as GameSessionV2;
    expect(white.vetSaved(saved, NONE)).toBe('send');
    // An illegal White move on the head, folded in: the game refuses it, so it is discarded.
    const illegal = actionAt(t, 0, m2.id, 3, mv(0, 'e1e3'));
    expect(white.receive(illegal, NOW).status).toBe('rejected');
    expect(white.vetSaved(illegal, NONE)).toEqual(discarded(/the game refuses it/));
    // The illegal move forks nothing, so the good one is still sent.
    expect(white.vetSaved(saved, NONE)).toBe('send');
    expect(t.spectator.vetSaved(saved, NONE)).toEqual(discarded(/spectator/));
    expect((t.players[1] as GameSessionV2).vetSaved(saved, NONE)).toEqual(
      discarded(/not signed by your seat/),
    );
    expect(white.vetSaved({ kind: 7452, id: 'x' }, NONE)).toEqual(discarded(/does not parse/));
    // Black forks at m1: the game is stopped, and no saved move goes out.
    const rival = actionAt(t, 1, m1.id, 2, mv(1, 'c7c5'));
    send(t, rival);
    expect(white.view().stop).toMatchObject({ at: m1.id, seat: 1 });
    expect(white.vetSaved(saved, NONE)).toEqual(discarded(/stopped at a fork/));
  });
});

describe('vetSaved: end attestations, Resigns, claims (Chess)', () => {
  it('V2-45 discards a saved end attestation once a fork is held, and one of a result this client does not compute', () => {
    const t = chessTable('outbox-end');
    const moves = play(t, FOOLS_MATE);
    const [m1, , , m4] = moves as [NostrEvent, NostrEvent, NostrEvent, NostrEvent];
    const white = t.players[0] as GameSessionV2;
    expect(white.view().result).toEqual({ kind: 'over', head: m4.id, forfeit: [] });
    const saved = white.buildEndAttest(t.game.rnd, NOW);
    expect(white.vetSaved(saved, NONE)).toBe('send');
    // The same result signed by the npub (it may sign end attestations too): sent.
    const hash = logHash(moves.map((m) => m.id));
    const byNpub = endOf(t, 0, { kind: 'over', head: m4.id, forfeit: [] }, hash, t.game.npubSks[0]);
    expect(white.vetSaved(byNpub, NONE)).toBe('send');
    // Another identity, or the right one with a wrong log hash: discarded.
    expect(white.vetSaved(endOf(t, 0, { kind: 'claim', head: m4.id, forfeit: [1] }, hash), NONE)).toEqual(
      discarded(/no longer computes that result/),
    );
    expect(
      white.vetSaved(endOf(t, 0, { kind: 'over', head: m4.id, forfeit: [] }, logHash([])), NONE),
    ).toEqual(discarded(/log hash/));
    // Black, who mated, signs a rival move 2 on m1 before White's attestation is out: a fork is held, the end
    // does not stand (White never attested), and the saved attestation is discarded.
    send(t, actionAt(t, 1, m1.id, 2, mv(1, 'c7c5')));
    expect(white.view()).toMatchObject({ result: null, stop: { at: m1.id, seat: 1 } });
    expect(white.vetSaved(saved, NONE)).toEqual(discarded(/a fork is held/));
  });

  it('V2-45 keeps a saved end attestation of a counted claim waiting while that claim is restored from a save, and sends it once restored', () => {
    const t = chessTable('outbox-awaiting');
    const m = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ]);
    const head = (m[2] as NostrEvent).id;
    const deadline = t.spectator.view().deadline;
    const claim = claimOf(t, 0, head, 1, NOW + deadline);
    const saved = { kind: 'claim' as const, id: claim.id, head, forfeit: [1] };
    const end = endOf(t, 0, { kind: 'claim', head, forfeit: [1] }, logHash(m.map((x) => x.id)));
    const w = GameSessionV2.create({
      modules: t.game.modules,
      table: t.game.table,
      joins: t.game.joins,
      root: t.game.root,
      me: t.game.ids[0] as Identity,
      rootSeenAt: ROOT_SEEN,
      savedCounted: saved,
    });
    for (const ev of m) w.receive(ev, NOW);
    expect(w.view().awaitingCounted).toEqual(saved);
    expect(w.vetSaved(end, NONE)).toBe('wait');
    w.receive(claim, NOW + deadline + 1);
    expect(w.view().result).toEqual({ kind: 'claim', head, forfeit: [1] });
    expect(w.vetSaved(end, NONE)).toBe('send');
  });

  it('V2-45 vets a saved Resign as v1 does: discarded once another Resign of its seat is held or the game is over, otherwise sent', () => {
    const t = chessTable('outbox-resign');
    const [m1] = play(t, [[0, 'e2e4']]) as [NostrEvent];
    const white = t.players[0] as GameSessionV2;
    const saved = resignOf(t, 0, m1.id);
    expect(white.vetSaved(saved, NONE)).toBe('send');
    // Folded in and counted: still sent (it is this seat's counted Resign).
    const u = replay(t);
    send(u, saved);
    expect(u.players[0]?.view().result).toEqual({ kind: 'resign', head: m1.id, forfeit: [0] });
    expect(u.players[0]?.vetSaved(saved, NONE)).toBe('send');
    // Another Resign of White's (another device) is held: discarded.
    const other = replay(t);
    send(other, resignOf(t, 0, m1.id, NOW + 1));
    expect(other.players[0]?.vetSaved(saved, NONE)).toEqual(discarded(/another resignation of yours/));
    // The game is over (mate): discarded.
    const mate = chessTable('outbox-resign-mate');
    const moves = play(mate, FOOLS_MATE);
    expect(mate.players[0]?.vetSaved(resignOf(mate, 0, (moves[3] as NostrEvent).id), NONE)).toEqual(
      discarded(/the game is over/),
    );
    // A saved Timeout claim is republished as in v1.
    expect(white.vetSaved(claimOf(t, 0, m1.id, 1), NONE)).toBe('send');
  });
});

describe('vetSaved: card Shares events (Chain Reaction, 3 seats)', () => {
  let base: V2Table;
  let steps: NostrEvent[];
  let deals: { seat: number; ev: NostrEvent }[];
  const deckId = chainReaction.decks(chainReaction.defaultRules())[0]?.id as string;
  beforeAll(() => {
    base = v2Table(chainReaction, 3, 'outbox-cr');
    steps = shuffleAll(base);
    deals = runAuto(base).map((x) => ({ seat: x.seat, ev: x.ev }));
  }, 120_000);

  /** From `t`, play random moves until one deals a tile to its actor; returns that move, its actor and position. */
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

  /** A card Shares event by `seat` of `positions` of the walk's final deck in `s`, anchored on `anchor`. */
  function sharesBy(
    t: V2Table,
    s: GameSessionV2,
    seat: number,
    positions: number[],
    anchor: Hex,
  ): NostrEvent {
    const id = t.game.ids[seat] as Identity;
    const deck = walkOf(s).line.points[3]?.deck as readonly Ciphertext[];
    const shares = positions.map((pos) => ({
      pos,
      share: makeShare(
        id.deckSecret,
        deck[pos] as Ciphertext,
        { rootId: t.game.rootId, deckId, pos },
        t.game.rnd,
      ),
    }));
    return finalizeEvent(
      cardSharesTemplate({ rootId: t.game.rootId, anchorId: anchor, shares }, NOW),
      id.sessionSk,
      t.game.rnd,
    );
  }

  it('V2-45 keeps the deal and never discards it: sent when it fits the deck on the chain, otherwise it waits', () => {
    const { seat, ev: deal0 } = deals[0] as { seat: number; ev: NostrEvent };
    // Before any deal is held, on the deck of the chain: sent.
    const fresh = replay(base, steps);
    expect(fresh.players[seat]?.vetSaved(deal0, NONE)).toBe('send');
    // Its anchor (the last shuffle step) not held: it waits while that step is a saved event of this seat's still in
    // the outbox; otherwise the step is gone after the sync, and the deal (on a deck never public here) goes with it.
    const partial = replay(base, steps.slice(0, 2));
    expect(partial.players[seat]?.vetSaved(deal0, [(steps[2] as NostrEvent).id])).toBe('wait');
    expect(partial.players[seat]?.vetSaved(deal0, NONE)).toEqual(discarded(/what it was built on is gone/));
    // A second deal by the same seat (another device), while the first is held: kept, never sent, never discarded.
    const second = fresh.players[seat]?.buildDeal(base.game.rnd, NOW) as NostrEvent;
    const full = replay(base);
    expect(full.players[seat]?.vetSaved(second, NONE)).toBe('wait');
    expect(full.players[seat]?.vetSaved(deal0, NONE)).toBe('send');
    // A rival last shuffle step (the last shuffler's second well-formed step): a fork, so the deal waits.
    const last = steps[2] as NostrEvent;
    const content = parseMove(last, 108, '2').content;
    // Seat 2 signs step 3 (3 seats, one deck): the same content again, dated otherwise, is a well-formed rival.
    const rival = signedMove(base, 2, steps[1]?.id as Hex, 3, content, NOW + 7);
    const forked = replay(base, [...steps, rival]);
    expect(forked.spectator.view().fork).not.toBeNull();
    expect(forked.players[seat]?.vetSaved(deal0, NONE)).toBe('wait');
  });

  it('V2-45 sends a saved release while it fits; discards it once its position is its own seat’s, undrawn or already released, or the game is over, and lets it wait for its anchor', () => {
    const t = replay(base);
    const draw = playToDraw(t, 'outbox-draw');
    const j = (draw.actor + 1) % 3;
    const s = t.players[j] as GameSessionV2;
    const release = s.buildRelease(base.game.rnd, NOW);
    expect(s.vetSaved(release, NONE)).toBe('send');
    // Its anchor (the draw) not held: it waits only while the anchor is in the outbox (`unconfirmed`), else it is gone.
    const before = replay(base, t.log.slice(0, t.log.indexOf(draw.move)));
    expect(before.players[j]?.vetSaved(release, [draw.move.id])).toBe('wait');
    expect(before.players[j]?.vetSaved(release, NONE)).toEqual(discarded(/what it was built on is gone/));
    // A share of a position dealt to its own seat is never sent (the Luster audit's F3), nor one of an undrawn card.
    const own = sharesBy(t, s, draw.actor, [draw.pos], draw.move.id);
    expect(t.players[draw.actor]?.vetSaved(own, NONE)).toEqual(discarded(/would reveal your own card/));
    const dealt = new Set(
      chainReaction.dealt(t.spectator.view().state as ChainReactionState).map((d) => d.pos),
    );
    const undrawn = [...Array(108).keys()].find((p) => !dealt.has(p)) as number;
    expect(s.vetSaved(sharesBy(t, s, j, [undrawn], draw.move.id), NONE)).toEqual(discarded(/not drawn/));
    // Another device of seat j released the same position first: the saved one is discarded; the held one is sent.
    const again = s.buildRelease(base.game.rnd, NOW);
    send(t, release);
    expect(s.vetSaved(again, NONE)).toEqual(discarded(/already released/));
    expect(s.vetSaved(release, NONE)).toBe('send');
    // The game is over (another seat resigned on the draw): discarded.
    const over = replay(base, t.log.slice(0, t.log.indexOf(release)));
    const k = (draw.actor + 2) % 3;
    send(over, over.players[k]?.buildResign(base.game.rnd, NOW) as NostrEvent);
    expect(over.spectator.view().result).toMatchObject({ kind: 'resign', forfeit: [k] });
    expect(over.players[j]?.vetSaved(again, NONE)).toEqual(discarded(/the game is over/));
  });

  it('V2-45 discards a saved release whose anchor left the chain: the drawer forked at the draw’s prev', () => {
    const t = replay(base);
    const draw = playToDraw(t, 'outbox-draw-fork');
    const j = (draw.actor + 1) % 3;
    const release = (t.players[j] as GameSessionV2).buildRelease(base.game.rnd, NOW);
    // The drawer's other legal action at the same prev, built on a copy without the draw.
    const at = replay(base, t.log.slice(0, t.log.indexOf(draw.move)));
    const drawer = at.players[draw.actor] as GameSessionV2;
    const wanted = JSON.stringify(parseMove(draw.move, 108, '2').content);
    const other = drawer
      .legalActions()
      .map((a) => drawer.buildAction(a, base.game.rnd, NOW + 3))
      .find((ev) => JSON.stringify(parseMove(ev, 108, '2').content) !== wanted) as NostrEvent;
    send(t, other);
    expect(t.players[j]?.view().fork).toMatchObject({ seat: draw.actor });
    expect(t.players[j]?.vetSaved(release, NONE)).toEqual(discarded(/went another way|stopped at a fork/));
  });
});

describe('vetSaved: roll Shares events and moves ahead of the head (Bank 0.2.0, 3 seats)', () => {
  let t: V2Table;
  let roller: number;
  let M: NostrEvent;
  let rolls: NostrEvent[];
  beforeAll(() => {
    t = v2Table(bank as AnyModule, 3, 'outbox-dice');
    roller = decider(t) as number;
    M = act(t, roller, t.players[roller]?.legalActions()[0]);
    rolls = t.players.map((p) => p.buildRoll(M.id, t.game.rnd, NOW));
  });

  it('V2-45 lets a saved roll wait until its requesting move is on the chain, then sends it', () => {
    const k = (roller + 1) % 3;
    const empty = replay(t, []);
    // The roller's own contribution, its Roll still a saved event in its outbox: it waits. Another seat's, its
    // requesting move not held after the sync: gone.
    expect(empty.players[roller]?.vetSaved(rolls[roller], [M.id])).toBe('wait');
    expect(empty.players[k]?.vetSaved(rolls[k], NONE)).toEqual(discarded(/what it was built on is gone/));
    send(empty, M);
    expect(empty.players[roller]?.vetSaved(rolls[roller], [M.id])).toBe('send');
    expect(empty.players[k]?.vetSaved(rolls[k], NONE)).toBe('send');
    // Another device of the seat contributed already (the same D): sending is harmless, never a fork.
    send(empty, t.players[k]?.buildRoll(M.id, t.game.rnd, NOW + 1) as NostrEvent);
    expect(empty.players[k]?.vetSaved(rolls[k], NONE)).toBe('send');
    // A contribution to a roll M never requested: the game refuses it.
    const id = t.game.ids[k] as Identity;
    const wrong = finalizeEvent(
      rollSharesTemplate(
        {
          rootId: t.game.rootId,
          anchorId: M.id,
          moveId: M.id,
          shares: [{ pos: 1, share: makeMoveRollShare(id.deckSecret, t.game.rootId, M.id, 1, t.game.rnd) }],
        },
        NOW,
      ),
      id.sessionSk,
      t.game.rnd,
    );
    expect(empty.players[k]?.vetSaved(wrong, NONE)).toEqual(discarded(/the game refuses it/));
  });

  it('V2-45 discards a saved roll once a fork is held or the game is over', () => {
    const k = (roller + 1) % 3;
    // The roller's rival Roll at the root (the same action, dated otherwise): a fork at the root.
    const forked = replay(t);
    const action = replay(t, []).players[roller]?.legalActions()[0];
    send(forked, actionAt(forked, roller, t.game.rootId, 1, action, NOW + 9));
    expect(forked.spectator.view().fork).toMatchObject({ seat: roller });
    expect(forked.players[k]?.vetSaved(rolls[k], NONE)).toEqual(discarded(/stopped at a fork/));
    const resigned = replay(t);
    const r = (roller + 2) % 3;
    send(resigned, resignOf(resigned, r, M.id));
    expect(resigned.spectator.view().result).toMatchObject({ kind: 'resign', forfeit: [r] });
    expect(resigned.players[k]?.vetSaved(rolls[k], NONE)).toEqual(discarded(/the game is over/));
  });

  it('V2-45 lets a saved move wait while its prev extends the head and waits for a roll (ahead), as v1', () => {
    const done = replay(t, [...t.log, ...rolls]);
    const p = done.spectator.view().pending as { type: string; seat: number };
    const action = done.players[p.seat]?.legalActions()[0];
    // The decision after the roll, signed before the roll was derived: ahead of the head while the beacon waits.
    const early = actionAt(t, p.seat, M.id, 2, action, NOW + 3);
    const a = replay(t, [...t.log, early]);
    expect(a.spectator.branchOf(early.id)).toBe('ahead');
    // The seat's own saved move: sent (its prev is the head); a move saved on top of it waits.
    expect(a.players[p.seat]?.vetSaved(early, NONE)).toBe('send');
    const next = (p.seat + 1) % 3;
    const onEarly = actionAt(t, next, early.id, 3, { type: 'stay', actor: next });
    expect(a.players[next]?.vetSaved(onEarly, NONE)).toBe('wait');
  });
});

describe('rebroadcast (PROTOCOL-v2 §9.1)', () => {
  it('V2-44 lists the fork certificate, the chain, this seat’s end attestations and every other held event; junk past the cap only when a held event names it', () => {
    const t = chessTable('rebroadcast-fork');
    const moves = play(t, FOOLS_MATE);
    const [m1, m2, m3, m4] = moves as [NostrEvent, NostrEvent, NostrEvent, NostrEvent];
    const ends = runAuto(t, ['end']);
    const endW = ends.find((x) => x.seat === 0)?.ev as NostrEvent;
    const endB = ends.find((x) => x.seat === 1)?.ev as NostrEvent;
    // Black (the mater) forks at m1 with a rival, and adds six illegal junk moves there.
    const rival = actionAt(t, 1, m1.id, 2, mv(1, 'c7c5'));
    const junk = ['a7a2', 'b7b2', 'c7c2', 'd7d2', 'f7f2', 'g7g2'].map((u) =>
      actionAt(t, 1, m1.id, 2, mv(1, u)),
    );
    for (const ev of [rival, ...junk]) send(t, ev);
    // A claim by White naming a random head waits (held under the waiting cap); one naming junk[0] names it.
    const unknown = claimOf(t, 0, 'ab'.repeat(32), 1);
    send(t, unknown);
    const white = t.players[0] as GameSessionV2;
    const r = white.rebroadcast(NONE);
    expect(r.certificate).toEqual([m2.id, rival.id].sort());
    expect(r.chain).toEqual([m1.id]);
    expect(r.own).toEqual([endW.id]);
    expect(r.other).toEqual([m3.id, m4.id, endB.id, unknown.id].sort());
    expect(r.rootOnly).toEqual([]);
    for (const ev of junk) expect(everything(r).has(ev.id)).toBe(false);
    const naming = claimOf(t, 0, (junk[0] as NostrEvent).id, 1);
    send(t, naming);
    const r2 = white.rebroadcast(NONE);
    expect(r2.other).toEqual(
      [m3.id, m4.id, endB.id, unknown.id, naming.id, (junk[0] as NostrEvent).id].sort(),
    );
    // The same set on every client holding the same events: a function of the held events.
    expect(t.spectator.rebroadcast(NONE)).toEqual({ ...r2, own: [], other: [...r2.other, endW.id].sort() });
  });

  it('V2-44 keeps a valid-looking pair off the walk ahead of junk, so a client fed only the rebroadcast reaches the same equivocators (M1)', () => {
    const t = chessTable('rebroadcast-m1');
    const [, m2, m3] = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
      [1, 'b8c6'],
    ]) as [NostrEvent, NostrEvent, NostrEvent, NostrEvent];
    // Black forks at m3 and White above it at m2 (both seats equivocate, M1); Black adds junk at m3.
    const black = actionAt(t, 1, m3.id, 4, mv(1, 'd7d6'));
    const white = actionAt(t, 0, m2.id, 3, mv(0, 'd2d4'));
    const junk = ['a7a2', 'b7b2', 'c7c2', 'h7h2'].map((u) => actionAt(t, 1, m3.id, 4, mv(1, u)));
    for (const ev of [black, white, ...junk]) send(t, ev);
    const v = t.spectator.view();
    expect(v.equivocators).toEqual([0, 1]);
    const r = t.spectator.rebroadcast(NONE);
    expect(r.other).toContain(black.id);
    for (const ev of junk) expect(everything(r).has(ev.id)).toBe(false);
    const byId = new Map(t.log.map((ev) => [ev.id, ev]));
    const copy = v2Session(t.game, null);
    for (const id of everything(r)) copy.receive(byId.get(id), NOW);
    expect(copy.view()).toEqual(v);
    expect(copy.rebroadcast(NONE)).toEqual(r);
  });

  it('V2-56 rebroadcasts every held Shares event and end attestation whatever its validity, its own seat’s apart', () => {
    const t = chessTable('rebroadcast-held');
    const moves = play(t, FOOLS_MATE);
    const head = (moves[3] as NostrEvent).id;
    const hash = logHash(moves.map((m) => m.id));
    const id0 = t.game.ids[0] as Identity;
    const id1 = t.game.ids[1] as Identity;
    const unheld = 'cd'.repeat(32);
    const ct = shuffleDeck(initialDeck('dummy', 1), G.multiply(id0.deckSecret), t.game.rnd)
      .out[0] as Ciphertext;
    const share = makeShare(
      id0.deckSecret,
      ct,
      { rootId: t.game.rootId, deckId: 'dummy', pos: 0 },
      t.game.rnd,
    );
    const events = [
      // An inapplicable card variant (a deckless game) by seat 0.
      finalizeEvent(
        cardSharesTemplate(
          { rootId: t.game.rootId, anchorId: moves[1]?.id as Hex, shares: [{ pos: 0, share }] },
          NOW,
        ),
        id0.sessionSk,
        t.game.rnd,
      ),
      // An inapplicable roll variant by seat 1, its anchor and requesting move not held.
      finalizeEvent(
        rollSharesTemplate(
          {
            rootId: t.game.rootId,
            anchorId: unheld,
            moveId: unheld,
            shares: [
              { pos: 0, share: makeMoveRollShare(id1.deckSecret, t.game.rootId, unheld, 0, t.game.rnd) },
            ],
          },
          NOW,
        ),
        id1.sessionSk,
        t.game.rnd,
      ),
      // End attestations: a non-seat in forfeit, a mismatched log hash, an unheld head, a valid one and its npub copy.
      endOf(t, 0, { kind: 'claim', head, forfeit: [5] }, hash),
      endOf(t, 1, { kind: 'over', head, forfeit: [] }, logHash([])),
      endOf(t, 1, { kind: 'over', head: unheld, forfeit: [] }, hash),
      endOf(t, 0, { kind: 'over', head, forfeit: [] }, hash),
      endOf(t, 0, { kind: 'over', head, forfeit: [] }, hash, t.game.npubSks[0]),
    ];
    for (const ev of events) send(t, ev);
    const white = t.players[0] as GameSessionV2;
    const held = white.heldSet();
    expect(held.map((x) => x.id).sort()).toEqual(events.map((ev) => ev.id).sort());
    const r = white.rebroadcast(NONE);
    expect(r.own).toEqual(held.filter((x) => x.seat === 0).map((x) => x.id));
    for (const x of held.filter((y) => y.seat !== 0)) expect(r.other).toContain(x.id);
  });
});

describe('fix round 1 (review of T13): own unconfirmed events, a chain move under a fork, waits that clear', () => {
  it('V2-44 H-1: never rebroadcasts an own event still in the outbox, so a folded-in move the outbox rule discards (the phone played that turn) never goes out as a fork certificate', () => {
    const t = chessTable('outbox-h1');
    const [m1, m2] = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
    ]) as [NostrEvent, NostrEvent];
    // The tablet builds Nc3 and folds it in (build, save, feed, publish), but no relay confirms it: it is offline.
    const tablet = t.players[0] as GameSessionV2;
    const saved = tablet.buildAction(mv(0, 'b1c3'), t.game.rnd, NOW);
    expect(tablet.receive(saved, NOW).status).toBe('accepted');
    // The phone, the same seat, plays Nf3 on m2; the tablet syncs and holds it: its seat's own fork.
    const phone = v2Session(t.game, 0);
    for (const ev of [m1, m2]) phone.receive(ev, NOW);
    const other = phone.buildAction(mv(0, 'g1f3'), t.game.rnd, NOW);
    tablet.receive(other, NOW);
    expect(tablet.view().fork).toMatchObject({ at: m2.id, seat: 0 });
    const outbox = [saved.id];
    expect(tablet.vetSaved(saved, outbox)).toEqual(discarded(/another move of yours/));
    const r = tablet.rebroadcast(outbox);
    expect(r.certificate).toEqual([other.id]);
    expect(everything(r).has(saved.id)).toBe(false);
    // Without the outbox's ids the set would list it as the certificate: why `unconfirmed` is required.
    expect(tablet.rebroadcast(NONE).certificate).toContain(saved.id);
  });

  it('V2-45 M-1: sends an own move already on its chain while a fork is held above it, so the session keeps it and asks for no second move', () => {
    const t = chessTable('outbox-m1');
    const [, , m3] = play(t, [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
      [1, 'b8c6'],
    ]) as [NostrEvent, NostrEvent, NostrEvent, NostrEvent];
    // Black equivocates on m3: the fork is at m3, and White's m3 (still in White's outbox) is on White's chain.
    send(t, actionAt(t, 1, m3.id, 4, mv(1, 'd7d6')));
    const white = t.players[0] as GameSessionV2;
    expect(white.view().fork).toMatchObject({ at: m3.id, seat: 1 });
    expect(white.vetSaved(m3, [m3.id])).toBe('send');
    // Sent, not discarded: no rebuild, so the session still holds White's move, the stop at m3 and no decision.
    expect(white.chainSeq(m3.id)).toBe(3);
    expect(white.view().stop).toMatchObject({ at: m3.id, seat: 1 });
    expect(white.duties().map((d) => d.kind)).not.toContain('decide');
    // A move of White's not on the chain is still discarded while the fork is held.
    expect(white.vetSaved(actionAt(t, 0, m3.id, 4, mv(0, 'd2d4')), NONE)).toEqual(
      discarded(/fork|another move/),
    );
  });
});

describe('fix round 1: a saved Shares event built on an own move the outbox discarded (Bank 0.2.0, 3 seats)', () => {
  it('V2-45 L-3: the roller’s saved contribution waits while its Roll is in the outbox, and is discarded with the Roll once the phone’s rival is held', () => {
    const t = v2Table(bank as AnyModule, 3, 'outbox-gone');
    const roller = decider(t) as number;
    const action = t.players[roller]?.legalActions()[0];
    // The roller's tablet, offline: its Roll M and its own contribution to it, both saved, neither confirmed.
    const tablet = t.players[roller] as GameSessionV2;
    const M = tablet.buildAction(action, t.game.rnd, NOW);
    const probe = replay(t, [M]);
    const contribution = probe.players[roller]?.buildRoll(M.id, t.game.rnd, NOW) as NostrEvent;
    // Meanwhile the phone rolled (the same action, another event) and the tablet synced it.
    const rival = actionAt(t, roller, t.game.rootId, 1, action, NOW + 9);
    send(t, rival);
    // Moves first: M has a rival of its own seat, so it is discarded (and removed from the outbox).
    expect(tablet.vetSaved(M, [M.id, contribution.id])).toEqual(discarded(/another move of yours/));
    // While M was still in the outbox the contribution waited; once M is gone it is discarded with it.
    expect(tablet.vetSaved(contribution, [M.id, contribution.id])).toBe('wait');
    expect(tablet.vetSaved(contribution, [contribution.id])).toEqual(
      discarded(/what it was built on is gone/),
    );
  });
});
