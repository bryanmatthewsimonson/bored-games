/*
 * The invariants the fuzzer checks after every step, and the rare-event tags of its coverage report. Pure.
 */
import { CASES_PER_STRAIN, CLINIC_LIMIT, FIELD_COUNT, HAND_LIMIT, MAX_CASES, SPILL_LIMIT } from './data.ts';
import { onBoard, overLimit } from './engine.ts';
import { CITY_COUNT, STRAIN_COUNT } from './map.ts';
import type { SpreadEvent, SpreadState } from './types.ts';

export function checkInvariants(s: SpreadState): string[] {
  const out: string[] = [];
  if (s.phase === 'setup') return out;
  for (let c = 0; c < CITY_COUNT; c++)
    for (let k = 0; k < STRAIN_COUNT; k++) {
      const n = s.cases[c]?.[k] ?? -1;
      if (n < 0 || n > MAX_CASES) out.push(`city ${c} holds ${n} cases of strain ${k}`);
    }
  for (let k = 0; k < STRAIN_COUNT; k++) {
    if (onBoard(s, k) > CASES_PER_STRAIN) out.push(`strain ${k} has more cases out than its tokens`);
    if (s.stamped[k] && (!s.cured[k] || onBoard(s, k) > 0)) out.push(`strain ${k} is stamped out wrongly`);
  }
  if (s.clinics.length < 1 || s.clinics.length > CLINIC_LIMIT) out.push(`${s.clinics.length} clinics`);
  if (new Set(s.clinics).size !== s.clinics.length) out.push('two clinics in one city');
  if (s.spills > SPILL_LIMIT) out.push('too many spillovers');
  if (s.spills >= SPILL_LIMIT && s.phase !== 'over') out.push('the eighth spillover did not end the game');
  // Every field card is in exactly one place, or still in the field deck.
  const seen = [...s.hands.flat(), ...s.discard, ...s.removed, ...s.stored.filter((x) => x !== null)];
  if (new Set(seen).size !== seen.length) out.push('a field card is in two places');
  if (seen.length > FIELD_COUNT || seen.some((f) => f < 0 || f >= FIELD_COUNT))
    out.push('a field card is unknown');
  // Every spread card is in the deck, spent or purged.
  const spread = s.pile.length + s.spent.length + s.purged.length;
  if (spread !== CITY_COUNT) out.push(`${spread} spread cards accounted for`);
  if (
    s.phase !== 'over' &&
    overLimit(s) === null &&
    s.hands.some((h) => h.length > HAND_LIMIT) &&
    s.phase === 'actions'
  )
    out.push('a hand is over the limit');
  if (s.phase === 'over' && s.result === null) out.push('over without a result');
  return out;
}

export function coverageOf(s: SpreadState, events: readonly SpreadEvent[]): string[] {
  const tags = new Set<string>();
  for (const e of events) {
    if (e.type === 'spillover') tags.add(e.count > 1 ? 'spillover:many' : 'spillover');
    if (e.type === 'drew' && e.surges === 2) tags.add('surge:double');
    if (e.type === 'restack') tags.add('restack');
    if (e.type === 'cure') tags.add('cure');
    if (e.type === 'stamped') tags.add('stamped');
    if (e.type === 'blocked') tags.add('blocked');
    if (e.type === 'cleared') tags.add('paramedic:cleared');
    if (e.type === 'relief') tags.add(`relief:${e.card}`);
    if (e.type === 'arranged') tags.add('arranged');
    if (e.type === 'quiet') tags.add('quiet');
    if (e.type === 'retrieve') tags.add('retrieve');
    if (e.type === 'discard') tags.add('discard:limit');
    if (e.type === 'clinic' && e.moved !== null) tags.add('clinic:moved');
    if (e.type === 'move') tags.add(`move:${e.how}`);
    if (e.type === 'handed') tags.add('handed');
    if (e.type === 'won') tags.add('end:won');
    if (e.type === 'lost') tags.add(`end:${e.reason}`);
  }
  if (s.pile.length === 0 && s.phase !== 'over' && s.phase !== 'setup') tags.add('pile:empty');
  return [...tags];
}
