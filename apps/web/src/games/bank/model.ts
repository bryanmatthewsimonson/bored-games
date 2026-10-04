/*
 * What the Bank screen shows, as plain data (D058). The component draws it; tests check it without a browser.
 * Names come from the theme. Numbers come from the engine state.
 */
import type { BankLog, BankState, DiceEffect } from '@bored-games/bank';
import { BANK_THEME } from '@bored-games/bank/theme';
import type { Pending } from '@bored-games/game-kit';

/** One pip on a die face, in a 100×100 square. */
export interface Pip {
  readonly x: number;
  readonly y: number;
}

const PIP_AT: Record<number, readonly [number, number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 28],
    [28, 50],
    [28, 72],
    [72, 28],
    [72, 50],
    [72, 72],
  ],
};

/** The pips of a face from 1 to 6. An unknown face has none. */
export function pips(face: number): readonly Pip[] {
  return (PIP_AT[face] ?? []).map(([x, y]) => ({ x, y }));
}

/**
 * A few degrees, different for each die and each roll, so a pair does not look stamped. The number is the CSS
 * rotation in degrees.
 */
export function dieTilt(rollId: number, which: 0 | 1): number {
  const base = (Math.abs(rollId) % 5) - 2;
  return which === 0 ? base : -base - 1;
}

/**
 * The die's class. `tumble` is the short roll. Reduced motion skips it and the face is shown as it is.
 */
export function dieClass(tumbling: boolean, reducedMotion: boolean): string {
  return tumbling && !reducedMotion ? 'bank-die tumble' : 'bank-die';
}

export interface DecisionButton {
  readonly action: unknown;
  readonly label: string;
}

const ACTION_LABEL: Record<string, string> = {
  bank: BANK_THEME.decisions.bank,
  stay: BANK_THEME.decisions.stay,
  roll: BANK_THEME.decisions.roll,
};

/** One button per legal action, in the engine's order, labelled from the theme. */
export function decisionButtons(legal: readonly unknown[]): DecisionButton[] {
  return legal.flatMap((action) => {
    if (action === null || typeof action !== 'object') return [];
    const type = (action as { type?: unknown }).type;
    if (typeof type !== 'string') return [];
    const label = ACTION_LABEL[type];
    return label === undefined ? [] : [{ action, label }];
  });
}

/**
 * Classes for a decision button. Roll is the filled action. Bank is the take-the-money action. Stay stays quiet.
 * A lone Roll spans the row. The label is the accessible name; the class is only paint.
 */
export function actionClass(label: string, alone: boolean): string {
  if (label === BANK_THEME.decisions.roll) {
    return alone ? 'btn btn-primary btn-roll btn-only' : 'btn btn-primary btn-roll';
  }
  if (label === BANK_THEME.decisions.bank) return 'btn btn-bank';
  if (label === BANK_THEME.decisions.stay) return 'btn btn-stay';
  return 'btn';
}

/** The button labels of a pending decision, for a viewer who cannot press them. */
export function pendingLabels(pending: Pending): readonly string[] {
  if (pending.type !== 'player') return [];
  switch (pending.decision) {
    case 'bank-or-stay':
      return [BANK_THEME.decisions.bank, BANK_THEME.decisions.stay];
    case 'bank-or-roll':
      return [BANK_THEME.decisions.bank, BANK_THEME.decisions.roll];
    case 'roll':
      return [BANK_THEME.decisions.roll];
    default:
      return [];
  }
}

function diceWords(effect: DiceEffect, dice: readonly [number, number], pot: number): string {
  const sum = dice[0] + dice[1];
  switch (effect) {
    case 'add':
      return `+${sum}`;
    case 'seventy':
      return '70 for the seven';
    case 'double':
      return `doubled to ${pot}`;
    case 'bust':
      return 'busted';
  }
}

/**
 * The last change to the pot, skipping a round marker that only opens the next round, so a bust or a bank that
 * ended the previous round is still the change on screen.
 */
function latestPotChange(log: readonly BankLog[]): BankLog | null {
  let i = log.length - 1;
  if (i > 0 && log[i]?.kind === 'round') i -= 1;
  for (; i >= 0; i--) {
    const entry = log[i];
    if (entry === undefined || entry.kind === 'round') return null;
    if (entry.kind === 'bank' || entry.kind === 'dice') return entry;
  }
  return null;
}

/** The last change to the pot, in words, or null before anything has changed it. */
export function potWords(log: readonly BankLog[]): string | null {
  const entry = latestPotChange(log);
  if (entry === null || entry.kind === 'round') return null;
  if (entry.kind === 'bank') return 'banked';
  if (entry.kind !== 'dice') return null;
  return diceWords(entry.effect, entry.dice, entry.pot);
}

/** The last dice effect, for a tone beside the words. Banking and an untouched pot have none. */
export function potTone(log: readonly BankLog[]): DiceEffect | null {
  const entry = latestPotChange(log);
  return entry !== null && entry.kind === 'dice' ? entry.effect : null;
}

/** The latest resolved faces. Empty until the first roll; a later round keeps them until the next one. */
export function latestDice(log: readonly BankLog[]): readonly [number, number] | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry?.kind === 'dice') return entry.dice;
  }
  return null;
}

/** The id of the latest resolved roll, so a new one can tumble. Null before any. */
export function latestRollId(log: readonly BankLog[]): number | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry?.kind === 'dice') return entry.rollId;
  }
  return null;
}

export function seatName(names: readonly string[], seat: number): string {
  return names[seat] ?? `Seat ${seat + 1}`;
}

/** "To play", "In", or "Banked 12". The words are the signal; colour is not. */
export function seatStatus(state: BankState, seat: number, pending: Pending): string {
  const banked = state.banked[seat];
  if (typeof banked === 'number') return `Banked ${banked}`;
  // A contribution is not a decision. The open app sends the share, and the seat stays "In".
  if (pending.type === 'player' && pending.seat === seat && pending.decision !== 'contribute')
    return 'To play';
  return 'In';
}

export function roundLabel(state: BankState): string {
  if (state.phase === 'over') return 'Game over';
  return `Round ${state.round + 1} of ${state.rules.rounds}`;
}

/** How many resolutions this round has had. The engine already counts them. Null once the game is over. */
export function rollCountLabel(state: BankState): string | null {
  if (state.phase === 'over') return null;
  if (state.rolls === 0) return 'No rolls yet';
  if (state.rolls === 1) return '1 roll this round';
  return `${state.rolls} rolls this round`;
}

/** Safe rolls still ahead of the next resolution, or the bust warning once those three are used. */
export function safeRollNote(state: BankState): string | null {
  if (state.phase === 'over') return null;
  const left = 3 - state.rolls;
  if (left >= 2) return `${left} safe rolls left`;
  if (left === 1) return '1 safe roll left';
  return 'A 7 busts';
}

/** The three safe rolls of this round. A used one is true. Null once the game is over. */
export function safeMarks(state: BankState): readonly boolean[] | null {
  if (state.phase === 'over') return null;
  return [0, 1, 2].map((i) => state.rolls > i);
}

/** One row of the odds table. `pot` is what the pot would become, or null if that result cannot be counted. */
export interface RollChance {
  readonly label: string;
  readonly effect: string;
  readonly pot: number | null;
  readonly ways: number;
  readonly tone: 'safe' | 'gain' | 'double' | 'bust';
}

/**
 * What the roll about to resolve can do. It follows the engine: the roll is safe while fewer than three have
 * been resolved, a safe 7 adds 70, an unsafe 7 busts, an unsafe pair doubles, and every other sum is added.
 * Ways are out of 36. Null once the game is over.
 */
export interface RollGuide {
  readonly nextRoll: number;
  readonly rollsSoFar: number;
  readonly safe: boolean;
  readonly headline: string;
  readonly summary: string;
  readonly chances: readonly RollChance[];
  readonly bankLine: string | null;
}

/** Ways for each face sum from 0 to 12. A 7 has six ways and is never a pair. */
const SUM_WAYS: readonly number[] = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
/** Ways that are not a pair. Sums 2 and 12 are only pairs, so they are absent once pairs double the pot. */
const ADD_WAYS: readonly number[] = [0, 0, 0, 2, 2, 4, 4, 0, 4, 4, 2, 2, 0];

function plus(pot: number, delta: number): number | null {
  if (!Number.isSafeInteger(pot) || !Number.isSafeInteger(delta)) return null;
  if (pot > Number.MAX_SAFE_INTEGER - delta) return null;
  return pot + delta;
}

function timesTwo(pot: number): number | null {
  if (!Number.isSafeInteger(pot)) return null;
  if (pot > Math.floor(Number.MAX_SAFE_INTEGER / 2)) return null;
  return pot * 2;
}

function added(sum: number, pot: number, ways: number, tone: 'safe' | 'gain'): RollChance {
  const next = plus(pot, sum);
  return {
    label: String(sum === 70 ? 7 : sum),
    effect: next === null ? `adds ${sum}, too large to count` : `adds ${sum} → ${next}`,
    pot: next,
    ways,
    tone,
  };
}

function safeChances(pot: number): readonly RollChance[] {
  const rows: RollChance[] = [];
  for (let sum = 2; sum <= 12; sum++) {
    if (sum === 7) rows.push(added(70, pot, 6, 'safe'));
    else rows.push(added(sum, pot, SUM_WAYS[sum] ?? 0, 'gain'));
  }
  return rows;
}

function unsafeChances(pot: number): readonly RollChance[] {
  const doubled = timesTwo(pot);
  const rows: RollChance[] = [
    { label: 'A 7', effect: 'wipes the pot', pot: 0, ways: 6, tone: 'bust' },
    {
      label: 'A pair',
      effect: doubled === null ? 'doubles the pot, too large to count' : `doubles the pot to ${doubled}`,
      pot: doubled,
      ways: 6,
      tone: 'double',
    },
  ];
  for (let sum = 3; sum <= 11; sum++) {
    const ways = ADD_WAYS[sum] ?? 0;
    if (ways === 0) continue;
    rows.push(added(sum, pot, ways, 'gain'));
  }
  return rows;
}

function safeSummary(rolls: number): string {
  const base = 'A 7 adds 70. Every other roll adds its faces, doubles included. Nothing wipes the pot.';
  if (rolls >= 2) return `${base} This is the last safe roll.`;
  if (rolls === 1) return `${base} One safe roll follows this one.`;
  return `${base} Two safe rolls follow this one.`;
}

function unsafeSummary(pot: number, last: boolean): string {
  const doubled = timesTwo(pot);
  const pair =
    doubled === null
      ? 'A pair would be too large to count (6 of 36).'
      : `A pair doubles it to ${doubled} (6 of 36).`;
  const base = `A 7 wipes the pot (6 of 36). ${pair} Any other roll adds its faces (24 of 36).`;
  if (!last) return base;
  return `${base} If it does not bust, everyone still in banks the pot and the round ends.`;
}

export function rollGuide(state: BankState): RollGuide | null {
  if (state.phase === 'over') return null;
  const safe = state.rolls < 3;
  const nextRoll = state.rolls + 1;
  const last = nextRoll === state.rules.maxRollsPerRound;
  const inFlight = state.phase === 'collect' || state.phase === 'beacon';
  const headline = last
    ? `Roll ${nextRoll} · the last of the round`
    : safe
      ? inFlight
        ? 'This roll is safe'
        : 'Next roll is safe'
      : inFlight
        ? 'This roll can bust'
        : 'Next roll can bust';
  const summary = safe ? safeSummary(state.rolls) : unsafeSummary(state.pot, last);
  return {
    nextRoll,
    rollsSoFar: state.rolls,
    safe,
    headline,
    summary,
    chances: safe ? safeChances(state.pot) : unsafeChances(state.pot),
    bankLine: state.phase === 'call' && state.pot > 0 ? `Banking now keeps ${state.pot}.` : null,
  };
}

function decisionPhrase(decision: string): string {
  switch (decision) {
    case 'bank-or-stay':
      return 'bank or stay';
    case 'bank-or-roll':
      return 'bank or roll';
    case 'roll':
      return 'roll';
    default:
      return 'decide';
  }
}

/** One line on whose decision it is. */
export function statusLine(
  state: BankState,
  names: readonly string[],
  mySeat: number | null,
  pending: Pending,
  ended: boolean,
): string {
  if (ended || state.phase === 'over' || pending.type === 'over') return 'The game is over.';
  // One public roll. Nobody is choosing, and there is nothing to show ahead of the others.
  if (pending.type === 'beacon' || (pending.type === 'player' && pending.decision === 'contribute')) {
    return 'Rolling the dice.';
  }
  if (pending.type !== 'player') return 'Showing the dice.';
  const who = seatName(names, pending.seat);
  const what = decisionPhrase(pending.decision);
  if (pending.seat === mySeat) return `Your turn: ${what}.`;
  return `Waiting for ${who} to ${what}.`;
}

function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** The line every screen shows once the game has a result. */
export function winnerLine(
  outcome: { readonly places: readonly number[]; readonly reason: string } | null,
  names: readonly string[],
): string | null {
  if (outcome === null || outcome.places.length === 0) return null;
  const firsts = outcome.places.flatMap((place, seat) => (place === 1 ? [seatName(names, seat)] : []));
  if (outcome.reason === 'score' && firsts.length === 1) return `${firsts[0]} wins.`;
  if (outcome.reason === 'score' && firsts.length > 1) return `${joinList(firsts)} tie for first.`;
  const ranked = outcome.places
    .map((place, seat) => ({ place, seat }))
    .sort((a, b) => a.place - b.place || a.seat - b.seat);
  return `Final places: ${ranked.map((r) => `${r.place}. ${seatName(names, r.seat)}`).join(', ')}.`;
}

const LOG_LIMIT = 8;

function logLine(entry: BankLog, names: readonly string[]): string | null {
  switch (entry.kind) {
    case 'round':
      return null;
    case 'bank':
      return `${seatName(names, entry.seat)} banked ${entry.amount}`;
    case 'stay':
      return `${seatName(names, entry.seat)} stayed`;
    case 'roll':
      return `${seatName(names, entry.seat)} rolled`;
    case 'contribute':
      return null;
    case 'dice':
      return `${entry.dice[0]} and ${entry.dice[1]}, ${diceWords(entry.effect, entry.dice, entry.pot)}`;
  }
}

/** The last few notes of the round now being played. */
export function roundLog(state: BankState, names: readonly string[]): string[] {
  let start = 0;
  for (let i = 0; i < state.log.length; i++) if (state.log[i]?.kind === 'round') start = i + 1;
  const lines: string[] = [];
  for (const entry of state.log.slice(start)) {
    const line = entry === undefined ? null : logLine(entry, names);
    if (line !== null) lines.push(line);
  }
  return lines.slice(-LOG_LIMIT);
}
