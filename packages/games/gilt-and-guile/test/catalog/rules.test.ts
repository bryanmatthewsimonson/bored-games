import { createRng, deepFreeze, fuzzGame, packetOrder } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  CARDS,
  DECK,
  type GiltState,
  giltAndGuile,
  KINDS,
  type Kind,
  kindOf,
  OFFSETS,
  STRIDE,
  scores,
} from '../../src/index.ts';

function initial(seats = 2): GiltState {
  const r = giltAndGuile.setup({
    mode: 'full',
    seats,
    rules: {},
    deckOrders: { pile: packetOrder(DECK, createRng('first-ascent')) },
  });
  if (!r.ok) throw Error(r.error.message);
  return r.value;
}
function move(s: GiltState, a: unknown): GiltState {
  const r = giltAndGuile.apply(deepFreeze(s), a);
  if (!r.ok) throw Error(r.error.message);
  let next = r.state;
  while (!next.gaining && giltAndGuile.pending(next).type === 'reveal') {
    const pd = giltAndGuile.pending(next);
    if (pd.type !== 'reveal') break;
    const pos = pd.positions[0]!;
    const card = next.orders[Math.floor(pos / STRIDE)]![pos % STRIDE]!;
    const shown = giltAndGuile.apply(next, { type: 'reveal', actor: 'deck', deck: 'pile', pos, card });
    if (!shown.ok) throw Error(shown.error.message);
    next = shown.state;
  }
  return next;
}
function hand(s: GiltState, kinds: Kind[], seat = 0): GiltState {
  const d = JSON.parse(JSON.stringify(s)) as GiltState;
  d.players[seat]!.hand = kinds.map((k, i) => ({ pos: OFFSETS[k]! + i, card: OFFSETS[k]! + i }));
  return d;
}
function play(s: GiltState, index = 0): GiltState {
  const c = s.players[s.turn]!.hand[index]!;
  return move(s, { type: 'play', actor: s.turn, pos: c.pos, card: c.card });
}
function reveal(s: GiltState): GiltState {
  const g = s.gaining!;
  return move(s, { type: 'reveal', actor: 'deck', deck: 'pile', pos: g.pos, card: s.orders[0]![g.pos] });
}
function choose(s: GiltState, type: string, index = 0): GiltState {
  const pd = giltAndGuile.pending(s);
  if (pd.type !== 'player') throw Error(pd.type);
  const a = giltAndGuile.legalActions(s, pd.seat).filter((a) => (a as { type: string }).type === type)[index];
  return move(s, a);
}
describe('First Performance rules catalog', () => {
  it('C01 starts each player with seven resources, three landmarks, and five cards in hand', () => {
    for (const n of [2, 3, 4]) {
      const s = initial(n);
      expect(s.players).toHaveLength(n);
      expect(scores(s)).toEqual(Array(n).fill(3));
      for (const p of s.players) {
        expect(p.hand).toHaveLength(5);
        expect(p.draw).toHaveLength(5);
        expect(p.owned.penny).toBe(7);
      }
      expect(giltAndGuile.invariants(s)).toEqual([]);
    }
  });
  it('C02 sizes the supply for two, three and four players', () => {
    for (const n of [2, 3, 4]) {
      const s = initial(n);
      expect(s.supply.penny).toHaveLength(60 - 7 * n);
      expect(s.supply.playbill).toHaveLength(n === 2 ? 8 : 12);
      expect(s.supply.grandstage).toHaveLength(n === 2 ? 8 : 12);
      expect(s.supply.scandal).toHaveLength(10 * (n - 1));
      expect(s.supply.scriptroom).toHaveLength(10);
    }
  });
  it('C03 enforces action, treasure and buy phases and exact encodings', () => {
    let s = initial();
    expect(giltAndGuile.apply(s, { type: 'end', actor: 0 }).ok).toBe(false);
    expect(giltAndGuile.apply(s, { type: 'next', actor: 0, extra: true }).ok).toBe(false);
    expect(giltAndGuile.apply(s, { type: 'next', actor: -0 }).ok).toBe(false);
    s = move(s, { type: 'next', actor: 0 });
    expect(s.phase).toBe('treasure');
    s = move(s, { type: 'next', actor: 0 });
    expect(s.phase).toBe('buy');
    expect(giltAndGuile.apply(s, { type: 'next', actor: 0 }).ok).toBe(false);
  });
  it('C04 buys spend coins and buys and put the gained card into discard', () => {
    let s = initial();
    s.phase = 'buy';
    s.coins = 5;
    s = move(s, { type: 'buy', actor: 0, kind: 'arcade' });
    expect(s.coins).toBe(0);
    expect(s.buys).toBe(0);
    expect(s.supply.arcade).toHaveLength(9);
    s = reveal(s);
    expect(s.players[0]!.owned.arcade).toBe(1);
    expect(kindOf(s.players[0]!.discard[0]!.card!)).toBe('arcade');
    expect(giltAndGuile.apply(s, { type: 'buy', actor: 0, kind: 'penny' }).ok).toBe(false);
  });
  it('C05 cleanup discards hand and play, draws five, and resets the next turn', () => {
    let s = initial();
    s.phase = 'buy';
    s.coins = 9;
    s.actions = 4;
    s.buys = 3;
    s = move(s, { type: 'end', actor: 0 });
    expect(s.players[0]!.hand).toHaveLength(5);
    expect(s.players[0]!.discard).toHaveLength(5);
    expect(s.turn).toBe(1);
    expect([s.actions, s.buys, s.coins]).toEqual([1, 1, 0]);
    expect(s.players[0]!.turns).toBe(1);
  });
  it('C06 reshuffles only when drawing requires it and uses nonoverlapping epoch positions', () => {
    let s = initial();
    s.players[0]!.draw = [];
    s.phase = 'buy';
    s = move(s, { type: 'end', actor: 0 });
    expect(giltAndGuile.pending(s).type).toBe('shuffle');
    const cards = giltAndGuile.shufflePlaintexts!(s);
    const install = giltAndGuile.installDeckOrder!(s, 1, [...cards].reverse());
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    s = move(install.state, { type: 'epoch', actor: 'deck', epoch: 1, size: cards.length });
    expect(s.players[0]!.hand.map((c) => c.pos)).toEqual(Array.from({ length: 5 }, (_, i) => STRIDE + i));
    expect(STRIDE).toBeGreaterThan(DECK.size);
    expect(s.players[0]!.discard).toEqual([]);
  });
  it('C07 Rehearsal discards any number before drawing replacements', () => {
    let s = hand(initial(), ['rehearsal', 'playbill', 'penny']);
    s = play(s);
    expect(s.actions).toBe(1);
    s = choose(s, 'discard');
    expect(s.players[0]!.hand).toHaveLength(1);
    expect(s.tasks[0]).toEqual({ type: 'rehearsal', count: 1 });
    s = choose(s, 'done');
    expect(s.players[0]!.hand).toHaveLength(2);
    expect(s.tasks).toEqual([]);
  });
  it('C08 Arcade provides one card, action, buy and coin', () => {
    const s = play(hand(initial(), ['arcade']));
    expect(s.players[0]!.hand).toHaveLength(1);
    expect([s.actions, s.buys, s.coins]).toEqual([1, 2, 1]);
  });
  it('C09 Impresario bonuses stack but apply to the first Banknote only', () => {
    let s = hand(initial(), ['impresario', 'impresario', 'banknote', 'banknote']);
    s = play(s);
    s = play(s);
    s = move(s, { type: 'next', actor: 0 });
    s = play(s);
    expect(s.coins).toBe(4);
    s = play(s);
    expect(s.coins).toBe(6);
  });
  it('C10 Rivalry asks each opponent to discard down to three', () => {
    let s = play(hand(initial(3), ['rivalry']));
    expect(s.coins).toBe(2);
    expect(giltAndGuile.pending(s)).toEqual({ type: 'player', seat: 1, decision: 'attack' });
    s = choose(s, 'accept');
    s = choose(s, 'discard');
    s = choose(s, 'discard');
    expect(s.players[1]!.hand).toHaveLength(3);
    expect(giltAndGuile.pending(s)).toEqual({ type: 'player', seat: 2, decision: 'attack' });
  });
  it('C11 Understudy draws two or blocks without leaving its owner hand', () => {
    expect(play(hand(initial(), ['understudy'])).players[0]!.hand).toHaveLength(2);
    let s = hand(hand(initial(), ['rivalry']), ['understudy', 'playbill', 'penny', 'banknote'], 1);
    s = play(s);
    s = choose(s, 'block');
    expect(s.players[1]!.hand).toHaveLength(4);
    expect(s.tasks).toEqual([]);
    expect(s.publicCards).toContain(OFFSETS.understudy);
  });
  it('C12 Investor optionally upgrades a treasure by up to three into the hand', () => {
    let s = play(hand(initial(), ['investor', 'penny', 'playbill']));
    const choices = giltAndGuile.legalActions(s, 0) as { type: string; card?: number }[];
    expect(choices.filter((a) => a.type === 'trash').map((a) => kindOf(a.card!))).toEqual(['penny']);
    s = choose(s, 'trash');
    expect(s.tasks[0]).toEqual({ type: 'gain', max: 3, treasure: true, hand: true });
    s = move(s, { type: 'gain', actor: 0, kind: 'banknote' });
    s = reveal(s);
    expect(s.players[0]!.hand.some((c) => c.card !== null && kindOf(c.card) === 'banknote')).toBe(true);
    expect(s.trash).toHaveLength(1);
    expect(choose(play(hand(initial(), ['investor', 'penny'])), 'done').tasks).toEqual([]);
  });
  it('C13 Renovation trashes and gains a card costing up to two more', () => {
    let s = play(hand(initial(), ['renovation', 'playbill']));
    s = choose(s, 'trash');
    expect(s.tasks[0]).toEqual({ type: 'gain', max: 4, treasure: false, hand: false });
    expect(giltAndGuile.apply(s, { type: 'gain', actor: 0, kind: 'endowment' }).ok).toBe(false);
    s = move(s, { type: 'gain', actor: 0, kind: 'scriptroom' });
    s = reveal(s);
    expect(s.players[0]!.discard).toHaveLength(1);
  });
  it('C14 Script Room draws three and Ensemble draws one with two actions', () => {
    let s = play(hand(initial(), ['scriptroom']));
    expect(s.players[0]!.hand).toHaveLength(3);
    expect(s.actions).toBe(0);
    s = play(hand(initial(), ['ensemble']));
    expect(s.players[0]!.hand).toHaveLength(1);
    expect(s.actions).toBe(2);
  });
  it('C15 Propmaker gains a card costing up to four without spending resources', () => {
    let s = play(hand(initial(), ['propmaker']));
    s = move(s, { type: 'gain', actor: 0, kind: 'rivalry' });
    s = reveal(s);
    expect(s.buys).toBe(1);
    expect(s.coins).toBe(0);
    expect(s.players[0]!.owned.rivalry).toBe(1);
  });
  it('C16 supply endings wait until the turn ends', () => {
    let s = initial();
    s.phase = 'buy';
    s.supply.grandstage = [];
    expect(giltAndGuile.outcome(s)).toBeNull();
    s = move(s, { type: 'end', actor: 0 });
    expect(s.result?.reason).toBe('supply');
    let t = initial();
    t.phase = 'buy';
    t.supply.penny = [];
    t.supply.banknote = [];
    t.supply.endowment = [];
    t = move(t, { type: 'end', actor: 0 });
    expect(t.result?.reason).toBe('supply');
  });
  it('C17 scoring counts all owned landmarks and penalties with fewer-turn tiebreak', () => {
    let s = initial();
    s.phase = 'buy';
    s.supply.grandstage = [];
    s.players[0]!.owned.grandstage = 2;
    s.players[0]!.owned.scandal = 1;
    s.players[1]!.owned.playhouse = 3;
    s.players[1]!.owned.playbill = 5;
    s = move(s, { type: 'end', actor: 0 });
    expect(s.result?.scores).toEqual([14, 14]);
    expect(s.result?.places).toEqual([2, 1]);
  });
  it('C18 private views hide opponents hands and all deck orders', () => {
    const s = initial();
    const v = giltAndGuile.view(s, 0);
    expect(v.orders).toEqual([null]);
    expect(v.players[0]!.hand.every((c) => c.card !== null)).toBe(true);
    expect(v.players[1]!.hand.every((c) => c.card === null)).toBe(true);
    const spectator = giltAndGuile.view(s, null);
    expect(spectator.players.every((p) => p.hand.every((c) => c.card === null))).toBe(true);
    expect(giltAndGuile.learn(v, { deck: 'pile', pos: s.players[1]!.hand[0]!.pos, card: 0 }).ok).toBe(false);
  });
  it('C19 rejects wrong actors, false card claims, invalid setups and altered shuffles', () => {
    let s = initial();
    expect(giltAndGuile.apply(s, { type: 'next', actor: 1 }).ok).toBe(false);
    expect(giltAndGuile.setup({ mode: 'full', rules: {}, seats: 1, deckOrders: { pile: [] } }).ok).toBe(
      false,
    );
    expect(giltAndGuile.validateRules({ variant: 'unknown' }).ok).toBe(false);
    s.phase = 'buy';
    s.players[0]!.draw = [];
    s = move(s, { type: 'end', actor: 0 });
    expect(giltAndGuile.installDeckOrder!(s, 1, [1, 2, 3]).ok).toBe(false);
  });
  it('C20 full games preserve private views, card conservation, replay and legal choices', () => {
    for (const seats of [2, 3, 4]) {
      const r = fuzzGame(giltAndGuile, {
        seed: `gilt-and-guile-${seats}`,
        seats,
        rules: {},
        deckOrder: packetOrder,
        maxSteps: 12000,
        legalitySample: 1,
        policies: [
          {
            name: 'builder',
            choose(_s, _seat, raw, rng) {
              const actions = raw as { type: string; kind?: Kind }[];
              const plays = actions.filter((a) => a.type === 'play');
              if (plays.length) return rng.pick(plays);
              const buy = actions
                .filter((a) => a.type === 'buy')
                .sort((a, b) => CARDS[b.kind!].cost - CARDS[a.kind!].cost);
              return (
                buy[0] ??
                actions.find((a) => a.type === 'next' || a.type === 'done' || a.type === 'end') ??
                rng.pick(actions)
              );
            },
          },
        ],
      });
      expect(r.failure).toBeNull();
      expect(r.outcome).not.toBeNull();
    }
  });
});
