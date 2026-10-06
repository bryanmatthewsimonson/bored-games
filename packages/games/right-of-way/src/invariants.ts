/*
 * State invariants for the fuzzer and tests (C37, C38). In full mode every freight card is somewhere exactly once:
 * in a hand, in the yard, in the discards, still in the pile, or being sifted.
 */
import { CHARTER_COUNT, CHARTER_OFFSET, FREIGHT_SIZE, GROUPS, groupOf } from './deck.ts';
import { freightOf } from './engine.ts';
import { ROUTES } from './map.ts';
import { ROUTE_POINTS, TRACK } from './scoring.ts';
import type { RowState } from './types.ts';

export function checkInvariants(s: RowState): string[] {
  const out: string[] = [];
  // Track and points follow the routes laid.
  s.players.forEach((p, seat) => {
    let used = 0;
    let points = 0;
    s.routes.forEach((sides, i) => {
      for (const o of sides) {
        if (o !== seat) continue;
        const L = ROUTES[i]?.length ?? 0;
        used += L;
        points += ROUTE_POINTS[L] ?? 0;
      }
    });
    if (p.track + used !== TRACK) out.push(`seat ${seat}: track ${p.track} + laid ${used} is not ${TRACK}`);
    if (p.track < 0) out.push(`seat ${seat}: negative track`);
    if (p.points !== points) out.push(`seat ${seat}: points ${p.points}, routes give ${points}`);
  });
  // Twins: never both sides to one seat; with 2–3 seats, never both sides at all.
  s.routes.forEach((sides, i) => {
    if (sides.length !== 2 || sides[0] === null || sides[1] === null) return;
    if (sides[0] === sides[1] || s.seats <= 3) out.push(`route ${i}: both sides taken`);
  });
  // Charters: every charter position is in the pile, offered or kept, exactly once.
  const charterPositions = [
    ...s.charterPile,
    ...s.players.flatMap((p) => [...p.offered, ...p.charters].map((c) => c.pos)),
  ].sort((a, b) => a - b);
  const expected = Array.from({ length: CHARTER_COUNT }, (_, k) => CHARTER_OFFSET + k);
  if (JSON.stringify(charterPositions) !== JSON.stringify(expected)) out.push('charters are not conserved');
  if (s.pile.group !== 0 && s.epochs[s.epochs.length - 1]?.group !== s.pile.group)
    out.push('pile is not the last epoch');
  if (new Set(s.epochs.map((e) => e.group)).size !== s.epochs.length)
    out.push('a spare group was used twice');
  if (s.mode !== 'full' || s.order === null) return out;
  const order = s.order;
  // Freight: each of the 110 cards exactly once.
  const where: number[] = [];
  for (const p of s.players) for (const h of p.hand) where.push(freightOf(s, h.pos, h.card) ?? -1);
  for (const y of s.yard) {
    if (y === null) continue;
    const f = freightOf(s, y.pos, order[y.pos] as number);
    // A pending slot of a reshuffle may hold a card that stands for no discard: its reveal will skip it.
    if (f !== null) where.push(f);
    else if (y.card !== null) where.push(-2);
  }
  where.push(...s.discards);
  const g = GROUPS[s.pile.group];
  if (g !== undefined) {
    for (let pos = s.pile.next; pos < g.offset + g.size; pos++) {
      const f = freightOf(s, pos, order[pos] as number);
      if (f !== null) where.push(f);
    }
  }
  if (s.sift !== null) {
    const f = freightOf(s, s.sift.pos, order[s.sift.pos] as number);
    if (f !== null) where.push(f);
  }
  const sorted = [...where].sort((a, b) => a - b);
  if (sorted.length !== FREIGHT_SIZE || sorted.some((f, i) => f !== i))
    out.push(`freight cards are not conserved (${sorted.length} placed)`);
  // Known cards match the deck.
  for (const p of s.players) {
    for (const x of [...p.hand, ...p.offered, ...p.charters, ...p.memory])
      if (x.card !== order[x.pos])
        out.push(`position ${x.pos} holds ${x.card}, the deck says ${order[x.pos]}`);
    if (p.hand.some((h) => groupOf(h.pos) !== groupOf(h.card ?? -1)))
      out.push('a hand card is outside its group');
  }
  return out;
}
