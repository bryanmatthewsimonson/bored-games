/*
 * The muster and the charters: cashing a set, its public reveal, drawing and reshuffles (RULES.md "Muster" and
 * "Charters"). Pure. A set is not checked when it is cashed: a view does not know the cards, and every view must
 * apply the move as the full state does. Its three positions are dealt to the table, every seat's app shares them,
 * and the set pays once all three are face up. Only a cheating client can cash a false set; it pays nothing and the
 * seat is marked as fouled.
 */
import type { ApplyResult } from '@bored-games/game-kit';
import { isSet, provinceOfCard, setValue } from './cards.ts';
import type { ProvinceId } from './map.ts';
import type { HazardAction, HazardEvent, HazardState, Slot } from './types.ts';
import { type Applied, at, failure, heldBy, withArray } from './util.ts';

/** The stride between reshuffles' positions (PROTOCOL §5, D073): reshuffle k deals positions 128·k + i. */
export const EPOCH_STRIDE = 128;

/** Whether `seat` must cash before it may place: five or more charters at the turn's start, or over four mid-turn. */
export const mustCash = (s: HazardState, seat: number): boolean => {
  const n = s.hands[seat]?.length ?? 0;
  return s.midTurn ? n > 4 : n >= 5;
};

/** Whether `seat` may cash now: mid-turn only while it holds more than four (then it must stop). */
const mayCash = (s: HazardState, seat: number): boolean => (s.midTurn ? mustCash(s, seat) : true);

/** Whether this state knows every charter in `seat`'s hand. */
export const handKnown = (s: HazardState, seat: number): boolean =>
  (s.hands[seat] ?? []).every((slot) => slot.card !== null);

/** The provinces on `cards` that `seat` holds, if this turn's extra troops are still to be had; else none. */
export function bonusChoices(s: HazardState, seat: number, cards: readonly number[]): ProvinceId[] {
  if (s.bonusUsed) return [];
  return cards
    .map(provinceOfCard)
    .filter((p): p is ProvinceId => p !== null && s.owner[at(p)] === seat)
    .sort((x, y) => at(x) - at(y));
}

const triples = (n: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) out.push([i, j, k]);
  return out;
};

/** Every set `seat` may cash, with each bonus province it may name (or null when it may name none). */
function cashOptions(s: HazardState, seat: number): HazardAction[] {
  const hand = [...(s.hands[seat] ?? [])].sort((x, y) => x.pos - y.pos);
  const out: HazardAction[] = [];
  for (const [i, j, k] of triples(hand.length)) {
    const slots = [hand[i], hand[j], hand[k]] as Slot[];
    const cards = slots.map((x) => x.card as number);
    if (!isSet(cards)) continue;
    const positions = slots.map((x) => x.pos);
    const choices = bonusChoices(s, seat, cards);
    for (const bonus of choices.length === 0 ? [null] : choices)
      out.push({ type: 'cash', actor: seat, positions, bonus });
  }
  return out;
}

export function chartersLegal(s: HazardState, seat: number): HazardAction[] {
  if (s.stage !== 'muster') return [];
  // A hand with a charter not yet learned: what may be cashed, and so whether placing is allowed, is unknown.
  if (!handKnown(s, seat)) return [];
  const cash = mayCash(s, seat) ? cashOptions(s, seat) : [];
  if (mustCash(s, seat)) return cash;
  const counts = [...new Set([1, s.pool])];
  return [
    ...cash,
    ...heldBy(s, seat).flatMap((province) =>
      counts.map((count): HazardAction => ({ type: 'muster', actor: seat, province, count })),
    ),
  ];
}

/** After a muster or a cash: the attack opens once the pool is empty and nothing more must be cashed. */
function settleMuster(s: HazardState): HazardState {
  if (s.stage === 'muster' && s.pool === 0 && !mustCash(s, s.turn))
    return { ...s, stage: 'attack', midTurn: false };
  return s;
}

export function applyCharters(s: HazardState, a: HazardAction): Applied | string {
  switch (a.type) {
    case 'muster': {
      if (s.stage !== 'muster' || s.turn !== a.actor) return 'It is not your turn to muster.';
      if (mustCash(s, a.actor)) return 'Cash in a set first.';
      if (a.count < 1 || a.count > s.pool) return `Place 1 to ${s.pool} troops.`;
      const i = at(a.province);
      if (s.owner[i] !== a.actor) return 'Muster troops on your own province.';
      return {
        state: settleMuster({
          ...s,
          troops: withArray(s.troops, i, (s.troops[i] ?? 0) + a.count),
          pool: s.pool - a.count,
        }),
        events: [{ type: 'mustered', seat: a.actor, province: a.province, count: a.count }],
      };
    }
    case 'cash': {
      if (s.stage !== 'muster' || s.turn !== a.actor) return 'It is not your turn to cash in.';
      if (!mayCash(s, a.actor)) return 'Stop cashing: you hold four charters or fewer.';
      const hand = s.hands[a.actor] ?? [];
      if (!a.positions.every((pos) => hand.some((x) => x.pos === pos))) return 'Cash in charters you hold.';
      return {
        state: {
          ...s,
          stage: 'reveal',
          cashing: { seat: a.actor, positions: [...a.positions], bonus: a.bonus },
          revealed: [],
          dealt: [...s.dealt, ...a.positions.map((pos) => ({ deck: 'pile', pos, to: null }))],
        },
        events: [{ type: 'cashing', seat: a.actor }],
      };
    }
    case 'reveal': {
      const c = s.cashing;
      if (s.stage !== 'reveal' || c === null) return 'No charter is being turned up.';
      if (!c.positions.includes(a.pos) || s.revealed.some((r) => r.pos === a.pos))
        return 'That charter is not owed.';
      if (s.plain !== null && s.plain[String(a.pos)] !== a.card)
        return 'That is not the charter at that position.';
      const revealed = [...s.revealed, { pos: a.pos, card: a.card }];
      const next = { ...s, revealed };
      return revealed.length < c.positions.length ? { state: next, events: [] } : payCash(next);
    }
    case 'endAttack': {
      if (s.stage !== 'attack' || s.turn !== a.actor) return 'It is not your turn.';
      const done = { ...s, stage: 'march' as const, battle: null };
      return s.captured ? draw(done) : { state: done, events: [{ type: 'ended', seat: a.actor }] };
    }
    case 'epoch': {
      if (s.stage !== 'shuffle') return 'No reshuffle is pending.';
      if (a.epoch !== s.epoch + 1 || a.size !== s.discard.length) return 'That is not the pending reshuffle.';
      const pile = s.discard.map((_, i) => EPOCH_STRIDE * a.epoch + i);
      if (s.plain !== null && pile.some((pos) => s.plain?.[String(pos)] === undefined))
        return 'The reshuffled order is not installed.';
      const drawn = draw({ ...s, stage: 'march', pile, discard: [], epoch: a.epoch });
      return {
        state: drawn.state,
        events: [{ type: 'reshuffled', epoch: a.epoch, size: a.size }, ...drawn.events],
      };
    }
    default:
      return 'That move is not possible now.';
  }
}

/** The three cards are face up: the set leaves the hand for the discard and pays, if it is a set. */
function payCash(s: HazardState): Applied {
  const c = s.cashing as NonNullable<HazardState['cashing']>;
  const cards = c.positions.map((pos) => s.revealed.find((r) => r.pos === pos)?.card as number);
  const valid = isSet(cards);
  const choices = bonusChoices(s, c.seat, cards);
  const bonusOk = c.bonus === null ? choices.length === 0 : choices.includes(c.bonus);
  const troops = valid ? setValue(s.cashes) : 0;
  const bonus = valid && bonusOk && c.bonus !== null ? c.bonus : null;
  const foul = !valid || !bonusOk;
  let next: HazardState = {
    ...s,
    stage: 'muster',
    hands: withArray(
      s.hands,
      c.seat,
      (s.hands[c.seat] ?? []).filter((x) => !c.positions.includes(x.pos)),
    ),
    discard: [...s.discard, ...c.positions.map((pos, i) => ({ pos, card: cards[i] as number }))],
    pool: s.pool + troops,
    cashes: s.cashes + (valid ? 1 : 0),
    cashing: null,
    revealed: [],
    fouls: foul && !s.fouls.includes(c.seat) ? [...s.fouls, c.seat] : s.fouls,
  };
  if (bonus !== null) {
    const i = at(bonus);
    next = { ...next, troops: withArray(next.troops, i, (next.troops[i] ?? 0) + 2), bonusUsed: true };
  }
  const events: HazardEvent[] = [{ type: 'cashed', seat: c.seat, cards, troops, bonus, foul }];
  return { state: settleMuster(next), events };
}

/** The turn seat takes the top charter; an empty pile is first reshuffled from the discard, if it holds any. */
function draw(s: HazardState): Applied {
  const seat = s.turn;
  const pos = s.pile[0];
  if (pos === undefined) {
    if (s.discard.length > 0) return { state: { ...s, stage: 'shuffle' }, events: [] };
    return { state: s, events: [{ type: 'ended', seat }] };
  }
  const slot: Slot = { pos, card: s.plain?.[String(pos)] ?? null, holders: [seat] };
  return {
    state: {
      ...s,
      pile: s.pile.slice(1),
      hands: withArray(s.hands, seat, [...(s.hands[seat] ?? []), slot]),
      dealt: [...s.dealt, { deck: 'pile', pos, to: seat }],
    },
    events: [
      { type: 'drew', seat },
      { type: 'ended', seat },
    ],
  };
}

/** Full mode only: the cards of a pending reshuffle, in their new order (PROTOCOL §5, D073). Emits nothing. */
export function installDeckOrder(
  s: HazardState,
  epoch: number,
  order: readonly number[],
): ApplyResult<HazardState, HazardEvent> {
  if (s.plain === null) return failure('A view has no charter order.');
  if (s.stage !== 'shuffle' || epoch !== s.epoch + 1) return failure('No such reshuffle is pending.');
  const want = s.discard.map((d) => d.card).sort((x, y) => x - y);
  const got = [...order].sort((x, y) => x - y);
  if (got.length !== want.length || got.some((c, i) => c !== want[i]))
    return failure('The order is not a shuffle of the cashed charters.');
  const plain = { ...s.plain };
  order.forEach((card, i) => {
    plain[String(EPOCH_STRIDE * epoch + i)] = card;
  });
  return { ok: true, state: { ...s, plain }, events: [] };
}

/** The cashed charters being reshuffled, in `from` order; empty outside full mode. */
export const shufflePlaintexts = (s: HazardState): readonly number[] =>
  s.plain !== null && s.stage === 'shuffle' ? s.discard.map((d) => d.card) : [];
