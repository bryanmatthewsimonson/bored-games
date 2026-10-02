import { type ChainReactionState, chainReaction, tileId } from '@bored-games/chain-reaction';
import { canonicalJson, createRng, stateHash } from '@bored-games/game-kit';
import {
  finalizeEvent,
  KIND,
  type MoveContent,
  moveTemplate,
  type NostrEvent,
  type ParsedMove,
  parseMove,
  parseShares,
  sharesTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClientError } from '../src/errors.ts';
import type { GameSession } from '../src/session.ts';
import { deliver, makeGame, newSession, playShuffle, statuses, T0, trust, unshared } from './helpers.ts';

const SEATS = 3;
const MOVES = 30;
const DECK = 108;
const game = makeGame(SEATS, 'client-play');

type Action = Extract<MoveContent, { type: 'action' }>;
type Place = { type: 'place'; actor: number; pos: number; tile: string };

const contentOf = (ev: NostrEvent): Action => parseMove(ev, DECK).content as Action;
const actionOf = (ev: NostrEvent): { type: string; actor: number } =>
  contentOf(ev).action as { type: string; actor: number };
const stateOf = (s: GameSession): ChainReactionState => s.view().state as ChainReactionState;

/** The public part of a session's state: its view redacted to a spectator's. */
const publicHash = (s: GameSession): string => stateHash(chainReaction.view(stateOf(s), null));

/** `ev` re-signed by `seat` with its content changed by `edit`; prev and seq are kept, and the time by default. */
function resign<C extends MoveContent = Action>(
  ev: NostrEvent,
  seat: number,
  edit: (c: C) => C = (c) => c,
  createdAt?: number,
): NostrEvent {
  const m: ParsedMove = parseMove(ev, DECK);
  const t = moveTemplate(
    { rootId: m.rootId, prevId: m.prevId, seq: m.seq, content: edit(m.content as C) },
    createdAt ?? m.createdAt,
  );
  return finalizeEvent(t, game.ids[seat]?.sessionSk as Uint8Array, game.rnd);
}

describe('play: game-action moves', () => {
  let players: GameSession[];
  let spectator: GameSession;
  /** Every event of the game in publication order: shuffle steps, deals, then moves and one early Shares event. */
  const log: NostrEvent[] = [];
  const moves: NostrEvent[] = [];
  /** Per move, each session's head, pending, log hash and public state hash. */
  const agreement: string[][] = [];
  /** A move whose signer published its owed shares in a separate, earlier Shares event. */
  let early: { shares: NostrEvent; move: NostrEvent };
  /** A valid alternative to `moves[rival.index]`, signed by the same seat on the same prev. */
  let rival: { index: number; move: NostrEvent };

  beforeAll(() => {
    players = [0, 1, 2].map((seat) => newSession(game, seat));
    spectator = newSession(game, null);
    const all = [...players, spectator];
    log.push(...playShuffle(game, players, [spectator]));
    const deals = players.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
    deliver(all, deals);
    log.push(...deals);

    const rng = createRng('client-play-policy');
    let t = T0 + 1000;
    for (let i = 0; i < MOVES; i++) {
      const pending = spectator.view().pending;
      if (pending.type !== 'player') throw new Error(`move ${i}: no player decision is pending`);
      const s = players[pending.seat] as GameSession;
      // The uniform fuzz policy.
      const legal = s.legalActions();
      const action = rng.pick(legal);
      let ev = s.buildAction(action, game.rnd, t++);

      if (early === undefined && contentOf(ev).shares.length > 0) {
        // Publish the owed shares on their own first; the move then carries none.
        const shares = finalizeEvent(
          sharesTemplate({ rootId: game.rootId, shares: contentOf(ev).shares }, t++),
          game.ids[pending.seat]?.sessionSk as Uint8Array,
          game.rnd,
        );
        expect(statuses(deliver(all, [shares]))).toEqual(Array(4).fill('accepted'));
        log.push(shares);
        ev = s.buildAction(action, game.rnd, t++);
        expect(contentOf(ev).shares).toEqual([]);
        early = { shares, move: ev };
      }
      if (rival === undefined && i >= 1 && legal.length > 1) {
        const other = legal.find((a) => canonicalJson(a) !== canonicalJson(action));
        rival = { index: i, move: s.buildAction(other, game.rnd, t++) };
      }

      expect(statuses(deliver(all, [ev]))).toEqual(Array(4).fill('accepted'));
      log.push(ev);
      moves.push(ev);
      agreement.push(
        all.map((x) => {
          const v = x.view();
          return canonicalJson({ head: v.head, pending: v.pending, logHash: v.logHash, hash: publicHash(x) });
        }),
      );
    }
  });

  /** A fresh session for `viewer` that has received the log up to (not including) `ev`. */
  function sessionBefore(ev: NostrEvent, viewer: number | null = null): GameSession {
    const s = newSession(game, viewer);
    const prefix = log.slice(0, log.indexOf(ev));
    expect(statuses(deliver([s], prefix)).filter((r) => r !== 'accepted')).toEqual([]);
    return s;
  }

  it('three seats and a spectator play 30 uniform-policy moves and agree on head, state and pending', () => {
    expect(moves).toHaveLength(MOVES);
    for (const [i, row] of agreement.entries()) {
      expect(new Set(row).size, `after move ${i}`).toBe(1);
      expect(JSON.parse(row[0] as string).head.seq).toBe(SEATS + i + 1);
    }
    // The spectator's state is exactly the public part.
    expect(stateHash(stateOf(spectator))).toBe(publicHash(spectator));
    for (const s of [...players, spectator]) expect(s.view().forfeits).toEqual([]);
  });

  it('gives the decide duty and legal actions only to the pending seat, and builds only legal actions', () => {
    const pending = spectator.view().pending as { type: 'player'; seat: number };
    let owing = 0;
    for (const [k, s] of players.entries()) {
      // Every seat that has not shared a drawn tile yet owes it first (D039).
      const owed = unshared(game, log, stateOf(spectator), k);
      const share = owed.length > 0 ? [{ kind: 'share', positions: owed }] : [];
      if (owed.length > 0) owing++;
      expect(s.duties()).toEqual(k === pending.seat ? [...share, { kind: 'decide' }] : share);
      if (k !== pending.seat) {
        expect(s.legalActions()).toEqual([]);
        expect(() => s.buildAction({ type: 'skipPlace', actor: k }, game.rnd, T0 + 5000)).toThrow(
          ClientError,
        );
      }
    }
    const me = players[pending.seat] as GameSession;
    const legal = me.legalActions();
    expect(legal).toEqual(chainReaction.legalActions(stateOf(me), pending.seat));
    expect(Object.isFrozen(legal)).toBe(true);
    // The pending seat knows its whole hand.
    expect(stateOf(me).players[pending.seat]?.hand.every((h) => h.tile !== null)).toBe(true);
    expect(() => me.buildAction({ type: 'bogus', actor: pending.seat }, game.rnd, T0 + 5000)).toThrow(
      ClientError,
    );
    expect(spectator.duties()).toEqual([]);
    expect(spectator.legalActions()).toEqual([]);
    expect(() => spectator.buildAction(legal[0], game.rnd, T0 + 5000)).toThrow(ClientError);
    // The game stopped with a drawn tile some seat has not shared, so the share duty was checked too.
    expect(owing).toBeGreaterThan(0);
  });

  /*
   * The share duty (D039): a seat publishes the shares it owes as soon as it sees a draw, so the drawer learns its
   * tile in seconds instead of after every other seat's next move.
   */

  /** Seat `viewer`'s fresh session (null: a spectator) after the log up to `ev`, each event first seen at its date. */
  function seenUpTo(ev: NostrEvent, viewer: number | null): GameSession {
    const s = newSession(game, viewer);
    const prefix = log.slice(0, log.indexOf(ev));
    trust([s], prefix);
    for (const e of prefix) expect(s.receive(e, e.created_at).status).toBe('accepted');
    return s;
  }

  /**
   * Every seat's session and a spectator's, just after the game's first endTurn, first seen at its date. It
   * draws for its actor, and no seat owes any other share then.
   */
  function afterFirstDraw() {
    const ev = moves.find((m) => actionOf(m).type === 'endTurn') as NostrEvent;
    const drawer = actionOf(ev).actor;
    const seats = [0, 1, 2].map((k) => seenUpTo(ev, k));
    const watcher = seenUpTo(ev, null);
    const all = [...seats, watcher];
    const before = new Set(chainReaction.dealt(stateOf(watcher)).map((d) => d.pos));
    expect(statuses(deliver(all, [ev], undefined, ev.created_at))).toEqual(Array(4).fill('accepted'));
    const drawn = chainReaction
      .dealt(stateOf(watcher))
      .filter((d) => d.to === drawer && !before.has(d.pos))
      .map((d) => d.pos);
    expect(drawn.length).toBeGreaterThan(0);
    const next = (drawer + 1) % SEATS;
    const third = (drawer + 2) % SEATS;
    expect((watcher.view().pending as { seat: number }).seat).toBe(next);
    const hidden = (s: GameSession): number =>
      stateOf(s).players[drawer]?.hand.filter((h) => h.tile === null).length ?? -1;
    return { ev, drawer, next, third, seats, watcher, all, drawn, hidden };
  }

  it('gives every other seat a share duty for a drawn tile, before its decision; the drawer and spectators none', () => {
    const { drawer, next, third, seats, watcher, drawn, hidden } = afterFirstDraw();
    const share = { kind: 'share', positions: drawn };
    expect(seats[drawer]?.duties()).toEqual([]);
    expect(seats[next]?.duties()).toEqual([share, { kind: 'decide' }]);
    expect(seats[third]?.duties()).toEqual([share]);
    expect(watcher.duties()).toEqual([]);
    expect(() => seats[drawer]?.buildShares(game.rnd, T0 + 5000)).toThrow(ClientError);
    expect(() => watcher.buildShares(game.rnd, T0 + 5000)).toThrow(ClientError);
    // The drawer cannot read its new tile yet.
    expect(hidden(seats[drawer] as GameSession)).toBe(drawn.length);
  });

  it('lets the drawer read its tile from the Shares events alone; the next move then carries no shares', () => {
    const { ev, drawer, next, third, seats, watcher, all, drawn, hidden } = afterFirstDraw();
    const shares = [next, third].map((k, i) =>
      (seats[k] as GameSession).buildShares(game.rnd, ev.created_at + 1 + i),
    );
    for (const sh of shares) {
      expect(sh.kind).toBe(KIND.shares);
      expect(parseShares(sh).shares.map((x) => x.pos)).toEqual(drawn);
    }
    expect(statuses(deliver(all, shares, undefined, ev.created_at + 5))).toEqual(Array(8).fill('accepted'));
    expect(hidden(seats[drawer] as GameSession)).toBe(0);
    // Every share is needed to decrypt, the drawer's own included: the others still cannot read it.
    const handSize = stateOf(seats[drawer] as GameSession).players[drawer]?.hand.length;
    for (const s of [seats[next], seats[third], watcher]) expect(hidden(s as GameSession)).toBe(handSize);
    expect(seats[next]?.duties()).toEqual([{ kind: 'decide' }]);
    expect(seats[third]?.duties()).toEqual([]);
    expect(() => seats[third]?.buildShares(game.rnd, T0 + 5000)).toThrow(ClientError);

    const s = seats[next] as GameSession;
    const move = s.buildAction(s.legalActions()[0], game.rnd, ev.created_at + 10);
    expect(contentOf(move).shares).toEqual([]);
    expect(statuses(deliver(all, [move], undefined, ev.created_at + 10))).toEqual(Array(4).fill('accepted'));
    for (const x of all) expect(x.view().head.id).toBe(move.id);
  });

  it('does not count a Shares event that leaves the stall set as it was as progress (Ruling 11)', () => {
    const { ev, next, third, seats, all } = afterFirstDraw();
    const deadline = 259200;
    for (const x of all) expect(x.view().pendingSince).toBe(ev.created_at);
    // The next seat can decide with its hand known: it alone is stalled, before and after these shares.
    for (const [i, k] of [third, next].entries()) {
      const sh = (seats[k] as GameSession).buildShares(game.rnd, ev.created_at + 1);
      expect(statuses(deliver(all, [sh], undefined, ev.created_at + 500 * (i + 1)))).toEqual(
        Array(4).fill('accepted'),
      );
    }
    for (const x of all) expect(x.view().pendingSince).toBe(ev.created_at);
    expect(seats[third]?.timeoutTarget(ev.created_at + deadline - 1)).toBeNull();
    expect(seats[third]?.timeoutTarget(ev.created_at + deadline)).toBe(next);
  });

  it('owes no share duty once a timeout has ended the game', () => {
    const { ev, drawer, next, third, seats, all, drawn } = afterFirstDraw();
    const due = ev.created_at + 259200;
    const claim = (seats[third] as GameSession).buildTimeout(next, game.rnd, due);
    expect(statuses(deliver(all, [claim], undefined, due))).toEqual(Array(4).fill('accepted'));
    // The other seats still have not shared the drawn tile, but only the attestation can be due now.
    for (const [k, s] of seats.entries()) {
      expect(s.view().phase).toBe('done');
      expect(s.duties()).toEqual([{ kind: 'attest' }]);
      expect(unshared(game, log.slice(0, log.indexOf(ev) + 1), stateOf(s), k)).toEqual(
        k === drawer ? [] : drawn,
      );
    }
  });

  it('owes no share duty in the deal phase: the deal duty covers it', () => {
    const firstDeal = log[SEATS] as NostrEvent;
    const s = seenUpTo(log[SEATS + 1] as NostrEvent, 1);
    expect(s.view().phase).toBe('deal');
    expect(unshared(game, log.slice(0, log.indexOf(firstDeal) + 1), stateOf(s), 1).length).toBeGreaterThan(0);
    expect(s.duties()).toEqual([{ kind: 'deal' }]);
  });

  it('stores a move whose owed share is only in an earlier Shares event, and accepts it once that arrives', () => {
    const s = sessionBefore(early.shares);
    const head = s.view().head;
    expect(s.receive(early.move, T0 + 5000)).toEqual({ status: 'stored' });
    expect(s.view().head).toEqual(head);
    expect(s.receive(early.shares, T0 + 5000)).toEqual({ status: 'accepted' });
    expect(s.view().head.id).toBe(early.move.id);
    // The rest of the game follows, to the same view as the spectator that saw everything in order.
    const rest = log.slice(log.indexOf(early.move) + 1);
    expect(statuses(deliver([s], rest)).filter((r) => r !== 'accepted')).toEqual([]);
    expect(canonicalJson(s.view())).toBe(canonicalJson(spectator.view()));
  });

  it('rejects a move whose reveal is not the claimed card', () => {
    const ev = moves.find((m) => actionOf(m).type === 'place') as NostrEvent;
    const s = sessionBefore(ev);
    const state = stateOf(s);
    const real = contentOf(ev).action as Place;
    // Claim another tile the module would accept from the spectator's view, with the same reveal share.
    const tile = state.board
      .map((_, i) => tileId(i))
      .find((tile) => tile !== real.tile && chainReaction.apply(state, { ...real, tile }).ok);
    expect(tile).toBeDefined();
    const forged = resign(ev, real.actor, (c) => ({ ...c, action: { ...real, tile } }));
    expect(s.receive(forged, T0 + 5000)).toEqual({
      status: 'rejected',
      reason: `the reveal of position ${real.pos} is not the claimed card`,
    });
    expect(s.view().head.id).toBe(parseMove(ev, DECK).prevId);
  });

  it('rejects a move with a share that does not verify', () => {
    const ev = moves.find((m) => contentOf(m).shares.length > 0) as NostrEvent;
    const seat = actionOf(ev).actor;
    const s = sessionBefore(ev);
    const [first] = contentOf(ev).shares;
    const pos = first?.pos as number;
    // The signer's own deal share for another position, under this position.
    const deal = parseShares(log[SEATS + seat] as NostrEvent).shares.find((x) => x.pos !== pos);
    const forged = resign(ev, seat, (c) => ({
      ...c,
      shares: c.shares.map((x) => (x.pos === pos ? { pos, share: deal?.share as typeof x.share } : x)),
    }));
    expect(s.receive(forged, T0 + 5000)).toEqual({
      status: 'rejected',
      reason: `the share for position ${pos} does not verify`,
    });
    expect(s.view().head.id).toBe(parseMove(ev, DECK).prevId);
  });

  it('rejects a move signed by a seat that is not pending, and an action the module rejects', () => {
    const ev = moves[0] as NostrEvent;
    const seat = actionOf(ev).actor;
    const other = (seat + 1) % SEATS;
    const s = sessionBefore(ev);
    expect(s.receive(resign(ev, other), T0 + 5000)).toEqual({
      status: 'rejected',
      reason: `move ${SEATS + 1} must be signed by seat ${seat}`,
    });
    const illegal = resign(ev, seat, (c) => ({ ...c, action: { type: 'buy', actor: seat, buys: [] } }));
    const r = s.receive(illegal, T0 + 5000);
    expect(r.status).toBe('rejected');
    expect((r as { reason: string }).reason).toMatch(/^the module rejects the action: /);
    expect(s.view().head.id).toBe(parseMove(ev, DECK).prevId);
    expect(s.view().forfeits).toEqual([]);
    // The genuine move on the same prev by the same seat still links: the invalid one never counts.
    expect(s.receive(ev, T0 + 5000)).toEqual({ status: 'accepted' });
    expect(s.view().head.id).toBe(ev.id);
    expect(s.view().forfeits).toEqual([]);
    expect(s.view().phase).toBe('play');
  });

  it('flags two valid rivals; the lowest id is the head until the other branch grows longer, in any order', () => {
    const real = moves[rival.index] as NostrEvent;
    const seat = actionOf(real).actor;
    const viewer = (seat + 1) % SEATS;
    const [lo, hi] = [real, rival.move].sort((a, b) => (a.id < b.id ? -1 : 1)) as [NostrEvent, NostrEvent];
    // A move built on the higher-id rival by the seat that decides next on that branch.
    let ext: NostrEvent;
    if (hi === real) ext = moves[rival.index + 1] as NostrEvent;
    else {
      const look = sessionBefore(real);
      look.receive(hi, T0 + 5000);
      const next = (look.view().pending as { seat: number }).seat;
      const builder = sessionBefore(real, next);
      expect(builder.receive(hi, T0 + 5000)).toEqual({ status: 'accepted' });
      ext = builder.buildAction(builder.legalActions()[0], game.rnd, T0 + 5001);
    }

    const views = [
      [lo, hi, ext],
      [hi, lo, ext],
      [ext, hi, lo],
    ].map((events, n) => {
      const s = sessionBefore(real, viewer);
      const [a, b, c] = events as [NostrEvent, NostrEvent, NostrEvent];
      if (n < 2) {
        expect(statuses(deliver([s], [a, b]))).toEqual(['accepted', 'accepted']);
        // Both rivals are depth 1: the lower id is the head, and the seat is flagged. Play goes on.
        expect(s.view().head.id).toBe(lo.id);
        expect(s.view().equivocators).toEqual([seat]);
        expect(s.view().forfeits).toEqual([seat]);
        expect(s.view().phase).toBe('play');
        expect(s.receive(c, T0 + 5000)).toEqual({ status: 'accepted' });
      } else {
        expect(statuses(deliver([s], events))).toEqual(['stored', 'accepted', 'accepted']);
      }
      // The branch through the higher id is now longer, so it wins.
      expect(s.view().head.id).toBe(ext.id);
      expect(s.view().equivocators).toEqual([seat]);
      expect(s.view().outcome).toBeNull();
      expect(statuses(deliver([s], events))).toEqual(['duplicate', 'duplicate', 'duplicate']);
      return canonicalJson(s.view());
    });
    expect(new Set(views).size).toBe(1);
  });

  it('misshapen steps are not candidates: two shuffle steps signed by one wrong seat are not equivocation', () => {
    const step = log[0] as NostrEvent;
    const a = resign<Extract<MoveContent, { type: 'shuffle' }>>(step, 1);
    const b = resign<Extract<MoveContent, { type: 'shuffle' }>>(step, 1, (c) => c, T0 + 101);
    const views = [
      [a, b],
      [b, a],
    ].map((pair) => {
      const s = newSession(game, null);
      const reason = 'shuffle step 1 must be signed by seat 0';
      expect(deliver([s], pair).flat()).toEqual([
        { status: 'rejected', reason },
        { status: 'rejected', reason },
      ]);
      expect(s.view().forfeits).toEqual([]);
      // The genuine step 1 still links.
      expect(s.receive(step, T0 + 5000)).toEqual({ status: 'accepted' });
      return canonicalJson(s.view());
    });
    expect(views[0]).toBe(views[1]);
    expect(JSON.parse(views[0] as string).head.id).toBe(step.id);
  });
});
