/*
 * The Hazard rules engine (docs/games/hazard/RULES.md, D088). Pure: `apply` never throws or mutates, and every move
 * has one accepted encoding. Battles and the first-player roll take their dice from the beacon (D058): the action
 * that fixes the dice opens a roll, every seat adds a share, and the session derives the faces. Charters are the deck
 * `pile` (cards.ts); a cashed set is turned face up by a public reveal before it pays (charters.ts).
 */
import type { ApplyResult, DeckSpec, Pending, Result, SetupInput } from '@bored-games/game-kit';
import { applyBattle, battleLegal } from './battle.ts';
import { CARD_COUNT } from './cards.ts';
import { applyCharters, chartersLegal } from './charters.ts';
import { isProvince, PROVINCES, type ProvinceId, provinceIndex, REALMS } from './map.ts';
import type { HazardAction, HazardEvent, HazardRules, HazardState } from './types.ts';

export const DEFAULT_RULES: HazardRules = { defense: 'choose' };

export const PILE_ID = 'pile';

/** The charters: 42 provinces and two Crowns. Every other seat's open app releases its share of a drawn charter. */
export const PILE: DeckSpec = { id: PILE_ID, size: CARD_COUNT, promptShares: true };

export const MIN_SEATS = 3;
export const MAX_SEATS = 6;
const STARTING_TROOPS: Readonly<Record<number, number>> = { 3: 35, 4: 30, 5: 25, 6: 20 };
const FACES = 6;

/* ------------------------------------------------------------------------------------------- helpers */

export type Applied = { readonly state: HazardState; readonly events: readonly HazardEvent[] };

export const failure = (message: string) => ({ ok: false as const, error: { code: 'invalid', message } });
export const int = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0);
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x: Record<string, unknown>, ks: readonly string[]): boolean =>
  Object.keys(x).sort().join(',') === [...ks].sort().join(',');
const plainArray = (x: unknown): x is unknown[] => Array.isArray(x) && Object.keys(x).length === x.length;

/** The index of a province, for the `owner` and `troops` arrays. */
export const at = (p: ProvinceId): number => provinceIndex(p);

/** The provinces `seat` holds, in PROVINCES order. */
export const heldBy = (s: HazardState, seat: number): ProvinceId[] =>
  PROVINCES.filter((_, i) => s.owner[i] === seat);

/** Seats still on the map, in seat order. */
export const alive = (s: HazardState): number[] =>
  Array.from({ length: s.seats }, (_, i) => i).filter((i) => !s.out.includes(i));

/** The next seat after `seat` that is still in play. */
export const nextAlive = (s: HazardState, seat: number): number => {
  for (let k = 1; k <= s.seats; k++) {
    const n = (seat + k) % s.seats;
    if (!s.out.includes(n)) return n;
  }
  return seat;
};

export const withArray = <T>(xs: readonly T[], i: number, v: T): T[] => {
  const out = [...xs];
  out[i] = v;
  return out;
};

/* --------------------------------------------------------------------------------------------- rules */

export function validateRules(raw: unknown): Result<HazardRules> {
  try {
    if (obj(raw) && keys(raw, ['defense']) && (raw.defense === 'choose' || raw.defense === 'auto'))
      return { ok: true, value: { defense: raw.defense } };
    return failure("Rules must be { defense: 'choose' } or { defense: 'auto' }.");
  } catch {
    return failure('Invalid rules.');
  }
}

/* --------------------------------------------------------------------------------------------- setup */

export function setupGame(input: SetupInput<HazardRules>): Result<HazardState> {
  try {
    const rules = validateRules(input.rules);
    if (!rules.ok) return rules;
    const seats = input.seats;
    if (!int(seats) || seats < MIN_SEATS || seats > MAX_SEATS) return failure('Choose 3–6 players.');
    let plain: Record<string, number> | null = null;
    if (input.mode === 'full') {
      const order = input.deckOrders[PILE_ID];
      const sorted = order === undefined ? [] : [...order].sort((a, b) => a - b);
      if (sorted.length !== CARD_COUNT || sorted.some((c, i) => c !== i))
        return failure('The charter order must be a permutation of the 44 charters.');
      plain = Object.fromEntries((order as readonly number[]).map((card, pos) => [String(pos), card]));
    } else if (input.mode === 'view') {
      if (input.viewer !== null && (!int(input.viewer) || input.viewer >= seats))
        return failure('Invalid viewer.');
    } else return failure('Invalid mode.');
    const troops = STARTING_TROOPS[seats] as number;
    return {
      ok: true,
      value: {
        rules: rules.value,
        seats,
        full: input.mode === 'full',
        viewer: input.mode === 'view' ? input.viewer : null,
        stage: 'order',
        turn: 0,
        owner: PROVINCES.map(() => null),
        troops: PROVINCES.map(() => 0),
        reserve: Array.from({ length: seats }, () => troops),
        first: null,
        tied: Array.from({ length: seats }, (_, i) => i),
        rolls: [],
        roll: null,
        contributors: [],
        pool: 0,
        midTurn: false,
        bonusUsed: false,
        captured: false,
        battle: null,
        dice: null,
        advance: null,
        hands: Array.from({ length: seats }, () => []),
        pile: Array.from({ length: CARD_COUNT }, (_, i) => i),
        discard: [],
        epoch: 0,
        cashes: 0,
        cashing: null,
        revealed: [],
        plain,
        out: [],
        fouls: [],
        dealt: [],
        result: null,
      },
    };
  } catch {
    return failure('Invalid setup.');
  }
}

/* ---------------------------------------------------------------------------------------------- parse */

const isFace = (x: unknown): boolean => int(x) && x >= 1 && x <= FACES;
const seatOf = (x: unknown): x is number => int(x);

/** The one accepted encoding of each action, or null. Never throws. */
export function parseAction(raw: unknown): HazardAction | null {
  try {
    if (!obj(raw) || typeof raw.type !== 'string') return null;
    const { type, actor } = raw;
    switch (type) {
      case 'rolled': {
        const { id, dice } = raw;
        if (!keys(raw, ['type', 'actor', 'id', 'dice']) || actor !== 'beacon' || !int(id)) return null;
        if (!plainArray(dice) || dice.length < 1 || dice.length > MAX_SEATS || !dice.every(isFace))
          return null;
        return { type, actor, id, dice: [...(dice as number[])] };
      }
      case 'reveal': {
        const { deck, pos, card } = raw;
        if (!keys(raw, ['type', 'actor', 'deck', 'pos', 'card']) || actor !== 'deck' || deck !== PILE_ID)
          return null;
        return int(pos) && int(card) && card < CARD_COUNT ? { type, actor, deck, pos, card } : null;
      }
      case 'epoch': {
        const { epoch, size } = raw;
        if (!keys(raw, ['type', 'actor', 'epoch', 'size']) || actor !== 'deck') return null;
        return int(epoch) && int(size) ? { type, actor, epoch, size } : null;
      }
      default:
        break;
    }
    if (!seatOf(actor)) return null;
    switch (type) {
      case 'roll':
      case 'endAttack':
      case 'endTurn':
        return keys(raw, ['type', 'actor']) ? { type, actor } : null;
      case 'contribute':
        return keys(raw, ['type', 'actor', 'id']) && int(raw.id) ? { type, actor, id: raw.id } : null;
      case 'claim':
      case 'place':
        return keys(raw, ['type', 'actor', 'province']) && isProvince(raw.province)
          ? { type, actor, province: raw.province }
          : null;
      case 'muster':
        return keys(raw, ['type', 'actor', 'province', 'count']) && isProvince(raw.province) && int(raw.count)
          ? { type, actor, province: raw.province, count: raw.count }
          : null;
      case 'cash': {
        const { positions, bonus } = raw;
        if (!keys(raw, ['type', 'actor', 'positions', 'bonus']) || !plainArray(positions)) return null;
        if (positions.length !== 3 || !positions.every(int)) return null;
        const [p0, p1, p2] = positions as [number, number, number];
        if (!(p0 < p1 && p1 < p2)) return null;
        if (bonus !== null && !isProvince(bonus)) return null;
        return { type, actor, positions: [p0, p1, p2], bonus };
      }
      case 'attack': {
        const { from, to, dice } = raw;
        return keys(raw, ['type', 'actor', 'from', 'to', 'dice']) &&
          isProvince(from) &&
          isProvince(to) &&
          int(dice)
          ? { type, actor, from, to, dice }
          : null;
      }
      case 'defend':
        return keys(raw, ['type', 'actor', 'dice']) && int(raw.dice) ? { type, actor, dice: raw.dice } : null;
      case 'advance':
        return keys(raw, ['type', 'actor', 'count']) && int(raw.count)
          ? { type, actor, count: raw.count }
          : null;
      case 'march': {
        const { from, to, count } = raw;
        return keys(raw, ['type', 'actor', 'from', 'to', 'count']) &&
          isProvince(from) &&
          isProvince(to) &&
          int(count)
          ? { type, actor, from, to, count }
          : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------------------------- pending */

/** The decision a player-pending stage names. */
const DECISION: Readonly<Partial<Record<HazardState['stage'], string>>> = {
  order: 'roll',
  claim: 'claim',
  place: 'place',
  muster: 'muster',
  attack: 'attack',
  advance: 'advance',
  march: 'march',
};

export function pendingOf(s: HazardState): Pending {
  switch (s.stage) {
    case 'over':
      return { type: 'over' };
    case 'orderRoll':
    case 'roll': {
      const next = s.contributors[0];
      if (next !== undefined) return { type: 'player', seat: next, decision: 'contribute' };
      return { type: 'beacon', id: s.roll ?? 0 };
    }
    case 'defend': {
      const to = s.battle?.to;
      return {
        type: 'player',
        seat: to === undefined ? s.turn : (s.owner[at(to)] ?? s.turn),
        decision: 'defend',
      };
    }
    case 'reveal':
      return {
        type: 'reveal',
        deck: PILE_ID,
        positions: (s.cashing?.positions ?? []).filter((p) => !s.revealed.some((r) => r.pos === p)),
      };
    case 'shuffle':
      return {
        type: 'shuffle',
        deck: PILE_ID,
        epoch: s.epoch + 1,
        from: s.discard.map((d) => ({ deck: PILE_ID, pos: d.pos })),
      };
    case 'order':
      return { type: 'player', seat: s.tied[0] ?? 0, decision: 'roll' };
    default:
      return { type: 'player', seat: s.turn, decision: DECISION[s.stage] ?? s.stage };
  }
}

/** The roll a `contribute` carries a beacon share for: the open one (D058). Never throws. */
export function beaconFor(s: HazardState, raw: unknown): number | null {
  try {
    return obj(raw) && raw.type === 'contribute' ? s.roll : null;
  } catch {
    return null;
  }
}

/** How many dice the open roll has: one per tied seat, or the attacker's and the defender's together. */
export function rollShapeOf(s: HazardState): { count: number; sides: number } {
  if (s.stage === 'orderRoll') return { count: s.tied.length, sides: FACES };
  const b = s.battle;
  return { count: b === null ? 2 : b.attack + (b.defend ?? 0), sides: FACES };
}

/**
 * Open a roll requested by `seat`: every seat adds a share, from the one after the requester round to the requester
 * itself, as Room for Doubt does (D058, D078).
 */
export function openRoll(s: HazardState, seat: number, stage: 'orderRoll' | 'roll'): HazardState {
  const id = s.rolls.length;
  return {
    ...s,
    stage,
    roll: id,
    rolls: [...s.rolls, { id, last: seat }],
    contributors: Array.from({ length: s.seats }, (_, k) => (seat + 1 + k) % s.seats),
  };
}

/* ---------------------------------------------------------------------------------------- the opening */

/** Troops `seat` musters at the start of its turn: a third of its provinces (at least 3) and its whole realms. */
export function reinforcements(s: HazardState, seat: number): number {
  const held = s.owner.filter((o) => o === seat).length;
  const realms = REALMS.filter((r) => r.provinces.every((p) => s.owner[at(p)] === seat));
  return Math.max(3, Math.floor(held / 3)) + realms.reduce((n, r) => n + r.bonus, 0);
}

/** Start `seat`'s turn: count its troops and open the muster. */
export function startTurn(s: HazardState, seat: number): Applied {
  const pool = reinforcements(s, seat);
  return {
    state: {
      ...s,
      stage: 'muster',
      turn: seat,
      pool,
      midTurn: false,
      bonusUsed: false,
      captured: false,
      battle: null,
      advance: null,
    },
    events: [{ type: 'turn', seat, troops: pool }],
  };
}

function applyOrderRolled(s: HazardState, dice: readonly number[]): Applied | string {
  if (dice.length !== s.tied.length) return 'The roll has the wrong number of dice.';
  const top = Math.max(...dice);
  const tied = s.tied.filter((_, i) => dice[i] === top);
  const base = { ...s, roll: null, contributors: [] };
  if (tied.length > 1)
    return {
      state: { ...base, stage: 'order', tied },
      events: [{ type: 'tie', seats: tied, faces: [...dice] }],
    };
  const first = tied[0] as number;
  return {
    state: { ...base, stage: 'claim', tied: [], first, turn: first },
    events: [{ type: 'first', seat: first, faces: [...dice] }],
  };
}

function applyOpening(s: HazardState, a: HazardAction): Applied | string {
  const seat = (a as { actor: number }).actor;
  switch (a.type) {
    case 'roll':
      if (s.stage !== 'order' || s.tied[0] !== seat) return 'It is not your roll.';
      return { state: openRoll(s, seat, 'orderRoll'), events: [] };
    case 'claim': {
      if (s.stage !== 'claim') return 'Claiming is over.';
      if (s.turn !== seat) return 'It is not your turn.';
      const i = at(a.province);
      if (s.owner[i] !== null) return 'That province is already claimed.';
      const owner = withArray(s.owner, i, seat);
      const state: HazardState = {
        ...s,
        owner,
        troops: withArray(s.troops, i, 1),
        reserve: withArray(s.reserve, seat, (s.reserve[seat] ?? 0) - 1),
        turn: (seat + 1) % s.seats,
        stage: owner.includes(null) ? 'claim' : 'place',
      };
      return { state: settlePlacing(state), events: [{ type: 'claimed', seat, province: a.province }] };
    }
    case 'place': {
      if (s.stage !== 'place') return 'Placing is over.';
      if (s.turn !== seat) return 'It is not your turn.';
      const i = at(a.province);
      if (s.owner[i] !== seat) return 'Place troops on your own province.';
      const state: HazardState = {
        ...s,
        troops: withArray(s.troops, i, (s.troops[i] ?? 0) + 1),
        reserve: withArray(s.reserve, seat, (s.reserve[seat] ?? 0) - 1),
        turn: (seat + 1) % s.seats,
      };
      const settled = settlePlacing(state);
      const events: HazardEvent[] = [{ type: 'placed', seat, province: a.province }];
      if (settled.stage !== 'place' || settled.reserve.some((r) => r > 0)) return { state: settled, events };
      // Every troop is out: the first claimer takes the first turn.
      const first = startTurn(settled, settled.first ?? 0);
      return { state: first.state, events: [...events, ...first.events] };
    }
    default:
      return 'That is not an opening move.';
  }
}

/** In the placing stage, pass over seats with nothing left to place. */
function settlePlacing(s: HazardState): HazardState {
  if (s.stage !== 'place') return s;
  for (let k = 0; k < s.seats; k++) {
    const seat = (s.turn + k) % s.seats;
    if ((s.reserve[seat] ?? 0) > 0) return { ...s, turn: seat };
  }
  return s;
}

/* -------------------------------------------------------------------------------------- legal actions */

export function legalActions(s: HazardState, seat: number): HazardAction[] {
  try {
    const p = pendingOf(s);
    if (p.type !== 'player' || p.seat !== seat) return [];
    switch (s.stage) {
      case 'order':
        return [{ type: 'roll', actor: seat }];
      case 'orderRoll':
      case 'roll':
        return s.roll === null ? [] : [{ type: 'contribute', actor: seat, id: s.roll }];
      case 'claim':
        return PROVINCES.filter((_, i) => s.owner[i] === null).map((province) => ({
          type: 'claim',
          actor: seat,
          province,
        }));
      case 'place':
        return heldBy(s, seat).map((province) => ({ type: 'place', actor: seat, province }));
      case 'muster':
        return chartersLegal(s, seat);
      default:
        return battleLegal(s, seat);
    }
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------------------------------- apply */

export function applyAction(s: HazardState, raw: unknown): ApplyResult<HazardState, HazardEvent> {
  try {
    const a = parseAction(raw);
    if (a === null) return failure('Not a Hazard action.');
    const r = dispatch(s, a);
    return typeof r === 'string' ? failure(r) : { ok: true, state: r.state, events: r.events };
  } catch {
    return failure('Invalid action.');
  }
}

function dispatch(s: HazardState, a: HazardAction): Applied | string {
  if (s.stage === 'over') return 'The game is over.';
  switch (a.type) {
    case 'contribute': {
      if (s.stage !== 'orderRoll' && s.stage !== 'roll') return 'No roll is open.';
      if (s.contributors[0] !== a.actor || s.roll !== a.id) return 'No share of that roll is owed.';
      return { state: { ...s, contributors: s.contributors.slice(1) }, events: [] };
    }
    case 'rolled': {
      const p = pendingOf(s);
      if (p.type !== 'beacon' || p.id !== a.id) return 'No roll is awaited.';
      return s.stage === 'orderRoll' ? applyOrderRolled(s, a.dice) : applyBattle(s, a);
    }
    case 'roll':
    case 'claim':
    case 'place':
      return applyOpening(s, a);
    case 'muster':
    case 'cash':
    case 'reveal':
    case 'epoch':
    case 'endAttack':
      return applyCharters(s, a);
    default:
      return applyBattle(s, a);
  }
}
