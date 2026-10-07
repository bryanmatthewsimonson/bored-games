import { deepFreeze } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { cardOf, pendingOf } from '../../src/engine.ts';
import { DECK_ID, VERDICT_POSITIONS } from '../../src/ids.ts';
import { roomForDoubt } from '../../src/module.ts';
import type { RfdState } from '../../src/types.ts';
import {
  act,
  dismiss,
  enter,
  learned,
  legal,
  only,
  orderWith,
  passTurn,
  posOf,
  refused,
  rollTo,
  showCard,
  started,
  submit,
  VERDICT,
  withPawns,
} from '../helpers.ts';

const INDICT = { type: 'indict', party: 'ashdown', exhibit: 'gavel', scene: 'jury' } as const;
const indictBy = (actor: number) => ({ ...INDICT, actor });

/** The indictments `seat` may make now. */
const indicts = (s: RfdState, seat: number) => only(s, 'indict', seat);

describe('indictment', () => {
  it('C32 indict timing: a seat may indict at any point of its own turn, and only on its own turn', () => {
    const start = started(3);
    const roll = act(start, { type: 'roll', actor: 0 });
    const walk = rollTo(start, [1, 1]);
    const moved = act(walk, { type: 'move', actor: 0, to: 'G2' });
    const rebut = submit(enter(start, 'courtroom'), 'faulk', 'gavel');
    const answered = showCard(rebut, posOf(rebut, 'faulk'));
    for (const [stage, s, open] of [
      ['start', start, true],
      ['roll', roll, false],
      ['walk', walk, true],
      ['moved', moved, true],
      ['rebut', rebut, false],
      ['answered', answered, true],
    ] as const) {
      expect(s.stage).toBe(stage);
      expect(indicts(s, 0), stage).toHaveLength(open ? 324 : 0);
      expect(refused(s, indictBy(0)) === null, stage).toBe(open);
      for (const seat of [1, 2]) {
        expect(indicts(s, seat), `${stage} seat ${seat}`).toEqual([]);
        expect(refused(s, indictBy(seat)), `${stage} seat ${seat}`).not.toBeNull();
      }
      if (open) {
        const r = roomForDoubt.apply(s, indictBy(0));
        if (!r.ok) throw new Error(r.error.message);
        expect(r.state.stage).toBe('verdict');
        expect(r.events).toEqual([
          { type: 'indicted', seat: 0, party: 'ashdown', exhibit: 'gavel', scene: 'jury', again: false },
        ]);
      }
    }
    // Parties, then Exhibits, then Scenes.
    expect(indicts(start, 0).slice(0, 2)).toEqual([
      { type: 'indict', actor: 0, party: 'ashdown', exhibit: 'gavel', scene: 'courtroom' },
      { type: 'indict', actor: 0, party: 'ashdown', exhibit: 'gavel', scene: 'chambers' },
    ]);
    expect(indicts(start, 0).at(-1)).toEqual({
      type: 'indict',
      actor: 0,
      party: 'quarrel',
      exhibit: 'clockhand',
      scene: 'gallery',
    });
  });

  it('C33 indict once: a seat may indict once per game; a second indictment is refused', () => {
    const s = act(started(3), indictBy(0));
    expect(indicts(s, 0)).toEqual([]);
    expect(refused(s, { ...indictBy(0), party: 'brine' })).not.toBeNull();
    // Dismissed, it takes no more turns, so it never indicts again.
    let t = act(s, { type: 'verdict', actor: 0, upheld: false });
    for (let i = 0; i < 4; i++) {
      expect(t.turn).not.toBe(0);
      expect(indicts(t, 0)).toEqual([]);
      expect(refused(t, indictBy(0))).not.toBeNull();
      t = passTurn(t);
    }
    // The rule itself, on a constructed state where a seat that has indicted holds the turn.
    const again: RfdState = deepFreeze({
      ...started(3),
      players: started(3).players.map((p, i) => (i === 0 ? { ...p, indicted: true } : p)),
    });
    expect(indicts(again, 0)).toEqual([]);
    expect(refused(again, indictBy(0))).not.toBeNull();
  });

  it('C34 the Verdict check: any three cards; only the indicting seat can read the Verdict', () => {
    const order = orderWith(VERDICT);
    const before = started(3, order);
    // Any Party, Exhibit and Scene: the Scene need not be the room the pawn stands in.
    const s = act(before, indictBy(0));
    expect(s.indictments).toEqual([
      { by: 0, party: 'ashdown', exhibit: 'gavel', scene: 'jury', upheld: null },
    ]);
    expect(s.dealt.slice(-3)).toEqual(VERDICT_POSITIONS.map((pos) => ({ deck: DECK_ID, pos, to: 0 })));
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'verdict' });
    expect(roomForDoubt.knownTo(s, 0).filter((l) => VERDICT_POSITIONS.includes(l.pos))).toEqual(
      VERDICT_POSITIONS.map((pos) => ({ deck: DECK_ID, pos, card: order[pos] })),
    );
    for (const seat of [1, 2])
      expect(roomForDoubt.knownTo(s, seat).filter((l) => VERDICT_POSITIONS.includes(l.pos))).toEqual([]);
    // The indicter's own view offers nothing until it has read all three cards, then exactly the true answer.
    let mine = act(roomForDoubt.view(before, 0), indictBy(0));
    for (const pos of VERDICT_POSITIONS) {
      expect(legal(mine, 0)).toEqual([]);
      mine = learned(mine, { deck: DECK_ID, pos, card: order[pos] as number });
    }
    expect(legal(mine, 0)).toEqual([{ type: 'verdict', actor: 0, upheld: false }]);
    expect(mine).toEqual(roomForDoubt.view(s, 0));
    expect(legal(s)).toEqual([{ type: 'verdict', actor: 0, upheld: false }]);
    // No other seat can learn it.
    for (const viewer of [1, 2, null]) {
      const v = act(roomForDoubt.view(before, viewer), indictBy(0));
      expect(roomForDoubt.learn(v, { deck: DECK_ID, pos: 0, card: order[0] as number }).ok).toBe(false);
      expect(v.verdict.map((x) => x.card)).toEqual([null, null, null]);
    }
    // A second indictment deals the three positions again, to the next indicter: each is dealt to the first
    // indicter, then to the second, and never to the public, so the first indicter seals its share to the second
    // (PROTOCOL §4.10, sealedPositions).
    const out = act(s, { type: 'verdict', actor: 0, upheld: false });
    const r = roomForDoubt.apply(out, indictBy(1));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([
      { type: 'indicted', seat: 1, party: 'ashdown', exhibit: 'gavel', scene: 'jury', again: true },
    ]);
    for (const pos of VERDICT_POSITIONS)
      expect(r.state.dealt.filter((d) => d.pos === pos)).toEqual([
        { deck: DECK_ID, pos, to: 0 },
        { deck: DECK_ID, pos, to: 1 },
      ]);
    expect(legal(r.state)).toEqual([{ type: 'verdict', actor: 1, upheld: false }]);
    // The second indicter's view reads the Verdict as the first one did.
    let second = act(roomForDoubt.view(out, 1), indictBy(1));
    for (const pos of VERDICT_POSITIONS)
      second = learned(second, { deck: DECK_ID, pos, card: order[pos] as number });
    expect(second.verdict.map((x) => x.card)).toEqual(VERDICT.map((id) => cardOf(id)));
  });

  it('C35 upheld: an indictment matching all three cards ends the game, and the indicting seat wins', () => {
    const s = act(started(3), {
      type: 'indict',
      actor: 0,
      party: 'quarrel',
      exhibit: 'clockhand',
      scene: 'gallery',
    });
    expect(legal(s)).toEqual([{ type: 'verdict', actor: 0, upheld: true }]);
    const r = roomForDoubt.apply(s, { type: 'verdict', actor: 0, upheld: true });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([{ type: 'verdict', seat: 0, upheld: true }]);
    expect(r.state.result).toEqual({ places: [1, 2, 2], scores: [1, 0, 0], reason: 'upheld' });
    expect([r.state.stage, r.state.indictments[0]?.upheld]).toEqual(['over', true]);
    expect(pendingOf(r.state)).toEqual({ type: 'over' });
    expect(roomForDoubt.outcome(r.state)).toEqual(r.state.result);
    for (const seat of [0, 1, 2]) expect(legal(r.state, seat)).toEqual([]);
    // Another seat, another table: seat 2 of four wins on its own turn.
    let t = passTurn(passTurn(started(4)));
    t = act(t, { type: 'indict', actor: 2, party: 'quarrel', exhibit: 'clockhand', scene: 'gallery' });
    t = act(t, { type: 'verdict', actor: 2, upheld: true });
    expect(t.result).toEqual({ places: [2, 2, 1, 2], scores: [0, 0, 1, 0], reason: 'upheld' });
  });

  it('C36 dismissed: a mismatch dismisses the seat, its turns are skipped, and the Verdict stays sealed', () => {
    const r = roomForDoubt.apply(act(started(3), indictBy(0)), { type: 'verdict', actor: 0, upheld: false });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([
      { type: 'verdict', seat: 0, upheld: false },
      { type: 'turn', seat: 1 },
    ]);
    let s = r.state;
    expect([s.players[0]?.dismissed, s.indictments[0]?.upheld, s.result]).toEqual([true, false, null]);
    expect([s.turn, s.stage, s.dice, s.entered]).toEqual([1, 'start', null, false]);
    s = passTurn(s);
    expect(s.turn).toBe(2);
    s = passTurn(s);
    expect(s.turn).toBe(1);
    // Seat 0 never decides again in its turn's stages; the others never see the Verdict.
    for (const viewer of [1, 2, null])
      expect(roomForDoubt.view(s, viewer).verdict.map((v) => v.card)).toEqual([null, null, null]);
    expect(roomForDoubt.view(s, 0).verdict.map((v) => v.card)).toEqual(VERDICT.map((id) => cardOf(id)));
    for (const a of [
      { type: 'roll', actor: 0 },
      { type: 'endTurn', actor: 0 },
    ])
      expect(refused(s, a)).not.toBeNull();
  });

  it('C37 the duties of a dismissed seat: it still rebuts and adds dice shares, and its pawn can be named', () => {
    let s = dismiss(started(3));
    // It adds its share to every roll.
    expect(act(s, { type: 'roll', actor: 1 }).contributors).toEqual([2, 0, 1]);
    // Reeve names Ashdown and the Brass Scales in the Jury Room: seat 2 holds none, so dismissed seat 0 is asked
    // and must show one of the three it holds.
    s = submit(enter(s, 'jury'), 'ashdown', 'scales');
    expect(s.pawns[0]).toBe('jury');
    s = act(s, { type: 'none', actor: 2 });
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'rebut' });
    expect(legal(s)).toEqual(
      (['ashdown', 'scales', 'jury'] as const).map((id) => ({ type: 'show', actor: 0, pos: posOf(s, id) })),
    );
    expect(refused(s, { type: 'none', actor: 0 })).not.toBeNull();
    const t = showCard(s, posOf(s, 'scales'));
    expect(t.submissions[0]).toMatchObject({ by: 1, shownBy: 0, card: cardOf('scales'), passed: [2] });
  });

  it('C38 a pawn blocking a door: a dismissed Party on a doorstep moves into that room at once', () => {
    // H3 is the Courtroom's doorstep.
    const s = dismiss(withPawns(started(3), { ashdown: 'H3' }));
    expect(s.pawns[0]).toBe('courtroom');
    expect(s.players[0]?.dismissed).toBe(true);
    // The door is free again for the next seat.
    const walk = rollTo(withPawns(s, { reeve: 'H1' }), [1, 2]);
    expect(only(walk, 'move').map((m) => m.to)).toContain('courtroom');
    // A pawn off the doorsteps stays where it is.
    expect(dismiss(started(3)).pawns[0]).toBe('H1');
    expect(dismiss(withPawns(started(3), { ashdown: 'jury' })).pawns[0]).toBe('jury');
  });

  it('C39 last standing: when every seat but one is dismissed, the last seat wins at once', () => {
    let s = dismiss(started(3));
    expect(s.result).toBeNull();
    const r = roomForDoubt.apply(act(s, indictBy(1)), { type: 'verdict', actor: 1, upheld: false });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([{ type: 'verdict', seat: 1, upheld: false }]);
    s = r.state;
    expect(s.players.map((p) => p.dismissed)).toEqual([true, true, false]);
    expect(s.stage).toBe('over');
    expect(s.result).toEqual({ places: [2, 2, 1], scores: [0, 0, 1], reason: 'last-standing' });
    expect(pendingOf(s)).toEqual({ type: 'over' });
    // At four seats the game goes on after two dismissals.
    let t = dismiss(dismiss(started(4)));
    expect([t.stage, t.turn, t.result]).toEqual(['start', 2, null]);
    t = dismiss(t);
    expect(t.result).toEqual({ places: [2, 2, 2, 1], scores: [0, 0, 0, 1], reason: 'last-standing' });
  });
});
