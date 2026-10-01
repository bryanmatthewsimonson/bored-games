import { chainReaction } from '@bored-games/chain-reaction';
import { canonicalJson, createRng, type Rng } from '@bored-games/game-kit';
import {
  finalizeEvent,
  getPublicKey,
  type Hex,
  type MoveContent,
  moveTemplate,
  type NostrEvent,
  type ParsedMove,
  parseMove,
  parseShares,
  sharesTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { rankWithForfeits } from '../src/audit.ts';
import type { GameSession } from '../src/session.ts';
import type { SessionView } from '../src/types.ts';
import { catchUp, deliver, LATE, makeGame, newSession, shuffleAll, statuses, T0, trust } from './helpers.ts';

/*
 * Fork choice at the end of a game and under junk (D030 Ruling 9): a branch that reaches the module's `over` beats
 * one that does not, whatever its length, so a finished game cannot be reopened; and junk pooled under a rival
 * that cannot link does not slow the session down.
 */

const SEATS = 3;
const DECK = 108;
const LONG = 600_000;

type ActionContent = Extract<MoveContent, { type: 'action' }>;
type Action = { type: string; actor: number; declareEnd?: boolean };

const contentOf = (ev: NostrEvent): ActionContent => parseMove(ev, DECK).content as ActionContent;
const actorOf = (ev: NostrEvent): number => (contentOf(ev).action as Action).actor;

/** The uniform fuzz policy, except that it declares the end whenever it may, so games end quickly. */
function choose(legal: readonly unknown[], rng: Rng): unknown {
  return (legal as Action[]).find((a) => a.declareEnd === true) ?? rng.pick(legal);
}

describe('fork choice: a finished game stays finished, and junk does not slow it down', () => {
  // A short game: the end may be declared once a chain reaches 4 tiles.
  const game = makeGame(SEATS, 'client-fork', { ...chainReaction.defaultRules(), endSize: 4 });
  let spectator: GameSession;
  /** Every event in publication order. */
  const log: NostrEvent[] = [];
  /** The shuffle steps and the deals. */
  let setup: NostrEvent[];
  const moves: NostrEvent[] = [];
  let done: SessionView;

  /** `ev` re-signed by its signer with its content changed by `edit`, and a later `created_at`. */
  function resign(ev: NostrEvent, edit: (c: ActionContent) => ActionContent, bump = 1): NostrEvent {
    const m: ParsedMove = parseMove(ev, DECK);
    const sk = game.ids[actorOf(ev)]?.sessionSk as Uint8Array;
    const t = moveTemplate(
      { rootId: m.rootId, prevId: m.prevId, seq: m.seq, content: edit(m.content as ActionContent) },
      m.createdAt + bump,
    );
    return finalizeEvent(t, sk, game.rnd);
  }

  /** A rival to the final move: the same endTurn without `declareEnd`, with an id below the original's. */
  function rivalToFinal(): NostrEvent {
    const final = moves[moves.length - 1] as NostrEvent;
    for (let bump = 1; ; bump++) {
      const r = resign(
        final,
        (c) => ({ ...c, action: { ...(c.action as object), declareEnd: false } }),
        bump,
      );
      if (r.id < final.id) return r;
    }
  }

  beforeAll(() => {
    const players = [0, 1, 2].map((seat) => newSession(game, seat));
    spectator = newSession(game, null);
    const all = [...players, spectator];
    const publish = (ev: NostrEvent): void => {
      const results = statuses(deliver(all, [ev]));
      if (results.some((r) => r !== 'accepted'))
        throw new Error(`event ${log.length}: ${results.join(', ')}`);
      log.push(ev);
    };
    log.push(...shuffleAll(game, players, [spectator]));
    for (const [k, s] of players.entries()) publish(s.buildDeal(game.rnd, T0 + 200 + k));
    setup = [...log];
    const rng = createRng('client-fork-policy');
    let t = T0 + 1000;
    while (spectator.view().phase === 'play') {
      if (moves.length > 500) throw new Error('the game does not end');
      const pending = spectator.view().pending as { seat: number };
      const s = players[pending.seat] as GameSession;
      const ev = s.buildAction(choose(s.legalActions(), rng), game.rnd, t++);
      publish(ev);
      moves.push(ev);
    }
    for (const s of players) publish(s.buildSecret(game.rnd, t++));
    for (const [k, s] of players.entries()) {
      publish(finalizeEvent(s.attestTemplate(t++), game.npubSks[k] as Uint8Array, game.rnd));
    }
    done = spectator.view();
  }, LONG);

  it('does not reopen a done game for a rival to the final move with a lower id; it flags the seat', () => {
    expect(done.phase).toBe('done');
    expect(done.audit).toBe('pass');
    expect(done.attested).toEqual([0, 1, 2]);
    const x = actorOf(moves[moves.length - 1] as NostrEvent);
    const rival = rivalToFinal();
    const watcher = catchUp(game, null, log);
    expect(watcher.receive(rival, LATE)).toEqual({ status: 'accepted' });
    const v = watcher.view();
    expect(v.phase).toBe('done');
    expect(v.head).toEqual(done.head);
    expect(v.logHash).toBe(done.logHash);
    expect(v.audit).toBe('pass');
    expect(v.equivocators).toEqual([x]);
    expect(v.forfeits).toEqual([x]);
    // The equivocator moves to the last place (R5); the honest attestations named the result before that.
    const declared = done.outcome as NonNullable<SessionView['outcome']>;
    expect(v.outcome).toEqual(rankWithForfeits(declared.scores, [x], declared.places));
    const unchanged = canonicalJson(v.outcome) === canonicalJson(declared);
    expect(v.attested).toEqual(unchanged ? [0, 1, 2] : []);

    // The same events with the rival delivered before the final move give the same view.
    const early = newSession(game, null);
    const at = log.indexOf(moves[moves.length - 1] as NostrEvent);
    const reordered = [...log.slice(0, at), rival, ...log.slice(at)];
    trust([early], setup);
    deliver([early], reordered, undefined, LATE);
    expect(canonicalJson(early.view())).toBe(canonicalJson(v));
  });

  it('does not reopen a done game for a longer branch that replaces the last turn', () => {
    const final = moves[moves.length - 1] as NostrEvent;
    const rival = rivalToFinal();
    // The next seat plays on after the rival, as a seat that saw only the rival would.
    const before = log.slice(0, log.indexOf(final));
    const probe = catchUp(game, null, [...before, rival]);
    const next = (probe.view().pending as { seat: number }).seat;
    const y = catchUp(game, next, [...before, rival]);
    const legal = y.legalActions();
    expect(legal.length).toBeGreaterThan(0);
    const follow = y.buildAction(legal[0], game.rnd, LATE);
    const watcher = catchUp(game, null, log);
    deliver([watcher], [follow, rival], undefined, LATE);
    const v = watcher.view();
    expect(v.phase).toBe('done');
    expect(v.head).toEqual(done.head);
    expect(v.outcome).not.toBeNull();
    expect(v.equivocators).toEqual([actorOf(final)]);
  });

  it('processes honest events at the usual speed with 300 junk moves pooled under a rival that waits on R1', () => {
    // An early move whose signer owed shares: its rival without them is valid except for R1, so it never links.
    // The honest event comes many moves later, so a fork trial at the rival's prev would refold a long tail.
    const k = moves.findIndex((ev, i) => i > 0 && contentOf(ev).shares.length > 0);
    expect(k).toBeGreaterThan(0);
    expect(moves.length - 2 - k).toBeGreaterThan(10);
    const prefix = [...setup, ...moves.slice(0, moves.length - 2)];
    const next = moves[moves.length - 2] as NostrEvent;
    const trials = (s: GameSession): number => (s as unknown as { trials: number }).trials;
    const time = (s: GameSession): { ms: number; trials: number } => {
      const before = trials(s);
      const start = performance.now();
      expect(s.receive(next, LATE)).toEqual({ status: 'accepted' });
      return { ms: performance.now() - start, trials: trials(s) - before };
    };
    const baseline = time(catchUp(game, null, prefix));

    const attacked = catchUp(game, null, prefix);
    const rival = resign(moves[k] as NostrEvent, (c) => ({ ...c, shares: [] }));
    expect(attacked.receive(rival, LATE)).toEqual({ status: 'accepted' });
    const signer = actorOf(rival);
    const atRival = trials(attacked);
    let prev = rival;
    for (let i = 0; i < 300; i++) {
      const m = parseMove(prev, DECK);
      const t = moveTemplate(
        {
          rootId: game.rootId,
          prevId: prev.id,
          seq: m.seq + 1,
          content: { type: 'action', action: { type: 'junk', i }, reveals: [], shares: [] },
        },
        LATE + i,
      );
      prev = finalizeEvent(t, game.ids[signer]?.sessionSk as Uint8Array, game.rnd);
      expect(attacked.receive(prev, LATE)).toEqual({ status: 'stored' });
    }
    // The junk under the stuck rival triggers no fork trial, nor does the honest event after it.
    expect(trials(attacked)).toBe(atRival);
    const slow = time(attacked);
    expect(slow.trials).toBe(baseline.trials);
    // A loose sanity bound only: wall-clock samples are noisy under parallel test runs.
    expect(slow.ms).toBeLessThan(Math.max(10 * baseline.ms, 1000));
    expect(attacked.view().head.id).toBe(next.id);
    expect(attacked.view().equivocators).toEqual([signer]);
  });

  it('does not re-try a fork for an earlier-seen copy of a kept share: only new shares bump the share version', () => {
    const k = moves.findIndex((ev, i) => i > 0 && contentOf(ev).shares.length > 0);
    const prefix = [...setup, ...moves.slice(0, moves.length - 2)];
    const next = moves[moves.length - 2] as NostrEvent;
    const rival = resign(moves[k] as NostrEvent, (c) => ({ ...c, shares: [] }));
    // Seat 0's deal, re-signed in part: the same shares (same D), so nothing new.
    const deal = setup[SEATS] as NostrEvent;
    const copy = finalizeEvent(
      sharesTemplate(
        { rootId: game.rootId, shares: parseShares(deal).shares.slice(0, 2) },
        deal.created_at - 1,
      ),
      game.ids[0]?.sessionSk as Uint8Array,
      game.rnd,
    );
    const trials = (s: GameSession): number => (s as unknown as { trials: number }).trials;
    const run = (extra: NostrEvent[]): number => {
      const s = catchUp(game, null, prefix);
      expect(s.receive(rival, LATE)).toEqual({ status: 'accepted' });
      const before = trials(s);
      // First seen before the original deal was.
      for (const ev of extra) expect(s.receive(ev, T0)).toEqual({ status: 'duplicate' });
      expect(s.receive(next, LATE)).toEqual({ status: 'accepted' });
      return trials(s) - before;
    };
    expect(run([copy])).toBe(run([]));
    expect(run([])).toBe(0);
  });

  it('rejects an invalid move that arrived before its prev and lost to a sibling, as when it arrives last', () => {
    // At the final move: once the chain is over, a short side branch is not tried, so only judging it rejects it.
    const j = moves.length - 1;
    const prev = moves[j - 1] as NostrEvent;
    const honest = moves[j] as NostrEvent;
    // An invalid sibling of the honest move by the same seat, with a higher id.
    let bad: NostrEvent = honest;
    for (let bump = 1; bad.id <= honest.id; bump++) {
      bad = resign(honest, (c) => ({ ...c, action: { type: 'junk', actor: actorOf(honest) } }), bump);
    }
    const base = [...setup, ...moves.slice(0, j - 1)];
    const early = catchUp(game, null, base);
    expect(statuses(deliver([early], [bad, honest, prev], undefined, LATE))).toEqual([
      'stored',
      'stored',
      'accepted',
    ]);
    expect(early.view().head.id).toBe(honest.id);
    const late = catchUp(game, null, base);
    expect(statuses(deliver([late], [prev, honest], undefined, LATE))).toEqual(['accepted', 'accepted']);
    const r = late.receive(bad, LATE);
    expect(r.status).toBe('rejected');
    expect(early.receive(bad, LATE)).toEqual(r);
    expect(canonicalJson(early.view())).toBe(canonicalJson(late.view()));
  });

  it(
    'Ruling 12: a late flood of shuffle rivals changes only the flags, in any order, at bounded cost',
    () => {
      const [s0, s1, s2] = setup as [NostrEvent, NostrEvent, NostrEvent];
      type ShuffleContent = Extract<MoveContent, { type: 'shuffle' }>;
      const shuffleOf = (ev: NostrEvent): ShuffleContent => parseMove(ev, DECK).content as ShuffleContent;
      const sk = (seat: number): Uint8Array => game.ids[seat]?.sessionSk as Uint8Array;
      const byId = (evs: NostrEvent[]): NostrEvent[] => [...evs].sort((a, b) => (a.id < b.id ? -1 : 1));
      const descending = (evs: NostrEvent[]): NostrEvent[] => byId(evs).reverse();
      /** A junk step `seq` on `prev` by `seat`: one step's deck with another's proof, so it never verifies. */
      const junk = (
        prev: NostrEvent,
        seq: number,
        deck: NostrEvent,
        proof: NostrEvent,
        i: number,
      ): NostrEvent =>
        finalizeEvent(
          moveTemplate(
            {
              rootId: game.rootId,
              prevId: prev.id,
              seq,
              content: { type: 'shuffle', deck: shuffleOf(deck).deck, proof: shuffleOf(proof).proof },
            },
            LATE + i,
          ),
          sk(seq - 1),
          game.rnd,
        );
      // Seat 1: a valid rival to its own step 2, and 4 junk steps.
      const seat1 = newSession(game, 1);
      trust([seat1], [s0]);
      expect(statuses(deliver([seat1], [s0], undefined, LATE))).toEqual(['accepted']);
      const valid = seat1.buildShuffle(game.rnd, LATE);
      const flood1 = [0, 1, 2, 3].map((i) => junk(s0, 2, s2, s1, i));
      // Seat 2, the last shuffler: 4 junk steps 3, the lowest-id one under a 40-move tail of its own game actions,
      // as if it could fake depth (acknowledgement) on its own.
      const flood2 = [0, 1, 2, 3].map((i) => junk(s1, 3, s1, s2, i));
      const tail: NostrEvent[] = [];
      let prev = byId(flood2)[0] as NostrEvent;
      for (let i = 0; i < 40; i++) {
        const t = moveTemplate(
          {
            rootId: game.rootId,
            prevId: prev.id,
            seq: SEATS + 1 + i,
            content: { type: 'action', action: { type: 'junk', i }, reveals: [], shares: [] },
          },
          LATE + i,
        );
        prev = finalizeEvent(t, sk(2), game.rnd);
        tail.push(prev);
      }
      const orders = [
        [...descending([...flood1, valid]), ...descending(flood2), ...tail],
        [...tail, ...descending([...flood1, valid]), ...descending(flood2)],
        [...[...tail].reverse(), ...byId(flood2), ...byId([...flood1, valid])],
      ];
      const checkedOf = (s: GameSession): Map<Hex, boolean> =>
        (s as unknown as { shuffleChecked: Map<Hex, boolean> }).shuffleChecked;
      const verifications = (s: GameSession): number =>
        (s as unknown as { shuffleVerifications: number }).shuffleVerifications;
      const views = orders.map((order) => {
        const s = catchUp(game, null, log);
        // The valid rival is trusted: the counter counts only real verifications, the junk's.
        trust([s], [valid]);
        const before = verifications(s);
        deliver([s], order, undefined, LATE);
        const v = s.view();
        expect(v.phase).toBe('done');
        expect(v.head).toEqual(done.head);
        expect(v.logHash).toBe(done.logHash);
        expect(v.equivocators).toEqual([1, 2]);
        expect(v.forfeits).toEqual([1, 2]);
        const checked = checkedOf(s);
        expect(flood1.filter((ev) => checked.has(ev.id)).length).toBeLessThanOrEqual(3);
        expect(flood2.filter((ev) => checked.has(ev.id)).length).toBeLessThanOrEqual(3);
        expect(verifications(s) - before).toBeLessThanOrEqual(6);
        return canonicalJson(v);
      });
      expect(new Set(views).size).toBe(1);
    },
    LONG,
  );

  it('does not overflow the stack with 20,000 pooled junk moves', () => {
    const watcher = catchUp(game, null, log);
    const rival = rivalToFinal();
    expect(watcher.receive(rival, LATE)).toEqual({ status: 'accepted' });
    // Junk pooled straight into the session (a test-only shortcut: signing 20,000 events is slow), in one chain.
    const signer = actorOf(rival);
    const pubkey = getPublicKey(game.ids[signer]?.sessionSk as Uint8Array);
    const pool = (watcher as unknown as { pool(m: ParsedMove): void }).pool.bind(watcher);
    let prevId: Hex = rival.id;
    const seq = parseMove(rival, DECK).seq;
    for (let i = 0; i < 20_000; i++) {
      const id = `e${i.toString(16).padStart(63, '0')}`;
      pool({
        id,
        pubkey,
        createdAt: LATE,
        rootId: game.rootId,
        prevId,
        seq: seq + 1 + i,
        content: { type: 'action', action: { type: 'junk', i }, reveals: [], shares: [] },
      });
      prevId = id;
    }
    // One more junk move, signed, makes the session settle and examine the fork.
    const t = moveTemplate(
      {
        rootId: game.rootId,
        prevId: rival.id,
        seq: seq + 1,
        content: { type: 'action', action: { type: 'junk', i: -1 }, reveals: [], shares: [] },
      },
      LATE,
    );
    const last = finalizeEvent(t, game.ids[signer]?.sessionSk as Uint8Array, game.rnd);
    // The fork trial finds it invalid; what matters is that nothing overflows.
    const r = watcher.receive(last, LATE);
    expect(r.status).toBe('rejected');
    expect('reason' in r ? r.reason : '').not.toMatch(/^internal error/);
    expect(watcher.view().phase).toBe('done');
    expect(watcher.view().head).toEqual(done.head);
  });
});
