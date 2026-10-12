/*
 * The Sticks & Stones rules engine (docs/games/sticks-and-stones/RULES.md). Pure: `apply` never throws or mutates,
 * and every move has one accepted encoding. Dice come from the beacon (D058): the move that rolls opens a roll,
 * every seat adds a share, and the session derives the faces. The discoveries and the monuments are one deck in two
 * groups (`camp`); every card is turned up by a public reveal, except the extra card, which its drawer sees alone
 * until the end.
 */
import {
  type ApplyResult,
  type DeckSpec,
  type Pending,
  packetOrderFits,
  type Result,
  type SetupInput,
} from '@bored-games/game-kit';
import {
  DECK_SIZE,
  DISCOVERIES,
  DISCOVERY_COUNT,
  DISPLAY_SLOTS,
  FOOD_DIVISOR,
  GOOD_VALUES,
  MONUMENT_COUNT,
  monumentOf,
  monumentPayments,
  monumentPoints,
  STACK_SIZE,
  vectors,
} from './data.ts';
import { outcomeOf } from './scoring.ts';
import {
  type Clan,
  GROUNDS,
  SPOTS,
  type Spot,
  type SticksAction,
  type SticksEvent,
  type SticksRules,
  type SticksState,
  VILLAGE,
} from './types.ts';
import {
  type Applied,
  addGoods,
  failure,
  gainField,
  gainTool,
  int,
  keys,
  MAX_PEOPLE,
  obj,
  plainArray,
  roundOrder,
  subsets,
  sum,
  withArray,
  withClan,
} from './util.ts';

export type { Applied } from './util.ts';

export const DEFAULT_RULES: SticksRules = { duplicates: 'squared' };
export const DECK_ID = 'camp';

/**
 * The deck: the 36 discoveries and the 28 monuments, each group shuffled on its own (D076's partitions), so a
 * position's group is public. `promptShares` (D075): every seat's open app releases its share of a public reveal,
 * and of the extra card for its drawer, as soon as it is due.
 */
export const CAMP_DECK: DeckSpec = {
  id: DECK_ID,
  size: DECK_SIZE,
  promptShares: true,
  partitions: [
    { id: 'discoveries', size: DISCOVERY_COUNT },
    { id: 'monuments', size: MONUMENT_COUNT },
  ],
};

export const MIN_SEATS = 2;
export const MAX_SEATS = 4;
const START_PEOPLE = 5;
const START_FOOD = 12;
/** People a gathering ground holds, over all players. */
export const GROUND_ROOM = 7;
const HUNGER = 10;
const FACES = 6;
const MAX_DICE = MAX_PEOPLE;

/** The deck position of stack `k`'s tile number `n` (from the top). */
export const stackPos = (k: number, n: number): number => DISCOVERY_COUNT + STACK_SIZE * k + n;
/** The slot a card spot names (`card2` → 2), or -1. */
export const slotOf = (spot: Spot): number => (spot.startsWith('card') ? Number(spot.slice(4)) : -1);
/** The stack a stack spot names (`stack1` → 1), or -1. */
export const stackOf = (spot: Spot): number => (spot.startsWith('stack') ? Number(spot.slice(5)) : -1);
/** The good a gathering ground yields (0–3), -1 for the hunting grounds, or null. */
export const groundGood = (spot: Spot | 'card'): number | null =>
  spot === 'hunt' ? -1 : GROUNDS.includes(spot as Spot) ? GROUNDS.indexOf(spot as Spot) : null;
/** The divisor of a roll for a good, or for food (-1). */
export const divisorOf = (good: number): number => (good < 0 ? FOOD_DIVISOR : (GOOD_VALUES[good] ?? 6));

/* --------------------------------------------------------------------------------------------- rules */

export function validateRules(raw: unknown): Result<SticksRules> {
  try {
    if (obj(raw) && keys(raw, ['duplicates']) && (raw.duplicates === 'squared' || raw.duplicates === 'ones'))
      return { ok: true, value: { duplicates: raw.duplicates } };
    return failure("Rules must be { duplicates: 'squared' } or { duplicates: 'ones' }.");
  } catch {
    return failure('Invalid rules.');
  }
}

/* --------------------------------------------------------------------------------------------- setup */

const emptySpots = (seats: number): Record<Spot, number[]> =>
  Object.fromEntries(SPOTS.map((spot) => [spot, Array.from({ length: seats }, () => 0)])) as Record<
    Spot,
    number[]
  >;

const newClan = (): Clan => ({
  people: START_PEOPLE,
  food: START_FOOD,
  goods: [0, 0, 0, 0],
  field: 0,
  tools: [],
  used: [],
  spares: [],
  choices: 0,
  cards: [],
  hidden: [],
  monuments: [],
  score: 0,
});

export function setupGame(input: SetupInput<SticksRules>): Result<SticksState> {
  try {
    const rules = validateRules(input.rules);
    if (!rules.ok) return rules;
    const seats = input.seats;
    if (!int(seats) || seats < MIN_SEATS || seats > MAX_SEATS) return failure('Choose 2–4 players.');
    let order: number[] | null = null;
    if (input.mode === 'full') {
      const raw = input.deckOrders[DECK_ID];
      if (raw === undefined || !packetOrderFits(CAMP_DECK, raw))
        return failure('The deck order must keep the discoveries and the monuments apart.');
      order = [...raw];
    } else if (input.mode === 'view') {
      if (input.viewer !== null && (!int(input.viewer) || input.viewer >= seats))
        return failure('Invalid viewer.');
    } else return failure('Invalid mode.');
    const display = Array.from({ length: DISPLAY_SLOTS }, (_, pos) => ({ pos, card: null }));
    const stacks = Array.from({ length: seats }, () => ({ built: 0, top: null }));
    return {
      ok: true,
      value: {
        rules: rules.value,
        seats,
        full: input.mode === 'full',
        viewer: input.mode === 'view' ? input.viewer : null,
        order,
        stage: 'place',
        round: 1,
        first: null,
        turn: 0,
        clans: Array.from({ length: seats }, newClan),
        home: Array.from({ length: seats }, () => START_PEOPLE),
        spots: emptySpots(seats),
        display,
        next: DISPLAY_SLOTS,
        stacks,
        rolls: [],
        roll: null,
        contributors: [],
        gather: null,
        gift: null,
        feeding: [],
        lastDice: null,
        dealt: [
          ...display.map((d) => ({ deck: DECK_ID, pos: d.pos, to: null })),
          ...stacks.map((_, k) => ({ deck: DECK_ID, pos: stackPos(k, 0), to: null })),
        ],
        ended: null,
        result: null,
      },
    };
  } catch {
    return failure('Invalid setup.');
  }
}

/* ---------------------------------------------------------------------------------------------- parse */

const isSpot = (x: unknown): x is Spot => typeof x === 'string' && (SPOTS as readonly string[]).includes(x);
const isPay = (x: unknown): x is number[] => plainArray(x) && x.length === 4 && x.every(int);
const ascending = (x: unknown): x is number[] =>
  plainArray(x) && x.every(int) && x.every((n, i) => i === 0 || (x[i - 1] as number) < (n as number));
const isFace = (x: unknown): boolean => int(x) && x >= 1 && x <= FACES;

/** The one accepted encoding of each action, or null. Never throws. */
export function parseAction(raw: unknown): SticksAction | null {
  try {
    if (!obj(raw) || typeof raw.type !== 'string') return null;
    const { type, actor } = raw;
    if (type === 'reveal') {
      const { deck, pos, card } = raw;
      if (!keys(raw, ['type', 'actor', 'deck', 'pos', 'card']) || actor !== 'deck' || deck !== DECK_ID)
        return null;
      return int(pos) && int(card) && pos < DECK_SIZE && card < DECK_SIZE
        ? { type, actor, deck, pos, card }
        : null;
    }
    if (type === 'rolled') {
      const { id, dice } = raw;
      if (!keys(raw, ['type', 'actor', 'id', 'dice']) || actor !== 'beacon' || !int(id)) return null;
      if (!plainArray(dice) || dice.length < 1 || dice.length > MAX_DICE || !dice.every(isFace)) return null;
      return { type, actor, id, dice: [...(dice as number[])] };
    }
    if (!int(actor)) return null;
    switch (type) {
      case 'contribute':
        return keys(raw, ['type', 'actor', 'id']) && int(raw.id) ? { type, actor, id: raw.id } : null;
      case 'place':
        return keys(raw, ['type', 'actor', 'spot', 'count']) && isSpot(raw.spot) && int(raw.count)
          ? { type, actor, spot: raw.spot, count: raw.count }
          : null;
      case 'use':
      case 'skip':
        return keys(raw, ['type', 'actor', 'spot']) && isSpot(raw.spot)
          ? { type, actor, spot: raw.spot }
          : null;
      case 'buy':
        return keys(raw, ['type', 'actor', 'slot', 'pay']) && int(raw.slot) && isPay(raw.pay)
          ? { type, actor, slot: raw.slot, pay: [...raw.pay] }
          : null;
      case 'build':
        return keys(raw, ['type', 'actor', 'stack', 'pay']) && int(raw.stack) && isPay(raw.pay)
          ? { type, actor, stack: raw.stack, pay: [...raw.pay] }
          : null;
      case 'tools':
        return keys(raw, ['type', 'actor', 'tools', 'spares']) &&
          ascending(raw.tools) &&
          ascending(raw.spares)
          ? { type, actor, tools: [...raw.tools], spares: [...raw.spares] }
          : null;
      case 'pick':
        return keys(raw, ['type', 'actor', 'face']) && isFace(raw.face)
          ? { type, actor, face: raw.face as number }
          : null;
      case 'choose':
        return keys(raw, ['type', 'actor', 'take']) && isPay(raw.take)
          ? { type, actor, take: [...raw.take] }
          : null;
      case 'feed':
        return keys(raw, ['type', 'actor', 'pay']) && (raw.pay === null || isPay(raw.pay))
          ? { type, actor, pay: raw.pay === null ? null : [...raw.pay] }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------------------------- pending */

/** Every deck position waiting for a public reveal: the display, the stack tops, and at the end the face-down cards. */
export function revealPositions(s: SticksState): number[] {
  if (s.stage === 'ending')
    return s.clans.flatMap((c) => c.hidden.filter((h) => !h.open).map((h) => h.pos)).sort((a, b) => a - b);
  const out: number[] = [];
  for (const d of s.display) if (d !== null && d.card === null) out.push(d.pos);
  s.stacks.forEach((st, k) => {
    if (st.top === null && st.built < STACK_SIZE) out.push(stackPos(k, st.built));
  });
  return out;
}

export function pendingOf(s: SticksState): Pending {
  if (s.stage === 'over') return { type: 'over' };
  const positions = revealPositions(s);
  if (positions.length > 0) return { type: 'reveal', deck: DECK_ID, positions };
  switch (s.stage) {
    case 'roll': {
      const next = s.contributors[0];
      if (next !== undefined) return { type: 'player', seat: next, decision: 'contribute' };
      return { type: 'beacon', id: s.roll ?? 0 };
    }
    case 'pick':
      return { type: 'player', seat: s.gift?.order[0] ?? s.turn, decision: 'pick' };
    default:
      return { type: 'player', seat: s.turn, decision: s.stage };
  }
}

/** The roll a `contribute` carries a beacon share for: the open one (D058). Never throws. */
export function beaconFor(s: SticksState, raw: unknown): number | null {
  try {
    return obj(raw) && raw.type === 'contribute' ? s.roll : null;
  } catch {
    return null;
  }
}

/** How many dice the open roll has: one per person gathering, two for a discovery's roll, one per player for a gift. */
export function rollShapeOf(s: SticksState): { count: number; sides: number } {
  if (s.gather !== null) return { count: s.gather.count, sides: FACES };
  return { count: s.seats, sides: FACES };
}

/** Open a roll requested by `seat`: every seat adds a share, from the one after `seat` round to `seat` (D058). */
function openRoll(s: SticksState, seat: number): SticksState {
  const id = s.rolls.length;
  return {
    ...s,
    stage: 'roll',
    roll: id,
    rolls: [...s.rolls, { id, last: seat }],
    contributors: Array.from({ length: s.seats }, (_, k) => (seat + 1 + k) % s.seats),
  };
}

/* -------------------------------------------------------------------------------------------- placing */

const total = (s: SticksState, spot: Spot): number => sum(s.spots[spot]);
const playersOn = (s: SticksState, spot: Spot): number => s.spots[spot].filter((n) => n > 0).length;
const villageUsed = (s: SticksState): number => VILLAGE.filter((v) => total(s, v) > 0).length;

/** The counts `seat` may place on `spot` now (RULES.md C05–C08), or none. */
export function placeCounts(s: SticksState, seat: number, spot: Spot): number[] {
  const home = s.home[seat] ?? 0;
  if (home <= 0 || (s.spots[spot][seat] ?? 0) > 0) return [];
  const upTo = (n: number): number[] => Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);
  if (spot === 'hunt') return upTo(home);
  if (GROUNDS.includes(spot)) {
    // Two players: one clan per ground; three: two clans per ground (C07).
    if (s.seats < 4 && playersOn(s, spot) >= s.seats - 1) return [];
    return upTo(Math.min(home, GROUND_ROOM - total(s, spot)));
  }
  if (total(s, spot) > 0) return [];
  if (VILLAGE.includes(spot)) {
    // With two or three players only two of the three village spots are used each round (C07).
    if (s.seats < 4 && villageUsed(s) >= 2) return [];
    if (spot === 'hut') return home >= 2 ? [2] : [];
    return [1];
  }
  const slot = slotOf(spot);
  if (slot >= 0) return s.display[slot] ? [1] : [];
  const k = stackOf(spot);
  return k < s.seats && (s.stacks[k]?.built ?? STACK_SIZE) < STACK_SIZE ? [1] : [];
}

const canPlace = (s: SticksState, seat: number): boolean =>
  SPOTS.some((p) => placeCounts(s, seat, p).length > 0);

function applyPlace(s: SticksState, seat: number, spot: Spot, count: number): Applied | string {
  if (s.stage !== 'place' || s.turn !== seat) return 'It is not your turn to place.';
  if (!placeCounts(s, seat, spot).includes(count)) return 'You cannot place there.';
  const placed: SticksState = {
    ...s,
    home: withArray(s.home, seat, (s.home[seat] ?? 0) - count),
    spots: { ...s.spots, [spot]: withArray(s.spots[spot], seat, (s.spots[spot][seat] ?? 0) + count) },
  };
  const events: SticksEvent[] = [{ type: 'placed', seat, spot, count }];
  for (let k = 1; k <= s.seats; k++) {
    const n = (seat + k) % s.seats;
    if (canPlace(placed, n)) return { state: { ...placed, turn: n }, events };
  }
  return { state: { ...placed, stage: 'resolve', turn: firstResolver(placed) }, events };
}

/* ------------------------------------------------------------------------------------------ resolving */

const spotsOf = (s: SticksState, seat: number): Spot[] => SPOTS.filter((p) => (s.spots[p][seat] ?? 0) > 0);
const clearSpot = (s: SticksState, seat: number, spot: Spot): SticksState => ({
  ...s,
  spots: { ...s.spots, [spot]: withArray(s.spots[spot], seat, 0) },
});

/** The first seat in round order with people out, or the first player (resolving has nothing then). */
function firstResolver(s: SticksState): number {
  const first = s.first ?? 0;
  return roundOrder(s.seats, first).find((n) => spotsOf(s, n).length > 0) ?? first;
}

/** After one of `s.turn`'s spots is resolved: the same seat goes on, or the next seat in order, or feeding. */
function afterStep(s: SticksState, events: readonly SticksEvent[]): Applied {
  const base: SticksState = { ...s, stage: 'resolve', gather: null, gift: null };
  if (spotsOf(base, s.turn).length > 0) return { state: base, events };
  const order = roundOrder(s.seats, s.first ?? 0);
  const next = order.slice(order.indexOf(s.turn) + 1).find((n) => spotsOf(base, n).length > 0);
  if (next !== undefined) return { state: { ...base, turn: next }, events };
  return startFeeding(base, events);
}

/** Every payment of `n` goods from `stock`. */
const paymentsOf = (stock: readonly number[], n: number): number[][] => vectors(stock, n);

/** Every "two goods of your choice" use open to `seat`. */
function chooseActions(s: SticksState, seat: number): SticksAction[] {
  if ((s.clans[seat]?.choices ?? 0) <= 0) return [];
  return vectors([2, 2, 2, 2], 2).map((take) => ({ type: 'choose', actor: seat, take }));
}

function resolveActions(s: SticksState, seat: number): SticksAction[] {
  const c = s.clans[seat] as Clan;
  const out: SticksAction[] = [];
  for (const spot of spotsOf(s, seat)) {
    const slot = slotOf(spot);
    const k = stackOf(spot);
    if (slot >= 0) {
      for (const pay of paymentsOf(c.goods, slot + 1)) out.push({ type: 'buy', actor: seat, slot, pay });
      out.push({ type: 'skip', actor: seat, spot });
    } else if (k >= 0) {
      const top = s.stacks[k]?.top ?? null;
      const m = top === null ? undefined : monumentOf(top);
      if (m)
        for (const pay of monumentPayments(m, c.goods))
          out.push({ type: 'build', actor: seat, stack: k, pay });
      out.push({ type: 'skip', actor: seat, spot });
    } else out.push({ type: 'use', actor: seat, spot });
  }
  return [...out, ...chooseActions(s, seat)];
}

function applyUse(s: SticksState, seat: number, spot: Spot): Applied | string {
  const count = s.spots[spot][seat] ?? 0;
  if (count <= 0 || slotOf(spot) >= 0 || stackOf(spot) >= 0) return 'You have nobody there to use.';
  const cleared = clearSpot(s, seat, spot);
  const good = groundGood(spot);
  if (good !== null)
    return { state: openRoll({ ...cleared, gather: { spot, good, count, dice: null } }, seat), events: [] };
  let gained = true;
  const state = withClan(cleared, seat, (c) => {
    const after =
      spot === 'hut'
        ? { ...c, people: Math.min(MAX_PEOPLE, c.people + 1) }
        : spot === 'field'
          ? gainField(c)
          : gainTool(c);
    gained = JSON.stringify(after) !== JSON.stringify(c);
    return after;
  });
  return afterStep(state, [{ type: 'village', seat, spot, gained }]);
}

/** Whether adding every unused tool and spare could raise the yield of the gathering (else none is asked). */
function toolsHelp(c: Clan, dice: readonly number[], good: number): boolean {
  const extra = sum(c.tools.filter((_, i) => !c.used[i])) + sum(c.spares);
  const d = divisorOf(good);
  return Math.floor((sum(dice) + extra) / d) > Math.floor(sum(dice) / d);
}

function toolActions(s: SticksState, seat: number): SticksAction[] {
  const c = s.clans[seat] as Clan;
  const free = c.tools.flatMap((_, i) => (c.used[i] ? [] : [i]));
  const out: SticksAction[] = [];
  for (const t of subsets(free.length))
    for (const spares of subsets(c.spares.length))
      out.push({ type: 'tools', actor: seat, tools: t.map((i) => free[i] as number), spares });
  return out;
}

/** The gathering yields: `tools` and `spares` (indexes) are added to the dice and spent. */
function finishGather(s: SticksState, tools: readonly number[], spares: readonly number[]): Applied {
  const g = s.gather;
  const seat = s.turn;
  if (g === null || g.dice === null) return { state: s, events: [] };
  const c = s.clans[seat] as Clan;
  const bonus = sum(tools.map((i) => c.tools[i] ?? 0)) + sum(spares.map((i) => c.spares[i] ?? 0));
  const amount = Math.floor((sum(g.dice) + bonus) / divisorOf(g.good));
  const state = withClan(s, seat, (k) => ({
    ...k,
    food: g.good < 0 ? k.food + amount : k.food,
    goods: g.good < 0 ? k.goods : withArray(k.goods, g.good, (k.goods[g.good] ?? 0) + amount),
    used: k.used.map((u, i) => u || tools.includes(i)),
    spares: k.spares.filter((_, i) => !spares.includes(i)),
  }));
  return afterStep(state, [
    { type: 'gathered', seat, spot: g.spot, good: g.good, dice: [...g.dice], bonus, amount },
  ]);
}

function applyTools(
  s: SticksState,
  seat: number,
  tools: readonly number[],
  spares: readonly number[],
): Applied | string {
  if (s.stage !== 'tools' || s.turn !== seat) return 'No roll is waiting for your tools.';
  const c = s.clans[seat] as Clan;
  if (tools.some((i) => i >= c.tools.length || c.used[i])) return 'That tool is not free.';
  if (spares.some((i) => i >= c.spares.length)) return 'You have no such one-use tool.';
  return finishGather(s, tools, spares);
}

/** A discovery's top, for its buyer (RULES.md C16–C23). */
function applyEffect(s: SticksState, seat: number, card: number, events: SticksEvent[]): Applied {
  const top = DISCOVERIES[card]?.top;
  const on = (f: (c: Clan) => Clan): SticksState => withClan(s, seat, f);
  switch (top?.type) {
    case 'food':
      return afterStep(
        on((c) => ({ ...c, food: c.food + top.n })),
        events,
      );
    case 'goods':
      return afterStep(
        on((c) => ({ ...c, goods: withArray(c.goods, top.good, (c.goods[top.good] ?? 0) + top.n) })),
        events,
      );
    case 'points':
      return afterStep(
        on((c) => ({ ...c, score: c.score + top.n })),
        events,
      );
    case 'oneUse':
      return afterStep(
        on((c) => ({ ...c, spares: [...c.spares, top.n] })),
        events,
      );
    case 'tool':
      return afterStep(on(gainTool), events);
    case 'field':
      return afterStep(on(gainField), events);
    case 'choose':
      return afterStep(
        on((c) => ({ ...c, choices: c.choices + 1 })),
        events,
      );
    case 'extra': {
      if (s.next >= DISCOVERY_COUNT) return afterStep(s, events);
      const pos = s.next;
      const drawn = on((c) => ({
        ...c,
        hidden: [...c.hidden, { pos, card: s.order?.[pos] ?? null, open: false }],
      }));
      return afterStep({ ...drawn, next: pos + 1, dealt: [...s.dealt, { deck: DECK_ID, pos, to: seat }] }, [
        ...events,
        { type: 'drew', seat, pos },
      ]);
    }
    case 'roll':
      return {
        state: openRoll({ ...s, gather: { spot: 'card', good: top.good, count: 2, dice: null } }, seat),
        events,
      };
    case 'dice':
      return {
        state: openRoll({ ...s, gift: { dice: null, order: roundOrder(s.seats, seat) } }, seat),
        events,
      };
    default:
      return afterStep(s, events);
  }
}

function applyBuy(s: SticksState, seat: number, slot: number, pay: readonly number[]): Applied | string {
  const spot = `card${slot}` as Spot;
  const shown = s.display[slot];
  if (!SPOTS.includes(spot) || (s.spots[spot][seat] ?? 0) <= 0 || !shown || shown.card === null)
    return 'You have nobody on that card.';
  const c = s.clans[seat] as Clan;
  if (sum(pay) !== slot + 1 || pay.some((n, i) => n > (c.goods[i] ?? 0)))
    return 'That is not the price of the card.';
  const card = shown.card;
  const paid = withClan(
    clearSpot({ ...s, display: withArray(s.display, slot, null) }, seat, spot),
    seat,
    (k) => ({
      ...k,
      goods: addGoods(
        k.goods,
        pay.map((n) => -n),
      ),
      cards: [...k.cards, card],
    }),
  );
  return applyEffect(paid, seat, card, [{ type: 'bought', seat, card, slot }]);
}

function applyBuild(s: SticksState, seat: number, k: number, pay: readonly number[]): Applied | string {
  const spot = `stack${k}` as Spot;
  const st = s.stacks[k];
  if (!SPOTS.includes(spot) || !st || (s.spots[spot][seat] ?? 0) <= 0 || st.top === null)
    return 'You have nobody on that monument.';
  const m = monumentOf(st.top);
  const c = s.clans[seat] as Clan;
  if (!m || !monumentPayments(m, c.goods).some((p) => p.every((n, i) => n === pay[i])))
    return 'That is not a price of the monument.';
  const monument = st.top - DISCOVERY_COUNT;
  const points = monumentPoints(pay);
  const built = st.built + 1;
  const state = withClan(clearSpot(s, seat, spot), seat, (x) => ({
    ...x,
    goods: addGoods(
      x.goods,
      pay.map((n) => -n),
    ),
    monuments: [...x.monuments, monument],
    score: x.score + points,
  }));
  return afterStep(
    {
      ...state,
      stacks: withArray(s.stacks, k, { built, top: null }),
      dealt:
        built < STACK_SIZE ? [...s.dealt, { deck: DECK_ID, pos: stackPos(k, built), to: null }] : s.dealt,
    },
    [{ type: 'built', seat, monument, points }],
  );
}

function applySkip(s: SticksState, seat: number, spot: Spot): Applied | string {
  if ((s.spots[spot][seat] ?? 0) <= 0 || (slotOf(spot) < 0 && stackOf(spot) < 0))
    return 'Only a card or a monument can be passed up.';
  return afterStep(clearSpot(s, seat, spot), [{ type: 'skipped', seat, spot }]);
}

/** What a face of a gift gives: 1–4 a good, 5 a tool step, 6 a harvest step (C19). */
const giftOf = (c: Clan, face: number): Clan =>
  face <= 4
    ? { ...c, goods: withArray(c.goods, face - 1, (c.goods[face - 1] ?? 0) + 1) }
    : face === 5
      ? gainTool(c)
      : gainField(c);

function applyPick(s: SticksState, seat: number, face: number): Applied | string {
  const g = s.gift;
  if (s.stage !== 'pick' || g === null || g.dice === null || g.order[0] !== seat)
    return 'It is not your pick.';
  const i = g.dice.indexOf(face);
  if (i < 0) return 'No die shows that face.';
  return settleGift(
    withClan(s, seat, (c) => giftOf(c, face)),
    g.dice.toSpliced(i, 1),
    g.order.slice(1),
    [{ type: 'picked', seat, face }],
  );
}

/** The last taker takes the last die; then the buyer goes on resolving. */
function settleGift(
  s: SticksState,
  dice: readonly number[],
  order: readonly number[],
  events: SticksEvent[],
): Applied {
  const last = order[0];
  if (order.length === 1 && last !== undefined && dice[0] !== undefined) {
    const face = dice[0];
    return afterStep(
      withClan(s, last, (c) => giftOf(c, face)),
      [...events, { type: 'picked', seat: last, face }],
    );
  }
  if (order.length === 0) return afterStep(s, events);
  return { state: { ...s, stage: 'pick', gift: { dice, order } }, events };
}

function applyChoose(s: SticksState, seat: number, take: readonly number[]): Applied | string {
  const c = s.clans[seat] as Clan;
  const p = pendingOf(s);
  if (p.type !== 'player' || p.seat !== seat || !['place', 'resolve', 'feed'].includes(s.stage))
    return 'You can use it only at one of your decisions.';
  if (c.choices <= 0 || sum(take) !== 2) return 'Take two goods with a card that gives them.';
  return {
    state: withClan(s, seat, (k) => ({ ...k, choices: k.choices - 1, goods: addGoods(k.goods, take) })),
    events: [{ type: 'chose', seat, take: [...take] }],
  };
}

function applyRolled(s: SticksState, dice: readonly number[]): Applied | string {
  const seat = s.turn;
  const base: SticksState = { ...s, roll: null, contributors: [], lastDice: { seat, dice: [...dice] } };
  if (s.gather !== null) {
    if (dice.length !== s.gather.count) return 'The roll has the wrong number of dice.';
    const gathering: SticksState = { ...base, gather: { ...s.gather, dice: [...dice] } };
    if (toolsHelp(s.clans[seat] as Clan, dice, s.gather.good))
      return { state: { ...gathering, stage: 'tools' }, events: [] };
    return finishGather(gathering, [], []);
  }
  if (s.gift !== null) {
    if (dice.length !== s.seats) return 'The roll has the wrong number of dice.';
    return settleGift(base, [...dice], s.gift.order, []);
  }
  return 'No roll is awaited.';
}

/* -------------------------------------------------------------------------------------------- feeding */

/** Food each seat still owes this round after its food: zero when it is fed. */
const shortfall = (c: Clan): number => Math.max(0, c.people - c.food);

/** Feeding (C24–C26): every clan reaps its harvest, then each in order eats; a hungry clan with goods decides. */
function startFeeding(s: SticksState, events: readonly SticksEvent[]): Applied {
  const reaped: SticksState = { ...s, clans: s.clans.map((c) => ({ ...c, food: c.food + c.field })) };
  return settleFeeding({ ...reaped, stage: 'feed', feeding: roundOrder(s.seats, s.first ?? 0) }, [...events]);
}

/** Feed every clan that has no choice to make, up to the next one that has, or the end of the round. */
function settleFeeding(s: SticksState, events: SticksEvent[]): Applied {
  let state = s;
  for (const seat of s.feeding) {
    const c = state.clans[seat] as Clan;
    const short = shortfall(c);
    if (short > 0 && sum(c.goods) + 2 * c.choices >= short)
      return {
        state: { ...state, turn: seat, feeding: state.feeding.slice(state.feeding.indexOf(seat)) },
        events,
      };
    state = withClan(state, seat, (k) =>
      short === 0 ? { ...k, food: k.food - k.people } : { ...k, food: 0, score: k.score - HUNGER },
    );
    events.push({ type: 'fed', seat, food: short === 0 ? c.people : c.food, goods: 0, hungry: short > 0 });
  }
  return endRound({ ...state, feeding: [] }, events);
}

function feedActions(s: SticksState, seat: number): SticksAction[] {
  const c = s.clans[seat] as Clan;
  const short = shortfall(c);
  return [
    ...vectors(c.goods, short).map((pay): SticksAction => ({ type: 'feed', actor: seat, pay })),
    { type: 'feed', actor: seat, pay: null },
    ...chooseActions(s, seat),
  ];
}

function applyFeed(s: SticksState, seat: number, pay: readonly number[] | null): Applied | string {
  if (s.stage !== 'feed' || s.turn !== seat || s.feeding[0] !== seat) return 'It is not your turn to feed.';
  const c = s.clans[seat] as Clan;
  const short = shortfall(c);
  const rest = { ...s, feeding: s.feeding.slice(1) };
  if (pay === null)
    return settleFeeding(
      withClan(rest, seat, (k) => ({ ...k, food: 0, score: k.score - HUNGER })),
      [{ type: 'fed', seat, food: c.food, goods: 0, hungry: true }],
    );
  if (sum(pay) !== short || pay.some((n, i) => n > (c.goods[i] ?? 0)))
    return 'Pay exactly the food you lack in goods.';
  return settleFeeding(
    withClan(rest, seat, (k) => ({
      ...k,
      food: 0,
      goods: addGoods(
        k.goods,
        pay.map((n) => -n),
      ),
    })),
    [{ type: 'fed', seat, food: c.food, goods: short, hungry: false }],
  );
}

/* ---------------------------------------------------------------------------------- rounds and the end */

/** After feeding: the game ends on an empty stack; else a new round, unless the pile cannot refill the display. */
function endRound(s: SticksState, events: SticksEvent[]): Applied {
  if (s.stacks.some((st) => st.built >= STACK_SIZE)) return endGame(s, 'monuments', events);
  const kept = s.display.filter((d) => d !== null);
  const empty = DISPLAY_SLOTS - kept.length;
  if (DISCOVERY_COUNT - s.next < empty) return endGame(s, 'pile', events);
  const fresh = Array.from({ length: empty }, (_, i) => ({ pos: s.next + i, card: null }));
  const first = ((s.first ?? 0) + 1) % s.seats;
  const round = s.round + 1;
  return {
    state: {
      ...s,
      stage: 'place',
      round,
      first,
      turn: first,
      clans: s.clans.map((c) => ({ ...c, used: c.used.map(() => false) })),
      home: s.clans.map((c) => c.people),
      spots: emptySpots(s.seats),
      display: [...kept, ...fresh],
      next: s.next + empty,
      dealt: [...s.dealt, ...fresh.map((d) => ({ deck: DECK_ID, pos: d.pos, to: null }))],
    },
    events: [...events, { type: 'round', round, first }],
  };
}

/** The end: face-down cards are turned up first, then the final count. */
function endGame(s: SticksState, reason: 'pile' | 'monuments', events: SticksEvent[]): Applied {
  const ended = [...events, { type: 'ended', reason } as const];
  const closed = s.clans.some((c) => c.hidden.some((h) => !h.open));
  const base: SticksState = { ...s, feeding: [], ended: reason };
  if (closed) return { state: { ...base, stage: 'ending' }, events: ended };
  return { state: { ...base, stage: 'over', result: outcomeOf(base, reason) }, events: ended };
}

/* ------------------------------------------------------------------------------------------- reveals */

function applyReveal(s: SticksState, pos: number, card: number): Applied | string {
  if (!revealPositions(s).includes(pos)) return 'No reveal is pending there.';
  if (s.order !== null && s.order[pos] !== card) return 'The reveal does not match the shuffled deck.';
  const discovery = pos < DISCOVERY_COUNT;
  if (discovery !== card < DISCOVERY_COUNT) return 'That card is not in this group of the deck.';
  if (s.stage === 'ending') {
    const clans = s.clans.map((c) => ({
      ...c,
      hidden: c.hidden.map((h) => (h.pos === pos ? { ...h, card, open: true } : h)),
    }));
    const state: SticksState = { ...s, clans, dealt: [...s.dealt, { deck: DECK_ID, pos, to: null }] };
    if (revealPositions(state).length > 0) return { state, events: [] };
    return { state: { ...state, stage: 'over', result: outcomeOf(state, s.ended ?? 'pile') }, events: [] };
  }
  if (discovery) {
    const seen = [
      ...s.display.flatMap((d) => (d?.card == null ? [] : [d.card])),
      ...s.clans.flatMap((c) => [...c.cards, ...c.hidden.flatMap((h) => (h.card === null ? [] : [h.card]))]),
    ];
    if (seen.includes(card)) return 'That discovery is already out.';
    const display = s.display.map((d) => (d?.pos === pos ? { pos, card } : d));
    let state: SticksState = { ...s, display };
    const events: SticksEvent[] = [];
    if (state.first === null && pos === 0) {
      // The first player: the first card of the opening display, counted round the table (C02). 36 cards divide
      // evenly by 2, 3 and 4, so every seat is as likely.
      const first = card % s.seats;
      state = { ...state, first, turn: first };
      events.push({ type: 'first', seat: first });
    }
    return { state, events };
  }
  const k = s.stacks.findIndex((st, i) => st.top === null && stackPos(i, st.built) === pos);
  const seen = [
    ...s.stacks.flatMap((st) => (st.top === null ? [] : [st.top])),
    ...s.clans.flatMap((c) => c.monuments.map((m) => m + DISCOVERY_COUNT)),
  ];
  if (k < 0 || seen.includes(card)) return 'That monument is already out.';
  return {
    state: { ...s, stacks: withArray(s.stacks, k, { ...(s.stacks[k] as { built: number }), top: card }) },
    events: [],
  };
}

/* -------------------------------------------------------------------------------------- legal actions */

export function legalActions(s: SticksState, seat: number): SticksAction[] {
  try {
    const p = pendingOf(s);
    if (p.type !== 'player' || p.seat !== seat) return [];
    switch (s.stage) {
      case 'roll':
        return s.roll === null ? [] : [{ type: 'contribute', actor: seat, id: s.roll }];
      case 'place':
        return [
          ...SPOTS.flatMap((spot) =>
            placeCounts(s, seat, spot).map(
              (count): SticksAction => ({ type: 'place', actor: seat, spot, count }),
            ),
          ),
          ...chooseActions(s, seat),
        ];
      case 'resolve':
        return resolveActions(s, seat);
      case 'tools':
        return toolActions(s, seat);
      case 'pick':
        return [...new Set(s.gift?.dice ?? [])]
          .sort((a, b) => a - b)
          .map((face) => ({ type: 'pick', actor: seat, face }));
      case 'feed':
        return feedActions(s, seat);
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------------------------------- apply */

export function applyAction(s: SticksState, raw: unknown): ApplyResult<SticksState, SticksEvent> {
  try {
    const a = parseAction(raw);
    if (a === null) return failure('Not a Sticks & Stones action.');
    const r = dispatch(s, a);
    return typeof r === 'string' ? failure(r) : { ok: true, state: r.state, events: r.events };
  } catch {
    return failure('Invalid action.');
  }
}

function dispatch(s: SticksState, a: SticksAction): Applied | string {
  if (s.stage === 'over') return 'The game is over.';
  const p = pendingOf(s);
  if (a.type === 'reveal')
    return p.type === 'reveal' ? applyReveal(s, a.pos, a.card) : 'No reveal is pending.';
  if (a.type === 'rolled')
    return p.type === 'beacon' && p.id === a.id ? applyRolled(s, a.dice) : 'No roll is awaited.';
  if (p.type !== 'player' || p.seat !== a.actor) return 'It is not your decision.';
  switch (a.type) {
    case 'contribute':
      if (s.stage !== 'roll' || s.roll !== a.id) return 'No share of that roll is owed.';
      return { state: { ...s, contributors: s.contributors.slice(1) }, events: [] };
    case 'place':
      return applyPlace(s, a.actor, a.spot, a.count);
    case 'choose':
      return applyChoose(s, a.actor, a.take);
    case 'tools':
      return applyTools(s, a.actor, a.tools, a.spares);
    case 'pick':
      return applyPick(s, a.actor, a.face);
    case 'feed':
      return applyFeed(s, a.actor, a.pay);
    default:
      break;
  }
  if (s.stage !== 'resolve' || s.turn !== a.actor) return 'It is not your turn to resolve.';
  switch (a.type) {
    case 'use':
      return applyUse(s, a.actor, a.spot);
    case 'buy':
      return applyBuy(s, a.actor, a.slot, a.pay);
    case 'build':
      return applyBuild(s, a.actor, a.stack, a.pay);
    case 'skip':
      return applySkip(s, a.actor, a.spot);
    default:
      return 'That is not a move now.';
  }
}
