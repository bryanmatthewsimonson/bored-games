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
 * - but a stale rival that ends the game (here a declared end) beats a longer chain that has not ended: the game
 *   is cut back to that old position and ends there.
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

  it('in play: a stale rival that declares the end reorganizes the game, which ends at that old position', () => {
    const { seat, ev } = rivalAt(beforeDeclare, (legal) => legal.find(isDeclare));
    const watcher = catchUp(game, null, mid);
    expect(watcher.view().head.seq).toBeGreaterThan(beforeDeclare.length);
    expect(watcher.receive(ev, LATE)).toEqual({ status: 'accepted' });
    const v = watcher.view();
    // Reaching `over` beats length (D030 Ruling 9): the moves played since are cut off the chain.
    expect(v.head.id).toBe(ev.id);
    expect(v.phase).toBe('end');
    expect(v.equivocators).toEqual([seat]);
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
