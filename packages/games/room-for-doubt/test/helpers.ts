import { deepFreeze, type FuzzPolicy, packetOrder, type Rng, range, SHOW_DECK } from '@bored-games/game-kit';
import { DOORS, type Place, squareIndex, squareName } from '../src/board.ts';
import { cardOf, DEFAULT_RULES, pendingOf } from '../src/engine.ts';
import {
  DECK_ID,
  DECK_SIZE,
  type ExhibitId,
  HAND_POSITIONS,
  PARTIES,
  type PartyId,
  ROOM_POSITIONS,
  SCENES,
  type SceneId,
} from '../src/ids.ts';
import { CASE_DECK, roomForDoubt } from '../src/module.ts';
import type { RfdAction, RfdRules, RfdState } from '../src/types.ts';

/** A Party, Exhibit or Scene card by its engine id. */
export type CardId = PartyId | ExhibitId | SceneId;

/** The Verdict of `orderWith` when a test names none: the last card of each kind. */
export const VERDICT: readonly [PartyId, ExhibitId, SceneId] = ['quarrel', 'clockhand', 'gallery'];

/** A case order the two shuffle rounds can produce (D076), drawn from `rng`. */
export const caseOrder = (rng: Rng): number[] => packetOrder(CASE_DECK, rng);

/**
 * The 30-card order with `verdict` at positions 0, 6 and 12, and `hands` (else the 18 other case cards ascending)
 * at `HAND_POSITIONS`, in that order: card k goes to seat k mod n. Room cards keep identity order, so the Exhibits
 * start gavel→courtroom, scales→chambers, reports→jury, carafe→robing, manacles→registry and clockhand→store.
 */
export function orderWith(
  verdict: readonly [PartyId, ExhibitId, SceneId] = VERDICT,
  hands?: readonly string[],
): number[] {
  const sealed = verdict.map((id) => cardOf(id));
  const rest =
    hands === undefined
      ? range(21).filter((n) => !sealed.includes(n))
      : hands.map((id) => cardOf(id as CardId));
  if (rest.length !== HAND_POSITIONS.length || new Set([...sealed, ...rest]).size !== 21 || rest.includes(-1))
    throw new Error('orderWith: the hands must be the 18 case cards outside the Verdict');
  const order = range(DECK_SIZE);
  order[0] = sealed[0] as number;
  order[6] = sealed[1] as number;
  order[12] = sealed[2] as number;
  HAND_POSITIONS.forEach((pos, k) => {
    order[pos] = rest[k] as number;
  });
  return order;
}

/** The frozen full state at setup, before the room reveals. */
export function fresh(
  seats: number,
  order: readonly number[] = orderWith(),
  rules: RfdRules = DEFAULT_RULES,
): RfdState {
  const r = roomForDoubt.setup({ rules, seats, mode: 'full', deckOrders: { [DECK_ID]: order } });
  if (!r.ok) throw new Error(r.error.message);
  return deepFreeze(r.value);
}

/** The view of `viewer` (a seat, or null for a spectator) at setup, before it has learned anything. */
export function freshView(seats: number, viewer: number | null, rules: RfdRules = DEFAULT_RULES): RfdState {
  const r = roomForDoubt.setup({ rules, seats, mode: 'view', viewer });
  if (!r.ok) throw new Error(r.error.message);
  return deepFreeze(r.value);
}

/** Apply the pending public reveals from the full state's order. */
export function revealAll(s: RfdState, order: readonly number[] | null = s.order): RfdState {
  let t = s;
  // Every loop in these helpers is bounded, so a broken engine fails a test instead of hanging it.
  for (let n = 0; n < ROOM_POSITIONS.length; n++) {
    const p = pendingOf(t);
    if (p.type !== 'reveal') return t;
    const pos = p.positions[0] as number;
    t = act(t, { type: 'reveal', actor: 'deck', deck: DECK_ID, pos, card: order?.[pos] });
  }
  if (pendingOf(t).type === 'reveal') throw new Error('the reveals do not end');
  return t;
}

/** The first turn: the six Exhibits placed, seat 0 to move. */
export const started = (seats: number, order?: readonly number[], rules?: RfdRules): RfdState =>
  revealAll(fresh(seats, order, rules));

/** Apply an action that must be accepted. */
export function act(s: RfdState, a: unknown): RfdState {
  const r = roomForDoubt.apply(s, a);
  if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error.message}`);
  return deepFreeze(r.state);
}

/** An action's rejection message, or null when it is accepted. */
export function refused(s: RfdState, a: unknown): string | null {
  const r = roomForDoubt.apply(s, a);
  return r.ok ? null : r.error.message;
}

/** Learn a card that must be accepted. */
export function learned(s: RfdState, l: { deck: string; pos: number; card: number }): RfdState {
  const r = roomForDoubt.learn(s, l);
  if (!r.ok) throw new Error(`learn ${JSON.stringify(l)}: ${r.error.message}`);
  return deepFreeze(r.state);
}

/** The seat whose decision is pending, or null. */
export function pendingSeat(s: RfdState): number | null {
  const p = pendingOf(s);
  return p.type === 'player' ? p.seat : null;
}

/** The legal actions of `seat`, by default the seat whose decision is pending. */
export const legal = (s: RfdState, seat: number | null = pendingSeat(s)): RfdAction[] =>
  seat === null ? [] : (roomForDoubt.legalActions(s, seat) as RfdAction[]);

/** The legal actions of one type. */
export function only<T extends RfdAction['type']>(
  s: RfdState,
  type: T,
  seat?: number | null,
): Extract<RfdAction, { type: T }>[] {
  return legal(s, seat).filter((a): a is Extract<RfdAction, { type: T }> => a.type === type);
}

/** The state with some pawns moved (test set-up only): by Party id, to a square name or a room. */
export function withPawns(s: RfdState, places: Partial<Record<PartyId, Place>>): RfdState {
  return deepFreeze({ ...s, pawns: s.pawns.map((p, i) => places[PARTIES[i] as PartyId] ?? p) });
}

/** The turn seat rolls: its roll, every seat's contribution in order, then the derived faces. */
export function rollTo(s: RfdState, dice: readonly [number, number]): RfdState {
  let t = act(s, { type: 'roll', actor: s.turn });
  for (let n = 0; n < s.seats && t.contributors.length > 0; n++)
    t = act(t, { type: 'contribute', actor: t.contributors[0], id: t.roll });
  return act(t, { type: 'rolled', actor: 'beacon', id: t.roll, dice: [...dice] });
}

/** The shower shows the card at deck position `pos`: the wire, then the full state's learn of the shown card. */
export function showCard(s: RfdState, pos: number): RfdState {
  const plan = roomForDoubt.privateShow?.(s) ?? null;
  if (plan === null) throw new Error('no show is pending');
  if (!legal(s, plan.from).some((a) => a.type === 'show' && 'pos' in a && a.pos === pos))
    throw new Error(`seat ${plan.from} has no marker for position ${pos}`);
  const t = act(s, { type: 'show', actor: plan.from, id: plan.id, packet: 'sealed-for-the-test' });
  return learned(t, { deck: SHOW_DECK, pos: plan.id, card: s.order?.[pos] as number });
}

/** The deck position of a card in the full state. */
export function posOf(s: RfdState, id: CardId): number {
  const pos = s.order?.indexOf(cardOf(id)) ?? -1;
  if (pos < 0) throw new Error(`${id} is not in the order`);
  return pos;
}

/** The turn seat walks into `room` from one of its free doorsteps: its pawn put there, a roll of 2, the step in. */
export function enter(s: RfdState, room: SceneId): RfdState {
  const taken = new Set(s.pawns.flatMap((p) => squareIndex(p) ?? []));
  const door = DOORS.find((d) => d.room === room && !taken.has(d.step));
  if (door === undefined) throw new Error(`every doorstep of ${room} is taken`);
  const party = PARTIES[s.players[s.turn]?.party as number] as PartyId;
  const t = rollTo(withPawns(s, { [party]: squareName(door.step) }), [1, 1]);
  return act(t, { type: 'move', actor: t.turn, to: room });
}

/** The turn seat submits in its room. */
export const submit = (s: RfdState, party: PartyId, exhibit: ExhibitId): RfdState =>
  act(s, { type: 'submit', actor: s.turn, party, exhibit });

/** Every asked seat answers until the submission is answered: the first card it may show, else none. */
export function answerAll(s: RfdState): RfdState {
  let t = s;
  for (let n = 0; n < s.seats && t.stage === 'rebut'; n++) {
    const first = legal(t)[0];
    if (first === undefined) throw new Error('the asked seat has no answer');
    t = first.type === 'show' && 'pos' in first ? showCard(t, first.pos) : act(t, first);
  }
  if (t.stage === 'rebut') throw new Error('the asking does not stop');
  return t;
}

/** A turn with no event: a roll of 2, a step to the first square offered, and the end of the turn. */
export function passTurn(s: RfdState): RfdState {
  const t = rollTo(s, [1, 1]);
  const move = only(t, 'move').find((m) => squareIndex(m.to) !== null);
  if (move === undefined) throw new Error('no square to step to');
  return act(act(t, move), { type: 'endTurn', actor: t.turn });
}

/** The turn seat indicts at once. */
export const indict = (s: RfdState, party: PartyId, exhibit: ExhibitId, scene: SceneId): RfdState =>
  act(s, { type: 'indict', actor: s.turn, party, exhibit, scene });

/** The turn seat indicts wrongly and announces it: it is dismissed. */
export function dismiss(s: RfdState): RfdState {
  const verdict = s.verdict.map((v) => v.card);
  const party = PARTIES.find((_, i) => i !== verdict[0]) as PartyId;
  const t = indict(s, party, 'gavel', 'courtroom');
  return act(t, { type: 'verdict', actor: t.turn, upheld: false });
}

const isRoom = (to: Place): boolean => (SCENES as readonly string[]).includes(to);

/**
 * The catalog's fuzz policy: starts with a random way to move; walks into a room when it can, else anywhere;
 * submits whenever it may; rebuts with a random legal answer; indicts at random on its sixth turn or later (its
 * turns counted by its rolls); otherwise ends the turn. A policy reads the state it is given, which is the full
 * state in the fuzzer, and here uses only what the seat may know.
 */
export const testPolicy: FuzzPolicy<RfdState> = {
  name: 'catalog',
  choose(s, seat, legalList, rng) {
    const all = legalList as readonly RfdAction[];
    const of = <T extends RfdAction['type']>(type: T) =>
      all.filter((a): a is Extract<RfdAction, { type: T }> => a.type === type);
    if (s.stage === 'rebut') return rng.pick(all);
    const indicts = of('indict');
    const turns = s.rolls.filter((r) => r.last === seat).length;
    const late = s.stage === 'moved' || s.stage === 'answered';
    if (indicts.length > 0 && turns >= 5 && (late || rng.int(2) === 0)) return rng.pick(indicts);
    const submits = of('submit');
    if (submits.length > 0) return rng.pick(submits);
    const moves = of('move');
    if (moves.length > 0) {
      const rooms = moves.filter((m) => isRoom(m.to));
      return rng.pick(rooms.length > 0 ? rooms : moves);
    }
    // At the start: a random way to move (a roll, the passage from a corner room, or a stay when walled in).
    const ways = all.filter((a) => a.type === 'roll' || a.type === 'passage' || a.type === 'stay');
    if (ways.length > 0) return rng.pick(ways);
    for (const type of ['contribute', 'verdict', 'endTurn'] as const) {
      const a = all.find((x) => x.type === type);
      if (a !== undefined) return a;
    }
    return rng.pick(all);
  },
};
