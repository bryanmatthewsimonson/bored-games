import type {
  ApplyResult,
  DiceRoll,
  Outcome,
  Pending,
  Result,
  Seat,
  SetupInput,
} from '@bored-games/game-kit';
import { type BankRules, validateRules } from './rules.ts';
import type { BankEvent, BankLog, BankState, DiceEffect, RoundEnd } from './types.ts';

const MIN_SEATS = 2;
const MAX_SEATS = 6;

function fail(code: string, message: string): ApplyResult<BankState, BankEvent> {
  return { ok: false, error: { code, message } };
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && !Object.is(n, -0);
}

function zeros(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

function everyoneIn(n: number): boolean[] {
  return Array.from({ length: n }, () => true);
}

function nobodyBanked(n: number): (number | null)[] {
  return Array.from({ length: n }, () => null);
}

/**
 * Seats still owing a contribution, in the order their open apps publish. The walk starts two seats after the
 * roller and skips the roller, so it ends on the seat after the roller. That seat publishes last and is the
 * first who can learn the faces (D058). A closed window can still withhold; that is a timeout.
 */
export function contributeOrder(roller: number, seats: number): number[] {
  const out: number[] = [];
  let seat = (roller + 2) % seats;
  while (out.length < seats - 1) {
    if (seat !== roller) out.push(seat);
    seat = (seat + 1) % seats;
  }
  return out;
}

/**
 * Who is asked next in a call window. A round with no roll yet asks the roller to roll: an empty pot is not
 * a banking decision. After a roll, `table` starts at the seat after the roller and ends on the roller.
 * Seats already out, and seats who stayed, are skipped. The roller is never skipped.
 * `turn` asks only the roller.
 */
export function caller(s: BankState): number {
  if (s.rules.banking === 'turn' || s.rolls === 0) return s.roller;
  for (let k = 1; k <= s.seats; k++) {
    const seat = (s.roller + k) % s.seats;
    if (!s.inRound[seat]) continue;
    if (seat !== s.roller && s.passed.includes(seat)) continue;
    return seat;
  }
  return s.roller;
}

function nextInRound(s: BankState, from: number): number {
  for (let k = 1; k <= s.seats; k++) {
    const seat = (from + k) % s.seats;
    if (s.inRound[seat]) return seat;
  }
  return from;
}

function rollerOnlyRolls(s: BankState, seat: number): boolean {
  return seat === s.roller && s.passed.includes(seat);
}

export function pendingOf(s: BankState): Pending {
  if (s.phase === 'over') return { type: 'over' };
  if (s.phase === 'beacon') return { type: 'beacon', id: s.openRoll ?? 0 };
  if (s.phase === 'collect') return { type: 'player', seat: s.owe[0] ?? 0, decision: 'contribute' };
  const seat = caller(s);
  if (seat === s.roller) {
    const mustRoll = s.rolls === 0 || rollerOnlyRolls(s, seat);
    return { type: 'player', seat, decision: mustRoll ? 'roll' : 'bank-or-roll' };
  }
  return { type: 'player', seat, decision: 'bank-or-stay' };
}

export function legalActionsOf(s: BankState, seat: Seat): readonly unknown[] {
  const pending = pendingOf(s);
  if (pending.type !== 'player' || pending.seat !== seat) return [];
  if (s.phase === 'collect') {
    return [{ type: 'contribute', actor: seat, rollId: s.openRoll }];
  }
  if (seat === s.roller) {
    const roll = { type: 'roll', actor: seat, rollId: s.nextRollId };
    if (s.rolls === 0 || rollerOnlyRolls(s, seat)) return [roll];
    return [{ type: 'bank', actor: seat }, roll];
  }
  return [
    { type: 'bank', actor: seat },
    { type: 'stay', actor: seat },
  ];
}

export function setupGame(input: SetupInput<BankRules>): Result<BankState> {
  const rules = validateRules(input.rules);
  if (!rules.ok) return rules;
  if (!isInt(input.seats) || input.seats < MIN_SEATS || input.seats > MAX_SEATS) {
    return {
      ok: false,
      error: { code: 'seats', message: `Bank is played by ${MIN_SEATS} to ${MAX_SEATS} players` },
    };
  }
  const seats = input.seats;
  const state: BankState = {
    game: 'bank',
    rules: rules.value,
    seats,
    round: 0,
    pot: 0,
    scores: zeros(seats),
    inRound: everyoneIn(seats),
    roller: 0,
    passed: [],
    rolls: 0,
    nextRollId: 0,
    phase: 'call',
    owe: [],
    openRoll: null,
    schedule: [],
    banked: nobodyBanked(seats),
    log: [{ kind: 'round', round: 1, roller: 0 }],
    lastActor: null,
    endReason: null,
  };
  return { ok: true, value: state };
}

function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(o, key));
}

type PlayerAction =
  | { readonly type: 'bank'; readonly actor: number }
  | { readonly type: 'stay'; readonly actor: number }
  | { readonly type: 'roll'; readonly actor: number; readonly rollId: number }
  | { readonly type: 'contribute'; readonly actor: number; readonly rollId: number };

type RolledAction = {
  readonly type: 'rolled';
  readonly actor: 'beacon';
  readonly id: number;
  readonly dice: readonly [number, number];
};

type Parsed =
  | { readonly ok: true; readonly action: PlayerAction | RolledAction }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

function bad(message: string): {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
} {
  return { ok: false, error: { code: 'malformed', message } };
}

function parseDice(
  raw: unknown,
):
  | { readonly ok: true; readonly dice: readonly [number, number] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } } {
  if (!Array.isArray(raw) || raw.length !== 2) return bad('dice must be two faces');
  const [a, b] = raw as readonly unknown[];
  if (!isInt(a) || !isInt(b)) return bad('each face must be an integer');
  if (a < 1 || a > 6 || b < 1 || b > 6) {
    return { ok: false, error: { code: 'illegal', message: 'each face must be from 1 to 6' } };
  }
  return { ok: true, dice: [a, b] };
}

function parseAction(raw: unknown, seats: number): Parsed {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return bad('action must be an object');
  const a = raw as Record<string, unknown>;
  if (a.type === 'rolled') {
    if (!hasExactKeys(a, ['type', 'actor', 'id', 'dice']))
      return bad('rolled keys are type, actor, id and dice');
    if (a.actor !== 'beacon') return bad("a rolled action's actor is beacon");
    if (!isInt(a.id)) return bad('roll id must be a non-negative integer');
    const dice = parseDice(a.dice);
    if (!dice.ok) return dice;
    return { ok: true, action: { type: 'rolled', actor: 'beacon', id: a.id, dice: dice.dice } };
  }
  if (a.type !== 'bank' && a.type !== 'stay' && a.type !== 'roll' && a.type !== 'contribute') {
    return bad('unknown action type');
  }
  const withId = a.type === 'roll' || a.type === 'contribute';
  const keys = withId ? ['type', 'actor', 'rollId'] : ['type', 'actor'];
  if (!hasExactKeys(a, keys)) return bad(`${a.type} has one accepted encoding`);
  if (!isInt(a.actor) || a.actor < 0 || a.actor >= seats) return bad('actor must be a seat at this table');
  if (withId) {
    if (!isInt(a.rollId)) return bad('roll id must be a non-negative integer');
    if (a.type === 'roll') return { ok: true, action: { type: 'roll', actor: a.actor, rollId: a.rollId } };
    return { ok: true, action: { type: 'contribute', actor: a.actor, rollId: a.rollId } };
  }
  if (a.type === 'bank') return { ok: true, action: { type: 'bank', actor: a.actor } };
  return { ok: true, action: { type: 'stay', actor: a.actor } };
}

function addMoney(base: number, delta: number): number | null {
  if (base > Number.MAX_SAFE_INTEGER - delta) return null;
  return base + delta;
}

function doubleMoney(base: number): number | null {
  if (base > Math.floor(Number.MAX_SAFE_INTEGER / 2)) return null;
  return base * 2;
}

function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  const copy = list.slice();
  copy[index] = value;
  return copy;
}

interface BankedSeat {
  readonly state: BankState;
  readonly event: BankEvent;
}

/** Pay `pot` to `seat` and take them out of the round. The pot itself is left as it was. */
function bankSeat(s: BankState, seat: number, pot: number, remember: boolean): BankedSeat | null {
  const score = addMoney(s.scores[seat] ?? 0, pot);
  if (score === null) return null;
  const shared = s.banked.some((amount) => amount === pot);
  const state: BankState = {
    ...s,
    scores: replaceAt(s.scores, seat, score),
    inRound: replaceAt(s.inRound, seat, false),
    banked: replaceAt(s.banked, seat, pot),
    lastActor: remember ? seat : s.lastActor,
    log: [...s.log, { kind: 'bank', seat, amount: pot }],
  };
  return { state, event: { type: 'banked', seat, amount: pot, shared } };
}

function finishRound(
  s: BankState,
  how: RoundEnd,
  pot: number,
  rolls: number,
  prior: readonly BankEvent[],
): ApplyResult<BankState, BankEvent> {
  const finished = s.round + 1;
  const endedRound: BankEvent = { type: 'round', round: finished, how };
  if (finished >= s.rules.rounds) {
    const state: BankState = {
      ...s,
      round: finished,
      pot,
      rolls,
      phase: 'over',
      owe: [],
      openRoll: null,
      passed: [],
      endReason: 'score',
    };
    return { ok: true, state, events: [...prior, endedRound, { type: 'over' }] };
  }
  const roller = ((s.lastActor ?? s.roller) + 1) % s.seats;
  const state: BankState = {
    ...s,
    round: finished,
    pot: 0,
    inRound: everyoneIn(s.seats),
    roller,
    passed: [],
    rolls: 0,
    phase: 'call',
    owe: [],
    openRoll: null,
    banked: nobodyBanked(s.seats),
    log: [...s.log, { kind: 'round', round: finished + 1, roller }],
    endReason: null,
  };
  return { ok: true, state, events: [...prior, endedRound] };
}

function applyBank(s: BankState, actor: number): ApplyResult<BankState, BankEvent> {
  if (s.phase !== 'call') return fail('illegal', 'banking is only between rolls');
  if (actor !== caller(s)) return fail('turn', `it is seat ${caller(s)}'s decision`);
  if (s.rolls === 0) return fail('illegal', 'there is nothing in the pot to bank');
  if (rollerOnlyRolls(s, actor)) return fail('illegal', 'a roller who already stayed may only roll');
  const paid = bankSeat(s, actor, s.pot, true);
  if (paid === null) return fail('illegal', 'a score would exceed a safe integer');
  let state = paid.state;
  const events: BankEvent[] = [paid.event];
  if (state.inRound.every((inRound) => !inRound))
    return finishRound(state, 'banks', state.pot, state.rolls, events);
  if (actor === s.roller) state = { ...state, roller: nextInRound(state, actor) };
  return { ok: true, state, events };
}

function applyStay(s: BankState, actor: number): ApplyResult<BankState, BankEvent> {
  if (s.rules.banking !== 'table') return fail('illegal', 'this game asks only the roller');
  if (s.phase !== 'call') return fail('illegal', 'staying is only between rolls');
  if (actor !== caller(s)) return fail('turn', `it is seat ${caller(s)}'s decision`);
  if (actor === s.roller) return fail('illegal', 'the roller cannot stay');
  const passed = [...s.passed, actor].sort((a, b) => a - b);
  const state: BankState = { ...s, passed, log: [...s.log, { kind: 'stay', seat: actor }] };
  return { ok: true, state, events: [{ type: 'stayed', seat: actor }] };
}

function applyRoll(s: BankState, actor: number, rollId: number): ApplyResult<BankState, BankEvent> {
  if (s.phase !== 'call') return fail('illegal', 'the dice are not waiting to be rolled');
  if (actor !== caller(s)) return fail('turn', `it is seat ${caller(s)}'s decision`);
  if (actor !== s.roller) return fail('illegal', 'only the roller rolls');
  if (rollId !== s.nextRollId) return fail('illegal', `the next roll is ${s.nextRollId}`);
  const owe = contributeOrder(s.roller, s.seats);
  const state: BankState = {
    ...s,
    nextRollId: s.nextRollId + 1,
    phase: 'collect',
    owe,
    openRoll: rollId,
    schedule: [...s.schedule, { id: rollId, last: (s.roller + 1) % s.seats }],
    log: [...s.log, { kind: 'roll', seat: actor, rollId }],
  };
  return { ok: true, state, events: [{ type: 'committed', seat: actor, rollId }] };
}

function applyContribute(s: BankState, actor: number, rollId: number): ApplyResult<BankState, BankEvent> {
  if (s.phase !== 'collect') return fail('illegal', 'no contribution is waiting');
  const due = s.owe[0];
  if (actor !== due) return fail('turn', `it is seat ${due}'s contribution`);
  if (rollId !== s.openRoll) return fail('illegal', 'the contribution is for the open roll');
  const owe = s.owe.slice(1);
  const state: BankState = {
    ...s,
    owe,
    phase: owe.length === 0 ? 'beacon' : 'collect',
    log: [...s.log, { kind: 'contribute', seat: actor, rollId }],
  };
  return { ok: true, state, events: [{ type: 'contributed', seat: actor, rollId }] };
}

function resolvePot(
  pot: number,
  rolls: number,
  dice: readonly [number, number],
): { readonly pot: number; readonly effect: DiceEffect } | null {
  const sum = dice[0] + dice[1];
  const doubles = dice[0] === dice[1];
  const safe = rolls < 3;
  // A 7 is never doubles (1+6, 2+5, 3+4). Safe doubles are ordinary adds.
  if (safe && sum === 7) {
    const next = addMoney(pot, 70);
    return next === null ? null : { pot: next, effect: 'seventy' };
  }
  if (!safe && sum === 7) return { pot: 0, effect: 'bust' };
  if (!safe && doubles) {
    const next = doubleMoney(pot);
    return next === null ? null : { pot: next, effect: 'double' };
  }
  const next = addMoney(pot, sum);
  return next === null ? null : { pot: next, effect: 'add' };
}

function applyRolled(
  s: BankState,
  id: number,
  dice: readonly [number, number],
): ApplyResult<BankState, BankEvent> {
  if (s.phase !== 'beacon' || id !== s.openRoll)
    return fail('illegal', 'that roll is not waiting to be revealed');
  const resolved = resolvePot(s.pot, s.rolls, dice);
  if (resolved === null) return fail('illegal', 'the pot would exceed a safe integer');
  const rolls = s.rolls + 1;
  const capped = resolved.effect !== 'bust' && rolls === s.rules.maxRollsPerRound;
  const diceLog: BankLog = {
    kind: 'dice',
    rollId: id,
    dice,
    effect: resolved.effect,
    pot: resolved.pot,
    capped,
  };
  const diceEvent: BankEvent = {
    type: 'dice',
    rollId: id,
    dice,
    effect: resolved.effect,
    pot: resolved.pot,
    capped,
  };
  let state: BankState = { ...s, pot: resolved.pot, rolls, log: [...s.log, diceLog] };
  if (resolved.effect === 'bust') {
    state = { ...state, lastActor: s.roller };
    return finishRound(state, 'bust', 0, rolls, [diceEvent]);
  }
  if (capped) {
    const events: BankEvent[] = [diceEvent];
    for (let seat = 0; seat < state.seats; seat++) {
      if (!state.inRound[seat]) continue;
      const paid = bankSeat(state, seat, state.pot, false);
      if (paid === null) return fail('illegal', 'a score would exceed a safe integer');
      state = paid.state;
      events.push(paid.event);
    }
    state = { ...state, lastActor: s.roller };
    return finishRound(state, 'cap', state.pot, rolls, events);
  }
  state = { ...state, passed: [], phase: 'call', owe: [], openRoll: null };
  return { ok: true, state, events: [diceEvent] };
}

export function applyAction(s: BankState, raw: unknown): ApplyResult<BankState, BankEvent> {
  try {
    if (s.phase === 'over') return fail('over', 'the game is over');
    const parsed = parseAction(raw, s.seats);
    if (!parsed.ok) return parsed;
    const action = parsed.action;
    switch (action.type) {
      case 'bank':
        return applyBank(s, action.actor);
      case 'stay':
        return applyStay(s, action.actor);
      case 'roll':
        return applyRoll(s, action.actor, action.rollId);
      case 'contribute':
        return applyContribute(s, action.actor, action.rollId);
      case 'rolled':
        return applyRolled(s, action.id, action.dice);
      default:
        return fail('malformed', 'unknown action type');
    }
  } catch {
    return fail('malformed', 'unreadable action');
  }
}

export function outcomeOf(s: BankState): Outcome | null {
  if (s.phase !== 'over' || s.endReason === null) return null;
  const scores = s.scores.slice();
  const places = scores.map(
    (score, index) => 1 + scores.filter((other, otherIndex) => otherIndex !== index && other > score).length,
  );
  return { places, scores, reason: 'score' };
}

export function standingsOf(s: BankState): readonly number[] {
  return s.scores.slice();
}

/** The append-only roll list the session reads. `last` is the seat after the roller of that roll. */
export function rollsOf(s: BankState): readonly DiceRoll[] {
  return s.schedule.map((entry) => ({ id: entry.id, last: entry.last }));
}

/** The roll id a `roll` or `contribute` action must attach one share to. Anything else carries none. */
export function beaconOf(_s: BankState, action: unknown): number | null {
  if (action === null || typeof action !== 'object' || Array.isArray(action)) return null;
  const a = action as Record<string, unknown>;
  if ((a.type !== 'roll' && a.type !== 'contribute') || !isInt(a.rollId)) return null;
  return a.rollId;
}
