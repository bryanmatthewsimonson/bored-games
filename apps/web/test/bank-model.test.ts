/*
 * The Bank screen's words and classes, without a browser. Faces and money come from the engine.
 */
import { type BankState, bank } from '@bored-games/bank';
import { BANK_THEME } from '@bored-games/bank/theme';
import { describe, expect, it } from 'vitest';
import {
  actionClass,
  decisionButtons,
  dieClass,
  pendingLabels,
  pips,
  potTone,
  potWords,
  type RollGuide,
  rollCountLabel,
  rollGuide,
  roundLog,
  safeMarks,
  safeRollNote,
  seatStatus,
  statusLine,
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
  it('labels Bank, Stay and Roll, and offers no button for a public roll', () => {
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
    const contributor = rolled.owe[0] ?? 0;
    const collecting = bank.pending(rolled);
    expect(decisionButtons(bank.legalActions(rolled, contributor))).toEqual([]);
    expect(pendingLabels(collecting)).toEqual([]);
    expect(statusLine(rolled, ['Ada', 'Bea'], contributor, collecting, false)).toBe('Rolling the dice.');
    expect(statusLine(rolled, ['Ada', 'Bea'], calling.roller, collecting, false)).toBe('Rolling the dice.');
    expect(seatStatus(rolled, contributor, collecting)).toBe('In');
    const names = ['Ada', 'Bea'];
    const played = resolve(start(2), [1, 2]);
    expect(roundLog(played, names).some((line) => line.includes('showed'))).toBe(false);
    expect(roundLog(played, names).some((line) => line.includes('rolled'))).toBe(true);
  });

  it('says what the pot just did', () => {
    expect(potWords(resolve(start(), [3, 5]).log)).toBe('+8');
    expect(potTone(resolve(start(), [3, 5]).log)).toBe('add');
    expect(potWords(resolve(start(), [1, 6]).log)).toBe('70 for the seven');
    expect(potTone(resolve(start(), [1, 6]).log)).toBe('seventy');
    let s = start();
    s = resolve(s, [1, 2]);
    s = resolve(s, [1, 2]);
    s = resolve(s, [1, 2]);
    expect(potWords(resolve(s, [2, 2]).log)).toBe('doubled to 18');
    expect(potTone(resolve(s, [2, 2]).log)).toBe('double');
    expect(potWords(resolve(s, [1, 6]).log)).toBe('busted');
    expect(potTone(resolve(s, [1, 6]).log)).toBe('bust');
    const banked = act(resolve(start(), [3, 5]), { type: 'bank', actor: 1 });
    expect(potWords(banked.log)).toBe('banked');
    expect(potTone(banked.log)).toBeNull();
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

  it('paints Roll, Bank and Stay so the choice stands out', () => {
    expect(actionClass(BANK_THEME.decisions.roll, true)).toBe('btn btn-primary btn-roll btn-only');
    expect(actionClass(BANK_THEME.decisions.roll, false)).toBe('btn btn-primary btn-roll');
    expect(actionClass(BANK_THEME.decisions.bank, false)).toBe('btn btn-bank');
    expect(actionClass(BANK_THEME.decisions.stay, false)).toBe('btn btn-stay');
  });
});

function waysOf(guide: RollGuide): number {
  return guide.chances.reduce((n, chance) => n + chance.ways, 0);
}

function chanceFor(guide: RollGuide, dice: readonly [number, number]) {
  const sum = dice[0] + dice[1];
  if (!guide.safe && sum === 7) return guide.chances.find((c) => c.label === 'A 7');
  if (!guide.safe && dice[0] === dice[1]) return guide.chances.find((c) => c.label === 'A pair');
  return guide.chances.find((c) => c.label === String(sum));
}

/** The pot recorded for this resolution, including a bust that then opens the next round at 0. */
function resolvedPot(before: BankState, dice: readonly [number, number]): number {
  const after = resolve(before, dice);
  for (let i = after.log.length - 1; i >= 0; i--) {
    const entry = after.log[i];
    if (entry?.kind === 'dice') return entry.pot;
  }
  throw new Error('no dice log');
}

describe('Bank roll guide', () => {
  it('counts the rolls and says the next one is safe while the pot is empty', () => {
    const state = start();
    expect(rollCountLabel(state)).toBe('No rolls yet');
    expect(safeRollNote(state)).toBe('3 safe rolls left');
    expect(safeMarks(state)).toEqual([false, false, false]);
    const guide = rollGuide(state);
    expect(guide).toMatchObject({
      nextRoll: 1,
      rollsSoFar: 0,
      safe: true,
      headline: 'Next roll is safe',
      summary:
        'A 7 adds 70. Every other roll adds its faces, doubles included. Nothing wipes the pot. Two safe rolls follow this one.',
      bankLine: null,
    });
    if (guide === null) throw new Error('expected a roll guide');
    expect(guide.chances).toHaveLength(11);
    expect(waysOf(guide)).toBe(36);
    expect(guide?.chances.find((c) => c.label === '2')).toEqual({
      label: '2',
      effect: 'adds 2 → 2',
      pot: 2,
      ways: 1,
      tone: 'gain',
    });
    expect(guide?.chances.find((c) => c.label === '7')).toEqual({
      label: '7',
      effect: 'adds 70 → 70',
      pot: 70,
      ways: 6,
      tone: 'safe',
    });
    expect(guide?.chances.find((c) => c.label === '12')).toMatchObject({ ways: 1, pot: 12, tone: 'gain' });
    expect(guide?.chances.some((c) => c.tone === 'bust' || c.tone === 'double')).toBe(false);
  });

  it('keeps the same odds while that safe roll is still being published', () => {
    let state = start(2);
    state = act(state, { type: 'roll', actor: state.roller, rollId: state.nextRollId });
    expect(state.phase).toBe('collect');
    const guide = rollGuide(state);
    expect(guide).toMatchObject({
      nextRoll: 1,
      rollsSoFar: 0,
      safe: true,
      headline: 'This roll is safe',
      bankLine: null,
    });
    expect(rollCountLabel(state)).toBe('No rolls yet');
  });

  it('names the pot you would keep, and when the last safe roll is next', () => {
    const once = resolve(start(), [1, 2]);
    expect(rollCountLabel(once)).toBe('1 roll this round');
    expect(safeRollNote(once)).toBe('2 safe rolls left');
    expect(safeMarks(once)).toEqual([true, false, false]);
    expect(rollGuide(once)).toMatchObject({
      nextRoll: 2,
      safe: true,
      headline: 'Next roll is safe',
      bankLine: 'Banking now keeps 3.',
    });
    expect(rollGuide(once)?.summary).toContain('One safe roll follows this one.');
    expect(rollGuide(once)?.chances.find((c) => c.label === '7')).toMatchObject({
      effect: 'adds 70 → 73',
      pot: 73,
    });

    const twice = resolve(once, [1, 2]);
    expect(rollCountLabel(twice)).toBe('2 rolls this round');
    expect(safeRollNote(twice)).toBe('1 safe roll left');
    expect(safeMarks(twice)).toEqual([true, true, false]);
    expect(rollGuide(twice)?.summary).toContain('This is the last safe roll.');
    expect(rollGuide(twice)?.bankLine).toBe('Banking now keeps 6.');
  });

  it('switches to busts and doubles once three rolls are in, and matches the engine', () => {
    let state = start();
    state = resolve(state, [1, 2]);
    state = resolve(state, [1, 2]);
    state = resolve(state, [1, 2]);
    expect(state.rolls).toBe(3);
    expect(state.pot).toBe(9);
    expect(rollCountLabel(state)).toBe('3 rolls this round');
    expect(safeRollNote(state)).toBe('A 7 busts');
    expect(safeMarks(state)).toEqual([true, true, true]);
    const guide = rollGuide(state);
    expect(guide).toMatchObject({
      nextRoll: 4,
      rollsSoFar: 3,
      safe: false,
      headline: 'Next roll can bust',
      summary:
        'A 7 wipes the pot (6 of 36). A pair doubles it to 18 (6 of 36). Any other roll adds its faces (24 of 36).',
      bankLine: 'Banking now keeps 9.',
    });
    if (guide === null) throw new Error('expected a roll guide');
    expect(waysOf(guide)).toBe(36);
    expect(guide.chances.map((c) => c.label)).toEqual([
      'A 7',
      'A pair',
      '3',
      '4',
      '5',
      '6',
      '8',
      '9',
      '10',
      '11',
    ]);
    expect(guide?.chances.find((c) => c.label === 'A 7')).toEqual({
      label: 'A 7',
      effect: 'wipes the pot',
      pot: 0,
      ways: 6,
      tone: 'bust',
    });
    expect(guide?.chances.find((c) => c.label === 'A pair')).toEqual({
      label: 'A pair',
      effect: 'doubles the pot to 18',
      pot: 18,
      ways: 6,
      tone: 'double',
    });
    expect(guide?.chances.find((c) => c.label === '4')).toMatchObject({ ways: 2, pot: 13, tone: 'gain' });
    expect(guide?.chances.find((c) => c.label === '3')).toMatchObject({ ways: 2, pot: 12 });
    expect(guide?.chances.find((c) => c.label === '6')).toMatchObject({ ways: 4 });
    expect(guide?.chances.find((c) => c.label === '10')).toMatchObject({ ways: 2 });

    let rolling = state;
    while (rolling.phase === 'call') {
      const pending = bank.pending(rolling);
      if (pending.type !== 'player' || pending.seat === rolling.roller) break;
      rolling = act(rolling, { type: 'stay', actor: pending.seat });
    }
    rolling = act(rolling, { type: 'roll', actor: rolling.roller, rollId: rolling.nextRollId });
    expect(rollGuide(rolling)).toMatchObject({
      headline: 'This roll can bust',
      nextRoll: 4,
      rollsSoFar: 3,
      bankLine: null,
      safe: false,
    });
  });

  it('matches the pot the engine would build for each kind of face', () => {
    const samples: readonly (readonly [number, number])[] = [
      [1, 1],
      [1, 2],
      [1, 3],
      [3, 4],
      [5, 5],
      [6, 6],
      [1, 6],
      [6, 5],
    ];
    let state = start();
    for (let step = 0; step < 5; step++) {
      const guide = rollGuide(state);
      if (guide === null) throw new Error('expected a roll guide');
      for (const dice of samples) {
        const row = chanceFor(guide, dice);
        expect(row, `roll ${step + 1} dice ${dice.join('+')}`).toBeDefined();
        expect(row?.pot, `roll ${step + 1} dice ${dice.join('+')}`).toBe(resolvedPot(state, dice));
      }
      state = resolve(state, [1, 2]);
    }
  });

  it('says the 30th roll pays everyone still in unless it busts', () => {
    let state = start();
    state = resolve(state, [1, 2]);
    state = resolve(state, [1, 2]);
    state = resolve(state, [1, 2]);
    const late = { ...state, rolls: 29 };
    const guide = rollGuide(late);
    expect(guide).toMatchObject({
      nextRoll: 30,
      rollsSoFar: 29,
      safe: false,
      headline: 'Roll 30 · the last of the round',
      bankLine: 'Banking now keeps 9.',
    });
    expect(guide?.summary).toContain('A pair doubles it to 18 (6 of 36).');
    expect(guide?.summary).toContain(
      'If it does not bust, everyone still in banks the pot and the round ends.',
    );
    expect(rollCountLabel(late)).toBe('29 rolls this round');
  });

  it('drops the guide once the game is over', () => {
    const over = { ...start(), phase: 'over' as const };
    expect(rollGuide(over)).toBeNull();
    expect(rollCountLabel(over)).toBeNull();
    expect(safeRollNote(over)).toBeNull();
    expect(safeMarks(over)).toBeNull();
  });

  it('does not invent a pot once the result would pass a safe integer', () => {
    const huge = { ...start(), pot: Number.MAX_SAFE_INTEGER - 1 };
    const safe = rollGuide(huge);
    expect(safe?.chances.find((c) => c.label === '2')?.pot).toBeNull();
    expect(safe?.chances.find((c) => c.label === '2')?.effect).toContain('too large');
    expect(safe?.chances.find((c) => c.label === '7')?.pot).toBeNull();

    const doubled = { ...start(), pot: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1, rolls: 3 };
    const unsafe = rollGuide(doubled);
    expect(unsafe?.chances.find((c) => c.label === 'A pair')?.pot).toBeNull();
    expect(unsafe?.summary).toContain('too large to count');
  });
});
