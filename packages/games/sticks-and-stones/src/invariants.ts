/*
 * Checks the fuzzer runs after every step (CLAUDE.md, D015). Each returns a sentence; none means the state is sound.
 */
import { DISCOVERY_COUNT, MONUMENT_COUNT, STACK_SIZE } from './data.ts';
import { GROUND_ROOM } from './engine.ts';
import { GROUNDS, SPOTS, type SticksEvent, type SticksState } from './types.ts';
import { MAX_FIELD, MAX_PEOPLE, MAX_TOOL, MAX_TOOLS, sum } from './util.ts';

export function checkInvariants(s: SticksState): string[] {
  const out: string[] = [];
  s.clans.forEach((c, seat) => {
    const who = `seat ${seat}`;
    if (c.people < 5 || c.people > MAX_PEOPLE) out.push(`${who} has ${c.people} people`);
    if (c.field < 0 || c.field > MAX_FIELD) out.push(`${who} has harvest ${c.field}`);
    if (c.food < 0) out.push(`${who} has ${c.food} food`);
    if (c.goods.length !== 4 || c.goods.some((n) => n < 0)) out.push(`${who} has goods ${c.goods.join(',')}`);
    if (c.tools.length > MAX_TOOLS || c.tools.some((v) => v < 1 || v > MAX_TOOL))
      out.push(`${who} has tools ${c.tools}`);
    if (c.used.length !== c.tools.length) out.push(`${who} has a tool marked used that it lacks`);
    if (c.choices < 0) out.push(`${who} has ${c.choices} choice cards`);
    const placed = SPOTS.reduce((n, p) => n + (s.spots[p][seat] ?? 0), 0);
    if (placed + (s.home[seat] ?? 0) > c.people) out.push(`${who} placed more people than it has`);
    if (s.stage === 'place' && placed + (s.home[seat] ?? 0) !== c.people)
      out.push(`${who} lost people while placing`);
  });
  for (const g of GROUNDS) if (sum(s.spots[g]) > GROUND_ROOM) out.push(`${g} holds more than ${GROUND_ROOM}`);
  for (const p of SPOTS)
    if (p !== 'hunt' && !GROUNDS.includes(p) && s.spots[p].filter((n) => n > 0).length > 1)
      out.push(`${p} holds two clans`);
  if (s.spots.hut.some((n) => n !== 0 && n !== 2)) out.push('the hearth holds other than two people');
  const discoveries = [
    ...s.display.flatMap((d) => (d?.card == null ? [] : [d.card])),
    ...s.clans.flatMap((c) => [...c.cards, ...c.hidden.flatMap((h) => (h.card === null ? [] : [h.card]))]),
  ];
  if (new Set(discoveries).size !== discoveries.length) out.push('a discovery is in two places');
  if (discoveries.some((c) => c < 0 || c >= DISCOVERY_COUNT)) out.push('a discovery number is out of range');
  const held =
    s.display.filter((d) => d !== null).length +
    s.clans.reduce((n, c) => n + c.cards.length + c.hidden.length, 0);
  if (held !== s.next) out.push(`${s.next} discoveries were drawn but ${held} are out`);
  const monuments = s.clans.flatMap((c) => c.monuments);
  if (new Set(monuments).size !== monuments.length) out.push('a monument was built twice');
  if (monuments.some((m) => m < 0 || m >= MONUMENT_COUNT)) out.push('a monument number is out of range');
  if (monuments.length !== sum(s.stacks.map((st) => st.built)))
    out.push('the monuments built do not match the stacks');
  if (s.stacks.some((st) => st.built < 0 || st.built > STACK_SIZE)) out.push('a stack is out of range');
  if (s.order !== null) {
    for (const d of s.display)
      if (d?.card != null && s.order[d.pos] !== d.card) out.push(`slot card ${d.pos} is misread`);
    s.stacks.forEach((st, k) => {
      if (st.top !== null && s.order?.[DISCOVERY_COUNT + STACK_SIZE * k + st.built] !== st.top)
        out.push(`stack ${k}'s top is misread`);
    });
  }
  if (s.stage === 'over' && s.result === null) out.push('the game is over without a result');
  return out;
}

/** Rare moments the fuzzer reports, so a run shows it reached them. */
export function coverageOf(_s: SticksState, events: readonly SticksEvent[]): string[] {
  const tags = events.map((e) => `move:${e.type}`);
  for (const e of events) {
    if (e.type === 'ended') tags.push(`end:${e.reason}`);
    if (e.type === 'fed' && e.hungry) tags.push('move:hungry');
    if (e.type === 'fed' && e.goods > 0) tags.push('move:feedGoods');
    if (e.type === 'gathered' && e.bonus > 0) tags.push('move:tools');
    if (e.type === 'gathered' && e.spot === 'card') tags.push('move:cardRoll');
  }
  return tags;
}
