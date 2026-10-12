/*
 * Checks the fuzzer runs after every step (CLAUDE.md, D015). Each returns a sentence; none means the state is sound.
 */
import { CARD_COUNT } from './cards.ts';
import { PROVINCES } from './map.ts';
import type { HazardEvent, HazardState } from './types.ts';

export function checkInvariants(s: HazardState): string[] {
  const out: string[] = [];
  const opening = s.stage === 'order' || s.stage === 'orderRoll' || s.stage === 'claim';
  PROVINCES.forEach((p, i) => {
    const owner = s.owner[i];
    const troops = s.troops[i] ?? -1;
    if (!Number.isSafeInteger(troops) || troops < 0) out.push(`${p} has ${troops} troops`);
    if (owner === null && (!opening || troops !== 0)) out.push(`${p} is unheld with ${troops} troops`);
    if (owner !== null && troops < 1 && s.stage !== 'advance') out.push(`${p} is held with no troops`);
    if (owner !== null && owner !== undefined && s.out.includes(owner))
      out.push(`${p} is held by a seat that is out`);
  });
  if (s.pool < 0) out.push(`the pool is ${s.pool}`);
  if (s.reserve.some((r) => r < 0)) out.push('a reserve is negative');
  const positions = [...s.pile, ...s.hands.flat().map((x) => x.pos), ...s.discard.map((d) => d.pos)];
  if (new Set(positions).size !== positions.length) out.push('a charter position is in two places');
  if (positions.length !== CARD_COUNT)
    out.push(`${positions.length} charters are accounted for, not ${CARD_COUNT}`);
  if (s.plain !== null) {
    const cards = positions.map((pos) => s.plain?.[String(pos)]);
    if (cards.some((c) => c === undefined)) out.push('a charter position has no card');
    else if (new Set(cards).size !== CARD_COUNT) out.push('a card is in two places');
    for (const hand of s.hands)
      for (const x of hand) if (x.card !== s.plain[String(x.pos)]) out.push(`charter ${x.pos} is misread`);
  }
  for (const seat of s.out)
    if ((s.hands[seat]?.length ?? 0) > 0) out.push(`seat ${seat} is out with charters`);
  if (s.stage !== 'over' && s.out.includes(s.turn) && s.stage !== 'order')
    out.push('the turn is with a seat that is out');
  return out;
}

/** Rare moments the fuzzer reports, so a run shows it reached them. */
export function coverageOf(s: HazardState, events: readonly HazardEvent[]): string[] {
  const tags = events.map((e) => `move:${e.type}`);
  for (const e of events) {
    if (e.type === 'won') tags.push('end:conquest');
    if (e.type === 'reshuffled') tags.push('move:reshuffle');
    if (e.type === 'eliminated' && e.charters > 0) tags.push('move:transfer');
    if (e.type === 'cashed' && e.foul) tags.push('move:foul');
  }
  if (s.midTurn && events.some((e) => e.type === 'eliminated')) tags.push('move:cashDown');
  return tags;
}
