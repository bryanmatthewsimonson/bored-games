import { describe, expect, it } from 'vitest';
import { actionCard, cardAt, numberCard } from '../../src/cards.ts';
import { checkInvariants, installDeckOrder, shufflePlaintexts, viewFor } from '../../src/index.ts';
import type { HollerState } from '../../src/types.ts';
import { act, handPos, reveal, setup, starterPos } from '../helpers.ts';

/** Tide ranks that do not match a Notch 5. */
function quietHand(): number[] {
  return [1, 2, 3, 4, 6, 7, 8].map((rank) => numberCard(1, rank, 0));
}

/** Puts every undrawn position under the top, so the next draw shuffles those cards. */
function withEmptyPile(state: HollerState): HollerState {
  const top = state.discard.at(-1);
  if (!top) throw new Error('missing top');
  const under = state.draw.map((pos) => {
    const card = cardAt(state.orders, pos);
    if (card === null) throw new Error(`no card at ${pos}`);
    return { pos, card };
  });
  return { ...state, draw: [], discard: [...under, top] };
}

function opened(hand: readonly number[]): HollerState {
  const seats = 2;
  const placed: Record<number, number> = { [starterPos(seats)]: numberCard(0, 5, 0) };
  hand.forEach((card, index) => {
    placed[handPos(seats, 0, index)] = card;
  });
  const state = withEmptyPile(reveal(setup(seats, placed)));
  expect(checkInvariants(state)).toEqual([]);
  return state;
}

describe('shuffle', () => {
  it('C41 an empty draw pile shuffles every discard except the top', () => {
    const drawn = act(opened(quietHand()), { type: 'draw', actor: 0 });
    expect(drawn.state.phase.type).toBe('epoch');
    if (drawn.state.phase.type !== 'epoch') return;
    expect(drawn.state.phase.purpose).toBe('mid');
    const under = drawn.state.discard.slice(0, -1).map((card) => card.pos);
    expect(drawn.state.phase.from.map((entry) => entry.pos)).toEqual(under);
    expect(shufflePlaintexts(drawn.state)).toHaveLength(under.length);
    expect(drawn.events.some((event) => event.type === 'drawn')).toBe(false);
  });

  it('C42 the top discard stays across that shuffle', () => {
    let state = opened(quietHand());
    state = act(state, { type: 'draw', actor: 0 }).state;
    expect(state.phase.type).toBe('epoch');
    if (state.phase.type !== 'epoch') return;
    const top = state.discard.at(-1);
    if (!top) throw new Error('missing top');
    const plain = shufflePlaintexts(state);
    const installed = installDeckOrder(state, state.phase.epoch, plain);
    if (!installed.ok) throw new Error(installed.error.message);
    state = act(installed.state, {
      type: 'epoch',
      actor: 'deck',
      epoch: state.phase.epoch,
      size: plain.length,
    }).state;
    expect(state.discard).toEqual([top]);
  });

  it('C43 when nothing remains under the top, a required draw takes nothing further', () => {
    // A full deal always has enough cards under the top to finish a draw of at most six.
    // The same branch is an empty pile whose discard is only the top.
    const seats = 2;
    const full = reveal(setup(seats, { [starterPos(seats)]: numberCard(0, 5, 0) }));
    const seen = viewFor(full, 0);
    const state: HollerState = {
      ...seen,
      draw: [],
      hands: seen.hands.map((hand, seat) =>
        seat === 0
          ? hand.map((slot, index) => ({
              ...slot,
              card: numberCard(1, [1, 2, 3, 4, 6, 7, 8][index] ?? 1, 0),
              fresh: false,
              open: false,
            }))
          : hand,
      ),
    };
    const drawn = act(state, { type: 'draw', actor: 0 });
    expect(drawn.events).toContainEqual({ type: 'drawn', seat: 0, count: 0, short: true });
    expect(drawn.state.discard).toHaveLength(1);
    expect(drawn.state.phase).toEqual({ type: 'play', seat: 1 });
    expect(drawn.state.resume).toBeNull();
  });

  it('C44 a set-aside starter Levy stays out of the draw', () => {
    const seats = 2;
    const start = starterPos(seats);
    const placed: Record<number, number> = {
      [start]: 104,
      [start + 1]: 105,
      [start + 2]: 106,
      [start + 3]: 107,
      [start + 4]: numberCard(0, 2, 0),
    };
    let state = setup(seats, placed);
    for (let i = 0; i < 4; i++) {
      expect(state.phase.type).toBe('reveal');
      state = reveal(state);
      expect(state.phase.type).not.toBe('epoch');
    }
    expect(state.buried).toEqual([start, start + 1, start + 2, start + 3]);
    expect(state.phase).toEqual({ type: 'reveal', kind: 'starter', positions: [start + 4] });
    state = reveal(state);
    expect(state.discard).toEqual([{ pos: start + 4, card: numberCard(0, 2, 0) }]);
    expect(state.buried).toHaveLength(4);
    expect(state.phase.type).toBe('play');
  });

  it('C58 a forced draw that empties the pile resumes after the epoch', () => {
    const pull = actionCard(0, 2, 0);
    const state = opened([pull, ...quietHand().slice(0, 6)]);
    const played = act(state, { type: 'play', actor: 0, pos: handPos(2, 0, 0), card: pull });
    expect(played.state.phase.type).toBe('epoch');
    if (played.state.phase.type !== 'epoch' || played.state.phase.plan === null) return;
    expect(played.state.resume).toEqual({ seat: played.state.phase.plan.seat, left: 2, after: 'skip' });
    expect(played.state.phase.purpose).toBe('mid');
    expect(played.state.phase.from.map((entry) => entry.pos)).toEqual(
      played.state.discard.slice(0, -1).map((card) => card.pos),
    );
  });
});
