import { chainReaction } from '@bored-games/chain-reaction';
import { createRng } from '@bored-games/game-kit';
import { finalizeEvent, KIND, type NostrEvent, tableTemplate } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { MemoryRelay } from '../src/memory-relay.ts';
import { type SimReport, simulateGame } from '../src/sim.ts';
import { type AdversaryName, adversary, lastAlone, quickPolicy, unexpected } from './adversaries.ts';
import { MODULES, makeGame, seededRandom, T0 } from './helpers.ts';

/*
 * Whole games between independent clients over the in-memory relay (Phase 2d Task 7). A 3-seat game takes a
 * minute or two of CPU even with a policy that declares the end as soon as it may, so only the games that end
 * during the shuffle and the deal run by default; `pnpm test:sim` runs them all, and `pnpm sim` plays more.
 */

const SIM = process.env.SIM !== undefined && process.env.SIM !== '';
const SEATS = 3;
/** The cheating seat. */
const CHEAT = 1;
const LONG = 900_000;

function sim(seed: string, name: AdversaryName | null, vanishAt = SEATS): SimReport {
  return simulateGame({
    seats: SEATS,
    seed,
    modules: MODULES,
    game: chainReaction.id,
    policy: quickPolicy,
    ...(name === null ? {} : { adversary: adversary(name, CHEAT, SEATS, vanishAt) }),
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
