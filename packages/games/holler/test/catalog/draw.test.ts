import { describe, expect, it } from 'vitest';
import { numberCard } from '../../src/cards.ts';
import { legalActionsOf, viewFor } from '../../src/index.ts';
import { act, handPos, pendingSeat, rejects, reveal, setup, starterPos, typesOf } from '../helpers.ts';

const QUIET = [1, 2, 3, 4, 6, 7, 8] as const;

/** Starter Notch 5. Each hand is another suit, with no rank 5, so nothing matches. */
function mustDraw(seats = 2) {
  const placed: Record<number, number> = { [starterPos(seats)]: numberCard(0, 5, 0) };
  for (let seat = 0; seat < seats; seat++) {
    for (let i = 0; i < 7; i++) placed[handPos(seats, seat, i)] = numberCard(seat + 1, QUIET[i] ?? 1, 0);
  }
  return reveal(setup(seats, placed));
}

describe('draw', () => {
  it('C24 draw is legal only when nothing in the hand matches', () => {
    const blocked = reveal(
      setup(2, { [starterPos(2)]: numberCard(0, 5, 0), [handPos(2, 0, 0)]: numberCard(0, 1, 0) }),
    );
    expect(typesOf(blocked)).not.toContain('draw');
    rejects(blocked, { type: 'draw', actor: 0 }, 'illegal');
    const state = mustDraw();
    expect(typesOf(state)).toEqual(['draw']);
    expect(act(state, { type: 'draw', actor: 0 }).state.phase.type).toBe('cover');
  });

  it('C25 the drawn card may be played at once when it matches', () => {
    const seats = 2;
    const drawPos = starterPos(seats) + 1;
    let state = mustDraw(seats);
    // The first draw is the next undealt card. Pin it to a Notch number so it matches.
    state = setupPinnedDraw(seats, drawPos, numberCard(0, 8, 0));
    state = act(state, { type: 'draw', actor: 0 }).state;
    state = act(state, { type: 'cover', actor: 1 }).state;
    expect(state.phase).toMatchObject({ type: 'drawn', seat: 0, pos: drawPos });
    const played = act(state, { type: 'play', actor: 0, pos: drawPos, card: numberCard(0, 8, 0) });
    expect(played.state.discard.at(-1)?.card).toBe(numberCard(0, 8, 0));
  });

  it('C26 the drawn card may be kept when it matches', () => {
    const seats = 2;
    const drawPos = starterPos(seats) + 1;
    let state = setupPinnedDraw(seats, drawPos, numberCard(0, 8, 0));
    state = act(state, { type: 'draw', actor: 0 }).state;
    state = act(state, { type: 'cover', actor: 1 }).state;
    const kept = act(state, { type: 'keep', actor: 0 });
    expect(kept.events).toContainEqual({ type: 'kept', seat: 0, pos: drawPos });
    expect(kept.state.hands[0]?.some((slot) => slot.pos === drawPos)).toBe(true);
    expect(kept.state.phase).toEqual({ type: 'play', seat: 1 });
  });

  it('C27 the drawn card must be kept when it does not match', () => {
    const seats = 2;
    const drawPos = starterPos(seats) + 1;
    let state = setupPinnedDraw(seats, drawPos, numberCard(2, 9, 0));
    state = act(state, { type: 'draw', actor: 0 }).state;
    state = act(state, { type: 'cover', actor: 1 }).state;
    rejects(state, { type: 'play', actor: 0, pos: drawPos, card: numberCard(2, 9, 0) }, 'illegal');
    expect(typesOf(state)).toEqual(['keep']);
    expect(act(state, { type: 'keep', actor: 0 }).state.phase).toEqual({ type: 'play', seat: 1 });
  });

  it('C28 a voluntary draw does not continue', () => {
    let state = mustDraw();
    const before = state.hands[0]?.length ?? 0;
    state = act(state, { type: 'draw', actor: 0 }).state;
    state = act(state, { type: 'cover', actor: 1 }).state;
    state = act(state, { type: 'keep', actor: 0 }).state;
    expect(state.hands[0]).toHaveLength(before + 1);
    expect(state.phase).toEqual({ type: 'play', seat: 1 });
    expect(typesOf(state)).toEqual(['draw']);
  });

  it('C29 cover is the only action while a voluntary draw is uncovered', () => {
    let state = mustDraw(3);
    state = act(state, { type: 'draw', actor: 0 }).state;
    expect(state.phase).toMatchObject({ type: 'cover', kind: 'voluntary', queue: [1, 2] });
    expect(typesOf(state)).toEqual(['cover']);
    expect(legalActionsOf(state, 0)).toEqual([]);
    expect(legalActionsOf(state, 2)).toEqual([]);
    state = act(state, { type: 'cover', actor: 1 }).state;
    expect(pendingSeat(state)).toBe(2);
    expect(typesOf(state)).toEqual(['cover']);
    state = act(state, { type: 'cover', actor: 2 }).state;
    expect(state.phase.type).toBe('drawn');
  });

  it('C30 legalActions is empty when any card in the pending hand is unknown', () => {
    const state = mustDraw(3);
    const hidden = viewFor(state, 1);
    expect(legalActionsOf(hidden, 0)).toEqual([]);
    const partial = {
      ...state,
      hands: state.hands.map((hand, seat) =>
        seat === 0 ? hand.map((slot, index) => (index === 0 ? { ...slot, card: null } : slot)) : hand,
      ),
    };
    expect(legalActionsOf(partial, 0)).toEqual([]);
    const levy = reveal(
      setup(2, {
        [starterPos(2)]: numberCard(0, 5, 0),
        [handPos(2, 0, 0)]: 104,
        [handPos(2, 0, 1)]: numberCard(1, 3, 0),
      }),
    );
    const blindHand = (levy.hands[0] ?? []).map((slot, index) =>
      index === 1 ? { ...slot, card: null } : slot,
    );
    const blind = { ...levy, hands: [blindHand, levy.hands[1] ?? []] };
    expect(legalActionsOf(blind, 0)).toEqual([]);
  });
});

function setupPinnedDraw(seats: number, drawPos: number, card: number) {
  const placed: Record<number, number> = {
    [starterPos(seats)]: numberCard(0, 5, 0),
    [drawPos]: card,
  };
  for (let seat = 0; seat < seats; seat++) {
    for (let i = 0; i < 7; i++) placed[handPos(seats, seat, i)] = numberCard(seat + 1, QUIET[i] ?? 1, 0);
  }
  return reveal(setup(seats, placed));
}
