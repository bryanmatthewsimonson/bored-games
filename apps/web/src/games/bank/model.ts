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
 * The last change to the pot, in words, or null before anything has changed it. A round marker that only opens
 * the next round is skipped, so a bust or a bank that ended the previous round is still the change on screen.
 */
export function potWords(log: readonly BankLog[]): string | null {
  let i = log.length - 1;
  if (i > 0 && log[i]?.kind === 'round') i -= 1;
  for (; i >= 0; i--) {
    const entry = log[i];
    if (entry === undefined || entry.kind === 'round') return null;
    if (entry.kind === 'bank') return 'banked';
    if (entry.kind === 'dice') return diceWords(entry.effect, entry.dice, entry.pot);
  }
  return null;
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
