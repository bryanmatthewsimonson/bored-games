import { TILES } from '../src/data.ts';
import { apply, DEFAULT_RULES, installDeckOrder, pending, setup, shufflePlaintexts } from '../src/engine.ts';
import type { Placement, State } from '../src/types.ts';
export function move(s: State, a: unknown): State {
  const r = apply(s, a);
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}
export function settle(s: State, order?: number[]): State {
  while (['start', 'shuffle', 'ending'].includes(s.phase)) {
    const p = pending(s);
    if (p.type === 'reveal') {
      for (const pos of p.positions)
        s = move(s, {
          type: 'reveal',
          actor: 'deck',
          deck: 'pile',
          pos,
          card: s.orders[Math.floor(pos / 128)]?.[pos % 128],
        });
    } else if (p.type === 'shuffle') {
      const cards = order ?? shufflePlaintexts(s),
        r = installDeckOrder(s, p.epoch, cards);
      if (!r.ok) throw new Error(r.error.message);
      s = move(r.state, { type: 'epoch', actor: 'deck', epoch: p.epoch, size: cards.length });
      order = undefined;
    }
  }
  return s;
}
export function ready(letters = 'CATERS?', seats = 2): State {
  const cards = Array.from({ length: 100 }, (_, i) => i),
    chosen: number[] = [];
  for (const letter of letters) {
    const card = cards.find(
      (c) => !chosen.includes(c) && TILES[c]?.letter === (letter === '?' ? '' : letter),
    );
    if (card === undefined) throw new Error('No tile');
    chosen.push(card);
  }
  const order: number[] = [];
  const rest = cards.filter((c) => !chosen.includes(c));
  for (let round = 0; round < 7; round++)
    for (let seat = 0; seat < seats; seat++) {
      const tile = seat === 0 ? chosen[round] : undefined;
      order.push(tile ?? rest.shift() ?? 0);
    }
  order.push(...rest);
  const start = setup({ rules: DEFAULT_RULES, seats, mode: 'full', deckOrders: { pile: cards } });
  if (!start.ok) throw new Error(start.error.message);
  const s = settle(start.value, order);
  s.turn = 0;
  return s;
}
export function placements(s: State, text: string, cell: number, step = 1, seat = s.turn): Placement[] {
  const used = new Set<number>();
  return [...text].map((letter, i) => {
    const h =
      s.hands[seat]?.find((h) => !used.has(h.pos) && h.card !== null && TILES[h.card]?.letter === letter) ??
      s.hands[seat]?.find((h) => !used.has(h.pos) && h.card !== null && TILES[h.card]?.letter === '');
    if (!h || h.card === null) throw new Error(`No ${letter}`);
    used.add(h.pos);
    return { cell: cell + i * step, pos: h.pos, card: h.card, letter };
  });
}
export function accepted(s: State, tiles: Placement[]): State {
  s = move(s, { type: 'place', actor: s.turn, tiles });
  while (s.phase === 'review') s = move(s, { type: 'accept', actor: s.turn });
  return s;
}
