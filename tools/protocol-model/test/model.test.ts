import { describe, expect, it } from 'vitest';
import {
  type Design,
  explore,
  foldView,
  MODES,
  type Mode,
  type ModelEvent,
  modelMove,
  type Result,
  type Scope,
  type Seat,
} from '../src/index.ts';

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

/** Protocol v2 (`stop3`): the round-3 kinds plus H1's cancel escape, H2's demotion after a stop and N1's audit escape. */
const SAFETY3 = [...SAFETY, 'cancel-escape', 'stop-demotion', 'cheat-escape'] as const;

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
  it('every coalition, 3 moves, 2 adversary moves, an Ack (private in CI; every mode in the big scope)', () => {
    for (const mode of BIG ? MODES : (['private'] as Mode[])) {
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
    // CI runs `checked`, the policy that also avoids flags; the big scope runs all three.
    for (const ackDevice of BIG ? (['all', 'first', 'checked'] as const) : (['checked'] as const)) {
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
      expectSafe(s.counts, SAFETY3);
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
    expectSafe(counts(r3), SAFETY3);
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
      expectSafe(counts(r), SAFETY3);
      if (coalition.length === 1) expectSafe(counts(r), FINAL);
    }
    for (const coalition of SINGLE)
      for (const extra of [{ advClaims: 1 }, { advResigns: 1 }]) {
        const r = explore({ ...e3, mode: 'private', length: 3, expiries: 1, coalition, ...extra });
        expect(r.complete).toBe(true);
        expectSafe(counts(r), SAFETY3);
        expectSafe(counts(r), FINAL);
      }
  });

  it('residual: a colluder who never attests keeps its partner’s fork able to void a counted timeout', () => {
    const r = explore({ ...e3, mode: 'private', length: 3, advClaims: 1, expiries: 1, coalition: [0, 1] });
    expect(r.complete).toBe(true);
    expectSafe(counts(r), SAFETY3);
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
    expectSafe(counts(r), SAFETY3);
    expect(counts(r)['honest-flagged'] ?? 0).toBe(0);
  });

  it('two devices and a claim (2 seats): events past a result’s head do not block it; devices check their own events', () => {
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
    // Round 3's first wording (any event past the head counts, attestations do not), without the check: device a
    // plays on after device b counted the opponent's timeout, the opponent forks, and the end stands over the
    // counted timeout.
    const path = explore({ ...scope, cutoff: 'path', ownCheck: false, stopAt: ['rating'] });
    expect(path.violations.rating).toBeDefined();
    // Now the counted claim and the end lie on one line and neither blocks the other: two results stand, and the
    // fork stops the game as the opponent's loss. Without the check the two devices can still end apart (no fork).
    const loose = explore({ ...scope, ownCheck: false });
    expect(loose.complete).toBe(true);
    expectSafe(counts(loose), SAFETY3);
    expect(counts(loose)['claim-race'] ?? 0).toBeGreaterThan(0);
    const r = explore(scope);
    expect(r.complete).toBe(true);
    expectSafe(counts(r), SAFETY3);
    expect(counts(r)['claim-race'] ?? 0).toBe(0);
  });

  it('two devices and a resign (2 seats): only events on another side of the fork block a result', () => {
    const scope = {
      ...e3,
      seats: 2,
      mode: 'private',
      length: 3,
      coalition: [1],
      devices: 2,
      advResigns: 1,
    } as const;
    // Round 3's first wording: device a plays to the end past the head of a resign that device b counts late, or on
    // the other side of the resigner's fork from it, and device a's end stands over the counted resign (a 2-seat
    // rating gain). Now events past the head do not block the resign, and device b's attestation on the other side
    // blocks the end.
    const path = explore({ ...scope, cutoff: 'path', stopAt: ['rating'] });
    expect(path.violations.rating).toBeDefined();
    const r = explore(scope);
    expect(r.complete).toBe(true);
    expectSafe(counts(r), SAFETY3);
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

/*
 * Protocol v2 (PROTOCOL-v2.md §5–§8, the v2 build plan's tasks T0a and T0b): the model aligned with the approved
 * spec. Each behaviour has a regression variant that reproduces the attack it closes; the CI scopes of the fixed
 * design show no safety kind. Larger scopes run with PROTOCOL_MODEL_BIG=1.
 */
describe('protocol v2 (stop3 as specified): T0a, the cancel case, M1 and the resign identity', () => {
  const v2 = {
    ...base,
    design: 'stop3',
    advAcks: 0,
    advAttests: 1,
    stopScore: 'last',
    ownCheck: true,
  } as const;
  const FINAL = ['attested-void', 'void-forfeit'] as const;
  /** A held line of moves, each on the one before, by the seats given (kinds `d` draw, `p` pass, `s` setup). */
  const line = (
    from: ModelEvent | null,
    steps: readonly [Seat, 'draw' | 'pass' | 'shuf' | 'junk', number?][],
  ) => {
    const out: ModelEvent[] = [];
    let at = from;
    for (const [seat, kind, v] of steps) {
      at = modelMove(at, seat, kind, v ?? 0);
      out.push(at);
    }
    return out;
  };

  it('H1 traces: a fork at the root after play is E’s loss; a setup fork with nothing played past it cancels', () => {
    // 2 seats, no setup: seat 0 signs a rival move 1 after play reached move 3.
    const two = { ...v2, seats: 2, mode: 'private', length: 4, coalition: [0] } as const;
    const played = line(null, [
      [0, 'draw'],
      [1, 'draw'],
      [0, 'draw'],
    ]);
    const rival = modelMove(null, 0, 'pass', 1);
    const late = foldView(two, [...played, rival], 1);
    expect(late.status).toBe('stop');
    expect(late.cancelled).toBe(false);
    expect(late.scores).toEqual(['last', 'first']);
    // One setup step per seat (3 seats): seat 0 signs a second, well-formed step on the root whose proof fails,
    // after play began: a stop scored as E's loss, P before play (everyone but E first, scores 0).
    const three = {
      ...v2,
      mode: 'private',
      length: 3,
      setup: 3,
      coalition: [0],
      stopScore: 'timeout',
    } as const;
    const setup = line(null, [
      [0, 'shuf'],
      [1, 'shuf'],
      [2, 'shuf'],
      [0, 'draw'],
    ]);
    const junk = modelMove(null, 0, 'junk', 1);
    const root = foldView(three, [...setup, junk], 1);
    expect(root.status).toBe('stop');
    expect(root.cancelled).toBe(false);
    expect(root.scores).toEqual(['last', 'zero', 'zero']);
    // The same fork before any game action: cancelled, E recorded.
    const early = foldView(three, [...setup.slice(0, 3), junk], 1);
    expect(early.cancelled).toBe(true);
    expect(early.equivocators).toEqual([0]);
    expect(early.scores).toEqual(['cancel', 'cancel', 'cancel']);
    // A fork at seat 1's old setup step with play past it (only on the other side): still a stop.
    const step1 = modelMove(setup[0] as ModelEvent, 1, 'shuf', 1);
    const shuffle = foldView(three, [...setup, step1], 0);
    expect([shuffle.status, shuffle.stopSeat, shuffle.cancelled]).toEqual(['stop', 1, false]);
    // Under the regression rule (cancel by where P is) both late forks cancel.
    expect(foldView({ ...three, cancelRule: 'position' }, [...setup, junk], 1).cancelled).toBe(true);
    expect(foldView({ ...two, cancelRule: 'position' }, [...played, rival], 1).cancelled).toBe(true);
  });

  it('regression: cancelling by where P is lets E escape a game in play by a second setup step', () => {
    const scope = { ...v2, mode: 'private', length: 3, setup: 1, advMoves: 3, coalition: [0] } as const;
    const r = explore({ ...scope, cancelRule: 'position', stopAt: ['cancel-escape'] });
    const v = r.violations['cancel-escape'];
    expect(v?.first.detail).toMatch(/fork of seat 0 at R cancels a game in play/);
    expect(v?.first.trace.some((t) => /signs 0[sj]\d/.test(t))).toBe(true);
    const fixed = explore(scope);
    expect(fixed.complete).toBe(true);
    expectSafe(counts(fixed), SAFETY3);
  });

  it('setup steps: every coalition, 3 moves after one setup step; with claims, resigns and a deadline at 2', () => {
    const s = sweep({ ...v2, mode: 'private', length: 3, setup: 1, advMoves: 3 });
    expect(s.complete).toBe(true);
    expectSafe(s.counts, SAFETY3);
    expect(s.counts['honest-flagged'] ?? 0).toBe(0);
    const c = sweep({
      ...v2,
      mode: 'private',
      length: 2,
      setup: 1,
      advClaims: 1,
      advResigns: 1,
      expiries: 1,
    });
    expect(c.complete).toBe(true);
    expectSafe(c.counts, SAFETY3);
    for (const coalition of [[0], [1], [2]] as Seat[][])
      expectSafe(
        counts(
          explore({
            ...v2,
            mode: 'private',
            length: 2,
            setup: 1,
            advClaims: 1,
            advResigns: 1,
            expiries: 1,
            coalition,
          }),
        ),
        FINAL,
      );
  });

  it('regression (M1): with only the topmost E recorded, a colluder’s higher fork erases a lower equivocator', () => {
    const scope = { ...v2, mode: 'private', length: 3, advMoves: 4, coalition: [0, 1] } as const;
    const r = explore({ ...scope, topmostOnly: true, stopAt: ['rating'] });
    expect(r.violations.rating?.first.detail).toMatch(
      /equivocator 1 is not rated last by the stop of seat 0/,
    );
    const s = sweep({ ...v2, mode: 'private', length: 3, advMoves: 4 });
    expect(s.complete).toBe(true);
    expectSafe(s.counts, SAFETY3);
    expect(s.counts['honest-flagged'] ?? 0).toBe(0);
  });

  it('M1: every equivocator shares the last places; with 2 seats a double equivocation is a tie', () => {
    const three = { ...v2, mode: 'private', length: 3, coalition: [0, 1] } as const;
    const a = modelMove(null, 0, 'pass', 1);
    const low = [modelMove(a, 1, 'pass', 0), modelMove(a, 1, 'pass', 1)];
    const high = modelMove(null, 0, 'pass', 0);
    const f = foldView(three, [a, ...low, high], 2);
    expect([f.status, f.stopSeat]).toEqual(['stop', 0]);
    expect(f.equivocators).toEqual([0, 1]);
    expect(f.scores).toEqual(['last', 'last', 'unrated']);
    expect(foldView({ ...three, topmostOnly: true }, [a, ...low, high], 2).scores).toEqual([
      'last',
      'unrated',
      'unrated',
    ]);
    const two = { ...v2, seats: 2, mode: 'private', length: 3, coalition: [0, 1] } as const;
    expect(foldView(two, [a, ...low, high], 0).scores).toEqual(['tie', 'tie']);
  });

  it('M3: a resign is attested at the head it names (and the round-3 counting head, for comparison)', () => {
    for (const resignAt of ['named', 'counted'] as const)
      for (const coalition of COALITIONS) {
        const r = explore({
          ...v2,
          mode: 'private',
          length: 3,
          advMoves: 1,
          advResigns: 1,
          expiries: 1,
          resignAt,
          coalition,
        });
        expect(r.complete).toBe(true);
        expectSafe(counts(r), SAFETY3);
        if (coalition.length === 1) expectSafe(counts(r), FINAL);
      }
  });

  it('M3: S stops at the first held fork past the named head; a resign that cancels there is no result', () => {
    const three = { ...v2, mode: 'private', length: 4, coalition: [1] } as const;
    const [m1, m2, m3] = line(null, [
      [0, 'draw'],
      [1, 'draw'],
      [2, 'draw'],
    ]) as [ModelEvent, ModelEvent, ModelEvent];
    const resign: ModelEvent = { t: 'resign', id: `X1@${m1.id}`, seat: 1, head: m1.id };
    const attest = (seat: Seat): ModelEvent => ({
      t: 'attest',
      id: `T${seat}:resign@${m1.id}:1`,
      seat,
      kind: 'resign',
      head: m1.id,
      forfeit: [1],
    });
    // Seat 1 resigns naming 0d0 after its own move, then forks below it: the resign stands (attested by 0 and 2).
    const rival = modelMove(m1, 1, 'pass', 1);
    const f = foldView(three, [m1, m2, m3, rival, resign, attest(0), attest(2)], 0);
    expect(f.status).toBe('stood');
    expect(f.standing).toEqual({ kind: 'resign', head: m1.id, forfeit: [1] });
    // Naming the root before its own first action, with the fork right after its first action: S stops before
    // that action, so the resign cancels, is no valid result, and the fork is a stop scored as seat 1's loss.
    const rootResign: ModelEvent = { t: 'resign', id: 'X1@R', seat: 1, head: 'R' };
    const g = foldView(three, [m1, m2, m3, rival, rootResign], 0);
    expect([g.status, g.cancelled, g.stopSeat]).toEqual(['stop', false, 1]);
  });
});

describe('protocol v2 (stop3 as specified): T0b, the features not modelled before', () => {
  const v2 = {
    ...base,
    design: 'stop3',
    advAcks: 0,
    advAttests: 1,
    stopScore: 'last',
    ownCheck: true,
  } as const;
  const FINAL = ['attested-void', 'void-forfeit'] as const;

  it('blocking public reveals (Luster refills): no safety kind; a claim forfeits every seat without a share', () => {
    const s = sweep({ ...v2, mode: 'reveal-block', length: 2, advClaims: 1, expiries: 1 });
    expect(s.complete).toBe(true);
    expectSafe(s.counts, SAFETY3);
    expect(s.counts['honest-flagged'] ?? 0).toBe(0);
    for (const coalition of [[0], [1], [2]] as Seat[][])
      expectSafe(
        counts(explore({ ...v2, mode: 'reveal-block', length: 2, advClaims: 1, expiries: 1, coalition })),
        FINAL,
      );
    // Two colluders that both withhold their share of a refill are timed out together (a two-seat forfeit list);
    // a fork by one of them then voids it (residual 2 of the proposal, reported apart).
    const pair = explore({
      ...v2,
      mode: 'reveal-block',
      length: 2,
      advClaims: 1,
      expiries: 1,
      coalition: [0, 2],
      stopAt: ['void-forfeit'],
    });
    expect(pair.violations['void-forfeit']?.first.detail).toMatch(/voids seat 0,2's counted claim/);
  });

  it('unresolved anchors: an anchor no client holds is off every line; no safety kind', () => {
    const three = { ...v2, mode: 'private', length: 3, coalition: [0, 1] } as const;
    const [m1, m2, m3] = [modelMove(null, 0, 'draw')].flatMap((a) => {
      const b = modelMove(a, 1, 'draw');
      return [a, b, modelMove(b, 2, 'draw')];
    }) as [ModelEvent, ModelEvent, ModelEvent];
    const attest = (seat: Seat, head: string): ModelEvent => ({
      t: 'attest',
      id: `T${seat}:over@${head}:`,
      seat,
      kind: 'over',
      head,
      forfeit: [],
    });
    const held = [m1, m2, m3, attest(1, m3.id), attest(2, m3.id), modelMove(null, 0, 'pass', 1)];
    expect(foldView(three, held, 2).status).toBe('stood');
    const share: ModelEvent = { t: 'share', id: 'Z1:-1@U', seat: 1, pos: -1, to: null, head: 'U' };
    expect(foldView(three, [...held, share], 2).status).toBe('stop');
    expect(foldView(three, [...held, attest(1, 'U')], 2).status).toBe('stop');
    // Signed by E itself it blocks nothing.
    expect(foldView(three, [...held, { ...share, id: 'Z0:-1@U', seat: 0 }], 2).status).toBe('stood');
    const s = sweep({ ...v2, mode: 'private', length: 3, advShares: 1, unresolved: true });
    expect(s.complete).toBe(true);
    expectSafe(s.counts, SAFETY3);
    expect(s.counts['honest-flagged'] ?? 0).toBe(0);
  });

  it('regression (H2): with claims after a stop, a withheld secret demotes a seat; the approved rule fixes places', () => {
    const scope = { ...v2, mode: 'private', length: 3, expiries: 1, secrets: true } as const;
    const bad = explore({ ...scope, coalition: [0, 1], stopClaims: true, stopAt: ['stop-demotion'] });
    expect(bad.violations['stop-demotion']?.first.detail).toMatch(
      /seat 1 moves from unrated to last after the stop/,
    );
    // The approved rule, with a cheat that the partial audit after a stop proves (which may demote).
    const s = sweep({ ...scope, advCheats: 1 });
    expect(s.complete).toBe(true);
    expectSafe(s.counts, SAFETY3);
    expect(s.counts['honest-flagged'] ?? 0).toBe(0);
  });

  it('regression (N1): without End rules after a standing result, a cheater forks and withholds its secret', () => {
    const scope = {
      ...v2,
      seats: 2,
      mode: 'private',
      length: 3,
      secrets: true,
      advCheats: 1,
      coalition: [1],
    } as const;
    const bad = explore({ ...scope, noStandingEnd: true, stopAt: ['cheat-escape'] });
    const v = bad.violations['cheat-escape'];
    expect(v?.first.detail).toMatch(/standing result over/);
    // The cheat, the end, seat 1's attestation, then its fork at its own old prev.
    expect(v?.first.trace.some((t) => t.includes('(a cheat)'))).toBe(true);
    expect(v?.first.trace.some((t) => t.startsWith('seat 1 attests over@'))).toBe(true);
    for (const expiries of [0, 1]) {
      const r = explore({ ...scope, expiries });
      expect(r.complete).toBe(true);
      expectSafe(counts(r), SAFETY3);
    }
  });

  it('unordered roll contributions: the requester contributes after its move; a withholder is timed out', () => {
    for (const coalition of COALITIONS) {
      const r = explore({ ...v2, mode: 'roll', length: 2, advClaims: 1, expiries: 1, coalition });
      expect(r.complete).toBe(true);
      expectSafe(counts(r), SAFETY3);
      if (coalition.length === 1) expectSafe(counts(r), FINAL);
    }
  });

  it('regression (N2): auto-accepting a claim that forfeits only one’s own seat ends the game on an honest forfeit', () => {
    const scope = { ...v2, mode: 'private', length: 3, advClaims: 1, coalition: [2] } as const;
    const bad = explore({ ...scope, autoOwnForfeit: true, stopAt: ['honest-forfeit'] });
    const v = bad.violations['honest-forfeit'];
    expect(v?.first.detail).toMatch(/honest seat 1 timed out at 0d0/);
    // The claim comes right after seat 0's move, with no deadline passed anywhere.
    expect(v?.first.trace.some((t) => t.startsWith('deadline'))).toBe(false);
    for (const coalition of [[0], [1], [2]] as Seat[][]) {
      const r = explore({ ...scope, coalition });
      expect(r.complete).toBe(true);
      expectSafe(counts(r), SAFETY3);
      expectSafe(counts(r), FINAL);
    }
  });

  it('liveness: blocking reveals and rolls are readable once the network is quiet', () => {
    for (const mode of ['reveal-block', 'roll'] as Mode[]) {
      const live = explore({ ...v2, mode, length: 5, advMoves: 0, coalition: [] });
      expect(live.complete).toBe(true);
      expect(Object.keys(live.violations), mode).toEqual([]);
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

  it('fgr2: moves that draw two positions; two colluders at a late-Ack depth (moved from CI)', () => {
    const s = sweep({ ...base, design: 'fgr2', mode: 'private', length: 3, multiDraw: true });
    expect(s.complete).toBe(true);
    expectSafe(s.counts);
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
  }, 7_200_000);

  it('stop (round 2): claims, resigns and a deadline; moves that draw two positions (moved from CI)', () => {
    const stop = { ...base, design: 'stop', advAcks: 0 } as const;
    for (const extra of [{ advClaims: 1, advResigns: 1, expiries: 1 }, { multiDraw: true }]) {
      const s = sweep({ ...stop, mode: 'private', length: 3, ...extra });
      expect(s.complete).toBe(true);
      expectSafe(s.counts, SAFETY2);
    }
  }, 7_200_000);

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

  it('two honest seats on two devices each, a single adversary, 3 moves; with a claim and a deadline', () => {
    // With two devices a single adversary can void an attested result (`attested-void`): the honest seat's other
    // device released a share on the rival, so the result must not stand (residual 4). Nothing else.
    for (const extra of [{}, { advClaims: 1, expiries: 1 }])
      for (const coalition of [[0], [1], [2]] as Seat[][]) {
        const r = explore({ ...e3, mode: 'private', length: 3, devices: 2, ...extra, coalition });
        expect(r.complete).toBe(true);
        expectSafe(counts(r));
        expect(counts(r)['honest-flagged'] ?? 0).toBe(0);
        expect(counts(r)['void-forfeit'] ?? 0).toBe(0);
      }
  }, 14_400_000);

  it('4 seats, 8 moves, 2 adversary moves, a claim and a deadline: every single adversary (private, public)', () => {
    for (const mode of ['private', 'public'] as Mode[])
      for (const coalition of [[0], [1], [2], [3]] as Seat[][])
        check(explore({ ...e3, seats: 4, mode, length: 8, advClaims: 1, expiries: 1, coalition }), true);
  }, 14_400_000);
});

describe.runIf(BIG)('bigger scope for protocol v2, T0a and T0b (PROTOCOL_MODEL_BIG=1, about an hour)', () => {
  const v2 = {
    ...base,
    design: 'stop3',
    advAcks: 0,
    advAttests: 1,
    stopScore: 'last',
    ownCheck: true,
  } as const;
  const FINAL = ['attested-void', 'void-forfeit'] as const;
  const claims = { advClaims: 1, advResigns: 1, expiries: 1 } as const;
  const check = (r: Result, single: boolean): void => {
    expect(r.complete).toBe(true);
    expectSafe(counts(r), SAFETY3);
    expect(counts(r)['honest-flagged'] ?? 0).toBe(0);
    if (single) expectSafe(counts(r), FINAL);
  };
  const each = (scope: Omit<Scope, 'coalition'>): void => {
    for (const coalition of COALITIONS) check(explore({ ...scope, coalition }), coalition.length === 1);
  };

  it('one setup step, 3 moves, 3 adversary moves, a claim, a resign and a deadline (private)', () => {
    each({ ...v2, mode: 'private', length: 3, setup: 1, advMoves: 3, ...claims });
  }, 7_200_000);

  it('blocking reveals and rolls, 3 moves, a claim and a deadline', () => {
    for (const mode of ['reveal-block', 'roll'] as Mode[])
      each({ ...v2, mode, length: 3, advClaims: 1, expiries: 1 });
  }, 7_200_000);

  it('unresolved anchors with a claim, a resign and a deadline (private, public)', () => {
    for (const mode of ['private', 'public'] as Mode[])
      each({ ...v2, mode, length: 3, advShares: 1, unresolved: true, ...claims });
  }, 7_200_000);

  it('the Secret phase with a cheat, a claim, a resign and a deadline; 2 seats at 4 moves', () => {
    each({ ...v2, mode: 'private', length: 3, secrets: true, advCheats: 1, ...claims });
    for (const coalition of [[0], [1]] as Seat[][])
      check(
        explore({
          ...v2,
          seats: 2,
          mode: 'private',
          length: 4,
          advMoves: 3,
          secrets: true,
          advCheats: 1,
          ...claims,
          coalition,
        }),
        true,
      );
  }, 7_200_000);

  it('M1 at depth: colluder pairs, 4 moves, 5 adversary moves (private)', () => {
    for (const coalition of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as Seat[][])
      check(explore({ ...v2, mode: 'private', length: 4, advMoves: 5, coalition }), false);
  }, 7_200_000);

  it('M3: two devices, 2 seats, a claim, a resign, a deadline and a stale outbox (B5c’s scope)', () => {
    for (const coalition of [[0], [1]] as Seat[][]) {
      const r = explore({
        ...v2,
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
      expectSafe(counts(r), SAFETY3);
    }
  }, 7_200_000);
});
