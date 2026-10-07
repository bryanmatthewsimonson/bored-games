import { describe, expect, it } from 'vitest';
import { actionCard, numberCard } from '../../src/cards.ts';
import { applyAction, legalActionsOf, viewFor } from '../../src/index.ts';
import { act, handPos, playCard, rejects, reveal, setup, starterPos } from '../helpers.ts';

function levyReady(seats = 3) {
  const placed: Record<number, number> = { [starterPos(seats)]: numberCard(0, 4, 0) };
  placed[handPos(seats, 0, 0)] = 104;
  for (let i = 1; i < 7; i++) placed[handPos(seats, 0, i)] = numberCard(1, i, 0);
  return reveal(setup(seats, placed));
}

describe('levy', () => {
  it('C17 the next seat may accept a Levy, draws 4, and misses', () => {
    let state = playCard(levyReady(), 0, 104, { suit: 1 });
    expect(state.phase).toMatchObject({ type: 'levy', seat: 1, player: 0 });
    expect(legalActionsOf(state, 1).map((action) => (action as { type: string }).type)).toEqual([
      'accept',
      'challenge',
    ]);
    state = act(state, { type: 'accept', actor: 1 }).state;
    expect(state.hands[1]).toHaveLength(11);
    expect(state.phase).toEqual({ type: 'play', seat: 2 });
  });

  it('C18 the next seat may challenge before accepting', () => {
    let state = playCard(levyReady(), 0, 104, { suit: 1 });
    state = act(state, { type: 'challenge', actor: 1 }).state;
    expect(state.phase).toMatchObject({ type: 'answer', seat: 0, challenger: 1, blind: false });
    rejects(state, { type: 'accept', actor: 1 }, 'illegal');
  });

  it('C19 a clean answer makes the challenger draw 6 and miss', () => {
    let state = playCard(levyReady(), 0, 104, { suit: 2 });
    state = act(state, { type: 'challenge', actor: 1 }).state;
    const answered = act(state, { type: 'answer', actor: 0, clean: true });
    expect(answered.events).toContainEqual({ type: 'answered', seat: 0, clean: true });
    expect(answered.state.hands[1]).toHaveLength(13);
    expect(answered.state.phase).toEqual({ type: 'play', seat: 2 });
  });

  it('C20 an unclean answer makes the Levy player draw 4', () => {
    const full = levyReady(2);
    const played = playCard(full, 0, 104, { suit: 1 });
    const hidden = viewFor(played, 1);
    expect(hidden.phase).toMatchObject({ type: 'levy', blind: true });
    let state = act(hidden, { type: 'challenge', actor: 1 }).state;
    state = act(state, { type: 'answer', actor: 0, clean: false }).state;
    expect(state.hands[0]).toHaveLength(10);
    expect(state.phase).toEqual({ type: 'play', seat: 1 });
  });

  it('C21 a false clean bit is rejected when every card of that hand is known', () => {
    let state = playCard(levyReady(), 0, 104, { suit: 1 });
    state = act(state, { type: 'challenge', actor: 1 }).state;
    rejects(state, { type: 'answer', actor: 0, clean: false }, 'claim');

    const seats = 2;
    const placed: Record<number, number> = { [starterPos(seats)]: numberCard(0, 0, 0) };
    for (let i = 0; i < 6; i++) {
      const suit = Math.floor(i / 2);
      const copy = i % 2;
      placed[handPos(seats, 0, i)] = actionCard(suit, 0, copy);
    }
    placed[handPos(seats, 0, 6)] = 105;
    let last = reveal(setup(seats, placed));
    for (let i = 0; i < 5; i++) {
      const slot = last.hands[0]?.[0];
      if (!slot || slot.card === null) throw new Error('missing card');
      last = act(last, { type: 'play', actor: 0, pos: slot.pos, card: slot.card }).state;
    }
    const penultimate = last.hands[0]?.find((slot) => slot.card !== 105);
    if (!penultimate || penultimate.card === null) throw new Error('missing penultimate');
    last = act(last, {
      type: 'play',
      actor: 0,
      pos: penultimate.pos,
      card: penultimate.card,
      holler: true,
    }).state;
    const levy = last.hands[0]?.[0];
    if (!levy || levy.card === null) throw new Error('missing levy');
    last = act(last, { type: 'play', actor: 0, pos: levy.pos, card: levy.card, suit: 1 }).state;
    last = act(last, { type: 'challenge', actor: 1 }).state;
    rejects(last, { type: 'answer', actor: 0, clean: false }, 'claim');
    expect(legalActionsOf(last, 0)).toEqual([{ type: 'answer', actor: 0, clean: true }]);
  });

  it('C22 a challenge from any seat but the next is rejected', () => {
    const state = playCard(levyReady(), 0, 104, { suit: 1 });
    rejects(state, { type: 'challenge', actor: 2 }, 'turn');
    rejects(state, { type: 'challenge', actor: 0 }, 'turn');
  });

  it('C23 a challenge after accept is rejected', () => {
    let state = playCard(levyReady(), 0, 104, { suit: 1 });
    state = act(state, { type: 'accept', actor: 1 }).state;
    rejects(state, { type: 'challenge', actor: 1 }, 'illegal');
    expect(applyAction(state, { type: 'accept', actor: 1 }).ok).toBe(false);
  });
});
