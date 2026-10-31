/*
 * Fever Pitch's screen model (D096): names, the status line, the history lines and the grouping of the legal moves
 * into what the screen offers. Pure functions of the state and the legal list.
 */
import {
  CITY_COUNT,
  type Entry,
  type FeverAction,
  type FeverState,
  pendingOf,
  RELIEFS,
  ROLES,
  type Role,
  roleOf,
  spreadRate,
  supplyOf,
} from '@bored-games/fever-pitch';
import { FEVER_THEME as THEME } from '@bored-games/fever-pitch/theme';

export const cityName = (c: number): string => THEME.cities[c] ?? `City ${c}`;
export const strainName = (k: number): string => THEME.strains[k] ?? `Strain ${k}`;
export const seatName = (names: readonly string[], seat: number): string =>
  names[seat] ?? `Player ${seat + 1}`;
export const roleName = (role: Role | null): string => (role === null ? 'No role yet' : THEME.roles[role]);

/** A field card's name: a city, or a relief. */
export function cardName(f: number): string {
  if (f < CITY_COUNT) return cityName(f);
  const relief = RELIEFS[f - CITY_COUNT];
  return relief === undefined ? 'a card' : THEME.reliefs[relief];
}

export const listText = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/** "Ann (Paramedic)". */
export const who = (s: FeverState, names: readonly string[], seat: number): string =>
  `${seatName(names, seat)} (${roleName(roleOf(s, seat))})`;

const HOW: Readonly<Record<string, string>> = {
  travel: 'travelled',
  fly: 'flew',
  charter: 'chartered',
  shuttle: 'shuttled',
  summon: 'was summoned',
  relocate: 'flew from a clinic',
  medevac: 'was flown out',
};

/** One history line, in words. */
export function logLine(e: Entry, s: FeverState, names: readonly string[]): string {
  const n = (seat: number) => seatName(names, seat);
  switch (e.kind) {
    case 'setup':
      return `Roles dealt: ${e.roles.map((r, seat) => `${n(seat)} ${roleName(ROLES[r] ?? null)}`).join(', ')}. ${n(e.first)} goes first.`;
    case 'turn':
      return `Turn ${e.turnNo}: ${n(e.seat)}.`;
    case 'move': {
      const pawn = e.pawn === e.seat ? n(e.seat) : `${n(e.seat)} moved ${n(e.pawn)}, who`;
      const how = e.pawn === e.seat && e.how === 'summon' ? 'moved to a teammate' : HOW[e.how];
      return `${pawn} ${how} from ${cityName(e.from)} to ${cityName(e.to)}.`;
    }
    case 'clinic':
      return `${n(e.seat)} opened a clinic in ${cityName(e.city)}${e.moved === null ? '' : ` (moved from ${cityName(e.moved)})`}.`;
    case 'treat':
      return `${n(e.seat)} treated ${e.removed} ${strainName(e.strain)} case${e.removed === 1 ? '' : 's'} in ${cityName(e.city)}.`;
    case 'cleared':
      return `The Paramedic cleared ${e.removed} ${strainName(e.strain)} case${e.removed === 1 ? '' : 's'} in ${cityName(e.city)}.`;
    case 'handed':
      return `${n(e.from)} handed ${cardName(e.card)} to ${n(e.to)}.`;
    case 'cure':
      return `${n(e.seat)} found the cure for ${strainName(e.strain)}!`;
    case 'stamped':
      return `${strainName(e.strain)} is stamped out.`;
    case 'retrieve':
      return `${n(e.seat)} stored ${cardName(e.card)} on the Archivist's card.`;
    case 'relief':
      return `${n(e.seat)} played ${cardName(e.card)}${e.city === null ? '' : ` (${cityName(e.city)})`}.`;
    case 'drew':
      return `${n(e.seat)} drew ${e.cards.length === 0 ? 'no city or relief card' : listText(e.cards.map(cardName))}${e.surges > 0 ? ` and ${e.surges === 1 ? 'a surge' : `${e.surges} surges`}` : ''}.`;
    case 'discard':
      return `${n(e.seat)} discarded ${cardName(e.card)} (hand limit).`;
    case 'rise':
      return `Surge! The spread rate rises to ${spreadRate({ ...s, rate: e.rate })}.`;
    case 'strike':
      return `The surge strikes ${cityName(e.city)}: ${e.placed} case${e.placed === 1 ? '' : 's'}.`;
    case 'restack':
      return `${e.cards} spent spread card${e.cards === 1 ? '' : 's'} reshuffled onto the spread deck.`;
    case 'infect':
      return `Spread: ${cityName(e.city)}${e.placed === 0 ? ', nothing placed' : ` +${e.placed}`}.`;
    case 'blocked':
      return `No ${strainName(e.strain)} case could be placed in ${cityName(e.city)}.`;
    case 'spillover':
      return `Spillover ${e.count} in ${cityName(e.city)} (${strainName(e.strain)})!`;
    case 'quiet':
      return 'A lull: no spread this turn.';
    case 'arranged':
      return `${n(e.seat)} reordered the top of the spread deck: ${listText(e.cities.map(cityName))}.`;
    case 'pass':
      return `${n(e.seat)} kept their relief cards.`;
    case 'won':
      return 'All four cures are found. The team wins!';
    case 'lost':
      return `The team loses: ${LOSS_TEXT[e.reason]}.`;
  }
}

export const LOSS_TEXT: Readonly<Record<string, string>> = {
  spillovers: 'the eighth spillover',
  cases: 'a strain ran out of case tokens',
  deck: 'the field deck ran out',
};

/** The line under the title: whose decision it is and what. */
export function statusLine(s: FeverState, names: readonly string[], me: number | null): string {
  if (s.phase === 'over') {
    if (s.result?.reason === 'cured') return 'Victory: all four cures are found!';
    return `Defeat: ${LOSS_TEXT[s.result?.reason ?? ''] ?? 'the game is over'}.`;
  }
  const p = pendingOf(s);
  if (p.type === 'reveal') return 'Turning up cards…';
  if (p.type === 'shuffle') return 'Reshuffling the spent spread cards onto the deck…';
  if (p.type !== 'player') return 'Waiting…';
  const you = p.seat === me;
  const name = you ? 'You' : seatName(names, p.seat);
  switch (p.decision) {
    case 'arrange':
      return `${name}: put the top spread cards back in any order.`;
    case 'discard':
      return `${name}: over the hand limit; discard a card or play a relief.`;
    case 'relief':
      return s.window?.only === 'immunity'
        ? `${name}: play Herd Immunity before the restack, or pass.`
        : `${name}: play a relief card before the game goes on, or pass.`;
    default:
      return `${you ? 'Your' : `${seatName(names, p.seat)}'s`} turn: ${s.actions} action${s.actions === 1 ? '' : 's'} left.`;
  }
}

/** The supply, spillover and rate figures for the tracks. */
export const tracks = (s: FeverState) => ({
  supply: [0, 1, 2, 3].map((k) => supplyOf(s, k)),
  spills: s.spills,
  rate: spreadRate(s),
  rateIndex: s.rate,
  field: s.field.length,
  pile: s.pile.length,
});

/** The moves the screen offers, grouped. */
export interface Offers {
  /** Destinations by kind for the selected pawn; and how each reaches it. */
  readonly moves: readonly FeverAction[];
  readonly others: readonly FeverAction[];
  readonly reliefs: readonly FeverAction[];
  readonly discards: readonly FeverAction[];
  readonly arranges: readonly FeverAction[];
  readonly pass: FeverAction | null;
}

const MOVE_TYPES = new Set(['travel', 'fly', 'charter', 'shuttle', 'summon', 'relocate']);
const RELIEF_TYPES = new Set(['medevac', 'warning', 'permit', 'lull', 'immunity']);

export function offersOf(legal: readonly FeverAction[]): Offers {
  return {
    moves: legal.filter((a) => MOVE_TYPES.has(a.type)),
    others: legal.filter(
      (a) =>
        !MOVE_TYPES.has(a.type) &&
        !RELIEF_TYPES.has(a.type) &&
        !['discard', 'arrange', 'pass'].includes(a.type),
    ),
    reliefs: legal.filter((a) => RELIEF_TYPES.has(a.type)),
    discards: legal.filter((a) => a.type === 'discard'),
    arranges: legal.filter((a) => a.type === 'arrange'),
    pass: legal.find((a) => a.type === 'pass') ?? null,
  };
}

/** A move's words, for a button: "Travel to Wexmoor", "Fly to Riomar (discard Riomar)". */
export function moveText(a: FeverAction, s: FeverState, names: readonly string[], me: number | null): string {
  const pawn = 'pawn' in a && a.pawn !== me ? `${seatName(names, a.pawn)}: ` : '';
  switch (a.type) {
    case 'travel':
      return `${pawn}Travel to ${cityName(a.to)}`;
    case 'fly':
      return `${pawn}Fly to ${cityName(a.to)} (discard its card)`;
    case 'charter':
      return `${pawn}Charter to ${cityName(a.to)} (discard ${cityName(s.at[a.pawn] ?? 0)})`;
    case 'shuttle':
      return `${pawn}Shuttle to ${cityName(a.to)}`;
    case 'summon':
      return `${pawn}Move to a teammate in ${cityName(a.to)}`;
    case 'relocate':
      return `Fly from the clinic to ${cityName(a.to)} (discard ${cityName(a.card)})`;
    case 'clinic':
      return a.remove === null
        ? 'Open a clinic here'
        : `Open a clinic here (moving the one in ${cityName(a.remove)})`;
    case 'treat':
      return `Treat ${strainName(a.strain)}`;
    case 'give':
      return `Give ${cardName(a.card)} to ${seatName(names, a.to)}`;
    case 'take':
      return `Take ${cardName(a.card)} from ${seatName(names, a.from)}`;
    case 'cure':
      return `Find the ${strainName(Math.floor((a.cards[0] ?? 0) / 12))} cure (${listText(a.cards.map(cityName))})`;
    case 'retrieve':
      return `Store ${cardName(a.card)} on your role card`;
    case 'end':
      return 'End my actions';
    case 'discard':
      return `Discard ${cardName(a.card)}`;
    case 'pass':
      return 'Pass';
    case 'medevac':
      return `Medevac: ${seatName(names, a.pawn)} to ${cityName(a.to)}`;
    case 'warning':
      return 'Early Warning: look at the top six spread cards';
    case 'permit':
      return `Field Permit: a clinic in ${cityName(a.city)}${a.remove === null ? '' : ` (moving ${cityName(a.remove)})`}`;
    case 'lull':
      return 'Lull: skip the next spread';
    case 'immunity':
      return `Herd Immunity: remove ${cityName(a.city)} from the spent pile`;
    default:
      return a.type;
  }
}
