import { DECK_SIZES, type DeckId, PATRONS, TIER_DECKS, workshop } from './data.ts';
import { score } from './engine.ts';
import type { LusterPlayer, LusterState } from './types.ts';

export function checkInvariants(s: LusterState): string[] {
  const out: string[] = [];
  const valid = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (s.seats < 2 || s.seats > 4 || s.players.length !== s.seats) out.push('seat count');
  if (!valid(s.turn) || s.turn >= s.seats) out.push('turn');
  if (s.startingSeat !== null && (!valid(s.startingSeat) || s.startingSeat >= s.seats))
    out.push('starting seat');
  if (s.startingSeat === null && !s.market[0]?.some((h) => h?.card === null))
    out.push('starting seat unresolved');
  if (s.supply.length !== 6 || !s.supply.every(valid)) out.push('supply');
  for (let i = 0; i < 6; i++) {
    const expected = i === 5 ? 5 : s.seats === 2 ? 4 : s.seats === 3 ? 5 : 7;
    if ((s.supply[i] ?? 0) + s.players.reduce((n, p) => n + (p.tokens[i] ?? 0), 0) !== expected)
      out.push(`token conservation ${i}`);
  }
  for (const [i, p] of s.players.entries()) {
    if (p.tokens.length !== 6 || !p.tokens.every(valid)) out.push(`tokens ${i}`);
    if (p.reserved.length > 3) out.push(`reservation limit ${i}`);
    if (p.tokens.reduce((a, b) => a + b, 0) > 10 && !(s.phase === 'return' && i === s.turn))
      out.push(`token limit ${i}`);
    if (p.bought.some((h) => h.card === null)) out.push(`unknown purchased card ${i}`);
    if (s.mode === 'view' && i !== s.viewer && p.reserved.some((h) => h.private && h.card !== null))
      out.push(`private leak ${i}`);
  }
  const holdings = [
    ...s.market.flat().filter((h) => h !== null),
    ...s.players.flatMap((p) => [...p.reserved, ...p.bought]),
  ];
  const positions = new Set<string>();
  const identities = new Set<string>();
  for (const h of holdings) {
    const key = `${h.deck}:${h.pos}`;
    if (positions.has(key)) out.push('duplicate workshop position');
    positions.add(key);
    if (!s.dealt.some((d) => d.deck === h.deck && d.pos === h.pos)) out.push('unassigned workshop');
    if (h.card !== null) {
      if (!workshop(h.deck, h.card)) out.push('invalid workshop');
      const id = `${h.deck}:${h.card}`;
      if (identities.has(id)) out.push('duplicate workshop identity');
      identities.add(id);
      if (s.decks[h.deck].order !== null && s.decks[h.deck].order?.[h.pos] !== h.card)
        out.push('workshop order mismatch');
    }
  }
  for (const deck of [...TIER_DECKS, 'patrons'] as DeckId[]) {
    const d = s.decks[deck];
    if (!valid(d.next) || d.next > DECK_SIZES[deck]) out.push(`deck cursor ${deck}`);
    const dealt = s.dealt.filter((x) => x.deck === deck);
    if (dealt.length !== d.next || dealt.some((x, i) => x.pos !== i)) out.push(`assignments ${deck}`);
    if (s.mode === 'view' && d.order !== null) out.push('deck order leaked');
    if (deck !== 'patrons' && holdings.filter((h) => h.deck === deck).length !== d.next)
      out.push(`card conservation ${deck}`);
  }
  const patrons = [
    ...s.patrons.flatMap((p) => (p.card === null ? [] : [p.card])),
    ...s.players.flatMap((p) => p.patrons),
  ];
  if (new Set(patrons).size !== patrons.length || patrons.some((p) => !PATRONS[p]))
    out.push('patron identity');
  if (s.patrons.length + s.players.reduce((n, p) => n + p.patrons.length, 0) !== s.seats + 1)
    out.push('patron conservation');
  if ((s.phase === 'over') !== (s.result !== null)) out.push('outcome phase');
  if (
    s.result &&
    ((s.turn + 1) % s.seats !== s.startingSeat ||
      !s.players.some((p) => score(p) >= 15) ||
      s.result.scores.some((n, i) => n !== score(s.players[i] as LusterPlayer)))
  )
    out.push('outcome scores');
  return out;
}
