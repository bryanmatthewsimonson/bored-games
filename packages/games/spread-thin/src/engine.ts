/*
 * The Spread Thin rules engine (docs/games/spread-thin/RULES.md, D096). Pure: plain JSON in and out, never throws,
 * never mutates. One encrypted deck, `pile`, holds every card; each card is turned up by a public reveal with
 * prompt shares (D075), and a surge's restack reshuffles the spent spread cards as a deck epoch (D073).
 *
 * A player action is accepted exactly when it is one of `legalActions` (canonical JSON), so every move has exactly one
 * encoding. The automatic steps (the draw, the surges, the spread) run in `advance` until the game needs a reveal, a
 * reshuffle or a decision.
 */
import {
  type ApplyResult,
  canonicalJson,
  type Outcome,
  type Pending,
  packetOrderFits,
  type Result,
  type SetupInput,
} from '@bored-games/game-kit';
import {
  ACTIONS_PER_TURN,
  CASES_PER_STRAIN,
  CLINIC_LIMIT,
  CURE_CARDS,
  DECK_ID,
  deckOf,
  EPOCH_STRIDE,
  FIELD_BASE,
  HAND_LIMIT,
  HAND_SIZES,
  isRelief,
  MAX_CASES,
  MAX_SEATS,
  MIN_SEATS,
  OPENING_INFECTION,
  pilesOf,
  type Relief,
  ROLES,
  type Role,
  reliefCard,
  reliefOf,
  roleBase,
  SPILL_LIMIT,
  SPREAD_RATES,
  SURGE_BASE,
  VIROLOGIST_CURE_CARDS,
} from './data.ts';
import { CITY_COUNT, NEIGHBOURS, POPULATION, START_CITY, STRAIN_COUNT, strainOf } from './map.ts';
import type {
  Entry,
  LossReason,
  PileItem,
  Reveal,
  RevealPurpose,
  SpreadAction,
  SpreadEvent,
  SpreadRules,
  SpreadState,
  Window,
} from './types.ts';

export const DEFAULT_RULES: SpreadRules = { rulesVersion: 1, surges: 5 };
/** The most history lines the state keeps. */
export const HISTORY_LIMIT = 80;
/** The spread cards Early Warning looks at (C22). */
export const WARNING_CARDS = 6;

/* --------------------------------------------------------------------------------------------- helpers */

const int = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0);
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x: Record<string, unknown>, ks: readonly string[]): boolean =>
  Object.keys(x).sort().join(',') === [...ks].sort().join(',');
const fail = (message: string): ApplyResult<SpreadState, SpreadEvent> => ({
  ok: false,
  error: { code: 'invalid', message },
});
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const sorted = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);

/** Record a history line and its event. */
function note(s: SpreadState, ev: SpreadEvent[], entry: Entry): SpreadState {
  ev.push({ ...entry, type: entry.kind } as SpreadEvent);
  return { ...s, history: [...s.history, entry].slice(-HISTORY_LIMIT) };
}

export const roleOf = (s: SpreadState, seat: number): Role | null => ROLES[s.roles[seat] ?? -1] ?? null;
const seatWithRole = (s: SpreadState, role: Role): number => s.roles.indexOf(ROLES.indexOf(role));
const handOf = (s: SpreadState, seat: number): readonly number[] => s.hands[seat] ?? [];
const atOf = (s: SpreadState, seat: number): number => s.at[seat] ?? START_CITY;

/** Cases of `strain` on the board. */
export const onBoard = (s: SpreadState, strain: number): number => sum(s.cases.map((c) => c[strain] ?? 0));
/** Case tokens of `strain` left in the supply (C21). */
export const supplyOf = (s: SpreadState, strain: number): number => CASES_PER_STRAIN - onBoard(s, strain);
export const spreadRate = (s: SpreadState): number => SPREAD_RATES[s.rate] ?? 4;
export const curesFound = (s: SpreadState): number => s.cured.filter(Boolean).length;

/** Seats in turn order from `from`, `from` first. */
const fromSeat = (seats: number, from: number): number[] =>
  Array.from({ length: seats }, (_, k) => (from + k) % seats);

const withSeat = <T>(xs: readonly T[], seat: number, v: T): T[] => xs.map((x, i) => (i === seat ? v : x));
const withCases = (s: SpreadState, city: number, strain: number, n: number): SpreadState => ({
  ...s,
  cases: s.cases.map((c, i) => (i === city ? c.map((m, k) => (k === strain ? n : m)) : c)),
});

/** The relief cards `seat` may play: those in its hand, and its stored one. */
export function reliefsHeld(s: SpreadState, seat: number): number[] {
  const own = handOf(s, seat).filter(isRelief);
  const stored = s.stored[seat] ?? null;
  return stored === null ? own : sorted([...own, stored]);
}

/* ------------------------------------------------------------------------------------------ rules, setup */

export function validateRules(raw: unknown): Result<SpreadRules> {
  if (
    !obj(raw) ||
    !keys(raw, ['rulesVersion', 'surges']) ||
    raw.rulesVersion !== 1 ||
    (raw.surges !== 4 && raw.surges !== 5 && raw.surges !== 6)
  )
    return {
      ok: false,
      error: { code: 'rules', message: 'Spread Thin rules are { rulesVersion: 1, surges: 4 | 5 | 6 }' },
    };
  return { ok: true, value: { rulesVersion: 1, surges: raw.surges } };
}

export function setupGame(input: SetupInput<SpreadRules>): Result<SpreadState> {
  const rules = validateRules(input.rules);
  if (!rules.ok) return rules;
  if (!int(input.seats) || input.seats < MIN_SEATS || input.seats > MAX_SEATS)
    return { ok: false, error: { code: 'seats', message: 'Spread Thin is played by 2 to 4 players' } };
  const seats = input.seats;
  let plain: Record<string, number> | null = null;
  if (input.mode === 'full') {
    const order = input.deckOrders[DECK_ID];
    if (order === undefined || !packetOrderFits(deckOf(rules.value, seats), order))
      return { ok: false, error: { code: 'deck', message: 'The deck order must fit the deck.' } };
    plain = Object.fromEntries(order.map((card, pos) => [String(pos), card]));
  } else if (input.viewer !== null && (!int(input.viewer) || input.viewer >= seats))
    return { ok: false, error: { code: 'viewer', message: 'Invalid viewer.' } };
  const hand = (HAND_SIZES[seats] ?? 2) * seats;
  const s: SpreadState = {
    game: 'spread-thin',
    rules: rules.value,
    seats,
    phase: 'setup',
    turn: 0,
    turnNo: 0,
    actions: 0,
    flew: false,
    roles: Array.from({ length: seats }, () => -1),
    hands: Array.from({ length: seats }, () => []),
    stored: Array.from({ length: seats }, () => null),
    at: Array.from({ length: seats }, () => START_CITY),
    cases: Array.from({ length: CITY_COUNT }, () => [0, 0, 0, 0]),
    clinics: [START_CITY],
    cured: [false, false, false, false],
    stamped: [false, false, false, false],
    spills: 0,
    rate: 0,
    field: pilesOf(rules.value, seats).flat(),
    discard: [],
    removed: [],
    surgesDrawn: 0,
    pile: [],
    spent: [],
    purged: [],
    epoch: 0,
    surges: 0,
    surgeStep: 'rise',
    spreadStep: 'window',
    spreadLeft: null,
    quiet: false,
    reveal: null,
    shuffling: false,
    window: null,
    arrange: null,
    dealt: [],
    plain,
    history: [],
    result: null,
  };
  // The roles, the opening hands and the nine opening spread cards are turned up together (C02–C04).
  const roles = Array.from({ length: seats }, (_, i) => roleBase(rules.value) + i);
  const hands = Array.from({ length: hand }, (_, i) => FIELD_BASE + i);
  const spread = OPENING_INFECTION.map((_, i) => i);
  return { ok: true, value: requestReveal(s, [...roles, ...hands, ...spread], 'setup', null) };
}

/* --------------------------------------------------------------------------------------------- pending */

/** The seat that must discard down to the hand limit now, or null (C19: not until the draw's surges are resolved). */
export function overLimit(s: SpreadState): number | null {
  if (s.phase === 'draw' || s.phase === 'surge' || s.phase === 'setup' || s.phase === 'over') return null;
  return fromSeat(s.seats, s.turn).find((seat) => handOf(s, seat).length > HAND_LIMIT) ?? null;
}

export function pendingOf(s: SpreadState): Pending {
  if (s.phase === 'over') return { type: 'over' };
  if (s.reveal !== null) {
    const done = s.reveal.cards;
    return {
      type: 'reveal',
      deck: DECK_ID,
      positions: sorted(s.reveal.positions.filter((p) => done[String(p)] === undefined)),
    };
  }
  if (s.shuffling)
    return {
      type: 'shuffle',
      deck: DECK_ID,
      epoch: s.epoch + 1,
      from: s.spent.map((x) => ({ deck: DECK_ID, pos: x.pos })),
    };
  if (s.arrange !== null) return { type: 'player', seat: s.arrange.seat, decision: 'arrange' };
  const limit = overLimit(s);
  if (limit !== null) return { type: 'player', seat: limit, decision: 'discard' };
  if (s.window !== null) return { type: 'player', seat: s.window.queue[0] ?? 0, decision: 'relief' };
  return { type: 'player', seat: s.turn, decision: 'act' };
}

/* ----------------------------------------------------------------------------------------- the deck */

function requestReveal(
  s: SpreadState,
  positions: readonly number[],
  purpose: RevealPurpose,
  seat: number | null,
): SpreadState {
  return {
    ...s,
    reveal: { positions, cards: {}, purpose, seat },
    dealt: [...s.dealt, ...positions.map((pos) => ({ deck: DECK_ID, pos, to: null }))],
  };
}

function applyReveal(s: SpreadState, pos: number, card: number, ev: SpreadEvent[]): SpreadState | string {
  const r = s.reveal;
  if (r === null) return 'No reveal is pending.';
  const waiting = sorted(r.positions.filter((p) => r.cards[String(p)] === undefined));
  if (waiting[0] !== pos) return 'That position is not the next one being turned up.';
  if (s.plain !== null && s.plain[String(pos)] !== card) return 'That is not the card at that position.';
  if (!cardFits(s, pos, card)) return 'That card cannot lie at that position.';
  const cards = { ...r.cards, [String(pos)]: card };
  if (waiting.length > 1) return { ...s, reveal: { ...r, cards } };
  return advance(revealed({ ...s, reveal: null }, { ...r, cards }, ev), ev);
}

/** Whether `card` may be the card at `pos`: the right group, and not already seen. */
function cardFits(s: SpreadState, pos: number, card: number): boolean {
  const base = roleBase(s.rules);
  const spreadPos = pos < FIELD_BASE || pos >= EPOCH_STRIDE;
  if (spreadPos) {
    if (!int(card) || card >= CITY_COUNT) return false;
    const seen =
      s.spent.some((x) => x.city === card) ||
      s.purged.includes(card) ||
      s.pile.some((x) => x.city === card) ||
      Object.values(s.reveal?.cards ?? {}).includes(card);
    return !seen;
  }
  if (pos >= base) return int(card) && card >= base && card < base + ROLES.length;
  // The field deck and its surges, mixed by the second round.
  if (!int(card) || card < FIELD_BASE || card >= base) return false;
  if (card >= SURGE_BASE) return true;
  const f = card - FIELD_BASE;
  return (
    !s.hands.some((h) => h.includes(f)) &&
    !s.discard.includes(f) &&
    !s.removed.includes(f) &&
    !s.stored.includes(f) &&
    !Object.values(s.reveal?.cards ?? {}).includes(card)
  );
}

/** Every position of a reveal is in: act on the cards. */
function revealed(s: SpreadState, r: Reveal, ev: SpreadEvent[]): SpreadState {
  const card = (pos: number): number => r.cards[String(pos)] as number;
  const fillPile = (t: SpreadState): SpreadState => ({
    ...t,
    pile: t.pile.map((x) => (r.cards[String(x.pos)] === undefined ? x : { ...x, city: card(x.pos) })),
  });
  switch (r.purpose) {
    case 'setup':
      return setupDone(s, r, ev);
    case 'draw': {
      const cards = r.positions.map(card);
      const kept = cards.filter((c) => c < SURGE_BASE).map((c) => c - FIELD_BASE);
      const surges = cards.length - kept.length;
      let t: SpreadState = {
        ...s,
        hands: withSeat(s.hands, s.turn, sorted([...handOf(s, s.turn), ...kept])),
        surgesDrawn: s.surgesDrawn + surges,
      };
      t = note(t, ev, { kind: 'drew', seat: s.turn, cards: kept, surges });
      if (surges > 0) return { ...t, phase: 'surge', surges, surgeStep: 'rise' };
      return { ...t, phase: 'spread', spreadStep: 'window', spreadLeft: null };
    }
    case 'strike':
    case 'spread':
      return fillPile(s);
    case 'warning': {
      const t = fillPile(s);
      return { ...t, arrange: { seat: r.seat ?? s.turn, count: Math.min(WARNING_CARDS, t.pile.length) } };
    }
  }
}

/** The setup reveal is in (C02–C04): roles, hands, the opening infection, then the first player. */
function setupDone(s: SpreadState, r: Reveal, ev: SpreadEvent[]): SpreadState {
  const card = (pos: number): number => r.cards[String(pos)] as number;
  const base = roleBase(s.rules);
  const size = HAND_SIZES[s.seats] ?? 2;
  const roles = Array.from({ length: s.seats }, (_, i) => card(base + i) - base);
  const hands = Array.from({ length: s.seats }, (_, seat) =>
    sorted(Array.from({ length: size }, (_, k) => card(FIELD_BASE + seat * size + k) - FIELD_BASE)),
  );
  let t: SpreadState = { ...s, roles, hands };
  const spent = OPENING_INFECTION.map((n, i) => ({ pos: i, city: card(i), n }));
  for (const x of spent) t = withCases(t, x.city, strainOf(x.city), x.n);
  t = {
    ...t,
    spent: spent.map(({ pos, city }) => ({ pos, city })),
    pile: Array.from({ length: CITY_COUNT - OPENING_INFECTION.length }, (_, i) => ({
      pos: OPENING_INFECTION.length + i,
      city: null,
    })),
  };
  // The player holding the most populous city card goes first; a tie goes to the earlier seat (C04).
  const best = (seat: number): number =>
    Math.max(-1, ...handOf(t, seat).map((f) => (f < CITY_COUNT ? (POPULATION[f] ?? 0) : -1)));
  const first = fromSeat(s.seats, 0).reduce((a, b) => (best(b) > best(a) ? b : a), 0);
  t = note(t, ev, { kind: 'setup', roles, first });
  return startTurn({ ...t, turn: first }, ev);
}

function startTurn(s: SpreadState, ev: SpreadEvent[]): SpreadState {
  const t: SpreadState = {
    ...s,
    phase: 'actions',
    actions: ACTIONS_PER_TURN,
    flew: false,
    turnNo: s.turnNo + 1,
    spreadStep: 'window',
    spreadLeft: null,
  };
  return note(t, ev, { kind: 'turn', seat: t.turn, turnNo: t.turnNo });
}

/** The restack is in (C17): the spent cards, reshuffled as epoch `epoch`, go on top of the spread deck. */
function applyEpoch(s: SpreadState, epoch: number, size: number, ev: SpreadEvent[]): SpreadState | string {
  if (!s.shuffling || epoch !== s.epoch + 1 || size !== s.spent.length)
    return 'That is not the pending reshuffle.';
  const top: PileItem[] = s.spent.map((_, i) => ({ pos: EPOCH_STRIDE * epoch + i, city: null }));
  if (s.plain !== null && top.some((x) => s.plain?.[String(x.pos)] === undefined))
    return 'The reshuffled order is not installed.';
  const t: SpreadState = { ...s, shuffling: false, epoch, spent: [], pile: [...top, ...s.pile] };
  return advance(note(t, ev, { kind: 'restack', cards: size }), ev);
}

/** Full mode only: the spent cards in their new order (PROTOCOL §5, D073). Emits nothing. */
export function installDeckOrder(
  s: SpreadState,
  epoch: number,
  order: readonly number[],
): ApplyResult<SpreadState, SpreadEvent> {
  if (s.plain === null) return fail('A view has no deck order.');
  if (!s.shuffling || epoch !== s.epoch + 1) return fail('No such reshuffle is pending.');
  const want = sorted(shufflePlaintexts(s));
  const got = sorted(order);
  if (got.length !== want.length || got.some((c, i) => c !== want[i]))
    return fail('The order is not a shuffle of the spent spread cards.');
  const plain = { ...s.plain };
  order.forEach((card, i) => {
    plain[String(EPOCH_STRIDE * epoch + i)] = card;
  });
  return { ok: true, state: { ...s, plain }, events: [] };
}

/** The card ids of the spent spread cards being reshuffled, in `from` order; empty outside full mode. */
export const shufflePlaintexts = (s: SpreadState): readonly number[] =>
  s.plain !== null && s.shuffling ? s.spent.map((x) => x.city) : [];

/* ------------------------------------------------------------------------------------------ infection */

/** Whether a case of `strain` may not be placed in `city` (C20, C24): stamped out, the Warden, the Paramedic. */
export function shielded(s: SpreadState, city: number, strain: number): boolean {
  if (s.stamped[strain]) return true;
  const warden = seatWithRole(s, 'warden');
  if (warden >= 0) {
    const w = atOf(s, warden);
    if (w === city || NEIGHBOURS[w]?.includes(city)) return true;
  }
  const medic = seatWithRole(s, 'paramedic');
  return medic >= 0 && s.cured[strain] === true && atOf(s, medic) === city;
}

function lose(s: SpreadState, reason: LossReason, ev: SpreadEvent[]): SpreadState {
  const n = curesFound(s);
  const result: Outcome = {
    places: Array.from({ length: s.seats }, () => 1),
    scores: Array.from({ length: s.seats }, () => n),
    reason,
  };
  return note({ ...s, phase: 'over', result, window: null, arrange: null }, ev, { kind: 'lost', reason });
}

/**
 * Add `n` cases of `strain` to `city` (C16, C17, C20): up to three; past three the city spills over, once per chain,
 * one case to each neighbour. Stops at a loss.
 */
function infect(s: SpreadState, city: number, strain: number, n: number, ev: SpreadEvent[]): SpreadState {
  const spilled = new Set<number>();
  const add = (t: SpreadState, c: number, k: number): SpreadState => {
    if (t.phase === 'over') return t;
    if (shielded(t, c, strain)) return note(t, ev, { kind: 'blocked', city: c, strain });
    const cur = t.cases[c]?.[strain] ?? 0;
    const placed = Math.min(k, MAX_CASES - cur);
    let u = t;
    if (placed > 0) {
      if (supplyOf(u, strain) < placed) return lose(u, 'cases', ev);
      u = withCases(u, c, strain, cur + placed);
    }
    return cur + k > MAX_CASES ? spill(u, c) : u;
  };
  const spill = (t: SpreadState, c: number): SpreadState => {
    if (spilled.has(c)) return t;
    spilled.add(c);
    let u = note({ ...t, spills: t.spills + 1 }, ev, {
      kind: 'spillover',
      city: c,
      strain,
      count: t.spills + 1,
    });
    if (u.spills >= SPILL_LIMIT) return lose(u, 'spillovers', ev);
    for (const nb of NEIGHBOURS[c] ?? []) {
      u = add(u, nb, 1);
      if (u.phase === 'over') return u;
    }
    return u;
  };
  return add(s, city, n);
}

/* ------------------------------------------------------------------------------------------- the flow */

/** Seats holding a relief card they may play now, in turn order from the active seat (C23). */
function holders(s: SpreadState, only: Window['only']): number[] {
  const herd = reliefCard('immunity');
  return fromSeat(s.seats, s.turn).filter((seat) =>
    only === 'immunity'
      ? reliefsHeld(s, seat).includes(herd) && s.spent.length > 0
      : reliefsHeld(s, seat).length > 0,
  );
}

function openWindow(s: SpreadState, only: Window['only']): SpreadState {
  const queue = holders(s, only);
  return queue.length === 0 ? s : { ...s, window: { queue, only } };
}

/** Run the automatic steps until a reveal, a reshuffle or a decision is needed (or the game is over). */
function advance(s: SpreadState, ev: SpreadEvent[]): SpreadState {
  let t = s;
  for (let guard = 0; guard < 500; guard++) {
    if (t.phase === 'over' || t.reveal !== null || t.shuffling || t.arrange !== null || t.window !== null)
      return t;
    if (overLimit(t) !== null) return t;
    switch (t.phase) {
      case 'setup':
        return t;
      case 'actions':
        if (t.actions > 0) return t;
        t = { ...t, phase: 'draw' };
        continue;
      case 'draw': {
        // Fewer than two cards left to draw: the team loses (C15).
        if (t.field.length < 2) return lose(t, 'deck', ev);
        const two = t.field.slice(0, 2);
        t = requestReveal({ ...t, field: t.field.slice(2) }, two, 'draw', null);
        continue;
      }
      case 'surge':
        t = surgeStep(t, ev);
        continue;
      case 'spread':
        t = spreadStep(t, ev);
        continue;
    }
  }
  return t;
}

/** One step of the current surge (C17). */
function surgeStep(s: SpreadState, ev: SpreadEvent[]): SpreadState {
  switch (s.surgeStep) {
    case 'rise': {
      const rate = Math.min(s.rate + 1, SPREAD_RATES.length - 1);
      return note({ ...s, rate, surgeStep: 'strike' }, ev, { kind: 'rise', rate });
    }
    case 'strike': {
      const bottom = s.pile.at(-1);
      if (bottom === undefined) return { ...s, surgeStep: 'immunity' };
      if (bottom.city === null) return requestReveal(s, [bottom.pos], 'strike', null);
      const city = bottom.city;
      const strain = strainOf(city);
      const before = s.cases[city]?.[strain] ?? 0;
      let t: SpreadState = { ...s, pile: s.pile.slice(0, -1), surgeStep: 'immunity' };
      if (!t.stamped[strain]) t = infect(t, city, strain, MAX_CASES, ev);
      const placed = (t.cases[city]?.[strain] ?? 0) - before;
      t = { ...t, spent: [...t.spent, { pos: bottom.pos, city }] };
      return t.phase === 'over' ? t : note(t, ev, { kind: 'strike', city, placed });
    }
    case 'immunity':
      // Herd Immunity may be played between the strike and the restack (C22).
      return openWindow({ ...s, surgeStep: 'restack' }, 'immunity');
    case 'restack':
      if (s.spent.length === 0) return { ...s, surgeStep: 'next' };
      return { ...s, shuffling: true, surgeStep: 'next' };
    case 'next': {
      const surges = s.surges - 1;
      if (surges > 0) return openWindow({ ...s, surges, surgeStep: 'rise' }, 'any');
      return { ...s, surges: 0, phase: 'spread', spreadStep: 'window', spreadLeft: null };
    }
  }
}

/** One step of the spread (C16): its window, then one spread card at a time. */
function spreadStep(s: SpreadState, ev: SpreadEvent[]): SpreadState {
  if (s.spreadStep === 'window') return openWindow({ ...s, spreadStep: 'infect' }, 'any');
  if (s.spreadLeft === null) {
    if (s.quiet) return note({ ...s, quiet: false, spreadLeft: 0 }, ev, { kind: 'quiet' });
    return { ...s, spreadLeft: spreadRate(s) };
  }
  const top = s.pile[0];
  if (s.spreadLeft === 0 || top === undefined) return startTurn({ ...s, turn: (s.turn + 1) % s.seats }, ev);
  if (top.city === null) return requestReveal(s, [top.pos], 'spread', null);
  const city = top.city;
  const strain = strainOf(city);
  const before = s.cases[city]?.[strain] ?? 0;
  let t: SpreadState = { ...s, pile: s.pile.slice(1), spreadLeft: s.spreadLeft - 1 };
  if (!t.stamped[strain]) t = infect(t, city, strain, 1, ev);
  t = { ...t, spent: [...t.spent, { pos: top.pos, city }] };
  if (t.phase === 'over') return t;
  return note(t, ev, { kind: 'infect', city, placed: (t.cases[city]?.[strain] ?? 0) - before });
}

/* ------------------------------------------------------------------------------------------ the actions */

const cityCards = (hand: readonly number[]): number[] => hand.filter((f) => f < CITY_COUNT);

/** k-element subsets of `xs`, each ascending, in lexicographic order. */
function subsets(xs: readonly number[], k: number): number[][] {
  if (k === 0) return [[]];
  const out: number[][] = [];
  xs.forEach((x, i) => {
    for (const rest of subsets(xs.slice(i + 1), k - 1)) out.push([x, ...rest]);
  });
  return out;
}

function permutations(xs: readonly number[]): number[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/** The relief plays open to `seat` now (C22). */
function reliefOptions(s: SpreadState, seat: number, only: Window['only']): SpreadAction[] {
  const out: SpreadAction[] = [];
  for (const card of reliefsHeld(s, seat)) {
    const relief = reliefOf(card);
    if (only === 'immunity' && relief !== 'immunity') continue;
    switch (relief) {
      case 'medevac':
        for (let pawn = 0; pawn < s.seats; pawn++)
          for (let to = 0; to < CITY_COUNT; to++)
            if (to !== atOf(s, pawn)) out.push({ type: 'medevac', actor: seat, pawn, to });
        break;
      case 'warning':
        if (s.pile.length > 0) out.push({ type: 'warning', actor: seat });
        break;
      case 'permit':
        for (let city = 0; city < CITY_COUNT; city++) {
          if (s.clinics.includes(city)) continue;
          if (s.clinics.length < CLINIC_LIMIT) out.push({ type: 'permit', actor: seat, city, remove: null });
          else for (const r of s.clinics) out.push({ type: 'permit', actor: seat, city, remove: r });
        }
        break;
      case 'lull':
        out.push({ type: 'lull', actor: seat });
        break;
      case 'immunity':
        for (const city of sorted(s.spent.map((x) => x.city)))
          out.push({ type: 'immunity', actor: seat, city });
        break;
    }
  }
  return out;
}

/** The moves of `pawn`'s pawn that `actor` may make with an action (C07–C09, C25, C26). */
function moveOptions(s: SpreadState, actor: number, pawn: number): SpreadAction[] {
  const out: SpreadAction[] = [];
  const from = atOf(s, pawn);
  const hand = handOf(s, actor);
  for (const to of NEIGHBOURS[from] ?? []) out.push({ type: 'travel', actor, pawn, to });
  for (const to of cityCards(hand)) if (to !== from) out.push({ type: 'fly', actor, pawn, to });
  if (hand.includes(from))
    for (let to = 0; to < CITY_COUNT; to++) if (to !== from) out.push({ type: 'charter', actor, pawn, to });
  if (s.clinics.includes(from))
    for (const to of s.clinics) if (to !== from) out.push({ type: 'shuttle', actor, pawn, to });
  return out;
}

/** The active seat's actions (C06–C14, C25–C31). */
function actionOptions(s: SpreadState, seat: number): SpreadAction[] {
  const out: SpreadAction[] = [];
  const role = roleOf(s, seat);
  const here = atOf(s, seat);
  const hand = handOf(s, seat);
  const pawns = role === 'coordinator' ? fromSeat(s.seats, seat) : [seat];
  for (const pawn of pawns) out.push(...moveOptions(s, seat, pawn));
  if (role === 'coordinator')
    for (let pawn = 0; pawn < s.seats; pawn++) {
      const targets = new Set(s.at.filter((_, q) => q !== pawn));
      for (const to of sorted([...targets]))
        if (to !== atOf(s, pawn)) out.push({ type: 'summon', actor: seat, pawn, to });
    }
  if (role === 'engineer' && !s.flew && s.clinics.includes(here))
    for (const card of cityCards(hand))
      for (let to = 0; to < CITY_COUNT; to++)
        if (to !== here) out.push({ type: 'relocate', actor: seat, to, card });
  if (!s.clinics.includes(here) && (role === 'engineer' || hand.includes(here))) {
    if (s.clinics.length < CLINIC_LIMIT) out.push({ type: 'clinic', actor: seat, remove: null });
    else for (const r of s.clinics) out.push({ type: 'clinic', actor: seat, remove: r });
  }
  for (let strain = 0; strain < STRAIN_COUNT; strain++)
    if ((s.cases[here]?.[strain] ?? 0) > 0) out.push({ type: 'treat', actor: seat, strain });
  for (let q = 0; q < s.seats; q++) {
    if (q === seat || atOf(s, q) !== here) continue;
    const gives = role === 'courier' ? cityCards(hand) : hand.includes(here) ? [here] : [];
    for (const card of gives) out.push({ type: 'give', actor: seat, to: q, card });
    const theirs = handOf(s, q);
    const takes = roleOf(s, q) === 'courier' ? cityCards(theirs) : theirs.includes(here) ? [here] : [];
    for (const card of takes) out.push({ type: 'take', actor: seat, from: q, card });
  }
  if (s.clinics.includes(here)) {
    const need = role === 'virologist' ? VIROLOGIST_CURE_CARDS : CURE_CARDS;
    for (let strain = 0; strain < STRAIN_COUNT; strain++) {
      if (s.cured[strain]) continue;
      const mine = cityCards(hand).filter((f) => strainOf(f) === strain);
      for (const cards of subsets(mine, need)) out.push({ type: 'cure', actor: seat, cards });
    }
  }
  if (role === 'archivist' && (s.stored[seat] ?? null) === null)
    for (const card of sorted(s.discard.filter(isRelief))) out.push({ type: 'retrieve', actor: seat, card });
  out.push({ type: 'end', actor: seat });
  return out;
}

/** Every legal player action of `seat` now: exact (every card is public). */
export function legalActions(s: SpreadState, seat: number): SpreadAction[] {
  const p = pendingOf(s);
  if (p.type !== 'player' || p.seat !== seat) return [];
  switch (p.decision) {
    case 'arrange': {
      const count = s.arrange?.count ?? 0;
      const top = s.pile.slice(0, count).map((x) => x.city as number);
      return permutations(top).map((order) => ({ type: 'arrange', actor: seat, order }));
    }
    case 'discard':
      return [
        ...handOf(s, seat).map((card): SpreadAction => ({ type: 'discard', actor: seat, card })),
        ...reliefOptions(s, seat, 'any'),
      ];
    case 'relief':
      return [...reliefOptions(s, seat, s.window?.only ?? 'any'), { type: 'pass', actor: seat }];
    default:
      return [...actionOptions(s, seat), ...reliefOptions(s, seat, 'any')];
  }
}

/* ---------------------------------------------------------------------------------------------- apply */

const DECK_TYPES = new Set(['reveal', 'epoch']);

export function applyAction(s: SpreadState, raw: unknown): ApplyResult<SpreadState, SpreadEvent> {
  try {
    if (!obj(raw)) return fail('Invalid action.');
    const ev: SpreadEvent[] = [];
    if (DECK_TYPES.has(raw.type as string)) {
      let next: SpreadState | string;
      if (raw.type === 'reveal') {
        if (
          !keys(raw, ['type', 'actor', 'deck', 'pos', 'card']) ||
          raw.actor !== 'deck' ||
          raw.deck !== DECK_ID
        )
          return fail('Invalid reveal.');
        if (!int(raw.pos) || !int(raw.card)) return fail('Invalid reveal.');
        next = applyReveal(s, raw.pos, raw.card, ev);
      } else {
        if (!keys(raw, ['type', 'actor', 'epoch', 'size']) || raw.actor !== 'deck')
          return fail('Invalid reshuffle.');
        if (!int(raw.epoch) || !int(raw.size)) return fail('Invalid reshuffle.');
        next = applyEpoch(s, raw.epoch, raw.size, ev);
      }
      return typeof next === 'string' ? fail(next) : { ok: true, state: next, events: ev };
    }
    if (!int(raw.actor) || raw.actor >= s.seats) return fail('Invalid action.');
    const want = canonicalJson(raw);
    const legal = legalActions(s, raw.actor);
    const action = legal.find((a) => canonicalJson(a) === want);
    if (action === undefined)
      return fail(legal.length === 0 ? 'It is not your decision.' : 'That move is not allowed now.');
    const next = advance(play(s, action, ev), ev);
    return { ok: true, state: next, events: ev };
  } catch {
    return fail('Invalid action.');
  }
}

/** Move `pawn` to `to`, and let the Paramedic clear the cured strains where it arrives (C27). */
function movePawn(s: SpreadState, pawn: number, to: number, ev: SpreadEvent[]): SpreadState {
  return paramedicSweep({ ...s, at: withSeat(s.at, pawn, to) }, ev);
}

/** The Paramedic removes every case of a cured strain in its city (C27), and stamped-out strains are noted. */
function paramedicSweep(s: SpreadState, ev: SpreadEvent[]): SpreadState {
  const medic = seatWithRole(s, 'paramedic');
  let t = s;
  if (medic >= 0) {
    const city = atOf(t, medic);
    for (let strain = 0; strain < STRAIN_COUNT; strain++) {
      const n = t.cases[city]?.[strain] ?? 0;
      if (!t.cured[strain] || n === 0) continue;
      t = note(withCases(t, city, strain, 0), ev, { kind: 'cleared', city, strain, removed: n });
    }
  }
  return stampCheck(t, ev);
}

/** A cured strain with no case on the board is stamped out (C14). */
function stampCheck(s: SpreadState, ev: SpreadEvent[]): SpreadState {
  let t = s;
  for (let strain = 0; strain < STRAIN_COUNT; strain++)
    if (t.cured[strain] && !t.stamped[strain] && onBoard(t, strain) === 0)
      t = note({ ...t, stamped: withSeat(t.stamped, strain, true) }, ev, { kind: 'stamped', strain });
  return t;
}

const discardFrom = (s: SpreadState, seat: number, cards: readonly number[]): SpreadState => ({
  ...s,
  hands: withSeat(
    s.hands,
    seat,
    handOf(s, seat).filter((f) => !cards.includes(f)),
  ),
  discard: [...s.discard, ...cards],
});

/** Spend an action. */
const spend = (s: SpreadState): SpreadState => ({ ...s, actions: s.actions - 1 });

function play(s: SpreadState, a: SpreadAction, ev: SpreadEvent[]): SpreadState {
  switch (a.type) {
    case 'travel':
    case 'fly':
    case 'charter':
    case 'shuttle':
    case 'summon': {
      const from = atOf(s, a.pawn);
      let t = spend(s);
      if (a.type === 'fly') t = discardFrom(t, a.actor, [a.to]);
      if (a.type === 'charter') t = discardFrom(t, a.actor, [from]);
      t = note(t, ev, { kind: 'move', seat: a.actor, pawn: a.pawn, how: a.type, from, to: a.to });
      return movePawn(t, a.pawn, a.to, ev);
    }
    case 'relocate': {
      const from = atOf(s, a.actor);
      let t = discardFrom({ ...spend(s), flew: true }, a.actor, [a.card]);
      t = note(t, ev, { kind: 'move', seat: a.actor, pawn: a.actor, how: 'relocate', from, to: a.to });
      return movePawn(t, a.actor, a.to, ev);
    }
    case 'clinic': {
      const city = atOf(s, a.actor);
      let t = spend(s);
      if (roleOf(s, a.actor) !== 'engineer') t = discardFrom(t, a.actor, [city]);
      const clinics = sorted([...t.clinics.filter((c) => c !== a.remove), city]);
      return note({ ...t, clinics }, ev, { kind: 'clinic', seat: a.actor, city, moved: a.remove });
    }
    case 'treat': {
      const city = atOf(s, a.actor);
      const n = s.cases[city]?.[a.strain] ?? 0;
      const all = s.cured[a.strain] === true || roleOf(s, a.actor) === 'paramedic';
      const removed = all ? n : 1;
      const t = note(withCases(spend(s), city, a.strain, n - removed), ev, {
        kind: 'treat',
        seat: a.actor,
        city,
        strain: a.strain,
        removed,
      });
      return stampCheck(t, ev);
    }
    case 'give':
    case 'take': {
      const from = a.type === 'give' ? a.actor : a.from;
      const to = a.type === 'give' ? a.to : a.actor;
      const t: SpreadState = {
        ...spend(s),
        hands: s.hands.map((h, i) =>
          i === from ? h.filter((f) => f !== a.card) : i === to ? sorted([...h, a.card]) : h,
        ),
      };
      return note(t, ev, { kind: 'handed', from, to, card: a.card });
    }
    case 'cure': {
      const strain = strainOf(a.cards[0] as number);
      let t = discardFrom(spend(s), a.actor, a.cards);
      t = note({ ...t, cured: withSeat(t.cured, strain, true) }, ev, { kind: 'cure', seat: a.actor, strain });
      t = paramedicSweep(t, ev);
      if (curesFound(t) === STRAIN_COUNT) {
        const result: Outcome = {
          places: Array.from({ length: t.seats }, () => 1),
          scores: Array.from({ length: t.seats }, () => STRAIN_COUNT),
          reason: 'cured',
        };
        return note({ ...t, phase: 'over', result }, ev, { kind: 'won' });
      }
      return t;
    }
    case 'retrieve': {
      const t: SpreadState = {
        ...spend(s),
        discard: s.discard.filter((f) => f !== a.card),
        stored: withSeat(s.stored, a.actor, a.card),
      };
      return note(t, ev, { kind: 'retrieve', seat: a.actor, card: a.card });
    }
    case 'end':
      return { ...s, actions: 0 };
    case 'discard':
      return note(discardFrom(s, a.actor, [a.card]), ev, { kind: 'discard', seat: a.actor, card: a.card });
    case 'pass': {
      const w = s.window;
      const queue = w === null ? [] : w.queue.slice(1);
      return note({ ...s, window: w === null || queue.length === 0 ? null : { ...w, queue } }, ev, {
        kind: 'pass',
        seat: a.actor,
      });
    }
    case 'arrange': {
      const count = a.order.length;
      const byCity = new Map(s.pile.slice(0, count).map((x) => [x.city, x]));
      const top = a.order.map((city) => byCity.get(city) as PileItem);
      const t: SpreadState = { ...s, arrange: null, pile: [...top, ...s.pile.slice(count)] };
      return note(t, ev, { kind: 'arranged', seat: a.actor, cities: a.order });
    }
    case 'medevac':
    case 'warning':
    case 'permit':
    case 'lull':
    case 'immunity':
      return playRelief(s, a, ev);
    default:
      return s;
  }
}

/** A relief card is played (C22): from the hand to the discard pile, or the Archivist's stored card out of the game. */
function playRelief(
  s: SpreadState,
  a: Extract<SpreadAction, { type: Relief }>,
  ev: SpreadEvent[],
): SpreadState {
  const card = reliefCard(a.type);
  const seat = a.actor;
  let t: SpreadState =
    s.stored[seat] === card
      ? { ...s, stored: withSeat(s.stored, seat, null), removed: [...s.removed, card] }
      : discardFrom(s, seat, [card]);
  const city = a.type === 'medevac' ? a.to : a.type === 'permit' || a.type === 'immunity' ? a.city : null;
  t = note(t, ev, { kind: 'relief', seat, card, city });
  // In a window, a seat with nothing left to play is done.
  const keepWindow = (u: SpreadState): SpreadState => {
    const w = u.window;
    if (w === null || w.queue[0] !== seat) return u;
    const left = reliefOptions(u, seat, w.only).length > 0;
    if (left) return u;
    const queue = w.queue.slice(1);
    return { ...u, window: queue.length === 0 ? null : { ...w, queue } };
  };
  switch (a.type) {
    case 'medevac': {
      const from = atOf(t, a.pawn);
      t = note(t, ev, { kind: 'move', seat, pawn: a.pawn, how: 'medevac', from, to: a.to });
      return keepWindow(movePawn(t, a.pawn, a.to, ev));
    }
    case 'permit': {
      const clinics = sorted([...t.clinics.filter((c) => c !== a.remove), a.city]);
      return keepWindow(note({ ...t, clinics }, ev, { kind: 'clinic', seat, city: a.city, moved: a.remove }));
    }
    case 'lull':
      return keepWindow({ ...t, quiet: true });
    case 'immunity':
      return keepWindow({
        ...t,
        spent: t.spent.filter((x) => x.city !== a.city),
        purged: [...t.purged, a.city],
      });
    case 'warning': {
      const count = Math.min(WARNING_CARDS, t.pile.length);
      const unknown = t.pile.slice(0, count).filter((x) => x.city === null);
      const u = keepWindow(t);
      if (unknown.length === 0) return { ...u, arrange: { seat, count } };
      return requestReveal(
        u,
        unknown.map((x) => x.pos),
        'warning',
        seat,
      );
    }
  }
}

/* --------------------------------------------------------------------------------------------- results */

/** Every seat's standing is the team's: the cures found so far. */
export const standingsOf = (s: SpreadState): number[] => Array.from({ length: s.seats }, () => curesFound(s));

export const cardOfField = (f: number): number => FIELD_BASE + f;
