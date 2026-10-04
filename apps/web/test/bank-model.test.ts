/*
 * The Bank screen's words and classes, without a browser. Faces and money come from the engine.
 */
import { type BankState, bank } from '@bored-games/bank';
import { BANK_THEME } from '@bored-games/bank/theme';
import { describe, expect, it } from 'vitest';
import {
  decisionButtons,
  dieClass,
  pendingLabels,
  pips,
  potWords,
  SHOW_DICE,
  seatStatus,
  winnerLine,
} from '../src/games/bank/model.ts';

function start(seats = 3): BankState {
  const result = bank.setup({ rules: bank.defaultRules(), seats, mode: 'full', deckOrders: {} });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function act(state: BankState, action: unknown): BankState {
  const result = bank.apply(state, action);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

/** Stay until the roller, commit the roll, contribute, and resolve `dice`. */
function resolve(state: BankState, dice: readonly [number, number]): BankState {
  let s = state;
  while (s.phase === 'call') {
    const pending = bank.pending(s);
    if (pending.type !== 'player' || pending.seat === s.roller) break;
    s = act(s, { type: 'stay', actor: pending.seat });
  }
  const id = s.nextRollId;
  s = act(s, { type: 'roll', actor: s.roller, rollId: id });
  while (s.phase === 'collect') {
    const seat = s.owe[0];
    if (seat === undefined) break;
    s = act(s, { type: 'contribute', actor: seat, rollId: id });
  }
  return act(s, { type: 'rolled', actor: 'beacon', id, dice: [dice[0], dice[1]] });
}

describe('Bank screen model', () => {
  it('labels Bank, Stay, Roll and Show the dice from the legal actions', () => {
    const state = start();
    const pending = bank.pending(state);
    expect(pendingLabels(pending)).toEqual([BANK_THEME.decisions.roll]);
    expect(decisionButtons(bank.legalActions(state, 0)).map((b) => b.label)).toEqual(['Roll']);
    const atRoller = resolve(start(2), [1, 2]);
    // After one safe roll the poll starts. Seat 1 may bank or stay; the roller is not asked yet.
    expect(decisionButtons(bank.legalActions(atRoller, atRoller.roller)).map((b) => b.label)).toEqual([]);
    expect(decisionButtons(bank.legalActions(atRoller, 1)).map((b) => b.label)).toEqual(['Bank', 'Stay']);
    const calling = act(atRoller, { type: 'stay', actor: 1 });
    expect(decisionButtons(bank.legalActions(calling, calling.roller)).map((b) => b.label)).toEqual([
      'Bank',
      'Roll',
    ]);
    const rolled = act(calling, { type: 'roll', actor: calling.roller, rollId: calling.nextRollId });
    expect(decisionButtons(bank.legalActions(rolled, rolled.owe[0] ?? 0)).map((b) => b.label)).toEqual([
      'Show the dice',
    ]);
    expect(SHOW_DICE).toContain('fixed when the roller chose to roll');
  });

  it('says what the pot just did', () => {
    expect(potWords(resolve(start(), [3, 5]).log)).toBe('+8');
    expect(potWords(resolve(start(), [1, 6]).log)).toBe('70 for the seven');
    let s = start();
    s = resolve(s, [1, 2]);
    s = resolve(s, [1, 2]);
    s = resolve(s, [1, 2]);
    expect(potWords(resolve(s, [2, 2]).log)).toBe('doubled to 18');
    expect(potWords(resolve(s, [1, 6]).log)).toBe('busted');
    const banked = act(resolve(start(), [3, 5]), { type: 'bank', actor: 1 });
    expect(potWords(banked.log)).toBe('banked');
  });

  it('names who is to play, in, or banked', () => {
    const state = start();
    const pending = bank.pending(state);
    expect(seatStatus(state, 0, pending)).toBe('To play');
    expect(seatStatus(state, 1, pending)).toBe('In');
    const banked = act(resolve(state, [3, 5]), { type: 'bank', actor: 1 });
    expect(seatStatus(banked, 1, bank.pending(banked))).toBe('Banked 8');
  });

  it('skips the tumble when motion is reduced', () => {
    expect(dieClass(true, false)).toBe('bank-die tumble');
    expect(dieClass(true, true)).toBe('bank-die');
    expect(dieClass(false, false)).toBe('bank-die');
  });

  it('draws five pips for a five, including the centre', () => {
    const five = pips(5);
    expect(five).toHaveLength(5);
    expect(five).toContainEqual({ x: 50, y: 50 });
    expect(pips(1)).toEqual([{ x: 50, y: 50 }]);
    expect(pips(0)).toEqual([]);
  });

  it('shares first place and gives the next score third', () => {
    const names = ['Ada', 'Bea', 'Cal'];
    expect(winnerLine({ places: [1, 1, 3], reason: 'score' }, names)).toBe('Ada and Bea tie for first.');
    expect(winnerLine({ places: [2, 1, 3], reason: 'score' }, names)).toBe('Bea wins.');
  });
});
