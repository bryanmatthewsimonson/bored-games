import { describe, expect, it } from 'vitest';
import { actionCard, cardAt, numberCard } from '../../src/cards.ts';
import {
  applyAction,
  checkInvariants,
  installDeckOrder,
  knownTo,
  learnCard,
  viewFor,
} from '../../src/index.ts';
import { act, handPos, opening, reveal, revealAll, setup, starterPos } from '../helpers.ts';

describe('views', () => {
  it('C54 views hide other hands and the draw pile', () => {
    const seats = 2;
    const card = numberCard(0, 2, 0);
    const full = reveal(
      setup(seats, { [starterPos(seats)]: numberCard(0, 0, 0), [handPos(seats, 0, 0)]: card }),
    );
    const mine = viewFor(full, 0);
    expect(mine.hands[0]?.every((slot) => slot.card !== null)).toBe(true);
    expect(mine.hands[1]?.every((slot) => slot.card === null)).toBe(true);
    expect(mine.orders.every((row) => row === null)).toBe(true);
    expect(cardAt(mine.orders, mine.draw[0] ?? 0)).toBeNull();
    const played = act(full, { type: 'play', actor: 0, pos: handPos(seats, 0, 0), card }).state;
    const seen = viewFor(played, 1);
    expect(seen.discard.at(-1)).toEqual({ pos: handPos(seats, 0, 0), card });
    expect(seen.hands[0]?.every((slot) => slot.card === null)).toBe(true);
  });

  it('C55 learn commutes with a later play and emits no events', () => {
    const seats = 2;
    const first = numberCard(0, 1, 0);
    const second = numberCard(0, 2, 0);
    const full = reveal(
      setup(seats, {
        [starterPos(seats)]: numberCard(0, 0, 0),
        [handPos(seats, 0, 0)]: first,
        [handPos(seats, 0, 1)]: second,
      }),
    );
    const view = viewFor(full, 0);
    const kept = full.hands[0]?.find((slot) => slot.card === first);
    const played = full.hands[0]?.find((slot) => slot.card === second);
    if (!kept || kept.card === null || !played || played.card === null) throw new Error('missing cards');
    const item = { deck: 'pile' as const, pos: kept.pos, card: kept.card };
    const learned = learnCard(view, item);
    expect(learned.ok).toBe(true);
    if (!learned.ok) return;
    expect(learned.events).toEqual([]);
    const play = { type: 'play' as const, actor: 0, pos: played.pos, card: played.card };
    const learnThenPlay = applyAction(learned.state, play);
    const playFirst = applyAction(view, play);
    expect(learnThenPlay.ok && playFirst.ok).toBe(true);
    if (!learnThenPlay.ok || !playFirst.ok) return;
    const playThenLearn = learnCard(playFirst.state, item);
    expect(playThenLearn.ok).toBe(true);
    if (!playThenLearn.ok) return;
    expect(playThenLearn.events).toEqual([]);
    expect(playThenLearn.state).toEqual(learnThenPlay.state);
    expect(knownTo(full, 0).some((entry) => entry.pos === kept.pos)).toBe(true);
  });

  it('C56 live zones are one deck and a repeated index is re-encryption', () => {
    const seats = 2;
    const placed: Record<number, number> = { [starterPos(seats)]: numberCard(0, 0, 0) };
    const cards: number[] = [];
    for (let suit = 0; suit < 4 && cards.length < 7; suit++) {
      for (let copy = 0; copy < 2 && cards.length < 7; copy++) cards.push(actionCard(suit, 0, copy));
    }
    cards.forEach((card, index) => {
      placed[handPos(seats, 0, index)] = card;
    });
    [100, 101, 102, 104, 105, 106, 107].forEach((card, index) => {
      placed[handPos(seats, 1, index)] = card;
    });
    const start = setup(seats, placed);
    let state = reveal(start);
    expect(checkInvariants(state)).toEqual([]);
    const zones = state.hands.flatMap((hand) => hand.map((slot) => slot.pos)).length + state.draw.length;
    expect(zones + state.discard.length + state.buried.length).toBe(108);
    const order = opening(start);
    const owned = (state.hands[0] ?? []).map((slot) => slot.card ?? -1);
    const play = (card: number, holler = false): void => {
      const slot = state.hands[0]?.find((entry) => entry.card === card);
      if (!slot || slot.card === null) throw new Error(`missing ${card}`);
      state = act(state, {
        type: 'play',
        actor: 0,
        pos: slot.pos,
        card,
        ...(holler ? { holler: true as const } : {}),
      }).state;
    };
    play(actionCard(0, 0, 0));
    const rest = owned.filter((card) => card !== actionCard(0, 0, 0));
    for (const card of rest.slice(0, 4)) play(card);
    play(rest[4] ?? -1, true);
    play(rest[5] ?? -1);
    state = revealAll(state);
    expect(state.phase.type).toBe('epoch');
    if (state.phase.type !== 'epoch') return;
    const installed = installDeckOrder(state, state.phase.epoch, order);
    if (!installed.ok) throw new Error(installed.error.message);
    state = act(installed.state, { type: 'epoch', actor: 'deck', epoch: state.phase.epoch, size: 108 }).state;
    const first = state.orders[0];
    const second = state.orders[1];
    expect(first && second && first.includes(0) && second.includes(0)).toBe(true);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('C59 going out on a Pull still makes the next seat draw before the score', () => {
    const seats = 2;
    const pull = actionCard(1, 2, 0);
    const tideHalt = actionCard(1, 0, 0);
    const hand = [
      actionCard(0, 0, 0),
      actionCard(0, 0, 1),
      actionCard(2, 0, 0),
      actionCard(2, 0, 1),
      actionCard(3, 0, 0),
      tideHalt,
      pull,
    ];
    const placed: Record<number, number> = { [starterPos(seats)]: numberCard(0, 0, 0) };
    hand.forEach((card, index) => {
      placed[handPos(seats, 0, index)] = card;
    });
    let state = reveal(setup(seats, placed));
    const play = (card: number, holler = false): void => {
      const slot = state.hands[0]?.find((entry) => entry.card === card);
      if (!slot) throw new Error(`missing ${card}`);
      state = act(state, {
        type: 'play',
        actor: 0,
        pos: slot.pos,
        card,
        ...(holler ? { holler: true as const } : {}),
      }).state;
    };
    for (const card of hand.slice(0, 4)) play(card);
    play(hand[4] ?? -1);
    play(tideHalt, true);
    const before = state.hands[1]?.length ?? 0;
    play(pull);
    expect(state.hands[0]).toEqual([]);
    expect(state.hands[1]).toHaveLength(before + 2);
    expect(state.phase).toMatchObject({ type: 'reveal', kind: 'score' });
    if (state.phase.type === 'reveal') expect(state.phase.positions).toHaveLength(before + 2);
  });
});
