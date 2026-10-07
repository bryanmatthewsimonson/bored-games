import { deepFreeze, fuzzBatch, fuzzGame, SHOW_DECK } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { cardOf, DEFAULT_RULES } from '../../src/engine.ts';
import { roomForDoubt } from '../../src/module.ts';
import type { RfdState } from '../../src/types.ts';
import {
  act,
  caseOrder,
  enter,
  legal,
  posOf,
  refused,
  rollTo,
  showCard,
  started,
  submit,
  testPolicy,
} from '../helpers.ts';

const SEATS = [3, 4, 5, 6];

const contribute = (actor: number) => ({ type: 'contribute', actor, id: 0 });

/** Every listed action of `s` applies, apart from a show marker, which only the session turns into the wire. */
function expectListedApply(s: RfdState): void {
  for (const a of legal(s)) {
    if (a.type === 'show' && 'pos' in a) continue;
    expect(roomForDoubt.apply(s, a).ok, JSON.stringify(a)).toBe(true);
  }
}

describe('protocol', () => {
  it('C41 standings: the winner scores 1 at place 1, every other seat 0 at place 2; all 0 before the end', () => {
    const s = started(3);
    expect(roomForDoubt.standings(s)).toEqual([0, 0, 0]);
    expect(roomForDoubt.outcome(s)).toBeNull();
    const t = act(s, { type: 'indict', actor: 0, party: 'quarrel', exhibit: 'clockhand', scene: 'gallery' });
    expect(roomForDoubt.standings(t)).toEqual([0, 0, 0]);
    const end = act(t, { type: 'verdict', actor: 0, upheld: true });
    expect(roomForDoubt.standings(end)).toEqual([1, 0, 0]);
    expect(roomForDoubt.outcome(end)).toEqual({ places: [1, 2, 2], scores: [1, 0, 0], reason: 'upheld' });
    // Public: every view and the spectator give the same standings.
    for (const viewer of [0, 1, 2, null]) {
      expect(roomForDoubt.standings(roomForDoubt.view(s, viewer))).toEqual([0, 0, 0]);
      expect(roomForDoubt.standings(roomForDoubt.view(end, viewer))).toEqual([1, 0, 0]);
    }
  });

  it('C42 invalid input: refused without throwing or changing the state; one accepted encoding each', () => {
    const start = started(3);
    const walk = rollTo(start, [1, 2]);
    const entered = enter(start, 'courtroom');
    const rebut = submit(entered, 'faulk', 'gavel');
    const verdict = act(start, {
      type: 'indict',
      actor: 0,
      party: 'ashdown',
      exhibit: 'gavel',
      scene: 'jury',
    });
    const beacon = act(
      act(act(act(start, { type: 'roll', actor: 0 }), contribute(1)), contribute(2)),
      contribute(0),
    );
    const hostile = Object.defineProperty({}, 'type', {
      get() {
        throw new Error('hostile');
      },
      enumerable: true,
    });
    const table: [RfdState, unknown][] = [
      [start, { type: 'roll', actor: 0, extra: 1 }],
      [start, { type: 'roll' }],
      [start, { type: 'roll', actor: '0' }],
      [start, { type: 'roll', actor: -1 }],
      [start, { type: 'roll', actor: 0.5 }],
      [start, { type: 'Roll', actor: 0 }],
      [start, null],
      [start, 7],
      [start, 'roll'],
      [start, []],
      [start, {}],
      [start, hostile],
      [start, { type: 'indict', actor: 0, party: 'nobody', exhibit: 'gavel', scene: 'jury' }],
      [start, { type: 'indict', actor: 0, party: 'ashdown', exhibit: 'gavel' }],
      [walk, { type: 'move', actor: 0, to: 'h3' }],
      [walk, { type: 'move', actor: 0, to: 'H03' }],
      [walk, { type: 'move', actor: 0, to: 'Courtroom' }],
      [walk, { type: 'move', actor: 0, to: ['G3'] }],
      [walk, { type: 'move', actor: 0, to: 'G3', how: 'walk' }],
      [entered, { type: 'submit', actor: 0, party: 'nobody', exhibit: 'gavel' }],
      [entered, { type: 'submit', actor: 0, party: 'faulk', exhibit: 'Gavel' }],
      [rebut, { type: 'show', actor: 1, pos: posOf(rebut, 'faulk') }],
      [rebut, { type: 'show', actor: 1, id: 0, packet: '' }],
      [rebut, { type: 'show', actor: 1, id: 0, packet: 'x'.repeat(4097) }],
      [rebut, { type: 'show', actor: 1, id: 1, packet: 'opaque' }],
      [rebut, { type: 'show', actor: 1, id: 0, packet: 7 }],
      [rebut, { type: 'show', actor: 1, id: 0, packet: 'opaque', pos: 5 }],
      [rebut, { type: 'none', actor: 1, card: null }],
      [verdict, { type: 'verdict', actor: 0, upheld: 'yes' }],
      [verdict, { type: 'verdict', actor: 0, upheld: 0 }],
      [verdict, { type: 'verdict', actor: 0 }],
      [beacon, { type: 'rolled', actor: 0, id: 0, dice: [3, 4] }],
      [beacon, { type: 'rolled', actor: 'beacon', id: 0, dice: [3, 4], extra: true }],
      [beacon, { type: 'reveal', actor: 'deck', deck: 'case', pos: 27, card: 27 }],
    ];
    for (const [i, [s, a]] of table.entries()) {
      const before = JSON.stringify(s);
      expect(() => roomForDoubt.apply(s, a)).not.toThrow();
      expect(refused(s, a), `table row ${i}`).not.toBeNull();
      expect(JSON.stringify(s)).toBe(before);
      expect(() => roomForDoubt.revealsOf(s, a)).not.toThrow();
      expect(roomForDoubt.revealsOf(s, a)).toEqual([]);
      expect(() => roomForDoubt.beaconOf?.(s, a)).not.toThrow();
    }
    // Each listed action applies, in its one encoding, and moves the sequence on.
    for (const s of [start, walk, entered, rebut, verdict, beacon]) expectListedApply(s);
    expect(act(start, { type: 'roll', actor: 0 }).seq).toBe(start.seq + 1);
    const junk = { deck: 'case', pos: 1, card: 0 };
    expect(roomForDoubt.learn(start, junk).ok).toBe(false);
    expect(roomForDoubt.learn(start, { deck: 'other', pos: 1, card: 0 }).ok).toBe(false);
  });

  it('C43 determinism and fold: every seat and the spectator fold the same state from the same actions', () => {
    for (let i = 0; i < 8; i++) {
      const seats = SEATS[i % SEATS.length] as number;
      const report = fuzzGame(roomForDoubt, {
        seed: `c43-${i}`,
        seats,
        rules: DEFAULT_RULES,
        deckOrder: (_d, r) => caseOrder(r),
        checkViews: true,
        policies: [testPolicy],
      });
      expect(report.failure, `c43-${i} at ${seats} seats`).toBeNull();
      expect(report.outcome).not.toBeNull();
      // The same seed folds the same game.
      if (i === 0)
        expect(
          fuzzGame(roomForDoubt, {
            seed: 'c43-0',
            seats,
            rules: DEFAULT_RULES,
            deckOrder: (_d, r) => caseOrder(r),
            checkViews: false,
            policies: [testPolicy],
          }).finalHash,
        ).toBe(report.finalHash);
    }
  });

  it('C44 audit of hidden claims: in full mode a false none, show, shown card or verdict is refused', () => {
    // Ashdown names Faulk and the Gavel in the Courtroom: seat 1 holds Faulk and the Courtroom.
    const s = submit(enter(started(3), 'courtroom'), 'faulk', 'gavel');
    // A holder's none: the full state, as the end audit replays it, refuses it; the other seats' views cannot tell.
    expect(refused(s, { type: 'none', actor: 1 })).not.toBeNull();
    expect(roomForDoubt.apply(roomForDoubt.view(s, 2), { type: 'none', actor: 1 }).ok).toBe(true);
    // The wire from a seat holding none of the three cards: in the Jury Room, naming Reeve and the Gavel, seat 1
    // holds none of them (seat 2 holds both), yet it sends a show.
    const jury = submit(enter(started(3), 'jury'), 'reeve', 'gavel');
    expect(refused(jury, { type: 'show', actor: 1, id: 0, packet: 'opaque' })).not.toBeNull();
    expect(
      roomForDoubt.apply(roomForDoubt.view(jury, 0), { type: 'show', actor: 1, id: 0, packet: 'p' }).ok,
    ).toBe(true);
    // The shown card must be one of the three named, and one the shower holds.
    const shown = act(s, { type: 'show', actor: 1, id: 0, packet: 'opaque' });
    for (const card of [cardOf('ashdown'), cardOf('gavel'), cardOf('reports'), 99, -1, 1.5])
      expect(roomForDoubt.learn(shown, { deck: SHOW_DECK, pos: 0, card }).ok, String(card)).toBe(false);
    for (const id of ['faulk', 'courtroom'] as const) {
      const r = roomForDoubt.learn(shown, { deck: SHOW_DECK, pos: 0, card: cardOf(id) });
      expect(r.ok, id).toBe(true);
      // The same card again is accepted; another one is not.
      if (r.ok) {
        expect(roomForDoubt.learn(r.state, { deck: SHOW_DECK, pos: 0, card: cardOf(id) }).ok).toBe(true);
        const other = id === 'faulk' ? 'courtroom' : 'faulk';
        expect(roomForDoubt.learn(r.state, { deck: SHOW_DECK, pos: 0, card: cardOf(other) }).ok).toBe(false);
      }
    }
    expect(roomForDoubt.learn(shown, { deck: SHOW_DECK, pos: 1, card: cardOf('faulk') }).ok).toBe(false);
    expect(showCard(s, posOf(s, 'courtroom')).submissions[0]?.card).toBe(cardOf('courtroom'));
    // A wrong verdict: the full state knows the Verdict, and so does the indicter once it has read it.
    const v = act(started(3), {
      type: 'indict',
      actor: 0,
      party: 'quarrel',
      exhibit: 'clockhand',
      scene: 'jury',
    });
    expect(refused(v, { type: 'verdict', actor: 0, upheld: true })).not.toBeNull();
    expect(refused(v, { type: 'verdict', actor: 0, upheld: false })).toBeNull();
    const right = act(started(3), {
      type: 'indict',
      actor: 0,
      party: 'quarrel',
      exhibit: 'clockhand',
      scene: 'gallery',
    });
    expect(refused(right, { type: 'verdict', actor: 0, upheld: false })).not.toBeNull();
    expect(refused(roomForDoubt.view(v, 0), { type: 'verdict', actor: 0, upheld: true })).not.toBeNull();
    // A view that cannot know the Verdict takes the claim as made; the end audit checks it.
    expect(refused(roomForDoubt.view(v, 1), { type: 'verdict', actor: 0, upheld: true })).toBeNull();
  });

  it('C45 games end: by an upheld indictment or by the last seat standing', () => {
    const report = fuzzBatch(roomForDoubt, {
      seed: 'c45',
      games: 40,
      seatCounts: SEATS,
      rules: DEFAULT_RULES,
      deckOrder: (_d, r) => caseOrder(r),
      checkViews: false,
      policies: [testPolicy],
    });
    expect(report.failures).toEqual([]);
    expect(report.games).toBe(40);
    const ends = Object.entries(report.coverage).filter(([tag]) => tag.startsWith('end:'));
    expect(ends.map(([tag]) => tag).every((tag) => tag === 'end:upheld' || tag === 'end:last-standing')).toBe(
      true,
    );
    expect(ends.reduce((n, [, count]) => n + count, 0)).toBe(40);
    // A game with no indictment would never end: the policies make every game end, and so do the rules' tools.
    expect(report.coverage['event:indicted']).toBeGreaterThan(0);
    expect(deepFreeze(started(3)).stage).toBe('start');
  });
});
