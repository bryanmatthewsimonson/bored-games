import { chainReaction } from '@bored-games/chain-reaction';
import { canonicalJson, createRng, type Rng } from '@bored-games/game-kit';
import { finalizeEvent, type NostrEvent } from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { rankWithForfeits } from '../src/audit.ts';
import type { GameSession } from '../src/session.ts';
import type { SessionView } from '../src/types.ts';
import { catchUp, deliver, LATE, makeGame, newSession, shuffleAll, statuses, T0 } from './helpers.ts';

/*
 * What protocol v1 does with a stale rival (D056, the stale outbox): a seat's own old device publishes, late, a
 * move it saved for a turn the seat then played differently on another device. These tests pin the answer that
 * PROTOCOL §11 ("A stale rival") records:
 * - it is an equivocation: the seat is flagged and forfeits (ranked last), even in a game that is already over,
 *   whose result then changes after it was attested;
 * - fork choice does not reorganize for it while it is shorter and does not reach the module's `over`;
 * - a stale rival that ends the game (here a declared end) no longer rewinds a longer chain that has not ended once
 *   every other seat has played on that chain since the fork (D056, "the late ending rival"): before D056 it cut
 *   the game back to that old position and ended it there, which let a seat out of contention pick the others'
 *   order (rated kingmaking). A real end raced by a move of the same seat still stands while some other seat has
 *   not played on the live chain.
 * The web controller never publishes such a move (D056); these tests describe what happens if a seat does.
 */

const SEATS = 3;
const LONG = 600_000;

type Action = { type: string; actor: number; declareEnd?: boolean };

const isDeclare = (a: unknown): boolean => (a as Action).declareEnd === true;

describe('a late rival from the same seat (the stale-outbox question, D056)', () => {
  const game = makeGame(SEATS, 'client-stale-rival', { ...chainReaction.defaultRules(), endSize: 4 });
  /** Every event in publication order, and the moves alone. */
  const log: NostrEvent[] = [];
  const moves: NostrEvent[] = [];
  /** The seat that signed each move, by id. */
  const signer = new Map<string, number>();
  /** The log while the game was still in play, a few moves after the first chance to declare the end. */
  let mid: NostrEvent[];
  /** The first position where the pending seat could declare the end (it did not): the log before that move. */
  let beforeDeclare: NostrEvent[];
  /** An earlier position where the pending seat had several legal actions: the log before that move. */
  let beforeChoice: NostrEvent[];
  let done: SessionView;

  beforeAll(() => {
    const players = [0, 1, 2].map((seat) => newSession(game, seat));
    const spectator = newSession(game, null);
    const all = [...players, spectator];
    const publish = (ev: NostrEvent): void => {
      const results = statuses(deliver(all, [ev]));
      if (results.some((r) => r !== 'accepted'))
        throw new Error(`event ${log.length}: ${results.join(', ')}`);
      log.push(ev);
    };
    log.push(...shuffleAll(game, players, [spectator]));
    for (const [k, s] of players.entries()) publish(s.buildDeal(game.rnd, T0 + 200 + k));
    const rng: Rng = createRng('client-stale-rival-policy');
    let t = T0 + 1000;
    let after = -1;
    while (spectator.view().phase === 'play') {
      if (moves.length > 600) throw new Error('the game does not end');
      const pending = spectator.view().pending as { seat: number };
      const s = players[pending.seat] as GameSession;
      const legal = s.legalActions();
      const declares = legal.filter(isDeclare);
      const others = legal.filter((a) => !isDeclare(a));
      if (beforeChoice === undefined && moves.length > 0 && others.length >= 2) beforeChoice = [...log];
      if (beforeDeclare === undefined && declares.length > 0) {
        beforeDeclare = [...log];
        after = moves.length;
      }
      // Play on without declaring for a few moves after the first chance, then end the game at the next one.
      const playOn = after < 0 || moves.length < after + 4;
      if (!playOn && mid === undefined) mid = [...log];
      const action =
        !playOn && declares.length > 0 ? declares[0] : rng.pick(others.length > 0 ? others : legal);
      const ev = s.buildAction(action, game.rnd, t++);
      publish(ev);
      moves.push(ev);
      signer.set(ev.id, pending.seat);
    }
    for (const s of players) publish(s.buildSecret(game.rnd, t++));
    for (const [k, s] of players.entries())
      publish(finalizeEvent(s.attestTemplate(t++), game.npubSks[k] as Uint8Array, game.rnd));
    done = spectator.view();
  }, LONG);

  /** A rival to the move that followed `prefix`, by the same seat: built by that seat's session at that position. */
  function rivalAt(
    prefix: readonly NostrEvent[],
    pick: (legal: readonly unknown[], played: string) => unknown,
  ) {
    const probe = catchUp(game, null, prefix);
    const seat = (probe.view().pending as { seat: number }).seat;
    const s = catchUp(game, seat, prefix);
    const played = canonicalJson(
      (JSON.parse((log[prefix.length] as NostrEvent).content) as Action & { action: unknown }).action,
    );
    const action = pick(s.legalActions(), played);
    return { seat, ev: s.buildAction(action, game.rnd, LATE) };
  }

  const otherAction = (legal: readonly unknown[], played: string): unknown =>
    legal.find((a) => !isDeclare(a) && canonicalJson(a) !== played);

  it('in play: an ordinary stale rival flags its seat, and the chain does not move', () => {
    expect(mid.length).toBeGreaterThan(beforeChoice.length);
    const { seat, ev } = rivalAt(beforeChoice, otherAction);
    const watcher = catchUp(game, null, mid);
    const head = watcher.view().head;
    expect(watcher.receive(ev, LATE)).toEqual({ status: 'accepted' });
    const v = watcher.view();
    expect(v.phase).toBe('play');
    expect(v.head).toEqual(head);
    expect(v.equivocators).toEqual([seat]);
    expect(v.forfeits).toEqual([seat]);
  });

  /** The seats that signed a move in `events` from index `from` on. */
  const signersFrom = (events: readonly NostrEvent[], from: number): Set<number> =>
    new Set(events.slice(from).flatMap((ev) => (signer.has(ev.id) ? [signer.get(ev.id) as number] : [])));

  it('in play: a stale ending rival does not rewind a chain every other seat played on since the fork', () => {
    const { seat, ev } = rivalAt(beforeDeclare, (legal) => legal.find(isDeclare));
    // Every seat but the rival's signer played on the live chain after the fork.
    const others = signersFrom(mid, beforeDeclare.length);
    for (let k = 0; k < SEATS; k++) if (k !== seat) expect(others.has(k)).toBe(true);
    const watcher = catchUp(game, null, mid);
    const head = watcher.view().head;
    expect(head.seq).toBeGreaterThan(beforeDeclare.length);
    expect(watcher.receive(ev, LATE)).toEqual({ status: 'accepted' });
    const v = watcher.view();
    // Before D056 this cut the game back to the rival and ended it there (Ruling 9 alone).
    expect(v.head).toEqual(head);
    expect(v.phase).toBe('play');
    expect(v.outcome).toBeNull();
    expect(v.equivocators).toEqual([seat]);
    expect(v.forfeits).toEqual([seat]);
    // Whatever the arrival order: a device that holds the rival first ends up on the same chain.
    const early = catchUp(game, null, [...beforeDeclare, ev]);
    expect(early.view().phase).toBe('end');
    for (const later of mid.slice(beforeDeclare.length)) early.receive(later, LATE);
    expect(early.view().head).toEqual(head);
    expect(early.view().phase).toBe('play');
    expect(early.view().forfeits).toEqual([seat]);
  });

  it('an honest secret revealed for the end freezes it: a settled live chain no longer reopens the game', () => {
    // The attack this closes: the ender's colluder withholds its move on the live chain, the ender publishes the
    // ending rival, the honest seats see the game end and reveal their deck secrets, then the colluder's move
    // settles the live chain and the game would go on with their hands public. Once a seat other than the ender has
    // revealed its secret, an ending branch beats any branch that does not end (Ruling 9 as it was).
    const { seat, ev } = rivalAt(beforeDeclare, (legal) => legal.find(isDeclare));
    const honest = (seat + 1) % SEATS;
    const ended = catchUp(game, honest, [...beforeDeclare, ev]);
    expect(ended.view().phase).toBe('end');
    const secret = ended.buildSecret(game.rnd, LATE);
    for (const order of [
      [ev, secret],
      [secret, ev],
    ]) {
      const watcher = catchUp(game, null, mid);
      const head = watcher.view().head;
      for (const e of order) expect(watcher.receive(e, LATE).status).not.toBe('rejected');
      const v = watcher.view();
      expect(v.head.id).toBe(ev.id);
      expect(v.head).not.toEqual(head);
      expect(v.phase).toBe('end');
      expect(v.equivocators).toEqual([seat]);
    }
    // Such an end, holding only by the freeze, is unrated with the forker recorded (D056 fix round 2): a colluder
    // that reveals its secret early buys no rated result.
    const secrets = [0, 1, 2].map((k) =>
      k === honest ? secret : catchUp(game, k, [...beforeDeclare, ev]).buildSecret(game.rnd, LATE),
    );
    const frozen = catchUp(game, null, mid);
    for (const e of [ev, ...secrets]) frozen.receive(e, LATE);
    expect(frozen.view().phase).toBe('done');
    expect(frozen.view().outcome?.unrated).toBe(true);
    expect(frozen.view().outcome?.endedBy).toEqual({ type: 'fork', seat });
    expect(frozen.view().outcome?.places[seat]).toBe(SEATS);
    // The same end won without the freeze (the live chain not settled) stays rated.
    const raced = catchUp(game, null, [...beforeDeclare, ev, ...secrets]);
    raced.receive(log[beforeDeclare.length] as NostrEvent, LATE);
    expect(raced.view().phase).toBe('done');
    expect(raced.view().head.id).toBe(ev.id);
    expect(raced.view().outcome?.unrated).toBeUndefined();
    expect(raced.view().outcome?.places[seat]).toBe(SEATS);
    // The ender's own secret freezes nothing: it could otherwise force its rewind alone.
    const own = catchUp(game, seat, [...beforeDeclare, ev]).buildSecret(game.rnd, LATE);
    const watcher = catchUp(game, null, mid);
    const head = watcher.view().head;
    watcher.receive(own, LATE);
    watcher.receive(ev, LATE);
    expect(watcher.view().head).toEqual(head);
    expect(watcher.view().phase).toBe('play');
  });

  it('a real end raced by a move of the same seat still stands while another seat has not played on', () => {
    const { seat, ev } = rivalAt(beforeDeclare, (legal) => legal.find(isDeclare));
    // The live chain: the seat's other move, then moves up to (not including) the one that would make every other
    // seat a signer since the fork.
    let cut = beforeDeclare.length + 1;
    for (; cut < mid.length; cut++) {
      const seen = signersFrom(mid.slice(0, cut + 1), beforeDeclare.length);
      if ([...Array(SEATS).keys()].every((k) => k === seat || seen.has(k))) break;
    }
    const live = mid.slice(0, cut);
    expect(live.length).toBeGreaterThan(beforeDeclare.length);
    for (const order of [
      [...live, ev],
      [...beforeDeclare, ev, ...live.slice(beforeDeclare.length)],
    ]) {
      const watcher = catchUp(game, null, beforeDeclare);
      for (const e of order.slice(beforeDeclare.length))
        expect(watcher.receive(e, LATE).status).not.toBe('rejected');
      const v = watcher.view();
      // Reaching `over` beats a longer chain that is not settled (Ruling 9, kept by D056).
      expect(v.head.id).toBe(ev.id);
      expect(v.phase).toBe('end');
      expect(v.equivocators).toEqual([seat]);
      expect(v.forfeits).toEqual([seat]);
    }
  });

  it('residual: a real end is lost when every other seat plays past it (the ender is flagged and ranked last)', () => {
    // The coalition case: the seat declares the end (a real, legitimate end) and also signs the move the log played;
    // every other seat then plays on that live chain (colluding, or never shown the end). Settled beats ending, so
    // the end is lost; the only cost is the ender's place. It takes every other seat's signed move on the live
    // chain: a seat whose client held the end never builds one.
    const { seat, ev } = rivalAt(beforeDeclare, (legal) => legal.find(isDeclare));
    const watcher = catchUp(game, null, [...beforeDeclare, ev]);
    expect(watcher.view().phase).toBe('end');
    for (const later of log.slice(beforeDeclare.length)) watcher.receive(later, LATE);
    const v = watcher.view();
    expect(v.head).toEqual(done.head);
    expect(v.phase).toBe('done');
    expect(v.equivocators).toEqual([seat]);
    const declared = done.outcome as NonNullable<SessionView['outcome']>;
    expect(v.outcome).toEqual(rankWithForfeits(declared.scores, [seat], declared.places));
    expect(v.outcome?.places[seat]).toBe(SEATS);
  });

  it('after the end: a stale rival flags its seat and changes the attested result, though the chain stays', () => {
    expect(done.phase).toBe('done');
    expect(done.attested).toEqual([0, 1, 2]);
    const { seat, ev } = rivalAt(beforeChoice, otherAction);
    const watcher = catchUp(game, null, log);
    expect(watcher.receive(ev, LATE)).toEqual({ status: 'accepted' });
    const v = watcher.view();
    expect(v.phase).toBe('done');
    expect(v.head).toEqual(done.head);
    expect(v.equivocators).toEqual([seat]);
    const declared = done.outcome as NonNullable<SessionView['outcome']>;
    expect(v.outcome).toEqual(rankWithForfeits(declared.scores, [seat], declared.places));
    const unchanged = canonicalJson(v.outcome) === canonicalJson(declared);
    expect(v.attested).toEqual(unchanged ? [0, 1, 2] : []);
  });

  it('after the end: an earlier declared end does not displace the longer finished chain, but flags its seat', () => {
    const { seat, ev } = rivalAt(beforeDeclare, (legal) => legal.find(isDeclare));
    const watcher = catchUp(game, null, log);
    expect(watcher.receive(ev, LATE)).toEqual({ status: 'accepted' });
    const v = watcher.view();
    expect(v.head).toEqual(done.head);
    expect(v.equivocators).toEqual([seat]);
    expect(v.forfeits).toContain(seat);
  });
});
