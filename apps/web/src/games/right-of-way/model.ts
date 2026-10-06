/*
 * Right of Way presentation helpers: pure functions of the module state, for the game screen and its tests.
 */
import {
  CHARTER_OFFSET,
  CHARTERS,
  colorAt,
  connects,
  ENGINE,
  longestLine,
  ownedRoutes,
  pileCount,
  ROUTES,
  type RowAction,
  type RowState,
} from '@bored-games/right-of-way';
import { RIGHT_OF_WAY_THEME } from '@bored-games/right-of-way/theme';

export type Claim = Extract<RowAction, { type: 'claim' }>;

/** Player colours by seat (the bird names are in the theme). */
export const PLAYER_COLORS = ['#c4512c', '#3f6f9e', '#d9a92a', '#30343b', '#3c8a5c'] as const;

export const townName = (t: number): string => RIGHT_OF_WAY_THEME.towns[t] ?? `Town ${t + 1}`;
export const routeName = (ri: number): string => {
  const r = ROUTES[ri];
  return r === undefined ? `Route ${ri + 1}` : `${townName(r.a)} – ${townName(r.b)}`;
};
export const cargoName = (c: number): string => RIGHT_OF_WAY_THEME.cargo[c] ?? '?';

/** A seat's known hand, as counts per colour index 0–7 and Engine (8). Unknown cards are left out. */
export function handCounts(s: RowState, seat: number): number[] {
  const out = new Array<number>(ENGINE + 1).fill(0);
  for (const h of s.players[seat]?.hand ?? []) {
    const c = colorAt(s, h);
    if (c !== null) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

/** The claim actions, grouped by `route:side`. */
export function claimsBySide(legal: readonly RowAction[]): Map<string, Claim[]> {
  const out = new Map<string, Claim[]>();
  for (const a of legal) {
    if (a.type !== 'claim') continue;
    const key = `${a.route}:${a.side}`;
    out.set(key, [...(out.get(key) ?? []), a]);
  }
  return out;
}

/** What a claim pays, as text: "2 Timber + 1 Engine". */
export function payText(s: RowState, a: Claim): string {
  const counts = new Map<number, number>();
  for (const [pos, card] of a.pay) {
    const c = colorAt(s, { pos, card });
    if (c !== null) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts]
    .sort((x, y) => x[0] - y[0])
    .map(([c, n]) => `${n} ${cargoName(c)}`)
    .join(' + ');
}

/** Engines a claim uses. */
export const enginesIn = (s: RowState, a: Claim): number =>
  a.pay.filter(([pos, card]) => colorAt(s, { pos, card }) === ENGINE).length;

export interface CharterLine {
  readonly pos: number;
  readonly index: number | null;
  readonly from: string;
  readonly to: string;
  readonly value: number | null;
  readonly done: boolean;
}

/** A seat's kept charters as this state knows them, with whether its own routes complete each. */
export function charterLines(s: RowState, seat: number): CharterLine[] {
  const owned = ownedRoutes(s.routes, seat);
  return (s.players[seat]?.charters ?? []).map((c) => {
    if (c.card === null) return { pos: c.pos, index: null, from: '?', to: '?', value: null, done: false };
    const index = c.card - CHARTER_OFFSET;
    const t = CHARTERS[index];
    return {
      pos: c.pos,
      index,
      from: t ? townName(t.a) : '?',
      to: t ? townName(t.b) : '?',
      value: t?.value ?? null,
      done: t !== undefined && connects(owned, t.a, t.b),
    };
  });
}

/** Each seat's longest line (C33). */
export const lines = (s: RowState): number[] =>
  s.players.map((_, seat) => longestLine(ownedRoutes(s.routes, seat)));

const PHASE_TEXT: Record<string, string> = {
  setup: 'setting up',
  keep: 'choose the charters to keep',
  turn: 'draw freight, lay track or draw charters',
  draw: 'take a second freight card',
  sift: 'drawing from the reshuffled pile',
  charters: 'choose the charters to keep',
  reveal: 'revealing the charters',
};

export function statusText(
  s: RowState,
  mySeat: number | null,
  names: readonly string[],
  ended: boolean,
): string {
  if (ended || s.phase === 'over') {
    const winners =
      s.result?.places.flatMap((p, i) => (p === 1 ? [names[i] ?? `Player ${i + 1}`] : [])) ?? [];
    return s.result
      ? `${winners.join(' and ')} ${winners.length === 1 ? 'wins' : 'share first place'}.`
      : 'The game has ended.';
  }
  if (s.phase === 'reveal') return 'The game is over: revealing every charter…';
  if (s.startingSeat === null) return 'Choosing the first player…';
  const who = s.turn === mySeat ? 'Your turn' : `${names[s.turn] ?? `Player ${s.turn + 1}`}'s turn`;
  const final =
    s.finalTurns !== null ? ` Final round: ${s.finalTurns} turn${s.finalTurns === 1 ? '' : 's'} left.` : '';
  return `${who}: ${PHASE_TEXT[s.phase] ?? s.phase}.${final}`;
}

/** The pile line: "62 cards in the pile · 8 discards". */
export function pileText(s: RowState): string {
  const n = pileCount(s.pile);
  return `${n} card${n === 1 ? '' : 's'} in the pile · ${s.discards.length} discard${s.discards.length === 1 ? '' : 's'}`;
}

/** "Saltmere – Yarrowfen", or "Not revealed yet" for a charter this state does not know. */
export function charterTowns(index: number | null): string {
  const t = index === null ? undefined : CHARTERS[index];
  return t === undefined ? 'Not revealed yet' : `${townName(t.a)} – ${townName(t.b)}`;
}
