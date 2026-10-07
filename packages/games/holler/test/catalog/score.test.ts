import { describe, expect, it } from 'vitest';
import { actionCard, numberCard, pointsOf } from '../../src/cards.ts';
import { installDeckOrder, outcomeOf, pendingOf, placesOf, standingsOf } from '../../src/index.ts';
import { act, handPos, opening, reveal, revealAll, setup, starterPos } from '../helpers.ts';

function halts(): number[] {
  const cards: number[] = [];
  for (let suit = 0; suit < 4; suit++)
    for (let copy = 0; copy < 2; copy++) cards.push(actionCard(suit, 0, copy));
  return cards.slice(0, 7);
}

const LOSER = [100, 101, 102, 104, 105, 106, 107];

function scoredTable() {
  const seats = 2;
  const placed: Record<number, number> = { [starterPos(seats)]: numberCard(0, 0, 0) };
  halts().forEach((card, index) => {
    placed[handPos(seats, 0, index)] = card;
  });
  LOSER.forEach((card, index) => {
    placed[handPos(seats, 1, index)] = card;
  });
  return setup(seats, placed);
}

function goOut(start: ReturnType<typeof setup>) {
  let state = reveal(start);
  const cards = (state.hands[0] ?? []).map((slot) => slot.card ?? -1);
  const play = (card: number, holler = false): void => {
    const slot = state.hands[0]?.find((entry) => entry.card === card);
    if (!slot || slot.card === null) throw new Error(`missing ${card}`);
    state = act(state, {
      type: 'play',
      actor: 0,
      pos: slot.pos,
      card: slot.card,
      ...(holler ? { holler: true as const } : {}),
    }).state;
  };
  play(actionCard(0, 0, 0));
  const rest = cards.filter((card) => card !== actionCard(0, 0, 0));
  for (const card of rest.slice(0, 4)) play(card);
  play(rest[4] ?? -1, true);
  play(rest[5] ?? -1);
  state = revealAll(state);
  return state;
}

describe('score', () => {
  it('C45 the seat who went out scores the other hands and nobody else scores', () => {
    const state = goOut(scoredTable());
    const expected = LOSER.reduce((sum, card) => sum + pointsOf(card), 0);
    expect(expected).toBe(350);
    expect(state.scores).toEqual([350, 0]);
    expect(state.phase.type).toBe('epoch');
  });

  it('C46 the match continues under 500 and ends on the round that reaches it', () => {
    const start = scoredTable();
    const order = opening(start);
    let state = goOut(start);
    expect(state.scores[0]).toBeLessThan(500);
    expect(state.phase.type).toBe('epoch');
    if (state.phase.type !== 'epoch') throw new Error('expected a new round');
    const installed = installDeckOrder(state, state.phase.epoch, order);
    if (!installed.ok) throw new Error(installed.error.message);
    state = act(installed.state, {
      type: 'epoch',
      actor: 'deck',
      epoch: state.phase.epoch,
      size: 108,
    }).state;
    state = act(state, { type: 'granted', actor: 'deck' }).state;
    state = goOut(state);
    expect(state.scores[0]).toBe(700);
    expect(state.phase.type).toBe('over');
    expect(outcomeOf(state)?.reason).toBe('score');
  });

  it('C47 tied scores share a place and the next score skips', () => {
    expect(placesOf([10, 10, 0])).toEqual([1, 1, 3]);
    expect(placesOf([10, 5, 5])).toEqual([1, 2, 2]);
    const start = scoredTable();
    const order = opening(start);
    let state = goOut(start);
    if (state.phase.type !== 'epoch') throw new Error('expected a new round');
    const installed = installDeckOrder(state, state.phase.epoch, order);
    if (!installed.ok) throw new Error(installed.error.message);
    state = act(installed.state, { type: 'epoch', actor: 'deck', epoch: state.phase.epoch, size: 108 }).state;
    state = act(state, { type: 'granted', actor: 'deck' }).state;
    state = goOut(state);
    expect(outcomeOf(state)?.places).toEqual(placesOf(state.scores));
    expect(outcomeOf(state)?.places).toEqual([1, 2]);
  });

  it('C48 standings is the match score during play and equals the outcome at the end', () => {
    const start = scoredTable();
    const playing = reveal(start);
    expect(standingsOf(playing)).toEqual([0, 0]);
    expect(outcomeOf(playing)).toBeNull();
    const order = opening(start);
    let state = goOut(start);
    expect(standingsOf(state)).toEqual([350, 0]);
    if (state.phase.type !== 'epoch') throw new Error('expected a new round');
    const installed = installDeckOrder(state, state.phase.epoch, order);
    if (!installed.ok) throw new Error(installed.error.message);
    state = act(installed.state, { type: 'epoch', actor: 'deck', epoch: state.phase.epoch, size: 108 }).state;
    state = act(state, { type: 'granted', actor: 'deck' }).state;
    state = goOut(state);
    expect(standingsOf(state)).toEqual(outcomeOf(state)?.scores);
    expect(pendingOf(state).type).toBe('over');
  });
});
