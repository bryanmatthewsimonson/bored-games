import { describe, expect, it } from 'vitest';
import { type Design, explore, MODES, type Mode, type Result, type Scope, type Seat } from '../src/index.ts';

/*
 * docs/proposals/prompt-reveal.md §6. The CI scope keeps the run short; PROTOCOL_MODEL_BIG=1 adds the larger
 * scope reported in the proposal (several minutes).
 */
const BIG = process.env.PROTOCOL_MODEL_BIG === '1';

const base = {
  seats: 3,
  rivalsPerPrev: 2,
  advMoves: 2,
  advAcks: 1,
  advClaims: 0,
  advResigns: 0,
  expiries: 0,
} as const;

const COALITIONS: Seat[][] = [[0], [1], [2], [0, 1], [0, 2], [1, 2]];

/** Explore every coalition of 1 or 2 seats and merge the violation counts. */
function sweep(scope: Omit<Scope, 'coalition'>): {
  complete: boolean;
  counts: Record<string, number>;
  runs: Result[];
} {
  const runs = COALITIONS.map((coalition) => explore({ ...scope, coalition }));
  const counts: Record<string, number> = {};
  for (const r of runs)
    for (const [k, v] of Object.entries(r.violations)) counts[k] = (counts[k] ?? 0) + (v?.count ?? 0);
  return { complete: runs.every((r) => r.complete), counts, runs };
}

const SAFETY = ['exposure', 'honest-forfeit', 'divergence'] as const;

function expectSafe(counts: Record<string, number>): void {
  for (const k of SAFETY) expect(counts[k] ?? 0, k).toBe(0);
}

describe('regressions: the model finds the known attacks', () => {
  it('D039: a lone equivocator reads another seat’s tile from prompt shares', () => {
    const r = explore({
      ...base,
      design: 'd039',
      mode: 'private',
      length: 3,
      coalition: [1],
      stopAt: ['exposure'],
    });
    const v = r.violations.exposure;
    expect(v, 'exposure').toBeDefined();
    // The trace has the equivocator sign two rivals on one prev.
    const signs = (v?.first.trace ?? []).filter((t) => t.startsWith('seat 1 signs'));
    expect(signs.length).toBeGreaterThanOrEqual(2);
  });

  it('D039 with public values: a seat sees a roll or a played card, then re-decides', () => {
    const r = explore({
      ...base,
      design: 'd039',
      mode: 'public',
      length: 3,
      coalition: [1],
      stopAt: ['exposure'],
    });
    expect(r.violations.exposure).toBeDefined();
  });

  it('D039 with viewer sets: two colluders read the next card of the deck', () => {
    const r = explore({
      ...base,
      design: 'd039',
      mode: 'viewers',
      length: 3,
      coalition: [0, 1],
      stopAt: ['exposure'],
    });
    expect(r.violations.exposure).toBeDefined();
  });

  it('acknowledge-then-share without the lock: the late-Ack reorg exposes an honest seat’s tile', () => {
    const r = explore({
      ...base,
      design: 'ack',
      mode: 'private',
      length: 6,
      advMoves: 6,
      advAcks: 1,
      coalition: [0, 1],
      stopAt: ['exposure'],
    });
    const v = r.violations.exposure;
    expect(v, 'exposure').toBeDefined();
    const trace = v?.first.trace ?? [];
    // The colluder's Ack comes last, after the honest seat moved on the rival branch.
    expect(trace.at(-1)).toMatch(/^seat [01] acks /);
    expect(trace.some((t) => t === 'seat 2 moves')).toBe(true);
  });

  it('ack implies lock: an honest split leaves honest clients apart and times one out', () => {
    const r = explore({
      ...base,
      design: 'ack-lock',
      mode: 'private',
      length: 3,
      coalition: [0],
      expiries: 1,
    });
    expect(r.violations.divergence, 'divergence').toBeDefined();
    expect(r.violations['honest-forfeit'], 'honest-forfeit').toBeDefined();
  });

  it('v1 with multi-seat resigns (F8): resign on one branch plus a rival gets an honest seat timed out', () => {
    const r = explore({
      ...base,
      design: 'v1',
      mode: 'private',
      length: 3,
      coalition: [1],
      advAcks: 0,
      advResigns: 1,
      expiries: 1,
      stopAt: ['honest-forfeit'],
    });
    expect(r.violations['honest-forfeit']).toBeDefined();
  });

  it('fork stop without acks: no exposure, but values leak past the end of the final chain', () => {
    const s = sweep({ ...base, design: 'fs', mode: 'private', length: 3, advAcks: 0 });
    expect(s.complete).toBe(true);
    expectSafe(s.counts);
    expect(s.counts['post-end'] ?? 0).toBeGreaterThan(0);
  });
});

describe('final, or stop (fgr): no exposure, honest forfeit or divergence within the scope', () => {
  it('every mode, every coalition of 1–2 seats, 3 moves, 2 adversary moves, an Ack', () => {
    for (const mode of MODES) {
      const s = sweep({ ...base, design: 'fgr', mode, length: 3 });
      expect(s.complete, mode).toBe(true);
      expectSafe(s.counts);
    }
  });

  it('with a timeout claim and a deadline (private draws)', () => {
    const s = sweep({ ...base, design: 'fgr', mode: 'private', length: 3, advClaims: 1, expiries: 1 });
    expect(s.complete).toBe(true);
    expectSafe(s.counts);
  });

  it('with a resign and a deadline (F8 closed)', () => {
    const r = explore({
      ...base,
      design: 'fgr',
      mode: 'private',
      length: 3,
      coalition: [2],
      advResigns: 1,
      expiries: 1,
    });
    expect(r.complete).toBe(true);
    expectSafe(Object.fromEntries(Object.entries(r.violations).map(([k, v]) => [k, v?.count ?? 0])));
  });

  it('at a late-Ack depth: two colluders, 5 moves, 5 adversary moves', () => {
    const r = explore({ ...base, design: 'fgr', mode: 'private', length: 5, advMoves: 5, coalition: [0, 1] });
    expect(r.complete).toBe(true);
    expectSafe(Object.fromEntries(Object.entries(r.violations).map(([k, v]) => [k, v?.count ?? 0])));
  });
});

describe('liveness, honest seats only', () => {
  const live = (design: Design, mode: Mode, lazy: Seat | null = null) =>
    explore({ ...base, design, mode, length: 5, advMoves: 0, advAcks: 0, coalition: [], lazy });

  it('prompt designs reveal every grant once the network is quiet; v1 does not', () => {
    for (const mode of MODES) {
      for (const design of ['d039', 'ack', 'fs', 'fgr'] as Design[]) {
        const r = live(design, mode);
        expect(r.complete).toBe(true);
        expect(Object.keys(r.violations), `${design} ${mode}`).toEqual([]);
      }
      expect(live('v1', mode).violations['not-prompt'], `v1 ${mode}`).toBeDefined();
    }
  });

  it('a seat that never acks nor shares early: fgr falls back to the turn-piggybacked path', () => {
    for (const mode of MODES)
      for (const lazy of [0, 1, 2]) {
        const r = live('fgr', mode, lazy);
        expect(r.violations['no-fallback'], `${mode} lazy ${lazy}`).toBeUndefined();
      }
  });
});

describe.runIf(BIG)('bigger scope (PROTOCOL_MODEL_BIG=1, about half an hour)', () => {
  const safe = (r: Result): void => {
    expect(r.complete).toBe(true);
    expectSafe(Object.fromEntries(Object.entries(r.violations).map(([k, v]) => [k, v?.count ?? 0])));
  };

  it('fgr: every mode and coalition, 4 moves, 3 adversary moves, an Ack', () => {
    for (const mode of MODES) {
      const s = sweep({ ...base, design: 'fgr', mode, length: 4, advMoves: 3 });
      expect(s.complete, mode).toBe(true);
      expectSafe(s.counts);
    }
  }, 7_200_000);

  it('fgr: a claim, a resign and a deadline, every coalition', () => {
    const s = sweep({
      ...base,
      design: 'fgr',
      mode: 'private',
      length: 3,
      advClaims: 1,
      advResigns: 1,
      expiries: 1,
    });
    expect(s.complete).toBe(true);
    expectSafe(s.counts);
  }, 7_200_000);

  it('fgr: 4 seats, 4 moves, every pair of colluders', () => {
    // A single adversary leaves 3 honest clients, whose delivery orders exceed this scope (over 4 million states).
    for (const mode of MODES)
      for (const coalition of [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
        [2, 3],
      ])
        safe(explore({ ...base, seats: 4, design: 'fgr', mode, length: 4, coalition }));
  }, 7_200_000);

  it('fgr: the late-Ack scope itself (6 moves, 6 adversary moves, two colluders)', () => {
    for (const mode of MODES)
      safe(explore({ ...base, design: 'fgr', mode, length: 6, advMoves: 6, coalition: [0, 1] }));
  }, 7_200_000);
});
