/*
 * What the Holler screen shows, as plain data. The component draws it.
 * Every function that names a suit takes the theme first (D046).
 */
import { faceOf, type HollerState, type Phase } from '@bored-games/holler';
import type { HOLLER_THEME } from '@bored-games/holler/theme';

export type HollerTheme = typeof HOLLER_THEME;

const PATTERN_WORD = {
  chevron: 'chevrons',
  wave: 'waves',
  seed: 'seeds',
  diamond: 'diamonds',
} as const;

export type PatternId = keyof typeof PATTERN_WORD;
export type SuitIndex = 0 | 1 | 2 | 3;

export interface SuitLook {
  readonly index: SuitIndex;
  readonly id: string;
  readonly name: string;
  readonly hue: string;
  readonly pattern: PatternId;
  readonly word: string;
}

function isSuitIndex(n: unknown): n is SuitIndex {
  return n === 0 || n === 1 || n === 2 || n === 3;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/** Suit `index` as `theme` draws and names it. Null when the theme has no such suit. */
export function suitLook(theme: HollerTheme, index: number): SuitLook | null {
  if (!isSuitIndex(index)) return null;
  const suit = theme.suits[index];
  if (suit === undefined) return null;
  const word = PATTERN_WORD[suit.pattern];
  if (word === undefined) return null;
  return { index, id: suit.id, name: suit.name, hue: suit.hue, pattern: suit.pattern, word };
}

/** "Tide, waves". The pattern word is the non-color name of the mark. */
export function suitLabel(look: SuitLook): string {
  return `${look.name}, ${look.word}`;
}

/**
 * Accessible name of a card. A number includes the pattern ("Tide, waves, 7"). An action is the suit and the
 * action ("Tide Halt"). Mark and Levy name no suit.
 */
export function cardLabel(theme: HollerTheme, card: number): string {
  const face = faceOf(card);
  if (face.kind === 'mark') return theme.actions.mark;
  if (face.kind === 'levy') return theme.actions.levy;
  const look = face.suit === null ? null : suitLook(theme, face.suit);
  if (look === null) return 'Card';
  if (face.kind === 'number') return `${suitLabel(look)}, ${face.rank}`;
  return `${look.name} ${theme.actions[face.kind]}`;
}

export interface PlayChoice {
  readonly action: unknown;
  readonly pos: number;
  readonly card: number;
  readonly suit: SuitIndex | null;
  readonly holler: boolean;
  readonly label: string;
}

export interface ButtonChoice {
  readonly action: unknown;
  readonly label: string;
  readonly suit: SuitIndex | null;
}

function playLabel(theme: HollerTheme, action: Record<string, unknown>, card: number): string | null {
  const holler = action.holler === true;
  const face = faceOf(card);
  const wild = face.kind === 'mark' || face.kind === 'levy';
  const look = isSuitIndex(action.suit) ? suitLook(theme, action.suit) : null;
  if (wild) {
    if (look === null) return null;
    return holler ? `${theme.declaration}, ${suitLabel(look)}` : suitLabel(look);
  }
  const name = cardLabel(theme, card);
  return holler ? `${theme.declaration}, ${name}` : name;
}

/** Legal plays, in engine order. A Mark or a Levy is one choice per named suit. */
export function playChoices(theme: HollerTheme, legal: readonly unknown[]): PlayChoice[] {
  const out: PlayChoice[] = [];
  for (const action of legal) {
    if (!isRecord(action) || action.type !== 'play') continue;
    if (typeof action.pos !== 'number' || typeof action.card !== 'number') continue;
    const label = playLabel(theme, action, action.card);
    if (label === null) continue;
    out.push({
      action,
      pos: action.pos,
      card: action.card,
      suit: isSuitIndex(action.suit) ? action.suit : null,
      holler: action.holler === true,
      label,
    });
  }
  return out;
}

function simpleLabel(theme: HollerTheme, action: Record<string, unknown>): string | null {
  switch (action.type) {
    case 'draw':
      return 'Draw';
    case 'keep':
      return 'Keep';
    case 'cover':
      return 'Seen';
    case 'accept':
      return 'Accept';
    case 'challenge':
      return 'Challenge';
    case 'catch':
      return 'Catch';
    case 'pass':
      return 'Pass';
    case 'answer':
      return action.clean === true ? 'The Levy was clean' : 'The Levy was not clean';
    case 'name': {
      const look = isSuitIndex(action.suit) ? suitLook(theme, action.suit) : null;
      return look === null ? null : suitLabel(look);
    }
    default:
      return null;
  }
}

/** Legal actions that are not a card play: draw, suit naming, a Levy answer, a catch. */
export function buttonChoices(theme: HollerTheme, legal: readonly unknown[]): ButtonChoice[] {
  const out: ButtonChoice[] = [];
  for (const action of legal) {
    if (!isRecord(action) || action.type === 'play') continue;
    const label = simpleLabel(theme, action);
    if (label === null) continue;
    out.push({
      action,
      label,
      suit: action.type === 'name' && isSuitIndex(action.suit) ? action.suit : null,
    });
  }
  return out;
}

/** Labels of the decision someone else is making, so the waiting screen can show disabled buttons. */
export function pendingLabels(theme: HollerTheme, phase: Phase): readonly string[] {
  switch (phase.type) {
    case 'name':
      return theme.suits.flatMap((suit) => {
        const word = PATTERN_WORD[suit.pattern];
        return word === undefined ? [] : [`${suit.name}, ${word}`];
      });
    case 'cover':
      return ['Seen'];
    case 'levy':
      return ['Accept', 'Challenge'];
    case 'answer':
      return ['Answer'];
    case 'catch':
      return ['Catch', 'Pass'];
    case 'drawn':
      return ['Keep'];
    default:
      return [];
  }
}

export function seatName(names: readonly string[], seat: number): string {
  return names[seat] ?? `Seat ${seat + 1}`;
}

export function directionLabel(direction: 1 | -1): string {
  return direction === 1 ? 'Forward' : 'Reversed';
}

export function roundLabel(state: HollerState): string {
  if (state.phase.type === 'over') return 'Game over';
  return `Round ${state.round + 1}`;
}

function you(
  seat: number,
  mySeat: number | null,
  names: readonly string[],
  mine: string,
  theirs: string,
): string {
  return seat === mySeat ? mine : theirs.replace('{name}', seatName(names, seat));
}

/** One line for the phase. The waiting banner outside this screen names a shuffle. */
export function statusLine(
  theme: HollerTheme,
  state: HollerState,
  names: readonly string[],
  mySeat: number | null,
): string {
  const phase = state.phase;
  switch (phase.type) {
    case 'reveal':
      return phase.kind === 'starter' ? 'Turning the starter.' : 'Counting the cards still in hand.';
    case 'name':
      return you(phase.seat, mySeat, names, 'Name a suit.', '{name} is naming a suit.');
    case 'play':
      return you(phase.seat, mySeat, names, 'Your turn.', "{name}'s turn.");
    case 'drawn':
      return you(
        phase.seat,
        mySeat,
        names,
        'Play the drawn card, or keep it.',
        '{name} is deciding on a drawn card.',
      );
    case 'cover':
      return you(
        phase.queue[0] ?? 0,
        mySeat,
        names,
        'Confirm the card you were shown.',
        '{name} is looking at a drawn card.',
      );
    case 'levy':
      return you(
        phase.seat,
        mySeat,
        names,
        'Accept the Levy, or challenge it.',
        '{name} is answering a Levy.',
      );
    case 'answer':
      return you(
        phase.seat,
        mySeat,
        names,
        'Say whether the Levy was clean.',
        '{name} is answering the challenge.',
      );
    case 'catch':
      return you(
        phase.queue[0] ?? 0,
        mySeat,
        names,
        `Catch the missing ${theme.declaration}, or pass.`,
        `{name} may catch a missing ${theme.declaration}.`,
      );
    case 'epoch':
      return 'Shuffling the discards.';
    case 'grant':
      return 'Dealing the next round.';
    case 'over':
      return 'Game over.';
  }
}

export function winnerLine(
  outcome: { readonly places: readonly number[]; readonly reason: string } | null,
  names: readonly string[],
): string | null {
  if (outcome === null || outcome.places.length === 0) return null;
  const firsts = outcome.places.flatMap((place, seat) => (place === 1 ? [seatName(names, seat)] : []));
  if (outcome.reason === 'score' && firsts.length === 1) return `${firsts[0]} wins.`;
  if (outcome.reason === 'score' && firsts.length > 1) return `${firsts.join(' and ')} tie for first.`;
  const ranked = outcome.places
    .map((place, seat) => ({ place, seat }))
    .sort((a, b) => a.place - b.place || a.seat - b.seat);
  return `Final places: ${ranked.map((r) => `${r.place}. ${seatName(names, r.seat)}`).join(', ')}.`;
}
