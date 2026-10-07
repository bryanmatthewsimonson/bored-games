import { cardAt, isFullDeck, isSuit } from './cards.ts';
import type { HollerState, Slot } from './types.ts';

function safeScore(n: number): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
}

/** The starter that has been dealt and not yet turned. It is not in a hand, the draw, or the discard. */
function inFlight(s: HollerState): number | null {
  if (s.phase.type === 'reveal' && s.phase.kind === 'starter') {
    return s.phase.positions.length === 1 ? (s.phase.positions[0] ?? null) : null;
  }
  if (s.phase.type === 'grant') return s.phase.starter;
  return null;
}

function livePositions(s: HollerState): number[] {
  const positions: number[] = [];
  for (const hand of s.hands) for (const slot of hand) positions.push(slot.pos);
  for (const pos of s.draw) positions.push(pos);
  for (const card of s.discard) positions.push(card.pos);
  for (const pos of s.buried) positions.push(pos);
  const flight = inFlight(s);
  if (flight !== null) positions.push(flight);
  return positions;
}

function samePositions(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.slice().sort((x, y) => x - y);
  const right = b.slice().sort((x, y) => x - y);
  return left.every((pos, i) => pos === right[i]);
}

function pushLiveCards(s: HollerState, out: string[]): void {
  const cards: number[] = [];
  const take = (pos: number, card: number | null, where: string): void => {
    if (card === null) {
      out.push(`${where} ${pos} has no card`);
      return;
    }
    cards.push(card);
  };
  for (const hand of s.hands) {
    for (const slot of hand) take(slot.pos, slot.card, 'hand');
  }
  for (const pos of s.draw) take(pos, cardAt(s.orders, pos), 'draw');
  for (const card of s.discard) {
    if (card.card !== cardAt(s.orders, card.pos)) out.push(`discard ${card.pos} does not match the order`);
    take(card.pos, card.card, 'discard');
  }
  for (const pos of s.buried) take(pos, cardAt(s.orders, pos), 'buried');
  const flight = inFlight(s);
  if (flight !== null) take(flight, cardAt(s.orders, flight), 'starter');
  if (!isFullDeck(cards)) out.push('live cards are not one full deck');
}

function handDealt(s: HollerState, live: ReadonlySet<number>, out: string[]): void {
  const discarded = new Set(s.discard.map((card) => card.pos));
  const buried = new Set(s.buried);
  for (let seat = 0; seat < s.seats; seat++) {
    const expected = s.dealt
      .filter(
        (entry) =>
          entry.to === seat && live.has(entry.pos) && !discarded.has(entry.pos) && !buried.has(entry.pos),
      )
      .map((entry) => entry.pos);
    const actual = (s.hands[seat] ?? []).map((slot: Slot) => slot.pos);
    if (!samePositions(expected, actual))
      out.push(`seat ${seat} hand is not the cards still dealt to that seat`);
  }
}

/** Human-readable violations; empty when the state is sound. Does not import the engine. */
export function checkInvariants(s: HollerState): string[] {
  const out: string[] = [];
  const n = s.seats;
  if (s.game !== 'holler') out.push('game id');
  if (!Number.isInteger(n) || n < 2 || n > 10) out.push('seat count');
  if (s.hands.length !== n || s.scores.length !== n || s.called.length !== n) out.push('per-seat arrays');
  if (s.direction !== 1 && s.direction !== -1) out.push('direction');
  if (s.mode !== 'full' && s.mode !== 'view') out.push('mode');
  if (s.mode === 'full' && s.viewer !== null) out.push('full mode has no viewer');
  if (
    s.mode === 'view' &&
    s.viewer !== null &&
    (!Number.isInteger(s.viewer) || s.viewer < 0 || s.viewer >= n)
  ) {
    out.push('viewer');
  }
  s.scores.forEach((score, seat) => {
    if (!safeScore(score)) out.push(`score of seat ${seat}`);
  });
  s.called.forEach((flag, seat) => {
    if (flag && (s.hands[seat]?.length ?? 0) !== 1) out.push(`seat ${seat} is declared without one card`);
  });
  if (s.activeSuit !== null && !isSuit(s.activeSuit)) out.push('active suit');
  if (s.buried.length > 4) out.push('more than four cards are set aside');
  if (s.phase.type === 'epoch' && (s.phase.from.length < 1 || s.phase.from.length > 108))
    out.push('epoch size');
  if (s.phase.type === 'reveal' && s.phase.kind === 'starter' && s.phase.positions.length !== 1) {
    out.push('the starter reveal is one card');
  }
  if (s.resume !== null) {
    const { seat, left, after } = s.resume;
    if (!Number.isInteger(seat) || seat < 0 || seat >= n) out.push('resume seat');
    if (!Number.isInteger(left) || left < 1 || left > 6) out.push('resume left');
    if (after !== 'skip' && after !== 'cover' && after !== 'score' && after !== 'play')
      out.push('resume after');
  }

  const dealtPos = new Set<number>();
  for (const entry of s.dealt) {
    if (
      entry.deck !== 'pile' ||
      !Number.isSafeInteger(entry.pos) ||
      entry.pos < 0 ||
      Object.is(entry.pos, -0)
    ) {
      out.push('dealt entry');
      continue;
    }
    if (dealtPos.has(entry.pos)) out.push(`position ${entry.pos} was dealt twice`);
    dealtPos.add(entry.pos);
  }

  const positions = livePositions(s);
  if (new Set(positions).size !== positions.length) out.push('a live position is in two zones');
  if (s.mode === 'full') {
    const opening = s.orders[0];
    if (!opening || !isFullDeck(opening)) out.push('opening order is not a full deck');
    pushLiveCards(s, out);
  } else if (s.orders.some((row) => row !== null)) {
    out.push('a view stores no deck order');
  }
  handDealt(s, new Set(positions), out);
  return out;
}
