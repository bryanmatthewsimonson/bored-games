/*
 * The Sticks & Stones screen model (D089): pure helpers that turn the state, the legal moves and the events into
 * what the screen shows. Names come only from the theme.
 */
import {
  DISCOVERIES,
  divisorOf,
  FIGURES,
  GOODS,
  GROUND_ROOM,
  GROUNDS,
  groundGood,
  monumentOf,
  SPOTS,
  type Spot,
  STACK_SIZE,
  type SticksAction,
  type SticksEvent,
  type SticksState,
  SYMBOLS,
  slotOf,
  stackOf,
  tally,
  VILLAGE,
} from '@bored-games/sticks-and-stones';
import { STICKS_THEME as THEME } from '@bored-games/sticks-and-stones/theme';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** A good's name: -1 is food. */
export const goodName = (good: number): string =>
  good < 0 ? THEME.words.food : (THEME.goods[GOODS[good] ?? 'wood'] ?? '');

/** A spot's name. */
export const spotName = (spot: Spot | 'card'): string =>
  spot === 'card' ? 'a discovery' : THEME.spots[spot];

export const seatName = (names: readonly string[], seat: number): string =>
  names[seat] ?? `Player ${seat + 1}`;

/** "2 wood, 1 clay": a goods vector in words, or "nothing". */
export function goodsText(pay: readonly number[]): string {
  const parts = pay.flatMap((n, i) => (n > 0 ? [`${n} ${goodName(i).toLowerCase()}`] : []));
  return parts.length === 0 ? 'nothing' : parts.join(', ');
}

/** What the viewer may do now, grouped from the legal list. */
export interface Choices {
  /** Placing: the counts open on each spot. */
  readonly places: ReadonlyMap<Spot, readonly number[]>;
  /** Resolving: gathering grounds and village spots to use. */
  readonly uses: readonly Spot[];
  /** Resolving: the payments for each display slot this seat stands on. */
  readonly buys: ReadonlyMap<number, readonly (readonly number[])[]>;
  /** Resolving: the payments for each stack this seat stands on. */
  readonly builds: ReadonlyMap<number, readonly (readonly number[])[]>;
  /** Cards and stacks the seat may pass up. */
  readonly skips: readonly Spot[];
  readonly tools: readonly Extract<SticksAction, { type: 'tools' }>[];
  readonly picks: readonly number[];
  /** Feeding: the payments of the shortfall in goods. */
  readonly feeds: readonly (readonly number[])[];
  /** Feeding: going hungry is open. */
  readonly hungry: boolean;
  /** A two-goods card's choices. */
  readonly chooses: readonly (readonly number[])[];
}

export function choicesOf(legal: readonly SticksAction[]): Choices {
  const places = new Map<Spot, number[]>();
  const buys = new Map<number, number[][]>();
  const builds = new Map<number, number[][]>();
  const c = {
    uses: [] as Spot[],
    skips: [] as Spot[],
    tools: [] as Extract<SticksAction, { type: 'tools' }>[],
    picks: [] as number[],
    feeds: [] as number[][],
    hungry: false,
    chooses: [] as number[][],
  };
  for (const a of legal) {
    switch (a.type) {
      case 'place':
        places.set(a.spot, [...(places.get(a.spot) ?? []), a.count]);
        break;
      case 'use':
        c.uses.push(a.spot);
        break;
      case 'buy':
        buys.set(a.slot, [...(buys.get(a.slot) ?? []), [...a.pay]]);
        break;
      case 'build':
        builds.set(a.stack, [...(builds.get(a.stack) ?? []), [...a.pay]]);
        break;
      case 'skip':
        c.skips.push(a.spot);
        break;
      case 'tools':
        c.tools.push(a);
        break;
      case 'pick':
        c.picks.push(a.face);
        break;
      case 'feed':
        if (a.pay === null) c.hungry = true;
        else c.feeds.push([...a.pay]);
        break;
      case 'choose':
        c.chooses.push([...a.take]);
        break;
      default:
        break;
    }
  }
  return { places, buys, builds, ...c };
}

/** Whether `pay` is one of `options`. */
export const isOption = (options: readonly (readonly number[])[], pay: readonly number[]): boolean =>
  options.some((o) => o.every((n, i) => n === pay[i]));

/** What a gift's face gives, in words. */
export function giftText(face: number): string {
  if (face <= 4) return `1 ${goodName(face - 1).toLowerCase()}`;
  return face === 5 ? 'a tool step' : 'a harvest step';
}

/** A discovery's top in words. */
export function topText(card: number): string {
  const top = DISCOVERIES[card]?.top;
  switch (top?.type) {
    case 'food':
      return `${top.n} food`;
    case 'goods':
      return `${top.n} ${goodName(top.good).toLowerCase()}`;
    case 'roll':
      return `roll two dice for ${goodName(top.good).toLowerCase()}`;
    case 'points':
      return `${top.n} points`;
    case 'oneUse':
      return `a one-use tool of ${top.n}`;
    case 'tool':
      return 'a tool step';
    case 'field':
      return 'a harvest step';
    case 'choose':
      return THEME.words.choose;
    case 'extra':
      return THEME.words.extra;
    case 'dice':
      return THEME.words.gift;
    default:
      return '';
  }
}

/** A discovery's scoring part in words. */
export function bottomText(card: number): string {
  const b = DISCOVERIES[card]?.bottom;
  if (b === undefined) return '';
  if (b.kind === 'culture') return THEME.symbols[SYMBOLS[b.symbol] ?? 'writing'];
  const fig = FIGURES[b.figure] ?? 'farmer';
  return `${THEME.figures[fig]} ×${b.count} (${THEME.figureCounts[fig]})`;
}

/** Who stands on `spot`, seat by seat. */
export const occupants = (s: SticksState, spot: Spot): { seat: number; count: number }[] =>
  s.spots[spot].flatMap((count, seat) => (count > 0 ? [{ seat, count }] : []));

/** The room on a spot in words ("3 of 7", "open", "full"). */
export function roomText(s: SticksState, spot: Spot): string {
  const used = sum(s.spots[spot]);
  if (spot === 'hunt') return used === 0 ? 'room for all' : `${used} hunting`;
  if (GROUNDS.includes(spot)) return `${used} of ${GROUND_ROOM}`;
  return used > 0 ? 'taken' : 'open';
}

/** The spots of the board, in drawing order: the hunt, the grounds, the village. */
export const BOARD_SPOTS: readonly Spot[] = ['hunt', ...GROUNDS, ...VILLAGE];

/** How a roll of `dice` for `good` would yield with `bonus` added. */
export const yieldOf = (dice: readonly number[], good: number, bonus: number): number =>
  Math.floor((sum(dice) + bonus) / divisorOf(good));

/** The value a tools choice adds, for the viewer's clan. */
export function toolBonus(
  s: SticksState,
  seat: number,
  a: { tools: readonly number[]; spares: readonly number[] },
) {
  const c = s.clans[seat];
  if (!c) return 0;
  return sum(a.tools.map((i) => c.tools[i] ?? 0)) + sum(a.spares.map((i) => c.spares[i] ?? 0));
}

/** Food `seat` still lacks while feeding (0 when fed). */
export const shortfallOf = (s: SticksState, seat: number): number => {
  const c = s.clans[seat];
  return c ? Math.max(0, c.people - c.food) : 0;
};

export interface PlayerRow {
  readonly seat: number;
  readonly name: string;
  /** The score track. */
  readonly score: number;
  /** The final count of what is public now. */
  readonly standing: number;
  readonly people: number;
  readonly home: number;
  readonly food: number;
  readonly field: number;
  readonly goods: readonly number[];
  readonly tools: readonly number[];
  readonly used: readonly boolean[];
  readonly spares: readonly number[];
  readonly choices: number;
  readonly cards: readonly number[];
  readonly hidden: number;
  readonly monuments: readonly number[];
  readonly first: boolean;
  readonly turn: boolean;
  readonly place: number | null;
}

export function playerRows(s: SticksState, names: readonly string[]): PlayerRow[] {
  const pending = s.stage === 'pick' ? (s.gift?.order[0] ?? null) : s.stage === 'over' ? null : s.turn;
  return s.clans.map((c, seat) => ({
    seat,
    name: seatName(names, seat),
    score: c.score,
    standing: s.result?.scores[seat] ?? tally(c, s.rules, true).total,
    people: c.people,
    home: s.home[seat] ?? 0,
    food: c.food,
    field: c.field,
    goods: c.goods,
    tools: c.tools,
    used: c.used,
    spares: c.spares,
    choices: c.choices,
    cards: [...c.cards, ...c.hidden.flatMap((h) => (h.open && h.card !== null ? [h.card] : []))],
    hidden: c.hidden.filter((h) => !h.open).length,
    monuments: c.monuments,
    first: s.first === seat,
    turn:
      pending === seat &&
      (s.stage === 'place' ||
        s.stage === 'resolve' ||
        s.stage === 'tools' ||
        s.stage === 'pick' ||
        s.stage === 'feed'),
    place: s.result?.places[seat] ?? null,
  }));
}

/** The status line at the top of the screen. */
export function statusLine(s: SticksState, names: readonly string[], me: number | null): string {
  const who = (seat: number): string => (seat === me ? 'You' : seatName(names, seat));
  const verb = (seat: number, mine: string, theirs: string): string => (seat === me ? mine : theirs);
  switch (s.stage) {
    case 'over': {
      const winners = (s.result?.places ?? []).flatMap((p, seat) => (p === 1 ? [seat] : []));
      const list = winners.map(who).join(' and ');
      return `Game over. ${list} ${winners.length === 1 && winners[0] !== me ? 'wins' : 'win'}.`;
    }
    case 'ending':
      return 'The game is over: turning up the face-down discoveries for the final count.';
    case 'place':
      if (s.first === null) return 'Turning up the discoveries and the monuments…';
      return `Round ${s.round}: ${who(s.turn)} ${verb(s.turn, 'send', 'sends')} people out.`;
    case 'resolve':
      return `Round ${s.round}: ${who(s.turn)} ${verb(s.turn, 'bring', 'brings')} the people home.`;
    case 'roll':
      return `Rolling the dice for ${who(s.turn)}…`;
    case 'tools':
      return `${who(s.turn)} ${verb(s.turn, 'choose', 'chooses')} tools for the roll.`;
    case 'pick': {
      const seat = s.gift?.order[0] ?? s.turn;
      return `Gifts of the dice: ${who(seat)} ${verb(seat, 'take', 'takes')} a die.`;
    }
    case 'feed':
      return `Feeding: ${who(s.turn)} ${verb(s.turn, 'lack', 'lacks')} food.`;
    default:
      return '';
  }
}

/** One line of the log for an event, or null for events the log skips. */
export function logLine(e: SticksEvent, names: readonly string[]): string | null {
  const who = (seat: number): string => seatName(names, seat);
  switch (e.type) {
    case 'first':
      return `${who(e.seat)} goes first.`;
    case 'round':
      return `Round ${e.round} begins; ${who(e.first)} goes first.`;
    case 'placed':
      return `${who(e.seat)} sends ${e.count} to ${spotName(e.spot)}.`;
    case 'gathered':
      return `${who(e.seat)} rolls ${e.dice.join('+')}${e.bonus > 0 ? ` +${e.bonus} in tools` : ''}: ${e.amount} ${goodName(e.good).toLowerCase()}.`;
    case 'village':
      return e.gained
        ? `${who(e.seat)} ${e.spot === 'hut' ? 'welcomes a new person' : e.spot === 'field' ? 'tills the furrows' : 'knaps a tool'}.`
        : `${who(e.seat)} gains nothing at ${spotName(e.spot)} (at the limit).`;
    case 'bought':
      return `${who(e.seat)} takes a discovery: ${bottomText(e.card)}, with ${topText(e.card)}.`;
    case 'drew':
      return `${who(e.seat)} draws a face-down discovery.`;
    case 'built': {
      return `${who(e.seat)} raises a monument for ${e.points} points.`;
    }
    case 'skipped':
      return `${who(e.seat)} passes up ${spotName(e.spot).toLowerCase()}.`;
    case 'picked':
      return `${who(e.seat)} takes a ${e.face}: ${giftText(e.face)}.`;
    case 'chose':
      return `${who(e.seat)} takes ${goodsText(e.take)}.`;
    case 'fed':
      return e.hungry
        ? `${who(e.seat)} ${THEME.words.hungry}: −10 points.`
        : e.goods > 0
          ? `${who(e.seat)} feeds the clan, ${e.goods} in goods.`
          : null;
    case 'ended':
      return e.reason === 'pile'
        ? 'The discoveries ran out: the game ends.'
        : 'A monument site is empty: the game ends.';
    default:
      return null;
  }
}

/** A monument's price in words. */
export function priceText(card: number): string {
  const m = monumentOf(card);
  if (!m) return '';
  if (m.kind === 'fixed') return goodsText(m.cost);
  if (m.kind === 'kinds')
    return `${m.count} goods of ${m.kinds === 1 ? 'one kind' : `${m.kinds} different kinds`}`;
  return '1 to 7 goods of any kinds';
}

/** Tiles left in each stack, the top included. */
export const stackLeft = (s: SticksState): number[] => s.stacks.map((st) => STACK_SIZE - st.built);

/** The spot of a display slot or a stack. */
export const cardSpot = (slot: number): Spot => `card${slot}` as Spot;
export const stackSpot = (k: number): Spot => `stack${k}` as Spot;
export { groundGood, SPOTS, slotOf, stackOf };
