import { bank, bankV1 } from '@bored-games/bank';
import { chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import { createRng } from '@bored-games/game-kit';
import { luster } from '@bored-games/luster';
import { finalizeEvent, KIND, type NostrEvent, tableTemplate } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { MemoryRelay } from '../src/memory-relay.ts';
import { type SimPolicy, type SimReport, simulateGame } from '../src/sim.ts';
import { type AdversaryName, adversary, lastAlone, quickPolicy, unexpected } from './adversaries.ts';
import { MODULES, makeGame, seededRandom, T0 } from './helpers.ts';

/*
 * Whole games between independent clients over the in-memory relay (Phase 2d Task 7). A 3-seat game takes a
 * minute or two of CPU even with a policy that declares the end as soon as it may, so only the games that end
 * during the shuffle and the deal run by default; `pnpm test:sim` (SIM=1) runs them all, and `pnpm sim` plays more.
 * The seat count is a parameter: the 3-seat games are the full set, 4 and 6 seats add an honest whole game each
 * (about 100 s and 227 s of CPU) under SIM=1, and one cheap 6-seat game that ends in the shuffle runs by default.
 *
 * Protocol 2 (build plan T19): the deckless games (Chess, Bank 0.2.0) play whole games by default, honest and with
 * each protocol 2 adversary (a fork that stops the game, a stale outbox, an honest seat on two devices); Chain
 * Reaction and Luster play the same under SIM=1. The protocol 1 games above keep running at protocol 1, and Bank
 * 0.1.0 still plays a protocol 1 game.
 */

const SIM = process.env.SIM !== undefined && process.env.SIM !== '';
/** The seat count of the full set of games. */
const SEATS = 3;
/** The cheating seat. */
const CHEAT = 1;
const LONG = 900_000;

/** Every game the sims play: the tests' registry plus Luster. */
const ALL = new Map([...MODULES, [luster.id, luster]]);

/**
 * The quick policy, but accepting a standing draw offer one time in twenty: the random Chess games end sooner (the
 * quick policy offers a draw with half of its moves, the legal list holding each move with and without an offer).
 */
const shortPolicy: SimPolicy = (state, seat, legal, rng) => {
  const accept = (legal as readonly { type?: string }[]).find((a) => a.type === 'acceptDraw');
  if (accept !== undefined && rng.float() < 0.05) return accept;
  return quickPolicy(state, seat, legal, rng);
};

/** A protocol 2 game of `game` with `name` at seat `CHEAT` (none for null). */
function simV2(
  game: string,
  seed: string,
  name: AdversaryName | null,
  seats: number,
  vanishAt = seats,
): SimReport {
  return simulateGame({
    seats,
    seed,
    modules: ALL,
    game,
    proto: 2,
    policy: shortPolicy,
    ...(name === null ? {} : { adversary: adversary(name, CHEAT, seats, vanishAt) }),
  });
}

/** `r` is what its adversary (or an honest game) should give, with no failure. */
function expectClean(r: SimReport): void {
  expect(r.failures).toEqual([]);
  expect(unexpected(r, CHEAT)).toEqual([]);
}

function sim(seed: string, name: AdversaryName | null, vanishAt = SEATS, seats = SEATS): SimReport {
  return simulateGame({
    seats,
    seed,
    modules: MODULES,
    game: chainReaction.id,
    proto: 1,
    policy: quickPolicy,
    ...(name === null ? {} : { adversary: adversary(name, CHEAT, seats, vanishAt) }),
  });
}

describe('MemoryRelay', () => {
  const game = makeGame(3, 'memory-relay');
  const events: NostrEvent[] = [game.table, ...game.joins, game.root];

  it('stores valid events once and drops invalid ones', () => {
    const relay = new MemoryRelay(createRng('relay'));
    for (const ev of events) expect(relay.publish(ev)).toBe(true);
    expect(relay.publish(game.root)).toBe(false);
    expect(relay.publish({ ...game.root, content: 'tampered' })).toBe(false);
    expect(
      relay.publish({ ...game.root, sig: game.root.sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) }),
    ).toBe(false);
    expect(relay.size).toBe(events.length);
  });

  it('answers filters by kind, author, id and tag, any of several filters matching', () => {
    const relay = new MemoryRelay(createRng('relay'));
    for (const ev of events) relay.publish(ev);
    const ids = (evs: NostrEvent[]): string[] => evs.map((e) => e.id).sort();
    const address = game.joins[0]?.tags.find((t) => t[0] === 'a')?.[1] as string;
    expect(ids(relay.query({ kinds: [KIND.join] }))).toEqual(ids(game.joins));
    expect(ids(relay.query({ kinds: [KIND.join, KIND.root], '#a': [address] }))).toEqual(
      ids([...game.joins, game.root]),
    );
    expect(ids(relay.query({ authors: [game.table.pubkey], kinds: [KIND.root] }))).toEqual([game.root.id]);
    expect(ids(relay.query({ '#e': [game.joins[1]?.id as string] }))).toEqual([game.root.id]);
    expect(ids(relay.query([{ ids: [game.table.id] }, { ids: [game.root.id] }]))).toEqual(
      ids([game.table, game.root]),
    );
    expect(relay.query({ kinds: [KIND.move] })).toEqual([]);
  });

  it('keeps only the latest version of an addressable event', () => {
    const relay = new MemoryRelay(createRng('relay'));
    relay.publish(game.table);
    const tags = game.table.tags.map((t) => (t[0] === 'status' ? ['status', 'started'] : t));
    const rnd = seededRandom('relay-table');
    const newer = finalizeEvent(
      { kind: game.table.kind, created_at: T0 + 50, tags, content: game.table.content },
      game.npubSks[0] as Uint8Array,
      rnd,
    );
    const older = finalizeEvent(
      { kind: game.table.kind, created_at: T0 - 50, tags, content: game.table.content },
      game.npubSks[0] as Uint8Array,
      rnd,
    );
    expect(relay.publish(newer)).toBe(true);
    expect(relay.publish(older)).toBe(false);
    expect(relay.query({ kinds: [KIND.table] })).toEqual([newer]);
    // A table with another `d` tag is another address.
    const other = finalizeEvent(
      tableTemplate(
        {
          tableId: 'other-table',
          game: chainReaction.id,
          version: chainReaction.version,
          seats: 2,
          deadline: 86400,
          invited: [],
          open: 1,
          relays: ['wss://relay.example.com'],
          status: 'open',
          rules: chainReaction.defaultRules(),
        },
        T0,
      ),
      game.npubSks[0] as Uint8Array,
      rnd,
    );
    expect(relay.publish(other)).toBe(true);
    expect(relay.query({ kinds: [KIND.table] })).toHaveLength(2);
  });

  it('permutes each answer with the reader’s rng', () => {
    const relay = new MemoryRelay(createRng('relay'));
    for (const ev of events) relay.publish(ev);
    const orders = new Set(
      Array.from({ length: 8 }, (_, i) =>
        relay
          .query({}, createRng(`reader-${i}`))
          .map((e) => e.id)
          .join(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
    // The same reader seed gives the same order.
    const a = relay.query({}, createRng('same')).map((e) => e.id);
    const b = relay.query({}, createRng('same')).map((e) => e.id);
    expect(a).toEqual(b);
  });
});

describe('simulated games that end before play', () => {
  it(
    'a seat that vanishes before the first game action is claimed against and the game is cancelled',
    () => {
      const r = sim('sim-vanish-early', 'vanish');
      expect(r.failures).toEqual([]);
      expect(unexpected(r, CHEAT)).toEqual([]);
      expect(r).toMatchObject({ phase: 'cancelled', outcome: null, forfeits: [CHEAT], actions: 0 });
      expect(r.claims).toBeGreaterThan(0);
      // The claim waits for the deadline: the game lasted at least a day after the root.
      expect(r.duration).toBeGreaterThanOrEqual(86400);
    },
    LONG,
  );

  it(
    'with 6 seats, seat 1 vanishing before its shuffle step cancels the game with that seat forfeiting',
    () => {
      // The chain is 1 move long (seat 0's shuffle step) when seat 1 is due, so it vanishes at atSeq 1.
      const r = sim('sim-vanish-shuffle-6', 'vanish', 1, 6);
      expect(r.failures).toEqual([]);
      expect(unexpected(r, CHEAT)).toEqual([]);
      expect(r).toMatchObject({ seats: 6, phase: 'cancelled', outcome: null, forfeits: [CHEAT], actions: 0 });
      expect(r.moves).toBe(1);
      expect(r.claims).toBeGreaterThan(0);
    },
    LONG,
  );

  it(
    'a shuffle step proven against the wrong input is rejected by everyone, then a timeout cancels the game',
    () => {
      const r = sim('sim-bad-shuffle', 'badShuffle');
      expect(r.failures).toEqual([]);
      expect(unexpected(r, CHEAT)).toEqual([]);
      expect(r).toMatchObject({ phase: 'cancelled', outcome: null, forfeits: [CHEAT] });
      // Only seat 0's step is on the chain.
      expect(r.moves).toBe(1);
      const [cheat] = r.cheats;
      expect(Object.keys(cheat?.last ?? {}).sort()).toEqual(['seat 0', 'seat 2', 'spectator']);
      expect(Object.values(cheat?.last ?? {})).toEqual(['rejected', 'rejected', 'rejected']);
    },
    LONG,
  );
});

describe.skipIf(!SIM)('simulated whole games (SIM=1)', () => {
  // The same honest game at more seats: the shuffle, the deal and the secrets all scale with the table.
  it.each([4, 6])(
    'an honest %i-seat game ends done, the audit passes and every seat attests',
    (seats) => {
      const r = sim(`sim-honest-${seats}`, null, seats, seats);
      expect(r.failures).toEqual([]);
      expect(r).toMatchObject({
        seats,
        phase: 'done',
        audit: 'pass',
        forfeits: [],
        equivocators: [],
        claims: 0,
      });
      expect(r.outcome?.reason).toBe('declared');
      expect(r.attested).toEqual(Array.from({ length: seats }, (_, i) => i));
      expect(r.actions).toBeGreaterThan(0);
    },
    LONG,
  );

  it(
    'an honest 3-seat game ends done, the audit passes, everyone agrees and every attestation is accepted',
    () => {
      const r = sim('sim-honest', null);
      expect(r.failures).toEqual([]);
      expect(r).toMatchObject({ phase: 'done', audit: 'pass', forfeits: [], equivocators: [], claims: 0 });
      expect(r.outcome?.reason).toBe('declared');
      expect(r.attested).toEqual([0, 1, 2]);
      expect(r.actions).toBeGreaterThan(0);
    },
    LONG,
  );

  it(
    'a move with a corrupt share is never accepted, and the game goes on to an honest end',
    () => {
      const r = sim('sim-bad-share', 'badShare');
      expect(r.failures).toEqual([]);
      expect(unexpected(r, CHEAT)).toEqual([]);
      expect(r).toMatchObject({ phase: 'done', audit: 'pass', forfeits: [] });
      expect(r.cheats).toHaveLength(1);
      expect(Object.values(r.cheats[0]?.statuses ?? {}).flat()).not.toContain('accepted');
      expect(r.attested).toEqual([0, 1, 2]);
    },
    LONG,
  );

  it(
    'a forged skipPlace is accepted in play, then the audit fails the seat and ranks it last',
    () => {
      const r = sim('sim-forged-skip', 'forgedSkip');
      expect(r.failures).toEqual([]);
      expect(unexpected(r, CHEAT)).toEqual([]);
      expect(r.phase).toBe('done');
      expect(r.audit).toMatchObject({ fail: [CHEAT] });
      expect(r.outcome?.reason).toBe('forfeit');
      expect(lastAlone(r.outcome?.places ?? [], CHEAT)).toBe(true);
      // Everyone, the cheat included, attests the failed audit.
      expect(r.attested).toEqual([0, 1, 2]);
    },
    LONG,
  );

  it(
    'two valid moves on one prev flag the seat; the game goes on and the seat ends last (Ruling 5)',
    () => {
      const r = sim('sim-equivocate', 'equivocate');
      expect(r.failures).toEqual([]);
      expect(unexpected(r, CHEAT)).toEqual([]);
      expect(r).toMatchObject({ phase: 'done', audit: 'pass', equivocators: [CHEAT], forfeits: [CHEAT] });
      expect(r.cheats).toHaveLength(2);
      expect(r.outcome?.reason).toBe('forfeit');
      expect(lastAlone(r.outcome?.places ?? [], CHEAT)).toBe(true);
    },
    LONG,
  );

  // Resign in a game with a deck (D052): the Resign carries the seat's secret, the others publish theirs, the
  // partial audit runs, and the result is unrated. At its first decision, a few turns in, and later.
  it.each([SEATS, SEATS + 4, SEATS + 14])(
    'a seat that resigns once the chain holds %i moves ends the game for everyone, unrated, and all agree',
    (atSeq) => {
      const r = sim(`sim-resign-${atSeq}`, 'resign', atSeq);
      expect(r.failures).toEqual([]);
      expect(unexpected(r, CHEAT)).toEqual([]);
      expect(r.claims).toBe(0);
      if (r.actions > 0) {
        expect(r.outcome).toMatchObject({
          reason: 'resign',
          unrated: true,
          endedBy: { type: 'resign', seat: CHEAT },
        });
        expect(r.attested).toEqual([0, 1, 2]);
      }
    },
    LONG,
  );

  it(
    'a seat that resigns at the first decision of the game cancels it; the others still publish their secrets',
    () => {
      // With this seed seat 2 holds the first decision (found with `pnpm sim --seed cancel-2`).
      const r = simulateGame({
        seats: 3,
        seed: 'cancel-2#1',
        modules: MODULES,
        game: chainReaction.id,
        proto: 1,
        policy: quickPolicy,
        adversary: adversary('resign', 2, 3, 3),
        fullSync: true,
      });
      expect(r.failures).toEqual([]);
      expect(unexpected(r, 2)).toEqual([]);
      expect(r).toMatchObject({ phase: 'cancelled', outcome: null, forfeits: [2], actions: 0, claims: 0 });
    },
    LONG,
  );

  it(
    'a resign in a 4-seat game with full syncs: every client agrees and every attestation is accepted',
    () => {
      const r = simulateGame({
        seats: 4,
        seed: 'sim-resign-4-full',
        modules: MODULES,
        game: chainReaction.id,
        proto: 1,
        policy: quickPolicy,
        adversary: adversary('resign', 2, 4, 4 + 8),
        fullSync: true,
      });
      expect(r.failures).toEqual([]);
      expect(unexpected(r, 2)).toEqual([]);
      expect(r).toMatchObject({ phase: 'done', forfeits: [2], audit: { fail: [2], reason: 'resign' } });
      expect(r.attested).toEqual([0, 1, 2, 3]);
    },
    LONG,
  );

  it(
    'a seat that vanishes after the first game action forfeits: the game ends done with the seat last',
    () => {
      const r = sim('sim-vanish-late', 'vanish', SEATS + 9);
      expect(r.failures).toEqual([]);
      expect(unexpected(r, CHEAT)).toEqual([]);
      expect(r.phase).toBe('done');
      expect(r.actions).toBeGreaterThan(0);
      expect(r.forfeits).toEqual([CHEAT]);
      expect(r.outcome?.reason).toBe('forfeit');
      expect(lastAlone(r.outcome?.places ?? [], CHEAT)).toBe(true);
      // A forfeit ending records the forfeit as the audit (Ruling 7): only the vanished seat fails.
      expect(r.audit).toEqual({ fail: [CHEAT], reason: 'timeout' });
    },
    LONG,
  );
});

describe('simulated protocol 2 games of the deckless games', () => {
  it(
    'an honest Chess game ends over: every seat end-attests and attests, and every client agrees',
    () => {
      const r = simV2(chess.id, 'v2-chess-honest', null, 2);
      expectClean(r);
      expect(r).toMatchObject({ proto: 2, phase: 'done', audit: 'pass', stop: null, claims: 0 });
      expect(r.record).toMatchObject({ ending: 'over', rated: [true, true], endedBy: null });
      expect(r.endAttested).toEqual([0, 1]);
      expect(r.attested).toEqual([0, 1]);
      expect(r.actions).toBeGreaterThan(0);
    },
    LONG,
  );

  it.each([
    [chess.id, 2],
    [bank.id, 3],
  ])(
    '%s, %i seats: two moves on one prev stop the game for every client, the forker last and rated',
    (game, seats) => {
      const r = simV2(game, `v2-stop-${game}`, 'equivocateStop', seats);
      expectClean(r);
      expect(r.stop).toEqual({ at: expect.any(String), seat: CHEAT, cancelled: false });
      expect(r.record).toMatchObject({ ending: 'stop', endedBy: CHEAT, equivocators: [CHEAT] });
      // 2 seats: a rated loss for the forker; 3 or more: only its last place is rated (PROTOCOL-v2 §5.6).
      expect(r.record?.rated).toEqual(Array.from({ length: seats }, (_, k) => seats === 2 || k === CHEAT));
      expect(r.endAttested).toEqual([]);
    },
    LONG,
  );

  it.each([
    [chess.id, 2, 6],
    [bank.id, 2, 8],
  ])(
    '%s, %i seats: a tablet that saved a move offline and reloads much later discards it, and nothing forks',
    (game, seats, atSeq) => {
      const r = simV2(game, `v2-stale-${game}`, 'staleOutbox', seats, atSeq);
      expectClean(r);
      expect(r.devices.saved).toBeGreaterThan(0);
      expect(r.devices.discarded).toBeGreaterThan(0);
      expect(r.devices.reasons).toContain('another move of yours on that position is held');
      expect(r.record?.ending).toBe('over');
    },
    LONG,
  );

  it.each([
    [chess.id, 2],
    [bank.id, 2],
  ])(
    '%s, %i seats: an honest seat on two devices that drop offline and reload: no fork, an honest result',
    (game, seats) => {
      const r = simV2(game, `v2-devices-${game}`, 'twoDevices', seats);
      expectClean(r);
      // Both paths of the outbox rule ran: saved events sent once back online, and stale ones discarded.
      expect(r.devices.sent).toBeGreaterThan(0);
      expect(r.devices.discarded).toBeGreaterThan(0);
      expect(r.record?.ending).toBe('over');
    },
    LONG,
  );

  it(
    'Bank 0.1.0 still plays a protocol 1 game',
    () => {
      const r = simulateGame({
        seats: 2,
        seed: 'v1-bank',
        modules: new Map([[bankV1.id, bankV1]]),
        game: bankV1.id,
        proto: 1,
        policy: quickPolicy,
      });
      expectClean(r);
      expect(r).toMatchObject({ proto: 1, phase: 'done', audit: 'pass', record: null, fork: null });
    },
    LONG,
  );
});

describe.skipIf(!SIM)('simulated protocol 2 games with a deck, and a longer Bank game (SIM=1)', () => {
  it(
    'an honest Bank 0.2.0 game: every roll gets its contributions, and every client agrees',
    () => {
      const r = simV2(bank.id, 'v2-bank-honest', null, 3);
      expectClean(r);
      expect(r).toMatchObject({ proto: 2, phase: 'done', audit: 'pass', stop: null, claims: 0 });
      expect(r.endAttested).toEqual([0, 1, 2]);
    },
    LONG,
  );

  it.each([
    [chainReaction.id, 3],
    [luster.id, 2],
    [luster.id, 3],
  ])(
    'an honest %s game of %i seats ends over: the audit passes, every client agrees',
    (game, seats) => {
      const r = simV2(game, `v2-honest-${game}-${seats}`, null, seats);
      expectClean(r);
      expect(r.record).toMatchObject({ ending: 'over', endedBy: null });
      expect(r.endAttested).toEqual(Array.from({ length: seats }, (_, k) => k));
    },
    LONG,
  );

  it.each([
    [chainReaction.id, 3],
    [luster.id, 2],
  ])(
    '%s, %i seats: a fork stops the game; every seat but the forker publishes its secret, and the stop is scored',
    (game, seats) => {
      const r = simV2(game, `v2-stop-${game}-${seats}`, 'equivocateStop', seats);
      expectClean(r);
      expect(r.record).toMatchObject({ ending: 'stop', endedBy: CHEAT });
    },
    LONG,
  );

  it.each([
    [chainReaction.id, 3, 12],
    [luster.id, 2, 12],
  ])(
    '%s, %i seats: a stale tablet discards its saved decision and its releases, and nothing forks',
    (game, seats, atSeq) => {
      const r = simV2(game, `v2-stale-${game}-${seats}`, 'staleOutbox', seats, atSeq);
      expectClean(r);
      expect(r.devices.saved).toBeGreaterThan(0);
      expect(r.devices.discarded).toBeGreaterThan(0);
    },
    LONG,
  );

  it.each([
    [chainReaction.id, 3],
    [luster.id, 2],
  ])(
    '%s, %i seats: an honest seat on two devices never forks itself nor shares its own card',
    (game, seats) => {
      const r = simV2(game, `v2-devices-${game}-${seats}`, 'twoDevices', seats);
      expectClean(r);
      expect(r.devices.saved).toBeGreaterThan(0);
    },
    LONG,
  );
});
