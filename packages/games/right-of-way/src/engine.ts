/*
 * The Right of Way rules engine (docs/games/right-of-way/RULES.md). Pure: `apply` never throws or mutates, and
 * every move has one accepted encoding. Positions and cards are packet ids (deck.ts).
 */
import type { ApplyResult, DealtPosition, Learn, Pending, Result, SetupInput } from '@bored-games/game-kit';
import {
  CHARTER_COUNT,
  CHARTER_GROUP,
  CHARTER_OFFSET,
  DECK_ID,
  DECK_SIZE,
  ENGINE,
  FREIGHT_SIZE,
  freightColor,
  GROUPS,
  type Group,
  groupOf,
} from './deck.ts';
import { CHARTERS, ROUTE_COLORS, ROUTES } from './map.ts';
import { charterDone, longestLine, ownedRoutes, RIBBON_POINTS, ROUTE_POINTS, TRACK } from './scoring.ts';
import type { HandCard, Pile, RowAction, RowEvent, RowPlayer, RowRules, RowState, Slot } from './types.ts';

export const DEFAULT_RULES: RowRules = { map: 'ferrovia' };
const HAND = 4;
const YARD = 5;
const FIRST_CHARTERS = 3;
const MAX_WIPES = 3;
const GRAY = ROUTE_COLORS.indexOf('gray');

const failure = (message: string) => ({ ok: false as const, error: { code: 'invalid', message } });
const int = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0);
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x: Record<string, unknown>, ks: readonly string[]): boolean =>
  Object.keys(x).sort().join(',') === [...ks].sort().join(',');
const list = (x: unknown): x is unknown[] => Array.isArray(x) && Object.keys(x).length === x.length;
const ascending = (xs: readonly number[]): boolean =>
  xs.every((x, i) => i === 0 || x > (xs[i - 1] as number));
const group = (g: number): Group => GROUPS[g] as Group;

export function validateRules(raw: unknown): Result<RowRules> {
  try {
    if (obj(raw) && keys(raw, ['map']) && raw.map === 'ferrovia') return { ok: true, value: DEFAULT_RULES };
    return failure("Rules must be { map: 'ferrovia' }.");
  } catch {
    return failure('Invalid rules.');
  }
}

/* ------------------------------------------------------------------------------------------- parsing */

export function parseAction(raw: unknown): RowAction | null {
  try {
    if (!obj(raw) || typeof raw.type !== 'string') return null;
    if (raw.type === 'reveal')
      return keys(raw, ['type', 'actor', 'deck', 'pos', 'card']) &&
        raw.actor === 'deck' &&
        raw.deck === DECK_ID &&
        int(raw.pos) &&
        int(raw.card)
        ? (raw as unknown as RowAction)
        : null;
    if (!int(raw.actor)) return null;
    switch (raw.type) {
      case 'take':
        return keys(raw, ['type', 'actor', 'slot']) && int(raw.slot) ? (raw as unknown as RowAction) : null;
      case 'blind':
      case 'charters':
      case 'pass':
        return keys(raw, ['type', 'actor']) ? (raw as unknown as RowAction) : null;
      case 'sift':
        return keys(raw, ['type', 'actor', 'card']) && (raw.card === null || int(raw.card))
          ? (raw as unknown as RowAction)
          : null;
      case 'keep':
        return keys(raw, ['type', 'actor', 'keep']) &&
          list(raw.keep) &&
          raw.keep.every(int) &&
          ascending(raw.keep as number[])
          ? (raw as unknown as RowAction)
          : null;
      case 'claim': {
        if (!keys(raw, ['type', 'actor', 'route', 'side', 'pay']) || !int(raw.route) || !int(raw.side))
          return null;
        if (!list(raw.pay)) return null;
        const pay = raw.pay;
        if (!pay.every((p) => list(p) && p.length === 2 && int(p[0]) && int(p[1]))) return null;
        if (!ascending(pay.map((p) => (p as number[])[0] as number))) return null;
        return raw as unknown as RowAction;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------ the pile */

/** The freight id (0–109) a known card at `pos` stands for, or null when it stands for none. */
export function freightOf(s: RowState, pos: number, card: number | null): number | null {
  if (card === null) return null;
  const g = groupOf(pos);
  if (g < 0 || g === CHARTER_GROUP || groupOf(card) !== g) return null;
  if (g === 0) return card;
  const epoch = s.epochs.find((e) => e.group === g);
  const v = card - group(g).offset;
  return epoch !== undefined && v < epoch.list.length ? (epoch.list[v] as number) : null;
}

/** A known card's colour index (0–7 or ENGINE), or null. */
export function colorAt(s: RowState, slot: Slot): number | null {
  const f = freightOf(s, slot.pos, slot.card);
  return f === null ? null : freightColor(f);
}

/** Cards left in the draw pile (public). */
export function pileCount(p: Pile): number {
  return p.group === 0 ? FREIGHT_SIZE - p.next : p.members - p.found;
}

const pendingYard = (s: RowState): number => s.yard.filter((y) => y !== null && y.card === null).length;

/**
 * Cards the pile can still give that no pending reveal has claimed. A freight-deck slot uses its position at once;
 * in a reshuffle a pending slot (or the card being sifted) may or may not be a discard, so it holds one back.
 */
export function pileLeft(s: RowState): number {
  if (s.pile.group === 0) return FREIGHT_SIZE - s.pile.next;
  return s.pile.members - s.pile.found - pendingYard(s) - (s.sift === null ? 0 : 1);
}

/** The smallest spare group not used yet with room for `n` discards, or null (C15). */
export function spareFor(s: RowState, n: number): number | null {
  let best: number | null = null;
  for (let g = 1; g < CHARTER_GROUP; g++) {
    if (s.epochs.some((e) => e.group === g) || group(g).size < n) continue;
    if (best === null || group(g).size < group(best).size) best = g;
  }
  return best;
}

export const canReshuffle = (s: RowState): boolean =>
  s.discards.length > 0 && spareFor(s, s.discards.length) !== null;

/** Whether a blind draw is possible now. */
export const blindOpen = (s: RowState): boolean => pileLeft(s) > 0 || canReshuffle(s);

/** Shuffle the discards into a new pile: a fresh spare group stands for them (C15). */
function reshuffle(s: RowState): RowState {
  const g = spareFor(s, s.discards.length);
  if (g === null || s.discards.length === 0) return s;
  return {
    ...s,
    epochs: [...s.epochs, { group: g, list: [...s.discards].sort((a, b) => a - b) }],
    pile: { group: g, next: group(g).offset, members: s.discards.length, found: 0 },
    discards: [],
  };
}

const known = (s: RowState, pos: number): number | null => (s.order === null ? null : (s.order[pos] ?? null));

/** Take the next pile position: the caller deals it. Returns the state with the pile advanced and the position. */
function nextPos(s: RowState): [RowState, number] {
  return [{ ...s, pile: { ...s.pile, next: s.pile.next + 1 } }, s.pile.next];
}

const deal = (s: RowState, pos: number, to: number | null): RowState => ({
  ...s,
  dealt: [...s.dealt, { deck: DECK_ID, pos, to }],
});

/**
 * Fill wanted yard slots from the pile, in slot order (C12). Never more slots wait for a public reveal than the
 * pile holds discards, so no discard is revealed that is not needed. When the pile is empty and `reshuffle` is
 * set (a card was taken from the yard, or wiped), the discards are reshuffled first; otherwise, or when they
 * cannot be, the slots stay empty (C16).
 */
function fill(s: RowState, mayReshuffle: boolean): RowState {
  let t = s;
  while (t.want.length > 0) {
    const slot = t.want[0] as number;
    if (pileLeft(t) > 0) {
      const [u, pos] = nextPos(t);
      t = deal(u, pos, null);
      t = { ...t, yard: t.yard.map((y, i) => (i === slot ? { pos, card: null } : y)), want: t.want.slice(1) };
    } else if (pendingYard(t) > 0) return t;
    else if (mayReshuffle && canReshuffle(t)) t = reshuffle(t);
    else t = { ...t, want: [] };
  }
  return t;
}

/** Every empty yard slot, in slot order. */
const emptySlots = (s: RowState): number[] => s.yard.flatMap((y, i) => (y === null ? [i] : []));

/* --------------------------------------------------------------------------------------------- setup */

export function setupGame(input: SetupInput<RowRules>): Result<RowState> {
  try {
    const rules = validateRules(input.rules);
    if (!rules.ok) return rules;
    if (!int(input.seats) || input.seats < 2 || input.seats > 5) return failure('Choose 2–5 players.');
    if (input.mode !== 'full' && input.mode !== 'view') return failure('Invalid mode.');
    if (input.mode === 'view' && input.viewer !== null && (!int(input.viewer) || input.viewer >= input.seats))
      return failure('Invalid viewer.');
    let order: number[] | null = null;
    if (input.mode === 'full') {
      const raw = input.deckOrders[DECK_ID];
      if (!Array.isArray(raw) || raw.length !== DECK_SIZE) return failure('Invalid rail order.');
      order = Array.from(raw);
      const seen = new Set<number>();
      for (let pos = 0; pos < DECK_SIZE; pos++) {
        const card = order[pos];
        if (!int(card) || card >= DECK_SIZE || seen.has(card) || groupOf(card) !== groupOf(pos))
          return failure('The rail order must shuffle each group within itself.');
        seen.add(card);
      }
    }
    const seats = input.seats;
    const viewer = input.mode === 'view' ? input.viewer : null;
    // A view learns its own cards later (learn); only the full state knows them at setup.
    const sees = (_seat: number, pos: number): number | null =>
      order !== null ? (order[pos] as number) : null;
    const dealt: DealtPosition[] = [];
    const players: RowPlayer[] = [];
    for (let seat = 0; seat < seats; seat++) {
      const hand: HandCard[] = [];
      for (let k = 0; k < HAND; k++) {
        const pos = seat * HAND + k;
        hand.push({ pos, card: sees(seat, pos), open: false });
        dealt.push({ deck: DECK_ID, pos, to: seat });
      }
      players.push({ hand, charters: [], offered: [], memory: [], track: TRACK, points: 0 });
    }
    const yard: Slot[] = [];
    for (let k = 0; k < YARD; k++) {
      const pos = seats * HAND + k;
      yard.push({ pos, card: null });
      dealt.push({ deck: DECK_ID, pos, to: null });
    }
    for (let seat = 0; seat < seats; seat++) {
      const offered: Slot[] = [];
      for (let k = 0; k < FIRST_CHARTERS; k++) {
        const pos = CHARTER_OFFSET + seat * FIRST_CHARTERS + k;
        offered.push({ pos, card: sees(seat, pos) });
        dealt.push({ deck: DECK_ID, pos, to: seat });
      }
      players[seat] = { ...(players[seat] as RowPlayer), offered };
    }
    const charterPile = Array.from(
      { length: CHARTER_COUNT - seats * FIRST_CHARTERS },
      (_, k) => CHARTER_OFFSET + seats * FIRST_CHARTERS + k,
    );
    return {
      ok: true,
      value: {
        game: 'right-of-way',
        rules: rules.value,
        seats,
        mode: input.mode,
        viewer,
        order,
        dealt,
        yard,
        want: [],
        pile: { group: 0, next: seats * HAND + YARD, members: FREIGHT_SIZE, found: 0 },
        epochs: [],
        discards: [],
        charterPile,
        routes: ROUTES.map((r) => r.sides.map(() => null)),
        players,
        startingSeat: null,
        turn: 0,
        phase: 'setup',
        kept: 0,
        drawn: 0,
        sift: null,
        finalTurns: null,
        passes: 0,
        wipes: 0,
        endReveal: [],
        result: null,
        seq: 0,
      },
    };
  } catch {
    return failure('Invalid setup.');
  }
}

/* ------------------------------------------------------------------------------------------- pending */

export function pendingOf(s: RowState): Pending {
  const yard = s.yard.flatMap((y) => (y !== null && y.card === null ? [y.pos] : []));
  if (yard.length > 0) return { type: 'reveal', deck: DECK_ID, positions: yard };
  if (s.phase === 'reveal' && s.endReveal.length > 0)
    return { type: 'reveal', deck: DECK_ID, positions: [...s.endReveal] };
  if (s.phase === 'over') return { type: 'over' };
  return { type: 'player', seat: s.turn, decision: s.phase };
}

/* -------------------------------------------------------------------------------------------- routes */

/** Whether `seat` may lay track on `side` of route `ri` (C24–C26). */
export function sideOpen(s: RowState, ri: number, side: number, seat: number): boolean {
  const sides = s.routes[ri];
  if (sides === undefined || side >= sides.length || sides[side] !== null) return false;
  if (sides.length === 2) {
    const other = sides[1 - side];
    if (other !== null && (s.seats <= 3 || other === seat)) return false;
  }
  return true;
}

/**
 * The one accepted payment of `length` cards with `e` Engines and the rest in `color` (C19): the lowest positions
 * of each kind, as [position, card] pairs ascending by position.
 */
function canonicalPay(
  byColor: readonly Slot[][],
  color: number | null,
  e: number,
  length: number,
): [number, number][] {
  const cards = [
    ...(color === null ? [] : (byColor[color] ?? []).slice(0, length - e)),
    ...(byColor[ENGINE] ?? []).slice(0, e),
  ];
  return cards.sort((a, b) => a.pos - b.pos).map((h) => [h.pos, h.card as number]);
}

/** A hand's known cards by colour index (0–7, ENGINE), each list ascending by position; null if any is unknown. */
function handByColor(s: RowState, seat: number): Slot[][] | null {
  const byColor: Slot[][] = Array.from({ length: ENGINE + 1 }, () => []);
  for (const h of [...(s.players[seat] as RowPlayer).hand].sort((a, b) => a.pos - b.pos)) {
    const c = colorAt(s, h);
    if (c === null) return null;
    (byColor[c] as Slot[]).push(h);
  }
  return byColor;
}

/** The claims `seat` can make with its hand (every card known), each with its canonical payment (C19). */
export function claimOptions(s: RowState, seat: number): RowAction[] {
  const p = s.players[seat] as RowPlayer;
  const byColor = handByColor(s, seat);
  if (byColor === null) return [];
  const engines = byColor[ENGINE] as Slot[];
  const out: RowAction[] = [];
  const push = (ri: number, side: number, color: number | null, e: number, length: number): void => {
    out.push({ type: 'claim', actor: seat, route: ri, side, pay: canonicalPay(byColor, color, e, length) });
  };
  ROUTES.forEach((r, ri) => {
    r.sides.forEach((routeColor, side) => {
      if (r.length > p.track || !sideOpen(s, ri, side, seat)) return;
      const L = r.length;
      const E = engines.length;
      if (E >= L) push(ri, side, null, L, L);
      const colors = routeColor === 'gray' ? [0, 1, 2, 3, 4, 5, 6, 7] : [ROUTE_COLORS.indexOf(routeColor)];
      for (const c of colors) {
        const n = (byColor[c] as Slot[]).length;
        for (let e = Math.max(0, L - n); e <= Math.min(E, L - 1); e++) push(ri, side, c, e, L);
      }
    });
  });
  return out;
}

/* ------------------------------------------------------------------------------------------- choices */

const secondOptions = (s: RowState, seat: number): RowAction[] => {
  const out: RowAction[] = [];
  s.yard.forEach((y, slot) => {
    if (y !== null && y.card !== null && colorAt(s, y) !== ENGINE)
      out.push({ type: 'take', actor: seat, slot });
  });
  if (blindOpen(s)) out.push({ type: 'blind', actor: seat });
  return out;
};

/** Every subset of `n` indexes with at least `min` members, as ascending lists. */
function subsets(n: number, min: number): number[][] {
  const out: number[][] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const keep = Array.from({ length: n }, (_, i) => i).filter((i) => (mask >> i) & 1);
    if (keep.length >= min) out.push(keep);
  }
  return out;
}

export function legalActions(s: RowState, seat: number): RowAction[] {
  const pending = pendingOf(s);
  if (pending.type !== 'player' || pending.seat !== seat) return [];
  const p = s.players[seat] as RowPlayer;
  switch (s.phase) {
    case 'keep':
    case 'charters': {
      // The choice is the seat's to make once it can read the charters (and the session can tell who stalls).
      if (p.offered.some((c) => c.card === null)) return [];
      const min = s.phase === 'keep' ? 2 : 1;
      return subsets(p.offered.length, Math.min(min, p.offered.length)).map((keep) => ({
        type: 'keep',
        actor: seat,
        keep,
      }));
    }
    case 'sift': {
      const sift = s.sift;
      if (sift === null || sift.card === null) return [];
      const v = sift.card - group(groupOf(sift.pos)).offset;
      return [{ type: 'sift', actor: seat, card: v < s.pile.members ? null : sift.card }];
    }
    case 'draw':
      return secondOptions(s, seat);
    case 'turn': {
      if (p.hand.some((h) => h.card === null)) return [];
      const out: RowAction[] = [];
      s.yard.forEach((y, slot) => {
        if (y !== null && y.card !== null) out.push({ type: 'take', actor: seat, slot });
      });
      if (blindOpen(s)) out.push({ type: 'blind', actor: seat });
      out.push(...claimOptions(s, seat));
      if (s.charterPile.length > 0) out.push({ type: 'charters', actor: seat });
      return out.length > 0 ? out : [{ type: 'pass', actor: seat }];
    }
    default:
      return [];
  }
}

/* ----------------------------------------------------------------------------------------- the turn */

function endGame(s: RowState): RowState {
  const endReveal = s.players.flatMap((p) => p.charters.map((c) => c.pos));
  let t: RowState = { ...s, phase: 'reveal', endReveal, sift: null };
  for (const pos of endReveal) t = deal(t, pos, null);
  return t;
}

function endTurn(s: RowState, passed: boolean): RowState {
  const passes = passed ? s.passes + 1 : 0;
  let t: RowState = { ...s, passes, sift: null, drawn: 0 };
  if (passes >= s.seats) return endGame(t);
  if (t.finalTurns !== null) {
    const finalTurns = t.finalTurns - 1;
    if (finalTurns === 0) return endGame({ ...t, finalTurns });
    t = { ...t, finalTurns };
  } else if ((t.players[t.turn] as RowPlayer).track <= 2) t = { ...t, finalTurns: t.seats };
  return { ...t, phase: 'turn', turn: (t.turn + 1) % t.seats };
}

/** After a freight card joins the hand: the second card, or the end of the turn (C08). */
function afterCard(s: RowState): RowState {
  return s.drawn === 0 ? { ...s, phase: 'draw', drawn: 1, sift: null } : endTurn(s, false);
}

function score(s: RowState): RowState {
  const owned = s.players.map((_, seat) => ownedRoutes(s.routes, seat));
  const lines = owned.map(longestLine);
  const best = Math.max(...lines);
  const ribbon = lines.map((n) => best > 0 && n === best);
  const done = s.players.map((p, seat) =>
    p.charters.filter(
      (c) => c.card !== null && charterDone(owned[seat] as number[], c.card - CHARTER_OFFSET),
    ),
  );
  const scores = s.players.map((p, seat) => {
    let n = p.points + (ribbon[seat] ? RIBBON_POINTS : 0);
    for (const c of p.charters) {
      const t = (c.card as number) - CHARTER_OFFSET;
      const value = CHARTERS[t]?.value ?? 0;
      n += charterDone(owned[seat] as number[], t) ? value : -value;
    }
    return n;
  });
  const key = (seat: number): [number, number, number] => [
    scores[seat] as number,
    (done[seat] as Slot[]).length,
    ribbon[seat] ? 1 : 0,
  ];
  const beats = (a: [number, number, number], b: [number, number, number]): boolean =>
    a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
  const places = s.players.map((_, i) => 1 + s.players.filter((__, j) => beats(key(j), key(i))).length);
  const reason = s.passes >= s.seats ? 'stall' : 'line';
  return { ...s, phase: 'over', result: { scores, places, reason } };
}

/** Choose the first player from the setup yard, in slot order, when its cards are known (C06). */
function chooseStart(s: RowState): RowState {
  if (s.startingSeat !== null) return s;
  const limit = FREIGHT_SIZE - (FREIGHT_SIZE % s.seats);
  for (const y of s.yard) {
    if (y === null || y.card === null) return s;
    if (y.card < limit) {
      const start = y.card % s.seats;
      return { ...s, startingSeat: start, turn: start, phase: 'keep', kept: 0 };
    }
  }
  return s;
}

/** Everything that follows on its own once the yard is settled: the first player, wipes, short draws, scoring. */
function settle(s: RowState): RowState {
  let t = s;
  for (;;) {
    // Empty slots refill whenever the pile has cards; only a take or a wipe reshuffles for them (C12, C16).
    if (
      (t.phase === 'turn' || t.phase === 'keep') &&
      t.want.length === 0 &&
      pileLeft(t) > 0 &&
      emptySlots(t).length > 0
    )
      t = { ...t, want: emptySlots(t) };
    t = fill(t, false);
    if (pendingYard(t) > 0 || t.want.length > 0) return t;
    t = chooseStart(t);
    const engines = t.yard.filter((y) => y !== null && colorAt(t, y) === ENGINE).length;
    if (engines >= 3 && t.wipes < MAX_WIPES) {
      // The wipe (C13), at most three in a row (C14).
      const wiped = t.yard.flatMap((y) => {
        const f = y === null ? null : freightOf(t, y.pos, y.card);
        return f === null ? [] : [f];
      });
      t = fill(
        {
          ...t,
          wipes: t.wipes + 1,
          discards: [...t.discards, ...wiped],
          yard: t.yard.map(() => null),
          want: t.yard.map((_, i) => i),
        },
        true,
      );
      continue;
    }
    if (t.phase === 'draw' && secondOptions(t, t.turn).length === 0) {
      t = endTurn(t, false);
      continue;
    }
    if (t.phase === 'reveal' && t.endReveal.length === 0) return score(t);
    return t;
  }
}

function applyReveal(s: RowState, a: Extract<RowAction, { type: 'reveal' }>): RowState | string {
  const g = groupOf(a.pos);
  if (g < 0 || groupOf(a.card) !== g) return 'The reveal is outside its group.';
  const full = known(s, a.pos);
  if (full !== null && full !== a.card) return 'The reveal does not match the shuffled deck.';
  if (s.endReveal.includes(a.pos)) {
    if (pendingOf(s).type !== 'reveal' || s.yard.some((y) => y !== null && y.card === null))
      return 'Unexpected reveal.';
    if (g !== CHARTER_GROUP) return 'Not a charter.';
    const seat = s.players.findIndex((p) => p.charters.some((c) => c.pos === a.pos));
    const held = s.players[seat]?.charters.find((c) => c.pos === a.pos);
    if (held === undefined || (held.card !== null && held.card !== a.card))
      return 'The reveal is not the held charter.';
    if (s.players.some((p) => p.charters.some((c) => c.pos !== a.pos && c.card === a.card)))
      return 'Duplicate charter.';
    return {
      ...s,
      endReveal: s.endReveal.filter((p) => p !== a.pos),
      players: s.players.map((p, i) =>
        i === seat
          ? { ...p, charters: p.charters.map((c) => (c.pos === a.pos ? { ...c, card: a.card } : c)) }
          : p,
      ),
    };
  }
  const slot = s.yard.findIndex((y) => y !== null && y.pos === a.pos && y.card === null);
  if (slot < 0) return 'Unexpected reveal.';
  if (g === 0) {
    const seenElsewhere =
      s.yard.some((y) => y?.card === a.card) ||
      s.players.some((p) => p.hand.some((h) => h.card === a.card && groupOf(h.pos) === 0));
    if (seenElsewhere) return 'Duplicate freight card.';
    return { ...s, yard: s.yard.map((y, i) => (i === slot ? { pos: a.pos, card: a.card } : y)) };
  }
  if (g !== s.pile.group) return 'The reveal is not from the pile.';
  const v = a.card - group(g).offset;
  if (v >= s.pile.members) {
    // Not one of the reshuffled discards: skip it and take the next card of the pile for this slot (C15).
    const want = [...s.want, slot].sort((x, y) => x - y);
    return fill({ ...s, yard: s.yard.map((y, i) => (i === slot ? null : y)), want }, true);
  }
  if (s.yard.some((y) => y?.card === a.card) || s.players.some((p) => p.hand.some((h) => h.card === a.card)))
    return 'Duplicate freight card.';
  return {
    ...s,
    yard: s.yard.map((y, i) => (i === slot ? { pos: a.pos, card: a.card } : y)),
    pile: { ...s.pile, found: s.pile.found + 1 },
  };
}

function applyClaim(s: RowState, a: Extract<RowAction, { type: 'claim' }>): RowState | string {
  if (s.phase !== 'turn') return 'Lay track only as a whole turn.';
  const r = ROUTES[a.route];
  if (r === undefined || a.side >= r.sides.length) return 'No such route.';
  const p = s.players[a.actor] as RowPlayer;
  if (!sideOpen(s, a.route, a.side, a.actor)) return 'That route is taken or closed.';
  if (r.length > p.track) return 'Not enough track.';
  if (a.pay.length !== r.length) return 'Pay as many cards as the route is long.';
  const colors: number[] = [];
  for (const [pos, card] of a.pay) {
    const h = p.hand.find((x) => x.pos === pos);
    if (h === undefined) return 'A paid card is not in hand.';
    if (h.card !== null && h.card !== card) return 'A paid card is not the card held.';
    const full = known(s, pos);
    if (full !== null && full !== card) return 'A paid card does not match the deck.';
    const f = freightOf(s, pos, card);
    if (f === null) return 'A paid card is not a freight card.';
    colors.push(freightColor(f));
  }
  const plain = [...new Set(colors.filter((c) => c !== ENGINE))];
  if (plain.length > 1) return 'Pay with one colour (and Engines).';
  const routeColor = ROUTE_COLORS.indexOf(r.sides[a.side] as (typeof ROUTE_COLORS)[number]);
  if (routeColor !== GRAY && plain.length === 1 && plain[0] !== routeColor) return 'Pay in the route colour.';
  // One accepted encoding (C19): where this state knows the whole hand, the payment must be the canonical one.
  const byColor = handByColor(s, a.actor);
  if (byColor !== null) {
    const color = plain.length === 1 ? (plain[0] as number) : null;
    const e = colors.filter((c) => c === ENGINE).length;
    if (JSON.stringify(canonicalPay(byColor, color, e, r.length)) !== JSON.stringify(a.pay))
      return 'Pay with your lowest cards of each kind.';
  }
  const paid = new Set(a.pay.map(([pos]) => pos));
  const discarded = a.pay.map(([pos, card]) => freightOf(s, pos, card) as number);
  return endTurn(
    {
      ...s,
      discards: [...s.discards, ...discarded],
      routes: s.routes.map((sides, i) =>
        i === a.route ? sides.map((o, k) => (k === a.side ? a.actor : o)) : sides,
      ),
      players: s.players.map((q, i) =>
        i === a.actor
          ? {
              ...q,
              hand: q.hand.filter((h) => !paid.has(h.pos)),
              track: q.track - r.length,
              points: q.points + (ROUTE_POINTS[r.length] as number),
            }
          : q,
      ),
    },
    false,
  );
}

/** Deal the next pile card to `seat`: into the hand (freight deck) or to sift (a reshuffle, C15). */
function blindDraw(s: RowState, seat: number): RowState {
  const t0 = pileLeft(s) === 0 ? reshuffle(s) : s;
  const [t1, pos] = nextPos(t0);
  const t = deal(t1, pos, seat);
  const card = known(t, pos);
  if (t.pile.group === 0)
    return afterCard({
      ...t,
      players: t.players.map((q, i) =>
        i === seat ? { ...q, hand: [...q.hand, { pos, card, open: false }] } : q,
      ),
    });
  return { ...t, phase: 'sift', sift: { pos, card } };
}

function applyPlayer(s: RowState, a: Exclude<RowAction, { type: 'reveal' }>): RowState | string {
  const p = s.players[a.actor] as RowPlayer;
  switch (a.type) {
    case 'take': {
      if (s.phase !== 'turn' && s.phase !== 'draw') return 'Not a freight draw now.';
      const y = s.yard[a.slot];
      if (y === undefined || y === null || y.card === null) return 'No card there.';
      const engine = colorAt(s, y) === ENGINE;
      if (engine && s.phase === 'draw') return 'A face-up Engine cannot be the second card.';
      const yard = s.yard.map((x, i) => (i === a.slot ? null : x));
      const t = fill(
        {
          ...s,
          yard,
          want: emptySlots({ ...s, yard }),
          players: s.players.map((q, i) =>
            i === a.actor ? { ...q, hand: [...q.hand, { pos: y.pos, card: y.card, open: true }] } : q,
          ),
        },
        true,
      );
      return engine ? endTurn(t, false) : afterCard(t);
    }
    case 'blind':
      if (s.phase !== 'turn' && s.phase !== 'draw') return 'Not a freight draw now.';
      if (!blindOpen(s)) return 'The pile is empty.';
      return blindDraw(s, a.actor);
    case 'sift': {
      if (s.phase !== 'sift' || s.sift === null) return 'Nothing to sift.';
      const sift = s.sift;
      const offset = group(groupOf(sift.pos)).offset;
      if (a.card === null) {
        if (sift.card !== null && sift.card - offset >= s.pile.members) return 'That card is not a discard.';
        const t: RowState = {
          ...s,
          pile: { ...s.pile, found: s.pile.found + 1 },
          players: s.players.map((q, i) =>
            i === a.actor ? { ...q, hand: [...q.hand, { pos: sift.pos, card: sift.card, open: false }] } : q,
          ),
        };
        return afterCard(t);
      }
      if (groupOf(a.card) !== groupOf(sift.pos) || a.card - offset < s.pile.members)
        return 'Keep a discard card.';
      if (sift.card !== null && sift.card !== a.card) return 'That is not the card drawn.';
      // A skipped card stands for nothing; draw again (C15).
      return blindDraw({ ...s, sift: null }, a.actor);
    }
    case 'claim':
      return applyClaim(s, a);
    case 'charters': {
      if (s.phase !== 'turn') return 'Draw charters only as a whole turn.';
      if (s.charterPile.length === 0) return 'No charters are left.';
      const take = s.charterPile.slice(0, 3);
      let t: RowState = { ...s, charterPile: s.charterPile.slice(take.length), phase: 'charters' };
      for (const pos of take) t = deal(t, pos, a.actor);
      const offered = take.map((pos) => ({
        pos,
        card: known(t, pos) ?? p.memory.find((m) => m.pos === pos)?.card ?? null,
      }));
      return {
        ...t,
        players: t.players.map((q, i) =>
          i === a.actor ? { ...q, offered, memory: q.memory.filter((m) => !take.includes(m.pos)) } : q,
        ),
      };
    }
    case 'keep': {
      if (s.phase !== 'keep' && s.phase !== 'charters') return 'No charters to keep.';
      const min = Math.min(s.phase === 'keep' ? 2 : 1, p.offered.length);
      if (a.keep.length < min || a.keep.some((k) => k >= p.offered.length))
        return 'Keep enough of the charters.';
      const kept = p.offered.filter((_, i) => a.keep.includes(i));
      const back = p.offered.filter((_, i) => !a.keep.includes(i));
      const t: RowState = {
        ...s,
        charterPile: [...s.charterPile, ...back.map((c) => c.pos)],
        players: s.players.map((q, i) =>
          i === a.actor
            ? { ...q, charters: [...q.charters, ...kept], offered: [], memory: [...q.memory, ...back] }
            : q,
        ),
      };
      if (s.phase === 'charters') return endTurn(t, false);
      const done = s.kept + 1;
      return done === s.seats
        ? { ...t, kept: done, phase: 'turn', turn: s.startingSeat as number }
        : { ...t, kept: done, turn: (s.turn + 1) % s.seats };
    }
    case 'pass': {
      if (s.phase !== 'turn') return 'Pass only as a whole turn.';
      // Where this state knows the hand, a pass is legal only when nothing else is (the audit checks the rest).
      if (handByColor(s, a.actor) !== null && legalActions(s, a.actor).some((b) => b.type !== 'pass'))
        return 'A pass is allowed only when nothing else is.';
      if (blindOpen(s) || s.charterPile.length > 0 || s.yard.some((y) => y?.card != null))
        return 'A pass is allowed only when nothing else is.';
      return endTurn(s, true);
    }
  }
}

export function applyAction(s: RowState, raw: unknown): ApplyResult<RowState, RowEvent> {
  try {
    const a = parseAction(raw);
    if (a === null) return failure('Malformed action.');
    const pending = pendingOf(s);
    let next: RowState | string;
    if (a.type === 'reveal') {
      if (pending.type !== 'reveal' || !pending.positions.includes(a.pos))
        return failure('Unexpected public reveal.');
      next = applyReveal(s, a);
    } else {
      if (pending.type !== 'player' || pending.seat !== a.actor) return failure('It is not your decision.');
      next = applyPlayer({ ...s, wipes: 0 }, a);
    }
    if (typeof next === 'string') return failure(next);
    return { ok: true, state: { ...settle(next), seq: s.seq + 1 }, events: [{ type: 'acted', action: a }] };
  } catch {
    return failure('Invalid action.');
  }
}

/* ---------------------------------------------------------------------------------------- knowledge */

export function learnCard(s: RowState, l: Learn): ApplyResult<RowState, RowEvent> {
  try {
    if (s.mode !== 'view' || s.viewer === null || l.deck !== DECK_ID || !int(l.pos) || !int(l.card))
      return failure('Invalid private card.');
    if (groupOf(l.pos) < 0 || groupOf(l.card) !== groupOf(l.pos))
      return failure('The card is outside its group.');
    const seat = s.viewer;
    const p = s.players[seat] as RowPlayer;
    const fit = (x: Slot): boolean => x.pos === l.pos && x.card === null;
    if (s.phase === 'sift' && s.turn === seat && s.sift !== null && fit(s.sift))
      return { ok: true, state: { ...s, sift: { pos: l.pos, card: l.card } }, events: [] };
    const set = <T extends Slot>(xs: readonly T[]): T[] =>
      xs.map((x) => (fit(x) ? { ...x, card: l.card } : x));
    if (p.hand.some((h) => fit(h) && !h.open) || p.offered.some(fit) || p.charters.some(fit))
      return {
        ok: true,
        state: {
          ...s,
          players: s.players.map((q, i) =>
            i === seat ? { ...q, hand: set(q.hand), offered: set(q.offered), charters: set(q.charters) } : q,
          ),
        },
        events: [],
      };
    return failure('The card is not privately assigned to this viewer.');
  } catch {
    return failure('Invalid private card.');
  }
}

/** Everything `seat` privately knows in a full state (C38). */
export function knownTo(s: RowState, seat: number): Learn[] {
  const p = s.players[seat];
  if (p === undefined) return [];
  const out: Learn[] = [];
  const add = (x: Slot): void => {
    if (x.card !== null) out.push({ deck: DECK_ID, pos: x.pos, card: x.card });
  };
  p.hand.filter((h) => !h.open).forEach(add);
  if (s.phase === 'sift' && s.turn === seat && s.sift !== null) add(s.sift);
  p.offered.forEach(add);
  p.charters.forEach(add);
  p.memory.forEach(add);
  return out;
}

export function viewOf(s: RowState, viewer: number | null): RowState {
  const shown = (pos: number): boolean =>
    (s.phase === 'reveal' || s.phase === 'over') && !s.endReveal.includes(pos);
  const hide = <T extends Slot>(x: T): T => ({ ...x, card: null });
  return {
    ...s,
    mode: 'view',
    viewer,
    order: null,
    sift: s.sift === null || s.turn === viewer ? s.sift : hide(s.sift),
    players: s.players.map((p, seat) =>
      seat === viewer
        ? p
        : {
            ...p,
            hand: p.hand.map((h) => (h.open ? h : hide(h))),
            offered: p.offered.map(hide),
            memory: p.memory.map(hide),
            charters: p.charters.map((c) => (shown(c.pos) ? c : hide(c))),
          },
    ),
  };
}

/** Public scores: route points during play, the final scores once the game is over. */
export const standingsOf = (s: RowState): number[] =>
  s.result?.scores.slice() ?? s.players.map((p) => p.points);

export const charterIndex = (card: number): number => card - CHARTER_OFFSET;
export { CHARTER_COUNT, GROUPS };
