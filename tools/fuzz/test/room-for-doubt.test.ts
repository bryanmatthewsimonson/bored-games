import { createRng, type FuzzPolicy, fuzzBatch, packetOrderFits } from '@bored-games/game-kit';
import { CASE_DECK, type RfdState, roomForDoubt } from '@bored-games/room-for-doubt';
import { describe, expect, it } from 'vitest';
import { TARGETS } from '../src/index.ts';
import {
  ROOM_FOR_DOUBT_EXPECTED_COVERAGE,
  ROOM_FOR_DOUBT_POLICIES,
  ROOM_FOR_DOUBT_SIM_DEADLINE,
  roomForDoubtDeckOrder,
} from '../src/room-for-doubt.ts';

const SEATS = [3, 4, 5, 6];

/** Whole tables of one policy: the sim plays a game with one policy at every seat. */
const table = (policy: FuzzPolicy<RfdState>, games: number, seed: string) =>
  fuzzBatch(roomForDoubt, {
    seed,
    games,
    seatCounts: SEATS,
    rules: roomForDoubt.defaultRules(),
    policies: [policy],
    deckOrder: roomForDoubtDeckOrder,
    checkViews: false,
    maxSteps: 5000,
  });

describe('the Room for Doubt fuzz target', () => {
  it('registers the detective and the hasty policy, in the order the sim cycles through them', () => {
    const target = TARGETS['room-for-doubt'];
    expect(target?.module).toBe(roomForDoubt);
    expect(target?.policies.map((p) => p.name)).toEqual(['detective', 'hasty']);
    expect(target?.defaultSeatCounts).toEqual([3, 4, 5, 6]);
    expect(target?.expectedCoverage).toBe(ROOM_FOR_DOUBT_EXPECTED_COVERAGE);
  });

  // A game of 400 to 1,100 moves meets a day-long gap of the sim's random scheduler about one time in three at six
  // seats. The timeout claim that follows forks the clients (ARCHITECTURE "Timeouts"), and the sim reports a failure.
  it('gives the sim the protocol default deadline of three days, not its own one day', () => {
    expect(TARGETS['room-for-doubt']?.simDeadline).toBe(3 * 86400);
    expect(ROOM_FOR_DOUBT_SIM_DEADLINE).toBe(3 * 86400);
  });

  it('draws case orders that the two shuffle rounds can produce, a different one each time', () => {
    const rng = createRng('case-orders');
    const orders = Array.from({ length: 12 }, () => roomForDoubtDeckOrder(CASE_DECK, rng));
    for (const order of orders) expect(packetOrderFits(CASE_DECK, order)).toBe(true);
    expect(new Set(orders.map((o) => o.join(','))).size).toBe(12);
  });

  it('fuzzed games keep every invariant, and end both by an upheld indictment and by the last seat standing', () => {
    const target = TARGETS['room-for-doubt'];
    if (!target) throw new Error('room-for-doubt target missing');
    const report = fuzzBatch(target.module, {
      seed: 'vitest-smoke',
      games: 40,
      seatCounts: target.defaultSeatCounts,
      rules: target.module.defaultRules(),
      policies: target.policies,
      ...(target.deckOrder ? { deckOrder: target.deckOrder } : {}),
    });
    expect(report.failures).toEqual([]);
    expect(report.games).toBe(40);
    for (const tag of target.expectedCoverage) expect(report.coverage[tag], tag).toBeGreaterThan(0);
    expect(report.coverage['end:upheld']).toBeGreaterThan(0);
    expect(report.coverage['end:last-standing']).toBeGreaterThan(0);
  });
});

describe.each(ROOM_FOR_DOUBT_POLICIES)('the $name policy', (policy) => {
  // The detective once took the passage between two corner rooms it had both used, turn after turn: it never rolled,
  // so its turns were never counted and no game of detectives ended. A game must end by declaration (D015).
  it('ends every game of a table of its own, by an upheld indictment or the last seat standing', () => {
    const report = table(policy, 8, `table-${policy.name}`);
    expect(report.failures).toEqual([]);
    expect(report.games).toBe(8);
    expect((report.coverage['end:upheld'] ?? 0) + (report.coverage['end:last-standing'] ?? 0)).toBe(8);
  });

  // A seat may know its own hand and the cards shown to it; the sim hands a policy exactly that view of the state.
  it("decides the same from the full state as from its seat's view", () => {
    const mismatches: string[] = [];
    let decisions = 0;
    const guarded: FuzzPolicy<RfdState> = {
      name: policy.name,
      choose(full, seat, legal, rng) {
        const view = roomForDoubt.view(full, seat);
        // `fork` draws the same stream each time, so both calls see the same randomness.
        const fromView = JSON.stringify(policy.choose(view, seat, legal, rng.fork('same')));
        const fromFull = JSON.stringify(policy.choose(full, seat, legal, rng.fork('same')));
        decisions++;
        if (fromView !== fromFull) mismatches.push(`seat ${seat}: view ${fromView}, full ${fromFull}`);
        return policy.choose(full, seat, legal, rng);
      },
    };
    const report = table(guarded, 6, `view-${policy.name}`);
    expect(report.failures).toEqual([]);
    expect(decisions).toBeGreaterThan(100);
    expect(mismatches).toEqual([]);
  });
});

describe('the hasty policy', () => {
  it('indicts on its third turn, so that a table of it re-deals the Verdict and ends by the last seat standing', () => {
    const hasty = ROOM_FOR_DOUBT_POLICIES.find((p) => p.name === 'hasty');
    if (!hasty) throw new Error('no hasty policy');
    const report = table(hasty, 8, 'table-hasty-again');
    expect(report.failures).toEqual([]);
    expect(report.coverage['indict:again']).toBeGreaterThan(0);
    expect(report.coverage['end:last-standing']).toBeGreaterThanOrEqual(7);
  });
});
