/*
 * Hazard's screen model (D088): pure functions from the session's view of the state and the legal moves to what the
 * screen draws. The atlas geometry comes from the package's hex grid (src/atlas.ts); seat colours, labels, the
 * decisions of the moment and the log lines are here, so a test can check them without a browser.
 */
import {
  ATLAS_KEY,
  ATLAS_LANES,
  ATLAS_ROWS,
  bonusChoices,
  type HazardAction,
  type HazardEvent,
  type HazardState,
  kindOf,
  mustCash,
  PROVINCES,
  type ProvinceId,
  provinceOfCard,
  REALMS,
  type RealmId,
  setValue,
} from '@bored-games/hazard';
import { HAZARD_THEME as THEME } from '@bored-games/hazard/theme';

/* ------------------------------------------------------------------------------------------- seats */

/** A seat's colour, its pattern (so colour is never the only cue) and the colour of text drawn on it. */
export interface SeatLook {
  readonly name: string;
  readonly fill: string;
  readonly ink: string;
  readonly pattern: 'stripe' | 'dot' | 'cross' | 'chevron' | 'ring' | 'plain';
}

export const SEAT_LOOKS: readonly SeatLook[] = [
  { name: 'crimson', fill: '#b23a3a', ink: '#fff8ec', pattern: 'stripe' },
  { name: 'cobalt', fill: '#2f5fa8', ink: '#fff8ec', pattern: 'dot' },
  { name: 'moss', fill: '#4f7d3a', ink: '#fff8ec', pattern: 'cross' },
  { name: 'saffron', fill: '#d19a1f', ink: '#2a2116', pattern: 'chevron' },
  { name: 'plum', fill: '#7a4a8c', ink: '#fff8ec', pattern: 'ring' },
  { name: 'slate', fill: '#4d5a63', ink: '#fff8ec', pattern: 'plain' },
];

export const seatLook = (seat: number): SeatLook => SEAT_LOOKS[seat % SEAT_LOOKS.length] as SeatLook;

/** The land colour of an unclaimed province: its realm's. */
export const REALM_LAND: Readonly<Record<RealmId, string>> = {
  a: '#b9c4a2',
  b: '#a9c79a',
  c: '#cbbfa6',
  d: '#e2c992',
  e: '#c9c0a0',
  f: '#e3b9a0',
};

export const seatName = (names: readonly string[], seat: number): string => names[seat] ?? `Seat ${seat + 1}`;
export const provinceName = (p: ProvinceId): string => THEME.provinces[p];
export const realmName = (r: RealmId): string => THEME.realms[r];
const realmOf = (p: ProvinceId): RealmId => p[0] as RealmId;
const at = (p: ProvinceId): number => PROVINCES.indexOf(p);

/* ---------------------------------------------------------------------------------------- geometry */

/** The hex size in atlas units: the distance from a hex's centre to a corner. */
export const HEX = 15;
const W = Math.sqrt(3) * HEX;
const MARGIN = 26;

export interface Hex {
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
  readonly points: string;
  readonly province: ProvinceId;
}

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Lane {
  readonly a: ProvinceId;
  readonly b: ProvinceId;
  /** An SVG path: a gentle arc between the closest hexes, or for the edge lane, two stubs off the map. */
  readonly d: string;
  readonly edge: boolean;
}

export interface Atlas {
  readonly width: number;
  readonly height: number;
  readonly hexes: readonly Hex[];
  /** Edges between two provinces. */
  readonly borders: readonly Segment[];
  /** Edges between land and sea. */
  readonly coasts: readonly Segment[];
  /** Where each province's troop token sits: the centre of its most central hex. */
  readonly anchors: Readonly<Record<ProvinceId, { readonly cx: number; readonly cy: number }>>;
  readonly lanes: readonly Lane[];
  /** Where each realm's name is written: above its northernmost hexes. */
  readonly realmLabels: readonly { readonly realm: RealmId; readonly x: number; readonly y: number }[];
  /** Each province's outline: every edge of its hexes that does not touch another hex of it. */
  readonly outlines: Readonly<Record<ProvinceId, readonly Segment[]>>;
}

const centre = (x: number, y: number) => ({
  cx: MARGIN + W * (x + 0.5 + (y % 2 === 1 ? 0.5 : 0)),
  cy: MARGIN + HEX + 1.5 * HEX * y,
});

/** Pointy-top corners, clockwise from the upper right (−30°). */
const corner = (cx: number, cy: number, i: number) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: cx + HEX * Math.cos(a), y: cy + HEX * Math.sin(a) };
};

const round = (n: number): number => Math.round(n * 10) / 10;

/** The six neighbours of (x, y), each with the two corners of the shared edge (odd rows sit half a hex east). */
function sides(x: number, y: number): { nx: number; ny: number; c: [number, number] }[] {
  const odd = y % 2 === 1;
  return [
    { nx: x + 1, ny: y, c: [0, 1] },
    { nx: odd ? x + 1 : x, ny: y + 1, c: [1, 2] },
    { nx: odd ? x : x - 1, ny: y + 1, c: [2, 3] },
    { nx: x - 1, ny: y, c: [3, 4] },
    { nx: odd ? x : x - 1, ny: y - 1, c: [4, 5] },
    { nx: odd ? x + 1 : x, ny: y - 1, c: [5, 0] },
  ];
}

function buildAtlas(): Atlas {
  const cols = Math.max(...ATLAS_ROWS.map((r) => r.length));
  const at2 = (x: number, y: number): ProvinceId | null => {
    const ch = ATLAS_ROWS[y]?.[x];
    return ch === undefined || ch === '.' ? null : (ATLAS_KEY[ch] ?? null);
  };
  const hexes: Hex[] = [];
  const borders: Segment[] = [];
  const coasts: Segment[] = [];
  const outlines = Object.fromEntries(PROVINCES.map((p) => [p, [] as Segment[]])) as Record<
    ProvinceId,
    Segment[]
  >;
  ATLAS_ROWS.forEach((row, y) => {
    [...row].forEach((_, x) => {
      const province = at2(x, y);
      if (province === null) return;
      const { cx, cy } = centre(x, y);
      const corners = [0, 1, 2, 3, 4, 5].map((i) => corner(cx, cy, i));
      hexes.push({
        x,
        y,
        cx: round(cx),
        cy: round(cy),
        points: corners.map((c) => `${round(c.x)},${round(c.y)}`).join(' '),
        province,
      });
      for (const side of sides(x, y)) {
        const other = at2(side.nx, side.ny);
        const p = corners[side.c[0]] as { x: number; y: number };
        const q = corners[side.c[1]] as { x: number; y: number };
        const seg = { x1: round(p.x), y1: round(p.y), x2: round(q.x), y2: round(q.y) };
        if (other !== province) outlines[province].push(seg);
        if (other === null) coasts.push(seg);
        // Each shared edge once: from the hex that comes first in reading order.
        else if (other !== province && (side.ny > y || (side.ny === y && side.nx > x))) borders.push(seg);
      }
    });
  });
  const anchors = {} as Record<ProvinceId, { cx: number; cy: number }>;
  for (const p of PROVINCES) {
    const mine = hexes.filter((h) => h.province === p);
    const mx = mine.reduce((n, h) => n + h.cx, 0) / mine.length;
    const my = mine.reduce((n, h) => n + h.cy, 0) / mine.length;
    const best = mine.reduce((a, b) =>
      (b.cx - mx) ** 2 + (b.cy - my) ** 2 < (a.cx - mx) ** 2 + (a.cy - my) ** 2 ? b : a,
    );
    anchors[p] = { cx: best.cx, cy: best.cy };
  }
  const width = round(MARGIN * 2 + W * (cols + 0.5));
  const height = round(MARGIN * 2 + HEX * 2 + 1.5 * HEX * (ATLAS_ROWS.length - 1));
  const lanes: Lane[] = ATLAS_LANES.map(([a, b]) => {
    const pa = anchors[a];
    const pb = anchors[b];
    // The edge lane leaves the map: west from the western province, east from the eastern one.
    if (Math.abs(pa.cx - pb.cx) > width / 2) {
      const [w, e] = pa.cx < pb.cx ? [pa, pb] : [pb, pa];
      return {
        a,
        b,
        edge: true,
        d: `M ${w.cx} ${w.cy} Q ${w.cx / 2} ${w.cy - 30} 4 ${w.cy - 20} M ${e.cx} ${e.cy} Q ${(e.cx + width) / 2} ${e.cy - 30} ${width - 4} ${e.cy - 20}`,
      };
    }
    // The closest pair of hexes of the two provinces, joined by a slight arc.
    let best = { d: Number.POSITIVE_INFINITY, p: pa, q: pb };
    for (const h of hexes.filter((x) => x.province === a))
      for (const k of hexes.filter((x) => x.province === b)) {
        const d = (h.cx - k.cx) ** 2 + (h.cy - k.cy) ** 2;
        if (d < best.d) best = { d, p: { cx: h.cx, cy: h.cy }, q: { cx: k.cx, cy: k.cy } };
      }
    const mx = (best.p.cx + best.q.cx) / 2;
    const my = (best.p.cy + best.q.cy) / 2;
    const dx = best.q.cx - best.p.cx;
    const dy = best.q.cy - best.p.cy;
    const bend = 0.15;
    return {
      a,
      b,
      edge: false,
      d: `M ${best.p.cx} ${best.p.cy} Q ${round(mx - dy * bend)} ${round(my + dx * bend)} ${best.q.cx} ${best.q.cy}`,
    };
  });
  const realmLabels = REALMS.map((r) => {
    const mine = hexes.filter((h) => realmOf(h.province) === r.id);
    const top = Math.min(...mine.map((h) => h.cy));
    const xs = mine.map((h) => h.cx);
    return { realm: r.id, x: round((Math.min(...xs) + Math.max(...xs)) / 2), y: round(top - HEX - 6) };
  });
  return { width, height, hexes, borders, coasts, anchors, lanes, realmLabels, outlines };
}

/** The atlas, drawn once. */
export const ATLAS: Atlas = buildAtlas();

/* ------------------------------------------------------------------------------------------ labels */

export function provinceLabel(s: HazardState, p: ProvinceId, names: readonly string[]): string {
  const owner = s.owner[at(p)];
  const troops = s.troops[at(p)] ?? 0;
  const place = `${provinceName(p)}, ${realmName(realmOf(p))}`;
  if (owner === null || owner === undefined) return `${place}, unclaimed`;
  return `${place}, ${seatName(names, owner)} (${seatLook(owner).name}), ${troops} ${troops === 1 ? 'troop' : 'troops'}`;
}

export function cardName(card: number | null): string {
  if (card === null) return 'a hidden charter';
  const kind = THEME.kinds[kindOf(card)];
  const p = provinceOfCard(card);
  return p === null ? kind : `${provinceName(p)} ${kind}`;
}

/* ------------------------------------------------------------------------------------------ players */

export interface PlayerRow {
  readonly seat: number;
  readonly name: string;
  readonly look: SeatLook;
  readonly provinces: number;
  readonly troops: number;
  readonly charters: number;
  readonly realms: readonly RealmId[];
  readonly out: boolean;
  readonly turn: boolean;
  readonly place: number | null;
}

export function playerRows(s: HazardState, names: readonly string[]): PlayerRow[] {
  return Array.from({ length: s.seats }, (_, seat) => ({
    seat,
    name: seatName(names, seat),
    look: seatLook(seat),
    provinces: s.owner.filter((o) => o === seat).length,
    troops: s.troops.reduce((n, t, i) => n + (s.owner[i] === seat ? t : 0), 0),
    charters: s.hands[seat]?.length ?? 0,
    realms: REALMS.filter((r) => r.provinces.every((p) => s.owner[at(p)] === seat)).map((r) => r.id),
    out: s.out.includes(seat),
    turn: s.turn === seat && s.stage !== 'over' && s.stage !== 'order' && s.stage !== 'orderRoll',
    place: s.result?.places[seat] ?? null,
  }));
}

/** The troops the next set pays. */
export const nextSetValue = (s: HazardState): number => setValue(s.cashes);

/* ---------------------------------------------------------------------------------------- decisions */

type Of<T extends HazardAction['type']> = Extract<HazardAction, { type: T }>;
const ofType = <T extends HazardAction['type']>(all: readonly HazardAction[], type: T): Of<T>[] =>
  all.filter((a): a is Of<T> => a.type === type);

/** The legal moves of the moment, grouped. */
export interface Choices {
  readonly roll: Of<'roll'> | null;
  readonly claims: readonly Of<'claim'>[];
  readonly places: readonly Of<'place'>[];
  readonly musters: readonly Of<'muster'>[];
  readonly cashes: readonly Of<'cash'>[];
  readonly attacks: readonly Of<'attack'>[];
  readonly endAttack: Of<'endAttack'> | null;
  readonly defends: readonly Of<'defend'>[];
  readonly advances: readonly Of<'advance'>[];
  readonly marches: readonly Of<'march'>[];
  readonly endTurn: Of<'endTurn'> | null;
}

export function choicesOf(legal: readonly HazardAction[]): Choices {
  return {
    roll: ofType(legal, 'roll')[0] ?? null,
    claims: ofType(legal, 'claim'),
    places: ofType(legal, 'place'),
    musters: ofType(legal, 'muster'),
    cashes: ofType(legal, 'cash'),
    attacks: ofType(legal, 'attack'),
    endAttack: ofType(legal, 'endAttack')[0] ?? null,
    defends: ofType(legal, 'defend'),
    advances: ofType(legal, 'advance'),
    marches: ofType(legal, 'march'),
    endTurn: ofType(legal, 'endTurn')[0] ?? null,
  };
}

/**
 * What a click on the atlas does now. `pick` provinces start a two-step move (attack or march) and `target`
 * provinces finish it; `single` provinces are a whole move by themselves (claim, place, muster).
 */
export interface MapMode {
  readonly kind: 'none' | 'claim' | 'place' | 'muster' | 'attack' | 'march';
  readonly single: readonly ProvinceId[];
  readonly pick: readonly ProvinceId[];
  readonly target: readonly ProvinceId[];
}

const uniq = (ps: readonly ProvinceId[]): ProvinceId[] => [...new Set(ps)].sort((x, y) => at(x) - at(y));

export function mapMode(c: Choices, selected: ProvinceId | null): MapMode {
  const none = { single: [], pick: [], target: [] };
  if (c.claims.length > 0) return { ...none, kind: 'claim', single: uniq(c.claims.map((a) => a.province)) };
  if (c.places.length > 0) return { ...none, kind: 'place', single: uniq(c.places.map((a) => a.province)) };
  if (c.musters.length > 0)
    return { ...none, kind: 'muster', single: uniq(c.musters.map((a) => a.province)) };
  if (c.attacks.length > 0) {
    const pick = uniq(c.attacks.map((a) => a.from));
    const target =
      selected === null ? [] : uniq(c.attacks.filter((a) => a.from === selected).map((a) => a.to));
    return { kind: 'attack', single: [], pick, target };
  }
  if (c.marches.length > 0) {
    const pick = uniq(c.marches.map((a) => a.from));
    const target =
      selected === null ? [] : uniq(c.marches.filter((a) => a.from === selected).map((a) => a.to));
    return { kind: 'march', single: [], pick, target };
  }
  return { ...none, kind: 'none' };
}

/**
 * Whether a half-made choice of provinces (an attack's or a march's) outlives the move to `stage`: an attack's pair
 * stays chosen through the defence, the roll and the move in, so the next roll is one click; any other stage starts
 * afresh. The legal moves still drop a pair that is no longer possible.
 */
export const selectionSurvives = (stage: HazardState['stage']): boolean =>
  stage === 'attack' || stage === 'defend' || stage === 'roll' || stage === 'advance' || stage === 'march';

/** The dice an attack from `from` to `to` may roll, fewest first. */
export const attackDiceFor = (c: Choices, from: ProvinceId, to: ProvinceId): number[] =>
  c.attacks.filter((a) => a.from === from && a.to === to).map((a) => a.dice);

/** The most troops a march from `from` may move (the legal list holds 1 and the most). */
export const marchMost = (c: Choices, from: ProvinceId, to: ProvinceId): number =>
  Math.max(0, ...c.marches.filter((a) => a.from === from && a.to === to).map((a) => a.count));

/** The sets the viewer may cash, each with its bonus choices. */
export function cashGroups(c: Choices): { positions: readonly number[]; actions: readonly Of<'cash'>[] }[] {
  const out = new Map<string, Of<'cash'>[]>();
  for (const a of c.cashes) {
    const key = a.positions.join(',');
    out.set(key, [...(out.get(key) ?? []), a]);
  }
  return [...out.values()].map((actions) => ({ positions: (actions[0] as Of<'cash'>).positions, actions }));
}

/** The viewer's charters, as this view knows them. */
export function handOf(s: HazardState, me: number | null): { pos: number; card: number | null }[] {
  if (me === null) return [];
  return (s.hands[me] ?? []).map((x) => ({ pos: x.pos, card: x.card }));
}

/** The provinces on a set's cards that would take the two extra troops. */
export const bonusFor = (s: HazardState, me: number, cards: readonly number[]): ProvinceId[] =>
  bonusChoices(s, me, cards);

/* ------------------------------------------------------------------------------------------ status */

export function statusLine(s: HazardState, names: readonly string[], me: number | null): string {
  const who = (seat: number) => (seat === me ? 'You' : seatName(names, seat));
  const your = (seat: number) => (seat === me ? 'your' : `${seatName(names, seat)}’s`);
  switch (s.stage) {
    case 'order':
      return s.tied.length === s.seats
        ? `Everyone rolls a die: the highest claims first. ${who(s.tied[0] ?? 0)} to start the roll.`
        : `A tie: ${s.tied.map((t) => seatName(names, t)).join(' and ')} roll again.`;
    case 'orderRoll':
      return 'Rolling for the first claim…';
    case 'claim':
      return `${who(s.turn)} ${s.turn === me ? 'claim' : 'claims'} an empty province.`;
    case 'place':
      return `${who(s.turn)} ${s.turn === me ? 'place' : 'places'} a troop (${s.reserve[s.turn] ?? 0} left).`;
    case 'muster':
      if (s.midTurn && mustCash(s, s.turn))
        return `${who(s.turn)} must cash charters down to four after the conquest.`;
      if (s.midTurn)
        return s.turn === me
          ? `Place the ${s.pool} ${s.pool === 1 ? 'troop' : 'troops'} from your cashed set, then attack on.`
          : `${who(s.turn)} places the troops from a cashed set.`;
      return `${capital(your(s.turn))} muster: ${s.pool} ${s.pool === 1 ? 'troop' : 'troops'} to place.`;
    case 'reveal':
      return 'Turning the cashed set face up…';
    case 'attack':
      return `${who(s.turn)} may attack, or stop.`;
    case 'defend': {
      const b = s.battle;
      const d = b === null ? null : (s.owner[at(b.to)] ?? null);
      return b === null || d === null
        ? 'The defender chooses dice.'
        : `${who(d)} ${d === me ? 'defend' : 'defends'} ${provinceName(b.to)} against ${b.attack} ${b.attack === 1 ? 'die' : 'dice'}.`;
    }
    case 'roll':
      return 'The dice are rolling…';
    case 'advance':
      return `${who(s.turn)} ${s.turn === me ? 'move' : 'moves'} troops into the captured province.`;
    case 'shuffle':
      return 'The pile is empty: reshuffling the cashed charters…';
    case 'march':
      return `${who(s.turn)} may march, then the turn ends.`;
    case 'over': {
      const winner = s.result?.places.indexOf(1) ?? -1;
      return winner < 0
        ? 'The game is over.'
        : `${who(winner)} ${winner === me ? 'hold' : 'holds'} the Meridian.`;
    }
  }
}

const capital = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

/** One line of the game log, or null for an event the log leaves out. */
export function logLine(e: HazardEvent, names: readonly string[]): string | null {
  const n = (seat: number) => seatName(names, seat);
  switch (e.type) {
    case 'first':
      return `${n(e.seat)} rolled highest (${e.faces.join(', ')}) and claims first.`;
    case 'tie':
      return `A tie on ${Math.max(...e.faces)}: ${e.seats.map(n).join(' and ')} roll again.`;
    case 'claimed':
      return `${n(e.seat)} claimed ${provinceName(e.province)}.`;
    case 'placed':
      return null;
    case 'turn':
      return `${n(e.seat)}’s turn: ${e.troops} troops to muster.`;
    case 'mustered':
      return `${n(e.seat)} mustered ${e.count} on ${provinceName(e.province)}.`;
    case 'cashing':
      return `${n(e.seat)} cashes in a set.`;
    case 'cashed':
      return e.foul
        ? `${n(e.seat)}’s set was false: ${e.cards.map(cardName).join(', ')}. It pays nothing.`
        : `${n(e.seat)} cashed ${e.cards.map(cardName).join(', ')} for ${e.troops}${e.bonus === null ? '' : `, and 2 on ${provinceName(e.bonus)}`}.`;
    case 'attacked':
      return `${n(e.seat)} attacks ${provinceName(e.to)} from ${provinceName(e.from)} with ${e.dice}.`;
    case 'defended':
      return null;
    case 'battle':
      return `Dice ${e.attack.join(' ')} against ${e.defend.join(' ')}: ${lossText(e.lost)}.`;
    case 'captured':
      return `${n(e.seat)} took ${provinceName(e.to)}.`;
    case 'advanced':
      return `${e.count} moved into ${provinceName(e.to)}.`;
    case 'eliminated':
      return `${n(e.seat)} is out. ${n(e.by)} takes ${e.charters} ${e.charters === 1 ? 'charter' : 'charters'}.`;
    case 'drew':
      return `${n(e.seat)} drew a charter.`;
    case 'reshuffled':
      return `The ${e.size} cashed charters were reshuffled into a new pile.`;
    case 'marched':
      return `${n(e.seat)} marched ${e.count} from ${provinceName(e.from)} to ${provinceName(e.to)}.`;
    case 'ended':
      return null;
    case 'won':
      return `${n(e.seat)} holds all 42 provinces and wins.`;
  }
}

function lossText([a, d]: readonly [number, number]): string {
  const part = (k: number, who: string) =>
    k === 0 ? null : `${who} ${k === 1 ? 'loses one' : `loses ${k}`}`;
  return [part(a, 'the attacker'), part(d, 'the defender')].filter((x) => x !== null).join(', ');
}
