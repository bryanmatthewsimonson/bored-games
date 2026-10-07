import { describe, expect, it } from 'vitest';
import { actionCard, numberCard } from '../../src/cards.ts';
import { legalActionsOf, pendingOf, viewFor } from '../../src/index.ts';
import { act, handPos, playCard, reveal, setup, starterPos } from '../helpers.ts';

const QUIET = [1, 2, 3, 4, 6, 7, 8] as const;

function halts(): number[] {
  const cards: number[] = [];
  for (let suit = 0; suit < 4; suit++)
    for (let copy = 0; copy < 2; copy++) cards.push(actionCard(suit, 0, copy));
  return cards;
}

/** Two seats. Seat 0 holds seven Halts, so each one skips seat 1 and seat 0 plays again. */
function haltTable(): ReturnType<typeof setup> {
  const seats = 2;
  const placed: Record<number, number> = { [starterPos(seats)]: numberCard(0, 0, 0) };
  halts()
    .slice(0, 7)
    .forEach((card, index) => {
      placed[handPos(seats, 0, index)] = card;
    });
  QUIET.forEach((rank, index) => {
    placed[handPos(seats, 1, index)] = numberCard(1, rank, 0);
  });
  return reveal(setup(seats, placed));
}

function playHalt(s: ReturnType<typeof setup>, card: number, holler = false) {
  return act(s, {
    type: 'play',
    actor: 0,
    pos: s.hands[0]?.find((slot) => slot.card === card)?.pos,
    card,
    ...(holler ? { holler: true as const } : {}),
  });
}

describe('declaration', () => {
  it('C35 a play down to one card with holler records the declaration and opens no window', () => {
    let state = haltTable();
    const cards = (state.hands[0] ?? []).map((slot) => slot.card ?? -1);
    const notch = actionCard(0, 0, 0);
    state = playHalt(state, notch).state;
    for (const card of cards.filter((entry) => entry !== notch).slice(0, 4))
      state = playHalt(state, card).state;
    const leaving = (state.hands[0] ?? []).map((slot) => slot.card ?? -1);
    expect(leaving).toHaveLength(2);
    const played = playHalt(state, leaving[0] ?? -1, true);
    expect(played.events).toContainEqual({ type: 'hollered', seat: 0 });
    expect(played.state.called[0]).toBe(true);
    expect(played.state.hands[0]).toHaveLength(1);
    expect(played.state.phase).toEqual({ type: 'play', seat: 0 });
  });

  it('C36 a play down to one card without the flag opens a catch window', () => {
    let state = haltTable();
    const cards = (state.hands[0] ?? []).map((slot) => slot.card ?? -1);
    state = playHalt(state, actionCard(0, 0, 0)).state;
    for (const card of cards.filter((entry) => entry !== actionCard(0, 0, 0)).slice(0, 4)) {
      state = playHalt(state, card).state;
    }
    const next = state.hands[0]?.[0]?.card ?? -1;
    state = playHalt(state, next).state;
    expect(state.called[0]).toBe(false);
    expect(state.phase).toMatchObject({ type: 'catch', offender: 0, queue: [1], selected: 0 });
  });

  it('C37 the first catch draws 2 and later seats are not asked', () => {
    const seats = 3;
    const placed: Record<number, number> = { [starterPos(seats)]: numberCard(0, 0, 0) };
    halts()
      .slice(0, 7)
      .forEach((card, index) => {
        placed[handPos(seats, 0, index)] = card;
      });
    const kiln: number[] = [];
    for (let rank = 0; rank <= 9; rank++) {
      kiln.push(numberCard(3, rank, 0));
      if (rank !== 0) kiln.push(numberCard(3, rank, 1));
    }
    kiln.push(actionCard(3, 1, 0), actionCard(3, 1, 1), actionCard(3, 2, 0), actionCard(3, 2, 1));
    let cursor = 0;
    for (let seat = 1; seat < seats; seat++) {
      for (let i = 0; i < 7; i++) placed[handPos(seats, seat, i)] = kiln[cursor++] ?? 0;
    }
    for (let i = 0; cursor < kiln.length; i++) placed[starterPos(seats) + 1 + i] = kiln[cursor++] ?? 0;
    let state = reveal(setup(seats, placed));
    const owned = (state.hands[0] ?? []).map((slot) => slot.card ?? -1);
    const playOwned = (card: number, holler = false): void => {
      for (let guard = 0; guard < 40; guard++) {
        const pending = pendingOf(state);
        if (pending.type === 'reveal') {
          state = reveal(state);
          continue;
        }
        if (pending.type !== 'player') throw new Error(`pending ${pending.type}`);
        if (pending.seat === 0 && state.phase.type === 'play') break;
        const choices = legalActionsOf(state, pending.seat) as { type: string }[];
        const step = choices.find(
          (action) =>
            action.type === 'cover' ||
            action.type === 'keep' ||
            action.type === 'draw' ||
            action.type === 'pass',
        );
        if (!step) {
          throw new Error(`seat ${pending.seat} cannot get out of the way (${state.phase.type})`);
        }
        state = act(state, step).state;
      }
      state = playCard(state, 0, card, holler ? { holler: true } : {});
    };
    playOwned(actionCard(0, 0, 0));
    for (const card of owned.filter((entry) => entry !== actionCard(0, 0, 0)).slice(0, 4)) playOwned(card);
    const windowCard = state.hands[0]?.[0]?.card ?? -1;
    playOwned(windowCard);
    expect(state.phase).toMatchObject({ type: 'catch', offender: 0, queue: [1, 2] });
    const before = state.hands[0]?.length ?? 0;
    state = act(state, { type: 'catch', actor: 1 }).state;
    expect(state.hands[0]).toHaveLength(before + 2);
    expect(state.phase).toEqual({ type: 'play', seat: 2 });
    expect(legalActionsOf(state, 2).some((action) => (action as { type: string }).type === 'pass')).toBe(
      false,
    );
  });

  it('C38 a window everyone passes leaves that seat free to go out later', () => {
    let state = haltTable();
    const cards = (state.hands[0] ?? []).map((slot) => slot.card ?? -1);
    state = playHalt(state, actionCard(0, 0, 0)).state;
    for (const card of cards.filter((entry) => entry !== actionCard(0, 0, 0)).slice(0, 4)) {
      state = playHalt(state, card).state;
    }
    const penultimate = state.hands[0]?.[0]?.card ?? -1;
    state = playHalt(state, penultimate).state;
    expect(state.phase.type).toBe('catch');
    state = act(state, { type: 'pass', actor: 1 }).state;
    expect(state.called[0]).toBe(true);
    expect(state.phase).toEqual({ type: 'play', seat: 0 });
    const last = state.hands[0]?.[0];
    if (!last || last.card === null) throw new Error('missing last card');
    state = act(state, { type: 'play', actor: 0, pos: last.pos, card: last.card }).state;
    expect(state.hands[0]).toEqual([]);
    expect(state.phase).toMatchObject({ type: 'reveal', kind: 'score' });
  });

  it('C39 the last card, after a declaration, ends the round once its effect has finished', () => {
    let state = haltTable();
    const cards = (state.hands[0] ?? []).map((slot) => slot.card ?? -1);
    state = playHalt(state, actionCard(0, 0, 0)).state;
    const rest = cards.filter((entry) => entry !== actionCard(0, 0, 0));
    for (const card of rest.slice(0, 4)) state = playHalt(state, card).state;
    state = playHalt(state, rest[4] ?? -1, true).state;
    const last = state.hands[0]?.[0];
    if (!last || last.card === null) throw new Error('missing last card');
    state = act(state, { type: 'play', actor: 0, pos: last.pos, card: last.card }).state;
    expect(state.hands[0]).toEqual([]);
    expect(state.phase).toMatchObject({ type: 'reveal', kind: 'score', goer: 0 });
  });

  it('C40 a last Levy answered unclean does not end the round', () => {
    const seats = 2;
    const placed: Record<number, number> = {
      [starterPos(seats)]: numberCard(0, 0, 0),
      [handPos(seats, 0, 6)]: 104,
    };
    halts()
      .slice(0, 6)
      .forEach((card, index) => {
        placed[handPos(seats, 0, index)] = card;
      });
    let state = reveal(setup(seats, placed));
    const cards = (state.hands[0] ?? []).map((slot) => slot.card ?? -1).filter((card) => card !== 104);
    state = playHalt(state, actionCard(0, 0, 0)).state;
    for (const card of cards.filter((entry) => entry !== actionCard(0, 0, 0)).slice(0, 4)) {
      state = playHalt(state, card).state;
    }
    expect(state.hands[0]).toHaveLength(2);
    const halt = state.hands[0]?.find((slot) => slot.card !== 104);
    if (!halt || halt.card === null) throw new Error('missing halt');
    state = act(state, { type: 'play', actor: 0, pos: halt.pos, card: halt.card, holler: true }).state;
    const levy = state.hands[0]?.[0];
    if (!levy || levy.card === null) throw new Error('missing levy');
    const hidden = viewFor(state, 1);
    let view = act(hidden, { type: 'play', actor: 0, pos: levy.pos, card: levy.card, suit: 1 }).state;
    expect(view.phase).toMatchObject({ type: 'levy', blind: true, player: 0 });
    view = act(view, { type: 'challenge', actor: 1 }).state;
    view = act(view, { type: 'answer', actor: 0, clean: false }).state;
    expect(view.hands[0]).toHaveLength(4);
    expect(view.phase).toEqual({ type: 'play', seat: 1 });
    expect(view.phase.type).not.toBe('over');
    expect(view.round).toBe(state.round);
  });
});
