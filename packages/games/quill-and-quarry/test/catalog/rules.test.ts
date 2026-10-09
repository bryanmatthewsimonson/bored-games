import { deepFreeze } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { INVENTORY, premiumAt, TILES } from '../../src/data.ts';
import {
  apply,
  DEFAULT_RULES,
  evaluate,
  installDeckOrder,
  invariants,
  knownTo,
  learn,
  legalActions,
  parseAction,
  pending,
  setup,
  shufflePlaintexts,
  validateRules,
  view,
} from '../../src/engine.ts';
import { quillAndQuarry } from '../../src/module.ts';
import type { Placement, State } from '../../src/types.ts';
import { accepted, move, placements, ready, settle } from '../helpers.ts';

function tile(tiles: Placement[], index = 0): Placement {
  const value = tiles[index];
  if (!value) throw new Error('Missing fixture tile');
  return value;
}
function opening(): State {
  const s = setup({
    rules: DEFAULT_RULES,
    seats: 2,
    mode: 'full',
    deckOrders: { pile: Array.from({ length: 100 }, (_, i) => i) },
  });
  if (!s.ok) throw new Error('setup');
  return s.value;
}
function points(s: State, text: string, cell: number, step = 1): number {
  const r = evaluate(s, s.turn, placements(s, text, cell, step));
  if (!r.ok) throw new Error(r.error.message);
  return r.value.points;
}
function rack(s: State, letters: string): State {
  s.hands[s.turn] = [...letters].map((letter, i) => ({
    pos: 10000 + i,
    card: TILES.findIndex((t) => t.letter === (letter === '?' ? '' : letter)),
    open: false,
  }));
  return s;
}

describe('rules catalog', () => {
  it('C01 contains the complete English inventory and four premium patterns', () => {
    expect(TILES).toHaveLength(100);
    expect(INVENTORY.reduce((n, [, c, v]) => n + c * v, 0)).toBe(187);
    expect(TILES.filter((t) => t.letter === '')).toHaveLength(2);
    const all = Array.from({ length: 225 }, (_, i) => premiumAt(i));
    expect(['2L', '3L', '2W', '3W'].map((p) => all.filter((x) => x === p).length)).toEqual([24, 12, 17, 8]);
  });
  it('C02 validates setup, seats, the dictionary contract, and deck permutations', () => {
    expect(validateRules({}).ok).toBe(false);
    expect(validateRules({ ...DEFAULT_RULES, extra: 1 }).ok).toBe(false);
    for (const seats of [1, 5, 2.5])
      expect(setup({ rules: DEFAULT_RULES, seats, mode: 'view', viewer: null }).ok).toBe(false);
    expect(
      setup({ rules: DEFAULT_RULES, seats: 2, mode: 'full', deckOrders: { pile: Array(100).fill(0) } }).ok,
    ).toBe(false);
    expect(invariants(ready())).toEqual([]);
  });
  it('C03 draws alphabetically for first player, redraws ties, and returns all starting tiles', () => {
    let s = opening();
    s = move(s, { type: 'reveal', actor: 'deck', deck: 'pile', pos: 0, card: 0 });
    s = move(s, { type: 'reveal', actor: 'deck', deck: 'pile', pos: 1, card: 1 });
    expect(s.phase).toBe('start');
    expect(s.draws.map((d) => d.pos)).toEqual([2, 3]);
    s = settle(s);
    expect(s.phase).toBe('turn');
    expect(s.bag.length).toBe(86);
    expect(s.hands.map((h) => h.length)).toEqual([7, 7]);
    expect(s.epoch).toBe(1);
    expect(invariants(s)).toEqual([]);
  });
  it('C04 treats a blank as the earliest starting tile', () => {
    let s = opening();
    s.orders[0] = [98, 0, ...Array.from({ length: 100 }, (_, i) => i).filter((i) => i !== 98 && i !== 0)];
    s = move(s, { type: 'reveal', actor: 'deck', deck: 'pile', pos: 0, card: 98 });
    s = move(s, { type: 'reveal', actor: 'deck', deck: 'pile', pos: 1, card: 0 });
    expect(s.first).toBe(0);
    expect(s.phase).toBe('shuffle');
  });
  it('C05 requires a centered first word of two or more letters', () => {
    const s = ready();
    expect(evaluate(s, 0, placements(s, 'C', 112)).ok).toBe(false);
    expect(evaluate(s, 0, placements(s, 'CAT', 100)).ok).toBe(false);
    expect(points(s, 'CAT', 111)).toBe(10);
    expect(points(s, 'CAT', 97, 15)).toBe(10);
  });
  it('C06 rejects bends, gaps, disconnected plays, and overwriting', () => {
    const s = ready();
    const p = placements(s, 'CAT', 111);
    expect(evaluate(s, 0, [tile(p, 0), { ...tile(p, 1), cell: 127 }, tile(p, 2)]).ok).toBe(false);
    expect(evaluate(s, 0, [tile(p, 0), { ...tile(p, 1), cell: 114 }]).ok).toBe(false);
    const next = rack(accepted(s, p), 'HAT');
    expect(evaluate(next, 1, placements(next, 'HAT', 0)).ok).toBe(false);
    expect(evaluate(next, 1, placements(next, 'HAT', 111)).ok).toBe(false);
  });
  it('C07 connects through existing letters without moving them', () => {
    let s = accepted(ready(), placements(ready(), 'CAT', 111));
    s = rack(s, 'HT');
    const tiles = [tile(placements(s, 'H', 97)), tile(placements(s, 'T', 127))];
    const result = evaluate(s, s.turn, tiles);
    expect(result.ok && result.value.words.map((w) => w.text)).toEqual(['HAT']);
    expect(result.ok && result.value.points).toBe(6);
  });
  it('C08 scores every crossing and reuses a fresh letter premium in each word', () => {
    let s = accepted(ready(), placements(ready(), 'CAT', 111));
    s = rack(s, 'AT');
    expect(points(s, 'AT', 97)).toBe(8);
  });
  it('C09 multiplies stacked word premiums after letter premiums', () => {
    const s = rack(ready(), 'ABCDEFG');
    s.board[6] = { pos: 9999, card: TILES.findIndex((t) => t.letter === 'H'), letter: 'H', seat: 1 };
    const tiles = placements(s, 'ABCDEFG', 0).map((t, i) => ({ ...t, cell: i === 6 ? 7 : i }));
    const result = evaluate(s, 0, tiles);
    expect(result.ok && result.value.points).toBe(248);
  });
  it('C10 consumes premiums once, including the central word multiplier', () => {
    let s = accepted(ready(), placements(ready(), 'CAT', 111));
    s = rack(s, 'S');
    expect(points(s, 'S', 114)).toBe(6);
  });
  it('C11 fixes a blank’s declared letter and always scores it zero', () => {
    const s = ready('C?TERSS');
    expect(points(s, 'CAT', 111)).toBe(8);
    const next = accepted(s, placements(s, 'CAT', 111));
    expect(next.board[112]?.letter).toBe('A');
    expect(TILES[next.board[112]?.card ?? -1]?.value).toBe(0);
    expect(next.scores[0]).toBe(8);
  });
  it('C12 adds fifty points only for a seven-tile play', () => {
    const s = ready('RETAINS');
    expect(points(s, 'RETAINS', 108)).toBe(66);
    const small = rack(ready(), 'AT');
    expect(points(small, 'AT', 112)).toBe(4);
  });
  it('C13 keeps a play provisional and refills only after every opponent accepts', () => {
    const s = ready('CATERS?', 4);
    let n = move(s, { type: 'place', actor: 0, tiles: placements(s, 'CAT', 111) });
    expect(n.scores[0]).toBe(0);
    expect(n.hands[0]).toHaveLength(4);
    for (let actor = 1; actor <= 3; actor++) n = move(n, { type: 'accept', actor });
    expect(n.scores[0]).toBe(10);
    expect(n.hands[0]).toHaveLength(7);
    expect(n.turn).toBe(1);
    expect(invariants(n)).toEqual([]);
  });
  it('C14 restores all tiles and cancels points after a successful challenge', () => {
    const s = ready();
    let n = move(s, { type: 'place', actor: 0, tiles: placements(s, 'CAT', 111) });
    n = move(n, { type: 'challenge', actor: 1 });
    n = move(n, { type: 'judge', actor: 1, valid: false });
    expect(n.scores).toEqual([0, 0]);
    expect(n.board.every((t) => t === null)).toBe(true);
    expect(n.hands[0]).toHaveLength(7);
    expect(n.hands[0]?.filter((h) => h.open)).toHaveLength(3);
    expect(n.turn).toBe(1);
    expect(n.scoreless).toBe(1);
    expect(invariants(n)).toEqual([]);
  });
  it('C15 skips the next turn of an unsuccessful challenger, including a later reviewer', () => {
    const s = ready('CATERS?', 3);
    let n = move(s, { type: 'place', actor: 0, tiles: placements(s, 'CAT', 111) });
    n = move(n, { type: 'accept', actor: 1 });
    n = move(n, { type: 'challenge', actor: 2 });
    n = move(n, { type: 'judge', actor: 2, valid: true });
    expect(n.turn).toBe(1);
    expect(n.skips).toEqual([2]);
    n = move(n, { type: 'pass', actor: 1 });
    expect(n.turn).toBe(0);
    expect(n.skips).toEqual([]);
    expect(n.scoreless).toBe(2);
  });
  it('C16 draws replacements before remixing exchanged tiles, and preserves all one hundred', () => {
    const s = ready(),
      pos = s.hands[0]?.[0]?.pos ?? 0,
      oldBag = [...s.bag];
    let n = move(s, { type: 'exchange', actor: 0, positions: [pos] });
    expect(n.hands[0]?.some((h) => h.pos === oldBag[0])).toBe(true);
    expect(n.hands[0]?.some((h) => h.pos === pos)).toBe(false);
    expect(n.shuffle).toContain(pos);
    expect(n.shuffle).not.toContain(oldBag[0]);
    expect(invariants(n)).toEqual([]);
    n = settle(n);
    expect(n.bag.length).toBe(86);
    expect(n.epoch).toBe(2);
    expect(n.turn).toBe(1);
    expect(invariants(n)).toEqual([]);
  });
  it('C17 requires seven bag tiles to exchange and canonical owned selections', () => {
    const s = ready(),
      pos = s.hands[0]?.[0]?.pos ?? 0;
    s.bag = s.bag.slice(0, 6);
    expect(apply(s, { type: 'exchange', actor: 0, positions: [pos] }).ok).toBe(false);
    s.bag.push(999);
    expect(apply(s, { type: 'exchange', actor: 0, positions: [pos] }).ok).toBe(true);
    expect(apply(s, { type: 'exchange', actor: 0, positions: [9999] }).ok).toBe(false);
    expect(parseAction({ type: 'exchange', actor: 0, positions: [pos, pos] })).toBeNull();
  });
  it('C18 permits passing with playable tiles and ends by declaration after six scoreless turns', () => {
    let s = ready();
    for (let i = 0; i < 6; i++) s = move(s, { type: 'pass', actor: s.turn });
    expect(s.result).toBeNull();
    expect(legalActions(s, s.turn)).toEqual([{ type: 'finish', actor: s.turn }]);
    expect(apply(s, { type: 'pass', actor: s.turn }).ok).toBe(false);
    s = settle(move(s, { type: 'finish', actor: s.turn }));
    expect(s.phase).toBe('over');
    expect(s.result?.scores.every((n) => n <= 0)).toBe(true);
  });
  it('C19 resets the scoreless count on an accepted positive score', () => {
    let s = ready();
    s = move(s, { type: 'pass', actor: 0 });
    s = move(s, { type: 'pass', actor: 1 });
    s = accepted(s, placements(s, 'CAT', 111));
    expect(s.scoreless).toBe(0);
  });
  it('C20 subtracts rack values and awards them to the player who goes out', () => {
    const s = rack(ready(), 'AT');
    s.bag = [];
    s.hands[1] = [
      { pos: 400, card: 98, open: true },
      { pos: 401, card: TILES.findIndex((t) => t.letter === 'Q'), open: true },
    ];
    const n = accepted(s, placements(s, 'AT', 112));
    expect(n.phase).toBe('over');
    expect(n.result?.scores).toEqual([14, -10]);
    expect(n.result?.places).toEqual([1, 2]);
  });
  it('C21 shares finishing places for tied final scores', () => {
    let s = ready();
    s.hands = [[], []];
    s.scoreless = 6;
    s = move(s, { type: 'finish', actor: 0 });
    expect(s.result?.places).toEqual([1, 1]);
  });
  it('C22 hides other racks and every bag order, but keeps challenged tiles public', () => {
    const s = ready();
    const v = view(s, 0),
      watch = view(s, null);
    expect(v.hands[0]?.every((h) => h.card !== null)).toBe(true);
    expect(v.hands[1]?.every((h) => h.card === null)).toBe(true);
    expect(watch.hands.flat().every((h) => h.card === null)).toBe(true);
    expect(v.orders).toEqual([null, null]);
    expect(knownTo(s, 0)).toHaveLength(7);
    expect(learn(v, { deck: 'pile', pos: s.hands[1]?.[0]?.pos ?? 0, card: 0 }).ok).toBe(false);
  });
  it('C23 rejects forged cards, duplicate rack tiles, extra keys, and out-of-turn actions without mutation', () => {
    const s = deepFreeze(ready()),
      tiles = placements(s, 'CAT', 111);
    const before = JSON.stringify(s);
    expect(
      apply(s, { type: 'place', actor: 0, tiles: [{ ...tile(tiles, 0), card: 99 }, ...tiles.slice(1)] }).ok,
    ).toBe(false);
    expect(
      apply(s, { type: 'place', actor: 0, tiles: [tiles[0], { ...tile(tiles, 0), cell: 112 }] }).ok,
    ).toBe(false);
    expect(apply(s, { type: 'pass', actor: 1 }).ok).toBe(false);
    expect(apply(s, { type: 'pass', actor: 0, extra: true }).ok).toBe(false);
    for (const a of [null, [], true, 'place', { type: 'place', actor: 0, tiles: [null] }])
      expect(apply(s, a).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('C24 authenticates shuffle epochs and final scoring reveals', () => {
    let s = ready();
    s = move(s, { type: 'exchange', actor: 0, positions: [s.hands[0]?.[0]?.pos ?? 0] });
    const cards = shufflePlaintexts(s);
    expect(installDeckOrder(s, s.epoch + 1, cards.slice(1)).ok).toBe(false);
    expect(installDeckOrder(view(s, 0), s.epoch + 1, cards).ok).toBe(false);
    expect(apply(s, { type: 'epoch', actor: 'deck', epoch: s.epoch + 1, size: cards.length }).ok).toBe(false);
    expect(quillAndQuarry.resignAllowed?.(DEFAULT_RULES, 4)).toBe(false);
    expect(pending(s).type).toBe('shuffle');
  });
});
