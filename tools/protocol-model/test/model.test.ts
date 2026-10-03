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

const SAFETY = ['exposure', 'honest-forfeit', 'divergence', 'rating'] as const;

const counts = (r: Result): Record<string, number> =>
  Object.fromEntries(Object.entries(r.violations).map(([k, v]) => [k, v?.count ?? 0]));

/** Round 1 (`fgr`) was not designed against rating gains (the review's attacks 2 and 3): its checks leave them out. */
const SAFETY1 = ['exposure', 'honest-forfeit', 'divergence'] as const;

/**
 * Round 2's designs (`fgr2`, `stop`) with claims or resigns: round 3 found that "a stop never overrides a counted
 * claim or resign" diverges once a fork is held (A2, below), which the model used to file as the claim race. Their
 * remaining checks leave divergence out; the A2 regressions show it.
 */
const SAFETY2 = ['exposure', 'honest-forfeit', 'rating'] as const;

function expectSafe(counts: Record<string, number>, kinds: readonly string[] = SAFETY): void {
  for (const k of kinds) expect(counts[k] ?? 0, k).toBe(0);
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
    expectSafe(s.counts, SAFETY1);
    expect(s.counts['post-end'] ?? 0).toBeGreaterThan(0);
  });
});

/*
 * The round-2 review's attacks on round 1 (`fgr`), reconstructed from the coordinator's summary of the review
 * (prompt-reveal.md §6.4): each must be found again, and each must be gone in round 2 (`fgr2`).
 */
describe('regressions: the round-2 review attacks on round 1', () => {
  it('attack 1: one key on two devices vouches for both sides, lowest id flips, a tile is exposed', () => {
    const scope = { ...base, mode: 'private', length: 2, advAcks: 2, coalition: [0, 2], devices: 2 } as const;
    expect(explore({ ...scope, design: 'fgr', stopAt: ['exposure'] }).violations.exposure).toBeDefined();
    const r2 = explore({ ...scope, design: 'fgr2' });
    expect(r2.complete).toBe(true);
    expect(counts(r2).exposure ?? 0).toBe(0);
    // Round 2 stops instead, and flags the double-vouching seat: the multi-device owner question.
    expect(counts(r2)['honest-flagged'] ?? 0).toBeGreaterThan(0);
  });

  it('attack 2: in a 2-seat game, an equivocation stop leaves the game unrated instead of a loss', () => {
    const scope = { ...base, seats: 2, mode: 'private', length: 3, coalition: [0] } as const;
    expect(explore({ ...scope, design: 'fgr', stopAt: ['rating'] }).violations.rating).toBeDefined();
    expect(counts(explore({ ...scope, design: 'fgr2' })).rating ?? 0).toBe(0);
  });

  it('attack 3: a timed-out seat forks at its own head and the stop voids its counted timeout', () => {
    const scope = { ...base, mode: 'private', length: 3, coalition: [1], expiries: 1 } as const;
    expect(explore({ ...scope, design: 'fgr', stopAt: ['rating'] }).violations.rating).toBeDefined();
    expectSafe(counts(explore({ ...scope, design: 'fgr2' })), SAFETY2);
  });

  it('attack 4: an honest human leaves on a stop, play resumes, and it is timed out', () => {
    const scope = { ...base, mode: 'private', length: 3, coalition: [0], absence: true } as const;
    const r1 = explore({ ...scope, design: 'fgr', expiries: 1, stopAt: ['honest-forfeit'] });
    expect(r1.violations['honest-forfeit']).toBeDefined();
    expectSafe(counts(explore({ ...scope, design: 'fgr2', expiries: 2 })), SAFETY2);
  });

  it('rule 9 "strictly below the head" (the review’s fix) still lets a colluder void a counted timeout', () => {
    const r = explore({
      ...base,
      design: 'fgr2',
      rule9: 'strict',
      mode: 'private',
      length: 3,
      advMoves: 3,
      coalition: [0, 1],
      expiries: 1,
      stopAt: ['rating'],
    });
    expect(r.violations.rating?.first.detail).toMatch(/voids seat 1's counted claim/);
  });
});

describe.runIf(BIG)(
  'final, or stop, round 1 (fgr, PROTOCOL_MODEL_BIG=1): no exposure, forfeit or divergence',
  () => {
    it('every mode, every coalition of 1–2 seats, 3 moves, 2 adversary moves, an Ack', () => {
      for (const mode of MODES) {
        const s = sweep({ ...base, design: 'fgr', mode, length: 3 });
        expect(s.complete, mode).toBe(true);
        expectSafe(s.counts, SAFETY1);
      }
    });

    it('with a timeout claim and a deadline (private draws)', () => {
      const s = sweep({ ...base, design: 'fgr', mode: 'private', length: 3, advClaims: 1, expiries: 1 });
      expect(s.complete).toBe(true);
      expectSafe(s.counts, SAFETY1);
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
      expectSafe(counts(r), SAFETY1);
    });

    it('at a late-Ack depth: two colluders, 5 moves, 5 adversary moves', () => {
      const r = explore({
        ...base,
        design: 'fgr',
        mode: 'private',
        length: 5,
        advMoves: 5,
        coalition: [0, 1],
      });
      expect(r.complete).toBe(true);
      expectSafe(counts(r), SAFETY1);
    });
  },
);

describe('final, or stop, round 2 (fgr2): no exposure, forfeit, divergence or rating gain within the scope', () => {
  it('every mode, every coalition, 3 moves, 2 adversary moves, an Ack', () => {
    for (const mode of MODES) {
      const s = sweep({ ...base, design: 'fgr2', mode, length: 3 });
      expect(s.complete, mode).toBe(true);
      expectSafe(s.counts);
      expect(s.counts['honest-flagged'] ?? 0).toBe(0);
    }
  });

  it('with a timeout claim and a deadline (private draws; every coalition in the big scope)', () => {
    for (const coalition of [[2], [0, 1], [0, 2], [1, 2]] as Seat[][]) {
      const r = explore({
        ...base,
        design: 'fgr2',
        mode: 'private',
        length: 3,
        coalition,
        advClaims: 1,
        expiries: 1,
      });
      expect(r.complete).toBe(true);
      expectSafe(counts(r), SAFETY2);
    }
  });

  it('moves that draw two positions', () => {
    const s = sweep({ ...base, design: 'fgr2', mode: 'private', length: 3, multiDraw: true });
    expect(s.complete).toBe(true);
    expectSafe(s.counts);
  });

  it('honest humans who leave on a stop, with two deadlines', () => {
    const s = sweep({ ...base, design: 'fgr2', mode: 'private', length: 3, absence: true, expiries: 2 });
    expect(s.complete).toBe(true);
    expectSafe(s.counts, SAFETY2);
  });

  it('a resign and a deadline', () => {
    for (const coalition of [[2], [0, 1]] as Seat[][]) {
      const r = explore({
        ...base,
        design: 'fgr2',
        mode: 'private',
        length: 3,
        coalition,
        advResigns: 1,
        expiries: 1,
      });
      expect(r.complete).toBe(true);
      expectSafe(counts(r), SAFETY2);
    }
  });

  it('two devices per honest seat: no exposure under any device policy; `checked` also avoids flags', () => {
    for (const ackDevice of ['all', 'first', 'checked'] as const) {
      const r = explore({
        ...base,
        design: 'fgr2',
        mode: 'private',
        length: 2,
        advAcks: 2,
        coalition: [0, 2],
        devices: 2,
        ackDevice,
      });
      expect(r.complete).toBe(true);
      expect(counts(r).exposure ?? 0, ackDevice).toBe(0);
      expect(counts(r).divergence ?? 0, ackDevice).toBe(0);
      if (ackDevice === 'checked') expect(counts(r)['honest-flagged'] ?? 0).toBe(0);
    }
  });

  it('at a late-Ack depth: two colluders, 5 moves, 5 adversary moves', () => {
    const r = explore({
      ...base,
      design: 'fgr2',
      mode: 'private',
      length: 5,
      advMoves: 5,
      coalition: [0, 1],
    });
    expect(r.complete).toBe(true);
    expectSafe(counts(r));
  });
});

/*
 * Candidate (e), "plain stop", the recommended design (prompt-reveal.md §5): one shared pile, shares released as
 * soon as the drawing move is held, any held fork stops the game as the equivocator's forfeit (never a pick, never
 * a resume), and a stop never overrides a counted claim or resign.
 */
describe('candidate (e), plain stop: no exposure, honest forfeit, rating gain or divergence', () => {
  const stop = { ...base, design: 'stop', advAcks: 0 } as const;

  it('every mode (private, viewers, public, roll) and every coalition, 3 moves', () => {
    for (const mode of [...MODES, 'roll'] as Mode[]) {
      const s = sweep({ ...stop, mode, length: 3 });
      expect(s.complete, mode).toBe(true);
      expectSafe(s.counts);
    }
  });

  it('claims, resigns and a deadline; moves that draw two positions', () => {
    for (const extra of [{ advClaims: 1, advResigns: 1, expiries: 1 }, { multiDraw: true }]) {
      const s = sweep({ ...stop, mode: 'private', length: 3, ...extra });
      expect(s.complete).toBe(true);
      expectSafe(s.counts, SAFETY2);
    }
  });

  it('D039, the late-Ack depth and honest splits all end in a stop', () => {
    expectSafe(counts(explore({ ...stop, mode: 'private', length: 3, coalition: [1] })));
    const r = explore({ ...stop, mode: 'private', length: 5, advMoves: 5, coalition: [0, 1] });
    expect(r.complete).toBe(true);
    expectSafe(counts(r));
  });

  it('the review’s attacks 1–4', () => {
    // 1: one key on two devices (no Acks; a device that never saw A plays on B until A surfaces).
    for (const coalition of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as Seat[][])
      expectSafe(counts(explore({ ...stop, mode: 'private', length: 3, coalition, devices: 2 })));
    // 2: the stop is the equivocator's forfeit in a 2-seat game.
    expectSafe(counts(explore({ ...stop, seats: 2, mode: 'private', length: 3, coalition: [0] })));
    // 3: a stop never overrides a counted timeout (own head, or a colluder's fork below it); round 3 (A2): the
    // clients then diverge.
    expectSafe(
      counts(explore({ ...stop, mode: 'private', length: 3, coalition: [1], expiries: 1 })),
      SAFETY2,
    );
    expectSafe(
      counts(explore({ ...stop, mode: 'private', length: 3, advMoves: 3, coalition: [0, 1], expiries: 1 })),
      SAFETY2,
    );
    // 4: no resume, and humans who leave on a stop are never timed out.
    expectSafe(
      counts(
        explore({
          ...stop,
          mode: 'private',
          length: 3,
          coalition: [0],
          absence: true,
          expiries: 1,
          advClaims: 1,
        }),
      ),
      SAFETY2,
    );
  });

  it('regressions: the owner’s "strictly above the head" rule 9 and "a finished ending stands" both fail', () => {
    const flip = explore({
      ...stop,
      rule9: 'strict',
      mode: 'private',
      length: 3,
      advMoves: 3,
      coalition: [0, 1],
      expiries: 1,
      stopAt: ['rating'],
    });
    expect(flip.violations.rating?.first.detail).toMatch(/voids seat 1's counted claim/);
    // Letting a finished side stand is picking a branch: the coalition finishes its rival and keeps what it read.
    const pick = explore({
      ...stop,
      overStands: true,
      mode: 'private',
      length: 5,
      advMoves: 5,
      coalition: [0, 1],
      stopAt: ['exposure'],
    });
    expect(pick.violations.exposure).toBeDefined();
  });

  it('residual: with 3 or more seats, a stop can turn a game that had ended into an unrated abort', () => {
    const r = explore({ ...stop, mode: 'private', length: 3, coalition: [0], stopAt: ['ended-void'] });
    expect(r.violations['ended-void']).toBeDefined();
  });

  it('liveness: every grant is readable once the network is quiet', () => {
    for (const mode of [...MODES, 'roll'] as Mode[]) {
      const live = explore({ ...stop, mode, length: 5, advMoves: 0, coalition: [] });
      expect(Object.keys(live.violations), mode).toEqual([]);
      for (const lazy of [0, 1, 2]) {
        const r = explore({ ...stop, mode, length: 5, advMoves: 0, coalition: [], lazy });
        expect(r.violations['no-fallback'], `${mode} lazy ${lazy}`).toBeUndefined();
      }
    }
  });
});

/*
 * Round 3 (prompt-reveal.md §5, as amended): candidate (e) with the attestation-and-anchor cutoff (`stop3`). A
 * result stands against a later fork by E when every seat but E attested it and no seat but E signed a move, or a
 * Shares event anchored on a head, off its path; otherwise the fork stops the game, overriding any counted claim or
 * resign, so clients converge (A2). A stop is E's rated last place, the game unrated for the others (`last`; E's
 * timeout at the fork, `timeout`, also works). Devices fetch their own seat's events before signing a move (device
 * policy (ii)); a saved move is published only under the controller rule (A3).
 */
describe('candidate (e), round 3 (stop3): the cutoff converges, and no single adversary gains', () => {
  const e3 = {
    ...base,
    design: 'stop3',
    advAcks: 0,
    advAttests: 1,
    stopScore: 'last',
    ownCheck: true,
  } as const;
  const SINGLE: Seat[][] = [[0], [1], [2]];
  /** Reported apart with coalitions; never for a single adversary with one device per seat. */
  const FINAL = ['attested-void', 'void-forfeit'] as const;

  it('every mode and coalition, 3 moves; single adversaries never void an attested result', () => {
    for (const mode of [...MODES, 'roll'] as Mode[]) {
      const s = sweep({ ...e3, mode, length: 3 });
      expect(s.complete, mode).toBe(true);
      expectSafe(s.counts);
      expect(s.counts['honest-flagged'] ?? 0, mode).toBe(0);
      for (const coalition of SINGLE)
        expectSafe(counts(explore({ ...e3, mode, length: 3, coalition })), FINAL);
    }
  });

  it('A2: a counted timeout and a stop diverge under rule (1); the cutoff converges', () => {
    const scope = { ...base, advAcks: 0, mode: 'private', length: 3, coalition: [1], expiries: 1 } as const;
    // Round 2: one client counted seat 1's timeout, the other holds seat 1's fork and stops.
    for (const design of ['stop', 'fgr2'] as Design[]) {
      const r = explore({ ...scope, design, stopAt: ['divergence'] });
      expect(r.violations.divergence?.first.detail, design).toMatch(/stop:.*claim:|claim:.*stop:/);
    }
    const r3 = explore({ ...e3, ...scope });
    expect(r3.complete).toBe(true);
    expectSafe(counts(r3));
    expectSafe(counts(r3), FINAL);
    expectSafe(counts(explore({ ...e3, ...scope, stopScore: 'timeout' })), FINAL);
    // The price of convergence: scored as the owner's abort, the stop turns seat 1's rated timeout into an unrated
    // abort (3 or more seats), so the equivocator also takes a rated last place.
    const abort = explore({ ...e3, ...scope, stopScore: 'abort', stopAt: ['void-forfeit'] });
    expect(abort.violations['void-forfeit']?.first.detail).toMatch(/voids seat 1's counted claim/);
  });

  it('claims, resigns and a deadline: no divergence, and single adversaries gain nothing', () => {
    for (const coalition of COALITIONS) {
      const r = explore({
        ...e3,
        mode: 'private',
        length: 3,
        advMoves: 1,
        advClaims: 1,
        advResigns: 1,
        expiries: 1,
        coalition,
      });
      expect(r.complete).toBe(true);
      expectSafe(counts(r));
      if (coalition.length === 1) expectSafe(counts(r), FINAL);
    }
    for (const coalition of SINGLE)
      for (const extra of [{ advClaims: 1 }, { advResigns: 1 }]) {
        const r = explore({ ...e3, mode: 'private', length: 3, expiries: 1, coalition, ...extra });
        expect(r.complete).toBe(true);
        expectSafe(counts(r));
        expectSafe(counts(r), FINAL);
      }
  });

  it('residual: a colluder who never attests keeps its partner’s fork able to void a counted timeout', () => {
    const r = explore({ ...e3, mode: 'private', length: 3, advClaims: 1, expiries: 1, coalition: [0, 1] });
    expect(r.complete).toBe(true);
    expectSafe(counts(r));
    expect(counts(r)['void-forfeit'] ?? 0).toBeGreaterThan(0);
  });

  it('regressions: the anchor clause and the loser’s own attestation are both needed', () => {
    // Attested alone: an honest seat's second device attests side B while its first released a share on side A.
    const attest = explore({
      ...e3,
      mode: 'private',
      length: 3,
      advMoves: 3,
      coalition: [0, 2],
      devices: 2,
      cutoff: 'attest',
      stopAt: ['exposure'],
    });
    expect(attest.violations.exposure).toBeDefined();
    expectSafe(
      counts(explore({ ...e3, mode: 'private', length: 3, advMoves: 3, coalition: [0, 2], devices: 2 })),
    );
    // Without the loser's attestation, two colluders time an honest seat out by claim, attestation and a fork.
    const exempt = explore({
      ...e3,
      mode: 'private',
      length: 3,
      advMoves: 3,
      advClaims: 1,
      expiries: 1,
      coalition: [0, 1],
      exemptLoser: true,
      stopAt: ['honest-forfeit'],
    });
    expect(exempt.violations['honest-forfeit']).toBeDefined();
  });

  it('A3: a stale outbox forks an honest seat; the controller rule drops the saved move', () => {
    for (const seats of [2, 3]) {
      const scope = {
        ...e3,
        seats,
        mode: 'private',
        length: 3,
        coalition: [],
        devices: 2,
        stale: 1,
      } as const;
      const bad = counts(explore(scope));
      expect((bad['honest-forfeit'] ?? 0) + (bad['honest-flagged'] ?? 0), `${seats} seats`).toBeGreaterThan(
        0,
      );
      const r = explore({ ...scope, outboxRule: true });
      expect(r.complete).toBe(true);
      expect(Object.keys(r.violations), `${seats} seats`).toEqual([]);
    }
    const r = explore({
      ...e3,
      mode: 'private',
      length: 3,
      coalition: [0, 1],
      devices: 2,
      stale: 1,
      outboxRule: true,
    });
    expect(r.complete).toBe(true);
    expectSafe(counts(r));
    expect(counts(r)['honest-flagged'] ?? 0).toBe(0);
  });

  it('two devices and a claim (2 seats): a device must fetch its own seat’s events before signing', () => {
    const scope = {
      ...e3,
      seats: 2,
      mode: 'private',
      length: 3,
      coalition: [1],
      devices: 2,
      advClaims: 1,
      expiries: 1,
    } as const;
    // Without the check, device a plays on after device b counted the opponent's timeout, and the end stands.
    expect(explore({ ...scope, ownCheck: false, stopAt: ['rating'] }).violations.rating).toBeDefined();
    const r = explore(scope);
    expect(r.complete).toBe(true);
    expectSafe(counts(r));
    expect(counts(r)['claim-race'] ?? 0).toBe(0);
  });

  it('A1: two devices and a resign leak a card past the end under rule (1); under the cutoff it is post-end', () => {
    const scope = {
      ...base,
      advAcks: 0,
      mode: 'private',
      length: 3,
      advMoves: 3,
      advResigns: 1,
      coalition: [0, 1],
      devices: 2,
    } as const;
    expect(explore({ ...scope, design: 'stop', stopAt: ['exposure'] }).violations.exposure).toBeDefined();
  });

  it('liveness: every grant is readable once the network is quiet', () => {
    for (const mode of [...MODES, 'roll'] as Mode[]) {
      const live = explore({ ...e3, mode, length: 5, advMoves: 0, coalition: [] });
      expect(Object.keys(live.violations), mode).toEqual([]);
      for (const lazy of [0, 1, 2]) {
        const r = explore({ ...e3, mode, length: 5, advMoves: 0, coalition: [], lazy });
        expect(r.violations['no-fallback'], `${mode} lazy ${lazy}`).toBeUndefined();
      }
    }
  });
});

describe('liveness, honest seats only', () => {
  const live = (design: Design, mode: Mode, lazy: Seat | null = null) =>
    explore({ ...base, design, mode, length: 5, advMoves: 0, advAcks: 0, coalition: [], lazy });

  it('prompt designs reveal every grant once the network is quiet; v1 does not', () => {
    for (const mode of MODES) {
      for (const design of ['d039', 'ack', 'fs', 'fgr', 'fgr2'] as Design[]) {
        const r = live(design, mode);
        expect(r.complete).toBe(true);
        expect(Object.keys(r.violations), `${design} ${mode}`).toEqual([]);
      }
      expect(live('v1', mode).violations['not-prompt'], `v1 ${mode}`).toBeDefined();
    }
  });

  it('a seat that never acks nor shares early: fgr falls back to the turn-piggybacked path', () => {
    for (const mode of MODES)
      for (const lazy of [0, 1, 2])
        for (const design of ['fgr', 'fgr2'] as Design[]) {
          const r = live(design, mode, lazy);
          expect(r.violations['no-fallback'], `${design} ${mode} lazy ${lazy}`).toBeUndefined();
        }
  });
});

describe.runIf(BIG)('bigger scope for round 2 (PROTOCOL_MODEL_BIG=1, about an hour)', () => {
  const safe = (r: Result): void => {
    expect(r.complete).toBe(true);
    expectSafe(counts(r));
  };

  it('fgr2: every mode and coalition, a claim and a deadline', () => {
    for (const mode of MODES) {
      const s = sweep({ ...base, design: 'fgr2', mode, length: 3, advClaims: 1, expiries: 1 });
      expect(s.complete, mode).toBe(true);
      expectSafe(s.counts, SAFETY2);
    }
  }, 7_200_000);

  it('fgr2: every coalition, a claim, a resign and two deadlines, with absent humans', () => {
    const s = sweep({
      ...base,
      design: 'fgr2',
      mode: 'private',
      length: 3,
      advClaims: 1,
      advResigns: 1,
      expiries: 2,
      absence: true,
    });
    expect(s.complete).toBe(true);
    expectSafe(s.counts, SAFETY2);
  }, 7_200_000);

  it('fgr2: every mode and coalition, 4 moves, 3 adversary moves, multi-draw', () => {
    for (const mode of MODES) {
      const s = sweep({ ...base, design: 'fgr2', mode, length: 4, advMoves: 3, multiDraw: true });
      expect(s.complete, mode).toBe(true);
      expectSafe(s.counts);
    }
  }, 7_200_000);

  it('fgr2: 4 seats, every pair of colluders at 4 moves, every single adversary at 2 moves', () => {
    const pairs = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ];
    for (const mode of MODES) {
      for (const coalition of pairs)
        safe(explore({ ...base, seats: 4, design: 'fgr2', mode, length: 4, coalition }));
      for (const coalition of [[0], [1], [2], [3]])
        safe(explore({ ...base, seats: 4, design: 'fgr2', mode, length: 2, coalition }));
    }
  }, 7_200_000);

  it('fgr2: the late-Ack scope (6 moves, 6 adversary moves, two colluders), and with claims', () => {
    for (const mode of MODES)
      safe(explore({ ...base, design: 'fgr2', mode, length: 6, advMoves: 6, coalition: [0, 1] }));
    for (const coalition of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      expectSafe(
        counts(
          explore({
            ...base,
            design: 'fgr2',
            mode: 'private',
            length: 6,
            advMoves: 5,
            expiries: 1,
            coalition,
          }),
        ),
        SAFETY2,
      );
  }, 7_200_000);

  it('fgr2: two devices per honest seat, 3 moves', () => {
    // One honest seat on two devices: a single adversary would leave four honest clients, beyond this scope.
    for (const ackDevice of ['all', 'checked'] as const)
      for (const coalition of [
        [0, 1],
        [0, 2],
        [1, 2],
      ] as Seat[][]) {
        const r = explore({
          ...base,
          design: 'fgr2',
          mode: 'private',
          length: 3,
          advAcks: 2,
          devices: 2,
          ackDevice,
          coalition,
        });
        expect(r.complete).toBe(true);
        expect(counts(r).exposure ?? 0).toBe(0);
        expect(counts(r).divergence ?? 0).toBe(0);
        if (ackDevice === 'checked') expect(counts(r)['honest-flagged'] ?? 0).toBe(0);
      }
  }, 7_200_000);
});

describe.runIf(BIG)('bigger scope for candidate (e) (PROTOCOL_MODEL_BIG=1)', () => {
  const stop = { ...base, design: 'stop', advAcks: 0 } as const;
  const ALL4: Seat[][] = [[0], [1], [2], [3], [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

  it('3 seats, 4 moves, 3 adversary moves, multi-draw, a claim, a resign, a deadline, every mode', () => {
    for (const mode of [...MODES, 'roll'] as Mode[]) {
      const s = sweep({
        ...stop,
        mode,
        length: 4,
        advMoves: 3,
        multiDraw: true,
        advClaims: 1,
        advResigns: 1,
        expiries: 1,
      });
      expect(s.complete, mode).toBe(true);
      expectSafe(s.counts, SAFETY2);
    }
  }, 7_200_000);

  it('4 seats, 4 moves, every coalition of 1 or 2 seats (single adversaries included), every mode', () => {
    for (const mode of [...MODES, 'roll'] as Mode[])
      for (const coalition of ALL4) {
        const r = explore({ ...stop, seats: 4, mode, length: 4, coalition });
        expect(r.complete).toBe(true);
        expectSafe(counts(r));
      }
  }, 7_200_000);

  it('two devices per honest seat with a claim and a deadline (colluder pairs); absent humans at 4 moves', () => {
    // A single adversary leaves two honest seats on four devices: over 8 million states, not completed.
    for (const coalition of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const r = explore({
        ...stop,
        mode: 'private',
        length: 3,
        devices: 2,
        advClaims: 1,
        expiries: 1,
        coalition,
      });
      expect(r.complete).toBe(true);
      expectSafe(counts(r), SAFETY2);
    }
    const a = sweep({ ...stop, mode: 'private', length: 4, absence: true, advClaims: 1, expiries: 2 });
    expect(a.complete).toBe(true);
    expectSafe(a.counts, SAFETY2);
  }, 7_200_000);

  it('the late-Ack scope with a claim, colluder pairs', () => {
    for (const coalition of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      expectSafe(
        counts(
          explore({ ...stop, length: 6, advMoves: 6, advClaims: 1, expiries: 1, coalition, mode: 'private' }),
        ),
        SAFETY2,
      );
  }, 7_200_000);
});

describe.runIf(BIG)('bigger scope for round 3 (PROTOCOL_MODEL_BIG=1, several hours)', () => {
  const e3 = {
    ...base,
    design: 'stop3',
    advAcks: 0,
    advAttests: 1,
    stopScore: 'last',
    ownCheck: true,
  } as const;
  const FINAL = ['attested-void', 'void-forfeit'] as const;
  const check = (r: Result, single: boolean): void => {
    expect(r.complete).toBe(true);
    expectSafe(counts(r));
    expect(counts(r)['honest-flagged'] ?? 0).toBe(0);
    if (single) expectSafe(counts(r), FINAL);
  };
  const claims = { advClaims: 1, advResigns: 1, expiries: 1 } as const;

  it('3 seats, 3 moves, a claim, a resign and a deadline: every mode and coalition', () => {
    for (const mode of [...MODES, 'roll'] as Mode[])
      for (const coalition of COALITIONS)
        check(explore({ ...e3, mode, length: 3, ...claims, coalition }), coalition.length === 1);
  }, 7_200_000);

  it('3 seats, 4 moves, 3 adversary moves, multi-draw, a claim, a resign and a deadline (private)', () => {
    for (const coalition of COALITIONS)
      check(
        explore({ ...e3, mode: 'private', length: 4, advMoves: 3, multiDraw: true, ...claims, coalition }),
        coalition.length === 1,
      );
  }, 7_200_000);

  it('2 seats, 4 moves, 3 adversary moves; absent humans with two deadlines', () => {
    for (const coalition of [[0], [1]] as Seat[][])
      check(
        explore({ ...e3, seats: 2, mode: 'private', length: 4, advMoves: 3, ...claims, coalition }),
        true,
      );
    for (const coalition of COALITIONS)
      check(
        explore({ ...e3, mode: 'private', length: 4, advClaims: 1, expiries: 2, absence: true, coalition }),
        coalition.length === 1,
      );
  }, 7_200_000);

  it('two devices: colluder pairs with claims, resigns and a stale outbox; A1; 2 seats', () => {
    const pairs: Seat[][] = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    for (const coalition of pairs) {
      check(
        explore({
          ...e3,
          mode: 'private',
          length: 3,
          devices: 2,
          stale: 1,
          outboxRule: true,
          ...claims,
          coalition,
        }),
        false,
      );
      // A1's scope: under the cutoff the card is read on a stopped branch (post-end), never exposed.
      check(
        explore({ ...e3, mode: 'private', length: 4, advMoves: 3, advResigns: 1, devices: 2, coalition }),
        false,
      );
    }
    for (const coalition of [[0], [1]] as Seat[][]) {
      const r = explore({
        ...e3,
        seats: 2,
        mode: 'private',
        length: 3,
        devices: 2,
        stale: 1,
        outboxRule: true,
        ...claims,
        coalition,
      });
      expect(r.complete).toBe(true);
      expectSafe(counts(r));
    }
  }, 7_200_000);

  it('two honest seats on two devices each, a single adversary, 3 moves', () => {
    for (const coalition of [[0], [1], [2]] as Seat[][]) {
      const r = explore({ ...e3, mode: 'private', length: 3, devices: 2, coalition });
      expect(r.complete).toBe(true);
      expectSafe(counts(r));
      expect(counts(r)['void-forfeit'] ?? 0).toBe(0);
    }
  }, 7_200_000);

  it('4 seats, 8 moves, 2 adversary moves, a claim and a deadline: every single adversary (private)', () => {
    for (const coalition of [[0], [1], [2], [3]] as Seat[][])
      check(
        explore({ ...e3, seats: 4, mode: 'private', length: 8, advClaims: 1, expiries: 1, coalition }),
        true,
      );
  }, 7_200_000);
});
