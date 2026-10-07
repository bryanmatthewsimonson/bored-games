import type {
  ApplyResult,
  DealtPosition,
  EngineError,
  Learn,
  Outcome,
  Pending,
  Result,
  Seat,
  SetupInput,
} from '@bored-games/game-kit';
import type { Suit } from './cards.ts';
import {
  bears,
  cardAt,
  DECK_SIZE,
  EPOCH_STRIDE,
  faceOf,
  isCard,
  isFullDeck,
  isSuit,
  matches,
  pointsOf,
  sameMultiset,
} from './cards.ts';
import type { HollerRules } from './rules.ts';
import { validateRules } from './rules.ts';
import type { After, HollerEvent, HollerState, Phase, PileCard, Plan, Resume, Slot } from './types.ts';

interface Draft {
  game: 'holler';
  rules: HollerRules;
  seats: number;
  mode: 'full' | 'view';
  viewer: number | null;
  direction: 1 | -1;
  scores: number[];
  round: number;
  epoch: number;
  phase: Phase;
  activeSuit: Suit | null;
  hands: Slot[][];
  draw: number[];
  discard: PileCard[];
  buried: number[];
  called: boolean[];
  resume: Resume | null;
  orders: (number[] | null)[];
  dealt: DealtPosition[];
}

interface Play {
  readonly actor: number;
  readonly pos: number;
  readonly card: number;
  readonly suit: Suit | null;
  readonly holler: boolean;
}

const bad = (code: string, message: string): EngineError => ({ code, message });

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && !Object.is(n, -0);
}

function isPos(n: unknown): n is number {
  return isInt(n) && n >= 0;
}

function isSize(n: unknown): n is number {
  return isInt(n) && n >= 1 && n <= DECK_SIZE;
}

function isSeat(n: unknown, seats: number): n is number {
  return isInt(n) && n >= 0 && n < seats;
}

function keysAre(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const got = Object.keys(o);
  return got.length === keys.length && keys.every((key) => Object.hasOwn(o, key));
}

function step(seat: number, dir: 1 | -1, n: number): number {
  return (seat + dir + n) % n;
}

function seatsAfter(seat: number, n: number): number[] {
  const queue: number[] = [];
  for (let i = 1; i < n; i++) queue.push((seat + i) % n);
  return queue;
}

function copyPhase(phase: Phase): Phase {
  switch (phase.type) {
    case 'reveal':
      return phase.kind === 'starter'
        ? { type: 'reveal', kind: 'starter', positions: [...phase.positions] }
        : { type: 'reveal', kind: 'score', positions: [...phase.positions], goer: phase.goer };
    case 'cover':
      return { ...phase, queue: [...phase.queue] };
    case 'catch':
      return { ...phase, queue: [...phase.queue] };
    case 'epoch':
      return {
        type: 'epoch',
        epoch: phase.epoch,
        from: phase.from.map((entry) => ({ deck: entry.deck, pos: entry.pos })),
        purpose: phase.purpose,
        plan: phase.plan ? { ...phase.plan } : null,
      };
    default:
      return { ...phase };
  }
}

function copyState(s: HollerState): Draft {
  return {
    game: 'holler',
    rules: s.rules,
    seats: s.seats,
    mode: s.mode,
    viewer: s.viewer,
    direction: s.direction,
    scores: [...s.scores],
    round: s.round,
    epoch: s.epoch,
    phase: copyPhase(s.phase),
    activeSuit: s.activeSuit,
    hands: s.hands.map((hand) => hand.map((slot) => ({ ...slot }))),
    draw: [...s.draw],
    discard: s.discard.map((card) => ({ pos: card.pos, card: card.card })),
    buried: [...s.buried],
    called: [...s.called],
    resume: s.resume ? { ...s.resume } : null,
    orders: s.orders.map((row) => (row === null ? null : [...row])),
    dealt: s.dealt.map((entry) => ({ deck: entry.deck, pos: entry.pos, to: entry.to })),
  };
}

function give(d: Draft, seat: number, pos: number, fresh: boolean): EngineError | null {
  const hand = d.hands[seat];
  if (!hand) return bad('turn', 'that seat is not in the game');
  let card: number | null = null;
  if (d.mode === 'full') {
    card = cardAt(d.orders, pos);
    if (card === null) return bad('deck', 'that position has no card');
  }
  hand.push({ pos, card, open: false, fresh });
  d.dealt.push({ deck: 'pile', pos, to: seat });
  return null;
}

/** A declaration survives only while the hand is still one card. */
function normalize(d: Draft): void {
  d.called = d.called.map((flag, seat) => flag && (d.hands[seat]?.length ?? 0) === 1);
}

function placeable(
  card: number,
  hand: readonly Slot[],
  pos: number,
  top: number,
  active: Suit | null,
): boolean {
  const face = faceOf(card);
  if (face.kind === 'mark') return true;
  if (face.kind === 'levy') {
    return !hand.some((slot) => slot.pos !== pos && slot.card !== null && bears(slot.card, active));
  }
  return matches(card, top, active);
}

/** Null when any slot is still hidden. An empty hand is clean: nothing bears the suit. */
function cleanTruth(hand: readonly Slot[], prior: Suit | null): boolean | null {
  if (hand.some((slot) => slot.card === null)) return null;
  return !hand.some((slot) => slot.card !== null && bears(slot.card, prior));
}

function hidden(hand: readonly Slot[]): boolean {
  return hand.some((slot) => slot.card === null || slot.fresh);
}

function pushPlays(out: unknown[], called: boolean, seat: number, slot: Slot, leaving: number): void {
  const card = slot.card;
  if (card === null) return;
  const face = faceOf(card);
  const suits: readonly (Suit | null)[] =
    face.kind === 'mark' || face.kind === 'levy' ? [0, 1, 2, 3] : [null];
  for (const suit of suits) {
    const base =
      suit === null
        ? { type: 'play' as const, actor: seat, pos: slot.pos, card }
        : { type: 'play' as const, actor: seat, pos: slot.pos, card, suit };
    if (leaving === 0) {
      if (called) out.push(base);
      continue;
    }
    out.push(base);
    if (leaving === 1) out.push({ ...base, holler: true as const });
  }
}

function playsFor(s: HollerState, seat: number): unknown[] {
  const hand = s.hands[seat];
  const top = s.discard[s.discard.length - 1];
  if (!hand || !top) return [];
  const out: unknown[] = [];
  let matched = false;
  for (const slot of [...hand].sort((a, b) => a.pos - b.pos)) {
    if (slot.card === null || !placeable(slot.card, hand, slot.pos, top.card, s.activeSuit)) continue;
    matched = true;
    pushPlays(out, s.called[seat] === true, seat, slot, hand.length - 1);
  }
  if (!matched) out.push({ type: 'draw', actor: seat });
  return out;
}

function drawnFor(s: HollerState, seat: number, pos: number): unknown[] {
  const hand = s.hands[seat] ?? [];
  const slot = hand.find((entry) => entry.pos === pos);
  const top = s.discard[s.discard.length - 1];
  const out: unknown[] = [];
  if (slot && slot.card !== null && top && placeable(slot.card, hand, slot.pos, top.card, s.activeSuit)) {
    pushPlays(out, s.called[seat] === true, seat, slot, hand.length - 1);
  }
  out.push({ type: 'keep', actor: seat });
  return out;
}

function answerActions(s: HollerState, seat: number): unknown[] {
  if (s.phase.type !== 'answer') return [];
  const hand = s.hands[seat] ?? [];
  const truth = cleanTruth(hand, s.phase.prior);
  if (truth === null) return [];
  return [{ type: 'answer', actor: seat, clean: truth }];
}

function pendingSeat(phase: Phase): number | null {
  switch (phase.type) {
    case 'name':
    case 'play':
    case 'drawn':
    case 'levy':
    case 'answer':
      return phase.seat;
    case 'cover':
    case 'catch':
      return phase.queue[0] ?? null;
    default:
      return null;
  }
}

export function legalActionsOf(s: HollerState, seat: Seat): readonly unknown[] {
  if (pendingSeat(s.phase) !== seat) return [];
  if (hidden(s.hands[seat] ?? [])) return [];
  switch (s.phase.type) {
    case 'name':
      return [0, 1, 2, 3].map((suit) => ({ type: 'name', actor: seat, suit }));
    case 'play':
      return playsFor(s, seat);
    case 'drawn':
      return drawnFor(s, seat, s.phase.pos);
    case 'cover':
      return [{ type: 'cover', actor: seat }];
    case 'levy':
      return [
        { type: 'accept', actor: seat },
        { type: 'challenge', actor: seat },
      ];
    case 'answer':
      return answerActions(s, seat);
    case 'catch':
      return [
        { type: 'catch', actor: seat },
        { type: 'pass', actor: seat },
      ];
    default:
      return [];
  }
}

export function pendingOf(s: HollerState): Pending {
  const phase = s.phase;
  switch (phase.type) {
    case 'epoch':
      return { type: 'shuffle', deck: 'pile', epoch: phase.epoch, from: phase.from };
    case 'grant':
      return { type: 'grant' };
    case 'reveal':
      return { type: 'reveal', deck: 'pile', positions: phase.positions };
    case 'over':
      return { type: 'over' };
    case 'name':
      return { type: 'player', seat: phase.seat, decision: 'name' };
    case 'play':
      return { type: 'player', seat: phase.seat, decision: 'play' };
    case 'drawn':
      return { type: 'player', seat: phase.seat, decision: 'drawn' };
    case 'levy':
      return { type: 'player', seat: phase.seat, decision: 'levy' };
    case 'answer':
      return { type: 'player', seat: phase.seat, decision: 'answer' };
    case 'cover':
      return { type: 'player', seat: phase.queue[0] ?? 0, decision: 'cover' };
    case 'catch':
      return { type: 'player', seat: phase.queue[0] ?? 0, decision: 'catch' };
  }
}

function coverNeed(d: Draft, plan: Plan): number[] {
  const offender = plan.offender;
  if (offender === null) return [];
  const will = new Set<number>();
  if (plan.selected !== offender) {
    let seat = plan.selected;
    for (let i = 0; i < d.seats; i++) {
      if (seat === offender) break;
      will.add(seat);
      seat = step(seat, d.direction, d.seats);
    }
  }
  const need: number[] = [];
  for (let i = 1; i < d.seats; i++) {
    const seat = (offender + i) % d.seats;
    if (will.has(seat) || (plan.catcher !== null && seat === plan.catcher)) continue;
    need.push(seat);
  }
  return need;
}

function beginRoundEpoch(d: Draft): EngineError | null {
  const from: { deck: 'pile'; pos: number }[] = [];
  for (const hand of d.hands) for (const slot of hand) from.push({ deck: 'pile', pos: slot.pos });
  for (const card of d.discard) from.push({ deck: 'pile', pos: card.pos });
  for (const pos of d.draw) from.push({ deck: 'pile', pos });
  for (const pos of d.buried) from.push({ deck: 'pile', pos });
  d.resume = null;
  d.phase = { type: 'epoch', epoch: d.epoch + 1, from, purpose: 'round', plan: null };
  return null;
}

function award(d: Draft, goer: number, events: HollerEvent[]): EngineError | null {
  let points = 0;
  for (let seat = 0; seat < d.seats; seat++) {
    if (seat === goer) continue;
    for (const slot of d.hands[seat] ?? []) {
      if (slot.card === null) return bad('card', 'a scoring card is unknown');
      points += pointsOf(slot.card);
    }
  }
  d.scores[goer] = (d.scores[goer] ?? 0) + points;
  events.push({ type: 'scored', seat: goer, points });
  if (d.scores.some((score) => score >= 500)) {
    d.phase = { type: 'over' };
    d.resume = null;
    events.push({ type: 'over' });
    return null;
  }
  return beginRoundEpoch(d);
}

function beginScore(d: Draft, goer: number, events: HollerEvent[]): EngineError | null {
  const positions: number[] = [];
  for (let seat = 0; seat < d.seats; seat++) {
    const hand = [...(d.hands[seat] ?? [])].sort((a, b) => a.pos - b.pos);
    for (const slot of hand) positions.push(slot.pos);
  }
  d.resume = null;
  if (positions.length === 0) return award(d, goer, events);
  d.phase = { type: 'reveal', kind: 'score', positions, goer };
  return null;
}

function finishPlan(d: Draft, plan: Plan, events: HollerEvent[]): EngineError | null {
  normalize(d);
  if (plan.offender !== null && (d.hands[plan.offender]?.length ?? 0) === 1) {
    // A catch that could take nothing must not leave the last card undeclared forever.
    d.called[plan.offender] = true;
  }
  d.resume = null;
  const window = plan.windowFor;
  if (window !== null && (d.hands[window]?.length ?? 0) === 1 && d.called[window] !== true) {
    d.phase = {
      type: 'catch',
      offender: window,
      queue: seatsAfter(window, d.seats),
      selected: plan.selected,
    };
    return null;
  }
  if (plan.after === 'score' && plan.goer !== null && (d.hands[plan.goer]?.length ?? 0) === 0) {
    return beginScore(d, plan.goer, events);
  }
  const need = plan.offender === null ? [] : coverNeed(d, plan);
  if (plan.offender !== null && need.length > 0) {
    d.phase = { type: 'cover', kind: 'catch', queue: need, drawer: plan.offender, selected: plan.selected };
    return null;
  }
  d.phase = { type: 'play', seat: plan.selected };
  return null;
}

function finishVoluntary(d: Draft, plan: Plan, got: number): EngineError | null {
  d.resume = null;
  if (got === 0) {
    d.phase = { type: 'play', seat: plan.selected };
    return null;
  }
  d.phase = {
    type: 'cover',
    kind: 'voluntary',
    queue: seatsAfter(plan.seat, d.seats),
    drawer: plan.seat,
    selected: plan.selected,
  };
  return null;
}

function takeAndFinish(d: Draft, plan: Plan, count: number, events: HollerEvent[]): EngineError | null {
  const got = d.draw.slice(0, count);
  d.draw = d.draw.slice(count);
  const fresh = plan.fresh && got.length > 0;
  for (const pos of got) {
    const err = give(d, plan.seat, pos, fresh);
    if (err) return err;
  }
  events.push({ type: 'drawn', seat: plan.seat, count: got.length, short: got.length < plan.left });
  normalize(d);
  if (plan.after === 'cover') return finishVoluntary(d, plan, got.length);
  return finishPlan(d, plan, events);
}

function suspendAfter(d: Draft, plan: Plan, have: number, events: HollerEvent[]): EngineError | null {
  if (have > 0) {
    const got = d.draw.slice(0, have);
    d.draw = [];
    for (const pos of got) {
      const err = give(d, plan.seat, pos, false);
      if (err) return err;
    }
    events.push({ type: 'drawn', seat: plan.seat, count: got.length, short: false });
    normalize(d);
  }
  const top = d.discard[d.discard.length - 1];
  if (!top || d.discard.length < 2) return bad('deck', 'nothing under the top discard');
  const left = plan.left - have;
  d.phase = {
    type: 'epoch',
    epoch: d.epoch + 1,
    from: d.discard.slice(0, -1).map((card) => ({ deck: 'pile' as const, pos: card.pos })),
    purpose: 'mid',
    plan: { ...plan, left, catcher: null },
  };
  d.resume = { seat: plan.seat, left, after: plan.after };
  return null;
}

function beginDraw(d: Draft, plan: Plan, events: HollerEvent[]): EngineError | null {
  if (plan.left <= 0) return finishPlan(d, plan, events);
  const have = d.draw.length;
  if (have >= plan.left) return takeAndFinish(d, plan, plan.left, events);
  if (d.discard.length > 1) return suspendAfter(d, plan, have, events);
  return takeAndFinish(d, plan, have, events);
}

function afterPlay(
  d: Draft,
  actor: number,
  prior: Suit | null,
  blind: boolean,
  events: HollerEvent[],
): EngineError | null {
  const played = d.discard[d.discard.length - 1];
  if (!played) return bad('card', 'nothing was played');
  const face = faceOf(played.card);
  const n = d.seats;
  if (face.kind === 'swing' && n >= 3) d.direction = d.direction === 1 ? -1 : 1;
  normalize(d);
  const left = d.hands[actor]?.length ?? 0;
  const goingOut = left === 0;
  const windowFor = left === 1 ? actor : null;
  if (face.kind === 'levy') {
    if (d.activeSuit === null) return bad('shape', 'a levy names a suit');
    d.resume = null;
    d.phase = {
      type: 'levy',
      seat: step(actor, d.direction, n),
      player: actor,
      prior,
      named: d.activeSuit,
      blind,
    };
    return null;
  }
  const next = step(actor, d.direction, n);
  const skip = face.kind === 'halt' || (face.kind === 'swing' && n === 2);
  const selected = skip ? step(next, d.direction, n) : next;
  if (face.kind === 'pull') {
    return beginDraw(
      d,
      {
        seat: next,
        left: 2,
        after: goingOut ? 'score' : 'skip',
        selected: step(next, d.direction, n),
        windowFor: goingOut ? null : windowFor,
        offender: null,
        catcher: null,
        goer: goingOut ? actor : null,
        fresh: false,
      },
      events,
    );
  }
  if (goingOut) return beginScore(d, actor, events);
  if (windowFor !== null && d.called[actor] !== true) {
    d.resume = null;
    d.phase = { type: 'catch', offender: actor, queue: seatsAfter(actor, n), selected };
    return null;
  }
  d.resume = null;
  d.phase = { type: 'play', seat: selected };
  return null;
}

function readPlay(raw: Record<string, unknown>, seats: number): Result<Play> {
  const allowed = ['type', 'actor', 'pos', 'card', 'suit', 'holler'];
  if (Object.keys(raw).some((key) => !allowed.includes(key)))
    return { ok: false, error: bad('shape', 'unexpected key') };
  if (
    !keysAre(raw, ['type', 'actor', 'pos', 'card']) &&
    !Object.hasOwn(raw, 'suit') &&
    !Object.hasOwn(raw, 'holler')
  ) {
    return { ok: false, error: bad('shape', 'missing key') };
  }
  if (!Object.hasOwn(raw, 'actor') || !Object.hasOwn(raw, 'pos') || !Object.hasOwn(raw, 'card')) {
    return { ok: false, error: bad('shape', 'missing key') };
  }
  if (!isSeat(raw.actor, seats) || !isPos(raw.pos) || !isCard(raw.card)) {
    return { ok: false, error: bad('shape', 'play fields') };
  }
  if (Object.hasOwn(raw, 'holler') && raw.holler !== true) {
    return { ok: false, error: bad('shape', 'holler is only true, and only when one card remains') };
  }
  let suit: Suit | null = null;
  if (Object.hasOwn(raw, 'suit')) {
    if (!isSuit(raw.suit)) return { ok: false, error: bad('shape', 'suit') };
    suit = raw.suit;
  }
  const face = faceOf(raw.card);
  const wild = face.kind === 'mark' || face.kind === 'levy';
  if (wild !== (suit !== null))
    return { ok: false, error: bad('shape', 'a suit is named only on a mark or a levy') };
  return {
    ok: true,
    value: { actor: raw.actor, pos: raw.pos, card: raw.card, suit, holler: raw.holler === true },
  };
}

function applyPlay(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  const parsed = readPlay(raw, d.seats);
  if (!parsed.ok) return parsed.error;
  const play = parsed.value;
  if (d.phase.type !== 'play' && d.phase.type !== 'drawn') return bad('illegal', 'no play is pending');
  if (play.actor !== d.phase.seat) return bad('turn', 'it is not that seat');
  if (d.phase.type === 'drawn' && play.pos !== d.phase.pos)
    return bad('illegal', 'only the drawn card can be played');
  const hand = d.hands[play.actor];
  if (!hand) return bad('turn', 'that seat is not in the game');
  const index = hand.findIndex((slot) => slot.pos === play.pos);
  const slot = index < 0 ? undefined : hand[index];
  if (!slot || slot.fresh) return bad('card', 'that card is not playable');
  if (slot.card !== null && slot.card !== play.card) return bad('card', 'the card does not match the hand');
  if (d.mode === 'full' && slot.card !== play.card) return bad('card', 'the card does not match the hand');
  const leaving = hand.length - 1;
  if (play.holler !== (leaving === 1)) {
    if (leaving !== 1) return bad('shape', 'holler is only when one card remains');
  }
  if (leaving === 0 && d.called[play.actor] !== true)
    return bad('illegal', 'the last card needs a declaration');
  const top = d.discard[d.discard.length - 1];
  if (!top) return bad('illegal', 'nothing to match');
  const face = faceOf(play.card);
  // Captured before the card leaves. A later empty hand can no longer show what was hidden.
  const blind = hand.some((entry) => entry.card === null);
  if (face.kind === 'levy') {
    const blocked = hand.some(
      (entry) => entry.pos !== play.pos && entry.card !== null && bears(entry.card, d.activeSuit),
    );
    if (blocked) return bad('illegal', 'a levy needs a hand with none of the active suit');
  } else if (face.kind !== 'mark' && !matches(play.card, top.card, d.activeSuit)) {
    return bad('illegal', 'the card does not match');
  }
  const prior = d.activeSuit;
  hand.splice(index, 1);
  d.discard.push({ pos: play.pos, card: play.card });
  if (play.suit !== null) d.activeSuit = play.suit;
  else if (face.suit !== null) d.activeSuit = face.suit;
  if (play.holler) {
    d.called[play.actor] = true;
    events.push({ type: 'hollered', seat: play.actor });
  }
  events.push({ type: 'played', seat: play.actor, pos: play.pos, card: play.card, suit: play.suit });
  return afterPlay(d, play.actor, prior, blind, events);
}

function applyDraw(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor'])) return bad('shape', 'draw keys');
  if (d.phase.type !== 'play') return bad('illegal', 'no draw is pending');
  if (!isSeat(raw.actor, d.seats)) return bad('shape', 'actor');
  if (raw.actor !== d.phase.seat) return bad('turn', 'it is not that seat');
  const hand = d.hands[raw.actor] ?? [];
  const top = d.discard[d.discard.length - 1];
  if (!top) return bad('illegal', 'nothing to match');
  const known = hand.some(
    (slot) => slot.card !== null && placeable(slot.card, hand, slot.pos, top.card, d.activeSuit),
  );
  if (known) return bad('illegal', 'a card can be played');
  if (d.mode === 'full' && hand.some((slot) => slot.card === null))
    return bad('illegal', 'the hand is not known');
  return beginDraw(
    d,
    {
      seat: raw.actor,
      left: 1,
      after: 'cover',
      selected: step(raw.actor, d.direction, d.seats),
      windowFor: null,
      offender: null,
      catcher: null,
      goer: null,
      fresh: true,
    },
    events,
  );
}

function applyKeep(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor'])) return bad('shape', 'keep keys');
  if (d.phase.type !== 'drawn') return bad('illegal', 'no drawn card is pending');
  if (!isSeat(raw.actor, d.seats)) return bad('shape', 'actor');
  if (raw.actor !== d.phase.seat) return bad('turn', 'it is not that seat');
  events.push({ type: 'kept', seat: raw.actor, pos: d.phase.pos });
  normalize(d);
  d.resume = null;
  d.phase = { type: 'play', seat: step(raw.actor, d.direction, d.seats) };
  return null;
}

function applyName(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor', 'suit'])) return bad('shape', 'name keys');
  if (d.phase.type !== 'name') return bad('illegal', 'no suit is pending');
  if (!isSeat(raw.actor, d.seats)) return bad('shape', 'actor');
  if (raw.actor !== d.phase.seat) return bad('turn', 'it is not that seat');
  if (!isSuit(raw.suit)) return bad('shape', 'suit');
  d.activeSuit = raw.suit;
  d.resume = null;
  d.phase = { type: 'play', seat: raw.actor };
  events.push({ type: 'named', seat: raw.actor, suit: raw.suit });
  return null;
}

function applyCover(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor'])) return bad('shape', 'cover keys');
  if (d.phase.type !== 'cover') return bad('illegal', 'no cover is pending');
  if (!isSeat(raw.actor, d.seats)) return bad('shape', 'actor');
  if (raw.actor !== d.phase.queue[0]) return bad('turn', 'it is not that seat');
  events.push({ type: 'covered', seat: raw.actor });
  const queue = d.phase.queue.slice(1);
  if (queue.length > 0) {
    d.phase = { ...d.phase, queue };
    return null;
  }
  if (d.phase.kind === 'catch') {
    d.resume = null;
    d.phase = { type: 'play', seat: d.phase.selected };
    return null;
  }
  const hand = d.hands[d.phase.drawer];
  const drawn = hand?.find((slot) => slot.fresh);
  if (!hand || !drawn) return bad('deck', 'no drawn card');
  const index = hand.findIndex((slot) => slot.pos === drawn.pos);
  const slot = hand[index];
  if (slot) hand[index] = { ...slot, fresh: false };
  d.resume = null;
  d.phase = { type: 'drawn', seat: d.phase.drawer, pos: drawn.pos };
  return null;
}

function applyAccept(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor'])) return bad('shape', 'accept keys');
  if (d.phase.type !== 'levy') return bad('illegal', 'no levy is pending');
  if (!isSeat(raw.actor, d.seats)) return bad('shape', 'actor');
  if (raw.actor !== d.phase.seat) return bad('turn', 'only the next seat can accept');
  events.push({ type: 'accepted', seat: raw.actor });
  const player = d.phase.player;
  const goingOut = (d.hands[player]?.length ?? 0) === 0;
  return beginDraw(
    d,
    {
      seat: raw.actor,
      left: 4,
      after: goingOut ? 'score' : 'skip',
      selected: step(raw.actor, d.direction, d.seats),
      windowFor: goingOut ? null : (d.hands[player]?.length ?? 0) === 1 ? player : null,
      offender: null,
      catcher: null,
      goer: goingOut ? player : null,
      fresh: false,
    },
    events,
  );
}

function applyChallenge(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor'])) return bad('shape', 'challenge keys');
  if (d.phase.type !== 'levy') return bad('illegal', 'no levy is pending');
  if (!isSeat(raw.actor, d.seats)) return bad('shape', 'actor');
  if (raw.actor !== d.phase.seat) return bad('turn', 'only the next seat can challenge');
  events.push({ type: 'challenged', seat: raw.actor });
  d.resume = null;
  d.phase = {
    type: 'answer',
    seat: d.phase.player,
    challenger: raw.actor,
    prior: d.phase.prior,
    named: d.phase.named,
    blind: d.phase.blind,
  };
  return null;
}

function applyAnswer(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor', 'clean'])) return bad('shape', 'answer keys');
  if (typeof raw.clean !== 'boolean') return bad('shape', 'clean must be a boolean');
  if (d.phase.type !== 'answer') return bad('illegal', 'no answer is pending');
  if (!isSeat(raw.actor, d.seats)) return bad('shape', 'actor');
  if (raw.actor !== d.phase.seat) return bad('turn', 'only the player who laid the levy answers');
  const hand = d.hands[raw.actor] ?? [];
  const truth = cleanTruth(hand, d.phase.prior);
  // A fully known hand, including an empty one, has one honest bit. A blind hand may claim either.
  if (!d.phase.blind && truth !== null && raw.clean !== truth) {
    return bad('claim', 'the hand does not support that answer');
  }
  events.push({ type: 'answered', seat: raw.actor, clean: raw.clean });
  const player = d.phase.seat;
  const challenger = d.phase.challenger;
  if (!raw.clean) {
    return beginDraw(
      d,
      {
        seat: player,
        left: 4,
        after: 'play',
        selected: challenger,
        windowFor: null,
        offender: null,
        catcher: null,
        goer: null,
        fresh: false,
      },
      events,
    );
  }
  const goingOut = (d.hands[player]?.length ?? 0) === 0;
  return beginDraw(
    d,
    {
      seat: challenger,
      left: 6,
      after: goingOut ? 'score' : 'skip',
      selected: step(challenger, d.direction, d.seats),
      windowFor: goingOut ? null : (d.hands[player]?.length ?? 0) === 1 ? player : null,
      offender: null,
      catcher: null,
      goer: goingOut ? player : null,
      fresh: false,
    },
    events,
  );
}

function applyCatch(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor'])) return bad('shape', 'catch keys');
  if (d.phase.type !== 'catch') return bad('illegal', 'no catch is pending');
  if (!isSeat(raw.actor, d.seats)) return bad('shape', 'actor');
  if (raw.actor !== d.phase.queue[0]) return bad('turn', 'it is not that seat');
  events.push({ type: 'caught', seat: raw.actor });
  const n = d.seats;
  return beginDraw(
    d,
    {
      seat: d.phase.offender,
      left: 2,
      after: n === 2 ? 'play' : 'skip',
      selected: d.phase.selected,
      windowFor: null,
      offender: d.phase.offender,
      catcher: raw.actor,
      goer: null,
      fresh: false,
    },
    events,
  );
}

function applyPass(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor'])) return bad('shape', 'pass keys');
  if (d.phase.type !== 'catch') return bad('illegal', 'no catch is pending');
  if (!isSeat(raw.actor, d.seats)) return bad('shape', 'actor');
  if (raw.actor !== d.phase.queue[0]) return bad('turn', 'it is not that seat');
  events.push({ type: 'passed', seat: raw.actor });
  const queue = d.phase.queue.slice(1);
  if (queue.length > 0) {
    d.phase = { ...d.phase, queue };
    return null;
  }
  const offender = d.phase.offender;
  d.called[offender] = (d.hands[offender]?.length ?? 0) === 1;
  d.resume = null;
  d.phase = { type: 'play', seat: d.phase.selected };
  return null;
}

function landStarter(d: Draft, card: number, pos: number, events: HollerEvent[]): EngineError | null {
  const face = faceOf(card);
  if (face.kind === 'levy') {
    const next = d.draw[0];
    if (next === undefined) return bad('deck', 'no card follows a starter levy');
    d.buried.push(pos);
    d.draw = d.draw.slice(1);
    d.dealt.push({ deck: 'pile', pos: next, to: null });
    d.phase = { type: 'reveal', kind: 'starter', positions: [next] };
    events.push({ type: 'round', round: d.round, starter: 'levy' });
    return null;
  }
  d.discard.push({ pos, card });
  if (face.kind === 'mark') {
    d.activeSuit = null;
    d.resume = null;
    d.phase = { type: 'name', seat: 0 };
    return null;
  }
  if (face.suit !== null) d.activeSuit = face.suit;
  if (face.kind === 'halt' || (face.kind === 'swing' && d.seats === 2)) {
    if (face.kind === 'swing') events.push({ type: 'round', round: d.round, starter: 'swing2' });
    d.resume = null;
    d.phase = { type: 'play', seat: 1 };
    return null;
  }
  if (face.kind === 'swing') {
    d.direction = -1;
    d.resume = null;
    d.phase = { type: 'play', seat: d.seats - 1 };
    return null;
  }
  if (face.kind === 'pull') {
    return beginDraw(
      d,
      {
        seat: 0,
        left: 2,
        after: 'skip',
        selected: 1,
        windowFor: null,
        offender: null,
        catcher: null,
        goer: null,
        fresh: false,
      },
      events,
    );
  }
  d.resume = null;
  d.phase = { type: 'play', seat: 0 };
  return null;
}

function revealScore(d: Draft, pos: number, card: number, events: HollerEvent[]): EngineError | null {
  if (d.phase.type !== 'reveal' || d.phase.kind !== 'score') return bad('illegal', 'no score is pending');
  const goer = d.phase.goer;
  let found = false;
  for (let seat = 0; seat < d.seats; seat++) {
    const hand = d.hands[seat];
    if (!hand) continue;
    const index = hand.findIndex((slot) => slot.pos === pos);
    const slot = index < 0 ? undefined : hand[index];
    if (!slot) continue;
    if (slot.card !== null && slot.card !== card) return bad('card', 'the card contradicts the hand');
    hand[index] = { pos, card, open: true, fresh: false };
    found = true;
    break;
  }
  if (!found) return bad('card', 'that card is not in a hand');
  const rest = d.phase.positions.filter((entry) => entry !== pos);
  if (rest.length > 0) {
    d.phase = { type: 'reveal', kind: 'score', positions: rest, goer };
    return null;
  }
  return award(d, goer, events);
}

function applyReveal(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor', 'deck', 'pos', 'card'])) return bad('shape', 'reveal keys');
  if (raw.actor !== 'deck' || raw.deck !== 'pile') return bad('shape', 'the deck reveals');
  if (!isPos(raw.pos) || !isCard(raw.card)) return bad('shape', 'reveal card');
  if (d.phase.type !== 'reveal') return bad('illegal', 'no reveal is pending');
  if (!d.phase.positions.includes(raw.pos)) return bad('card', 'that position is not pending');
  if (d.mode === 'full' && cardAt(d.orders, raw.pos) !== raw.card) {
    return bad('card', 'the card does not match the order');
  }
  if (d.phase.kind === 'starter') return landStarter(d, raw.card, raw.pos, events);
  return revealScore(d, raw.pos, raw.card, events);
}

function epochPositions(epoch: number, size: number): number[] {
  const base = epoch * EPOCH_STRIDE;
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(base + i);
  return out;
}

function dealRound(d: Draft, epoch: number): EngineError | null {
  const n = d.seats;
  const base = epoch * EPOCH_STRIDE;
  d.hands = Array.from({ length: n }, () => []);
  d.discard = [];
  d.buried = [];
  d.draw = [];
  d.called = Array.from({ length: n }, () => false);
  d.direction = 1;
  d.activeSuit = null;
  d.resume = null;
  d.epoch = epoch;
  d.round += 1;
  for (let r = 0; r < 7; r++) {
    for (let seat = 0; seat < n; seat++) {
      const err = give(d, seat, base + r * n + seat, false);
      if (err) return err;
    }
  }
  const starter = base + 7 * n;
  d.dealt.push({ deck: 'pile', pos: starter, to: null });
  const draw: number[] = [];
  for (let i = 7 * n + 1; i < DECK_SIZE; i++) draw.push(base + i);
  d.draw = draw;
  d.phase = { type: 'grant', starter };
  return null;
}

function resumeMid(d: Draft, epoch: number, size: number, events: HollerEvent[]): EngineError | null {
  if (d.phase.type !== 'epoch' || d.phase.plan === null)
    return bad('deck', 'a mid-round shuffle has no draw');
  const plan = d.phase.plan;
  const top = d.discard[d.discard.length - 1];
  if (!top) return bad('deck', 'the top discard is missing');
  d.discard = [{ pos: top.pos, card: top.card }];
  d.draw = epochPositions(epoch, size);
  d.epoch = epoch;
  d.resume = null;
  return beginDraw(d, plan, events);
}

function applyEpoch(d: Draft, raw: Record<string, unknown>, events: HollerEvent[]): EngineError | null {
  if (!keysAre(raw, ['type', 'actor', 'epoch', 'size'])) return bad('shape', 'epoch keys');
  if (raw.actor !== 'deck') return bad('shape', 'the deck shuffles');
  if (d.phase.type !== 'epoch') return bad('illegal', 'no shuffle is pending');
  if (!isInt(raw.epoch) || raw.epoch !== d.phase.epoch) return bad('deck', 'epoch number');
  if (!isSize(raw.size) || raw.size !== d.phase.from.length) return bad('deck', 'epoch size');
  if (d.mode === 'full') {
    const order = d.orders[raw.epoch];
    if (!order || order.length !== raw.size) return bad('deck', 'the epoch order is not installed');
  } else if (d.orders.length === raw.epoch) {
    d.orders.push(null);
  }
  events.push({ type: 'reshuffled', epoch: raw.epoch, size: raw.size });
  if (d.phase.purpose === 'round') {
    if (raw.size !== DECK_SIZE) return bad('deck', 'a new round shuffles 108 cards');
    return dealRound(d, raw.epoch);
  }
  return resumeMid(d, raw.epoch, raw.size, events);
}

function applyGranted(d: Draft, raw: Record<string, unknown>): EngineError | null {
  if (!keysAre(raw, ['type', 'actor'])) return bad('shape', 'granted keys');
  if (raw.actor !== 'deck') return bad('shape', 'the deck grants');
  if (d.phase.type !== 'grant') return bad('illegal', 'no grant is pending');
  d.phase = { type: 'reveal', kind: 'starter', positions: [d.phase.starter] };
  return null;
}

function dispatch(d: Draft, raw: unknown, events: HollerEvent[]): EngineError | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return bad('shape', 'an action is an object');
  switch (raw.type) {
    case 'resign':
      return bad('resign', 'resign is not a module action');
    case 'play':
      return applyPlay(d, raw, events);
    case 'draw':
      return applyDraw(d, raw, events);
    case 'keep':
      return applyKeep(d, raw, events);
    case 'cover':
      return applyCover(d, raw, events);
    case 'name':
      return applyName(d, raw, events);
    case 'accept':
      return applyAccept(d, raw, events);
    case 'challenge':
      return applyChallenge(d, raw, events);
    case 'answer':
      return applyAnswer(d, raw, events);
    case 'catch':
      return applyCatch(d, raw, events);
    case 'pass':
      return applyPass(d, raw, events);
    case 'reveal':
      return applyReveal(d, raw, events);
    case 'epoch':
      return applyEpoch(d, raw, events);
    case 'granted':
      return applyGranted(d, raw);
    default:
      return bad('shape', 'unknown action');
  }
}

export function setupGame(input: SetupInput<HollerRules>): Result<HollerState> {
  const rules = validateRules(input.rules);
  if (!rules.ok) return rules;
  if (!isInt(input.seats) || input.seats < 2 || input.seats > 10) {
    return { ok: false, error: bad('seats', 'holler seats are 2 to 10') };
  }
  const seats = input.seats;
  let opening: number[] | null = null;
  let viewer: number | null = null;
  if (input.mode === 'full') {
    const pile = input.deckOrders.pile;
    if (!pile || !isFullDeck(pile)) {
      return { ok: false, error: bad('deck', 'the pile must be one of each card') };
    }
    opening = [...pile];
  } else {
    viewer = input.viewer;
  }
  const hands: Slot[][] = Array.from({ length: seats }, () => []);
  const dealt: DealtPosition[] = [];
  let pos = 0;
  for (let round = 0; round < 7; round++) {
    for (let seat = 0; seat < seats; seat++) {
      const card = opening ? (opening[pos] ?? null) : null;
      const hand = hands[seat];
      if (!hand || (opening && card === null)) {
        return { ok: false, error: bad('deck', 'the pile is short') };
      }
      hand.push({ pos, card, open: false, fresh: false });
      dealt.push({ deck: 'pile', pos, to: seat });
      pos += 1;
    }
  }
  const starter = pos;
  dealt.push({ deck: 'pile', pos, to: null });
  pos += 1;
  const draw: number[] = [];
  for (; pos < DECK_SIZE; pos++) draw.push(pos);
  const state: HollerState = {
    game: 'holler',
    rules: rules.value,
    seats,
    mode: input.mode,
    viewer,
    direction: 1,
    scores: Array.from({ length: seats }, () => 0),
    round: 0,
    epoch: 0,
    phase: { type: 'reveal', kind: 'starter', positions: [starter] },
    activeSuit: null,
    hands,
    draw,
    discard: [],
    buried: [],
    called: Array.from({ length: seats }, () => false),
    resume: null,
    orders: [opening],
    dealt,
  };
  return { ok: true, value: state };
}

export function applyAction(s: HollerState, raw: unknown): ApplyResult<HollerState, HollerEvent> {
  const draft = copyState(s);
  const events: HollerEvent[] = [];
  const err = dispatch(draft, raw, events);
  if (err) return { ok: false, error: err };
  return { ok: true, state: draft, events };
}

export function learnCard(s: HollerState, item: Learn): ApplyResult<HollerState, HollerEvent> {
  if (s.mode !== 'view') return { ok: false, error: bad('mode', 'learn is for a view') };
  if (s.viewer === null || item.deck !== 'pile')
    return { ok: false, error: bad('card', 'that card cannot be learned') };
  const hand = s.hands[s.viewer];
  if (!hand) return { ok: false, error: bad('card', 'that card is not in this hand') };
  const index = hand.findIndex((slot) => slot.pos === item.pos);
  const slot = index < 0 ? undefined : hand[index];
  if (!slot || slot.fresh) return { ok: false, error: bad('card', 'that card is not waiting to be learned') };
  if (slot.card !== null) {
    if (slot.card === item.card) return { ok: true, state: s, events: [] };
    return { ok: false, error: bad('card', 'that card contradicts the one already learned') };
  }
  const viewer = s.viewer;
  const hands = s.hands.map((cards, seat) =>
    seat === viewer ? cards.map((entry, i) => (i === index ? { ...entry, card: item.card } : entry)) : cards,
  );
  return { ok: true, state: { ...s, hands }, events: [] };
}

export function knownTo(s: HollerState, seat: Seat): readonly Learn[] {
  if (s.mode !== 'full') return [];
  const out: Learn[] = [];
  for (const slot of s.hands[seat] ?? []) {
    if (slot.fresh || slot.open || slot.card === null) continue;
    out.push({ deck: 'pile', pos: slot.pos, card: slot.card });
  }
  return out;
}

function showSlot(slot: Slot, seat: number, viewer: number | null): Slot {
  const show = !slot.fresh && slot.card !== null && (slot.open || seat === viewer);
  return show ? slot : { ...slot, card: null };
}

/**
 * A seat who could not see the levy hand stored `blind: true` when the play was applied.
 * The full state stored false. Publishing the full flag would disagree with that view.
 */
function phaseForViewer(phase: Phase, viewer: number | null): Phase {
  if (phase.type !== 'levy' && phase.type !== 'answer') return phase;
  const player = phase.type === 'levy' ? phase.player : phase.seat;
  if (viewer === player) return phase;
  return { ...phase, blind: true };
}

export function viewFor(s: HollerState, viewer: number | null): HollerState {
  return {
    ...s,
    mode: 'view',
    viewer,
    phase: phaseForViewer(s.phase, viewer),
    orders: s.orders.map(() => null),
    hands: s.hands.map((hand, seat) => hand.map((slot) => showSlot(slot, seat, viewer))),
  };
}

/** Tied scores share a place and the next score skips: (1, 1, 3). A tie for second is (1, 2, 2). */
export function placesOf(scores: readonly number[]): number[] {
  return scores.map((score) => 1 + scores.filter((other) => other > score).length);
}

export function outcomeOf(s: HollerState): Outcome | null {
  if (s.phase.type !== 'over') return null;
  return { places: placesOf(s.scores), scores: [...s.scores], reason: 'score' };
}

export function standingsOf(s: HollerState): readonly number[] {
  return [...s.scores];
}

export function dealtOf(s: HollerState): readonly DealtPosition[] {
  return s.dealt;
}

export function revealsOf(_s: HollerState, action: unknown): readonly Learn[] {
  if (!isRecord(action) || action.type !== 'play') return [];
  if (!isPos(action.pos) || !isCard(action.card)) return [];
  return [{ deck: 'pile', pos: action.pos, card: action.card }];
}

function plaintexts(s: HollerState): number[] | null {
  if (s.phase.type !== 'epoch') return null;
  const cards: number[] = [];
  for (const entry of s.phase.from) {
    const card = cardAt(s.orders, entry.pos);
    if (card === null) return null;
    cards.push(card);
  }
  return cards;
}

export function installDeckOrder(
  s: HollerState,
  epoch: number,
  order: readonly number[],
): ApplyResult<HollerState, HollerEvent> {
  if (s.mode !== 'full') return { ok: false, error: bad('mode', 'a view has no deck order') };
  if (s.phase.type !== 'epoch') return { ok: false, error: bad('deck', 'no shuffle is pending') };
  if (!isInt(epoch) || epoch !== s.phase.epoch) return { ok: false, error: bad('deck', 'epoch number') };
  if (!Array.isArray(order) || order.some((card) => !isCard(card))) {
    return { ok: false, error: bad('deck', 'the order must be cards') };
  }
  const expected = plaintexts(s);
  if (!expected || order.length !== expected.length || !sameMultiset(order, expected)) {
    return { ok: false, error: bad('deck', 'the order is not a permutation of the shuffled cards') };
  }
  if (s.orders[epoch]) return { ok: false, error: bad('deck', 'that epoch already has an order') };
  const orders = s.orders.map((row) => (row === null ? null : [...row]));
  while (orders.length < epoch) orders.push(null);
  orders.push([...order]);
  return { ok: true, state: { ...s, orders }, events: [] };
}

export function shufflePlaintexts(s: HollerState): readonly number[] {
  if (s.mode !== 'full') return [];
  return plaintexts(s) ?? [];
}

export function handsReveal(s: HollerState): boolean {
  return s.phase.type === 'reveal' && s.phase.kind === 'score';
}

export type { After };
