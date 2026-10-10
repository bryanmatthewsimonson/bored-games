import { createRng, deepFreeze, fuzzGame, packetOrder } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  CARDS,
  DECK,
  type GiltAction,
  type GiltState,
  giltAndGuile as game,
  INTRO,
  KINDS,
  KINGDOM,
  type Kind,
  kindOf,
  OFFSETS,
  PRESETS,
  STRIDE,
  scores,
} from '../../src/index.ts';

function setup(cards: Kind[] = INTRO): GiltState {
  const r = game.setup({
    mode: 'full',
    seats: 2,
    rules: { kingdom: cards },
    deckOrders: { pile: Array.from({ length: DECK.size }, (_, i) => i) },
  });
  if (!r.ok) throw Error(r.error.message);
  return r.value;
}
function act(s: GiltState, a: unknown): GiltState {
  const r = game.apply(deepFreeze(s), a);
  if (!r.ok) throw Error(`${JSON.stringify(a)}: ${r.error.message}`);
  return r.state;
}
function ready(s: GiltState): GiltState {
  for (let i = 0; i < 30; i++) {
    const pd = game.pending(s);
    if (pd.type !== 'reveal') return s;
    const pos = pd.positions[0]!;
    s = act(s, {
      type: 'reveal',
      actor: 'deck',
      deck: 'pile',
      pos,
      card: s.orders[Math.floor(pos / STRIDE)]![pos % STRIDE],
    });
  }
  throw Error('Reveal loop');
}
function hand(s: GiltState, kinds: Kind[], seat = 0) {
  s.players[seat]!.hand = kinds.map((k, i) => ({ pos: OFFSETS[k]! + i, card: OFFSETS[k]! + i }));
  return s;
}
function deck(s: GiltState, kinds: Kind[], seat = 0) {
  s.players[seat]!.draw = kinds.map((k, i) => OFFSETS[k]! + i);
  return s;
}
function choose(s: GiltState, type: GiltAction['type'], kind?: Kind): GiltState {
  const pd = game.pending(s);
  if (pd.type !== 'player') throw Error(pd.type);
  const a = (game.legalActions(s, pd.seat) as GiltAction[]).find(
    (a) =>
      a.type === type && (!kind || ('kind' in a ? a.kind === kind : 'card' in a && kindOf(a.card) === kind)),
  );
  if (!a) throw Error(`No ${type} ${kind ?? ''}: ${JSON.stringify(game.legalActions(s, pd.seat))}`);
  return act(s, a);
}
function play(kind: Kind, rest: Kind[] = [], cards: Kind[] = INTRO) {
  return choose(hand(setup(cards), [kind, ...rest]), 'play');
}
describe('Complete company catalog', () => {
  it('C21 offers all 26 distinct company piles and validates ten-pile configurations', () => {
    expect(KINGDOM).toHaveLength(26);
    expect(KINDS).toHaveLength(33);
    for (const p of PRESETS) {
      expect(game.validateRules({ kingdom: p.cards }).ok).toBe(true);
      const s = setup(p.cards);
      expect(KINGDOM.filter((k) => s.supply[k].length)).toHaveLength(10);
      expect(s.result).toBeNull();
    }
    expect(game.validateRules({ kingdom: [...INTRO.slice(1), 'penny'] }).ok).toBe(false);
    expect(game.validateRules({ kingdom: Array(10).fill('ensemble') }).ok).toBe(false);
    expect(game.validateRules({ kingdom: KINGDOM }).ok).toBe(false);
  });
  it('C22 Costumier gains into hand then privately top-decks any hand card', () => {
    let s = play('costumier', ['penny']);
    s = ready(choose(s, 'gain', 'arcade'));
    expect(s.players[0]!.hand.map((c) => kindOf(c.card!))).toContain('arcade');
    const a = (game.legalActions(s, 0) as GiltAction[]).find((a) => a.type === 'put')!;
    expect('card' in a).toBe(false);
    expect(game.revealsOf(s, a)).toEqual([]);
    s = act(s, a);
    expect(s.players[0]!.draw[0]).toBe('pos' in a ? a.pos : -1);
  });
  it('C23 Headliner gains funding, respects a block and lets a victim choose an eligible treasure', () => {
    let s = hand(setup(), ['headliner']);
    s = hand(s, ['understudy', 'penny'], 1);
    s = choose(s, 'play');
    s = ready(s);
    expect(s.players[0]!.owned.endowment).toBe(1);
    s = choose(s, 'block');
    expect(s.tasks).toEqual([]);
    s = hand(setup(), ['headliner']);
    deck(s, ['banknote', 'endowment'], 1);
    s = ready(choose(s, 'play'));
    s = ready(choose(s, 'accept'));
    expect((game.legalActions(s, 1) as GiltAction[]).map((a) => ('card' in a ? kindOf(a.card) : ''))).toEqual(
      ['banknote', 'endowment'],
    );
    s = choose(s, 'peektrash', 'banknote');
    expect(kindOf(s.trash[0]!.card!)).toBe('banknote');
    expect(kindOf(s.players[1]!.discard[0]!.card!)).toBe('endowment');
  });
  it('C24 Booking Office top-decks funding and forces a revealed victory or a revealed empty-of-victories hand', () => {
    let s = hand(setup(), ['booking']);
    hand(s, ['playbill', 'penny'], 1);
    s = ready(choose(s, 'play'));
    expect(kindOf(s.revealed[s.players[0]!.draw[0]!]!)).toBe('banknote');
    s = choose(s, 'accept');
    s = choose(s, 'top', 'playbill');
    expect(kindOf(s.revealed[s.players[1]!.draw[0]!]!)).toBe('playbill');
    s = hand(setup(), ['booking']);
    hand(s, ['penny', 'banknote'], 1);
    s = ready(choose(s, 'play'));
    s = choose(s, 'accept');
    s = ready(choose(s, 'novictory'));
    expect(game.view(s, null).players[1]!.hand.every((c) => c.card !== null)).toBe(true);
  });
  it('C25 Cutting Room may stop early and never trashes more than four', () => {
    let s = play('cuttingroom', ['penny', 'penny', 'penny', 'playbill', 'playbill']);
    for (let i = 0; i < 4; i++) s = choose(s, 'trash');
    expect(s.trash).toHaveLength(4);
    expect(s.tasks).toEqual([]);
    expect(s.players[0]!.hand).toHaveLength(1);
    expect(choose(play('cuttingroom', ['penny']), 'done').trash).toHaveLength(0);
  });
  it('C26 Opening Night draws for opponents without an attack response and Gala supplies its full bonuses', () => {
    let s = play('openingnight');
    expect(s.players[0]!.hand).toHaveLength(4);
    expect(s.players[1]!.hand).toHaveLength(6);
    expect(s.buys).toBe(2);
    expect(s.tasks).toEqual([]);
    s = play('gala');
    expect([s.actions, s.buys, s.coins]).toEqual([2, 2, 2]);
  });
  it('C27 Repertoire scores each copy using total ownership and uses victory pile sizes', () => {
    const s = setup(PRESETS[1]!.cards);
    expect(s.supply.repertoire).toHaveLength(8);
    s.players[0]!.owned.repertoire = 2;
    s.players[0]!.owned.penny = 15;
    expect(scores(s)[0]).toBe(7);
    s.players[0]!.owned.penny = 14;
    expect(scores(s)[0]).toBe(5);
  });
  it('C28 Encore can recover any discard and Duet draws while replacing its action', () => {
    let s = hand(setup(), ['encore']);
    s.players[0]!.discard = [{ pos: OFFSETS.banknote!, card: OFFSETS.banknote! }];
    s = choose(s, 'play');
    s = choose(s, 'top', 'banknote');
    expect(s.players[0]!.draw[0]).toBe(OFFSETS.banknote);
    s = play('duet');
    expect(s.actions).toBe(1);
    expect(s.players[0]!.hand).toHaveLength(2);
  });
  it('C29 Reading Room offers private action set-asides and discards them only after drawing ends', () => {
    let s = hand(setup(), ['readingroom', 'penny', 'penny', 'penny', 'penny', 'penny']);
    deck(s, ['ensemble', 'banknote', 'endowment']);
    s = choose(s, 'play');
    const aside = (game.legalActions(s, 0) as GiltAction[]).find((a) => a.type === 'aside')!;
    expect('card' in aside).toBe(false);
    expect(game.revealsOf(s, aside)).toEqual([]);
    const spectator = game.view(s, null);
    expect(spectator.players[0]!.peek[0]!.card).toBeNull();
    expect(game.apply(spectator, aside).ok).toBe(true);
    s = act(s, aside);
    expect(s.players[0]!.aside).toHaveLength(1);
    expect(s.players[0]!.discard).toHaveLength(0);
    expect((game.legalActions(s, 0) as GiltAction[]).some((a) => a.type === 'aside')).toBe(false);
    s = choose(s, 'keep');
    s = ready(choose(s, 'keep'));
    expect(s.players[0]!.hand).toHaveLength(7);
    expect(s.players[0]!.aside).toHaveLength(0);
    expect(s.players[0]!.discard).toHaveLength(1);
  });
  it('C30 Cashbox requires a Penny and Audition counts active empty piles after drawing', () => {
    let s = choose(play('cashbox', ['penny', 'banknote']), 'trash', 'penny');
    expect(s.coins).toBe(3);
    expect(s.tasks).toEqual([]);
    expect((game.legalActions(play('cashbox', ['banknote']), 0) as GiltAction[]).map((a) => a.type)).toEqual([
      'done',
    ]);
    s = hand(setup(), ['audition', 'penny', 'penny', 'penny']);
    s.supply.ensemble = [];
    s.supply.arcade = [];
    s = choose(s, 'play');
    s = choose(s, 'discard');
    s = choose(s, 'discard');
    expect(s.players[0]!.hand).toHaveLength(2);
    expect(s.tasks).toEqual([]);
    s = hand(setup(), ['audition', 'penny']);
    s.players[0]!.draw = [];
    s.supply.ensemble = [];
    s = choose(s, 'play');
    s = choose(s, 'discard');
    expect(s.players[0]!.hand).toHaveLength(0);
  });
  it('C31 Stage Door inspects privately, separates trash and discard, and controls next draw order', () => {
    let s = hand(setup(), ['stagedoor']);
    deck(s, ['penny', 'banknote', 'endowment']);
    s = choose(s, 'play');
    expect(s.players[0]!.peek).toHaveLength(2);
    expect(game.view(s, 1).players[0]!.peek.every((c) => c.card === null)).toBe(true);
    s = choose(s, 'done');
    s = choose(s, 'done');
    const positions = s.players[0]!.peek.map((c) => c.pos);
    s = choose(s, 'put');
    s = choose(s, 'put');
    expect(s.players[0]!.draw.slice(0, 2)).toEqual([...positions].reverse());
    s = hand(setup(), ['stagedoor']);
    deck(s, ['penny', 'banknote', 'endowment']);
    s = choose(s, 'play');
    s = choose(s, 'peektrash', 'banknote');
    s = choose(s, 'done');
    s = choose(s, 'peekdiscard', 'endowment');
    expect(s.trash).toHaveLength(1);
    expect(s.players[0]!.discard).toHaveLength(1);
    expect(s.tasks).toEqual([]);
  });
  it('C32 Double Bill resolves nested plays fully and repeats draw and resource bonuses', () => {
    let s = play('doublebill', ['ensemble']);
    s = choose(s, 'repeat', 'ensemble');
    expect(s.actions).toBe(4);
    expect(s.players[0]!.hand).toHaveLength(2);
    s = play('doublebill', ['doublebill', 'gala', 'duet']);
    s = choose(s, 'repeat', 'doublebill');
    s = choose(s, 'repeat', 'gala');
    expect(s.coins).toBe(4);
    s = choose(s, 'repeat', 'duet');
    expect(s.players[0]!.hand).toHaveLength(4);
    expect(s.tasks).toEqual([]);
  });
  it('C33 Busker reveals its discard and may play an action without using an action', () => {
    let s = hand(setup(), ['busker']);
    deck(s, ['gala']);
    s = ready(choose(s, 'play'));
    s = choose(s, 'busk');
    expect(s.coins).toBe(4);
    expect(s.actions).toBe(2);
    expect(s.players[0]!.played).toHaveLength(2);
    s = hand(setup(), ['busker']);
    deck(s, ['penny']);
    s = ready(choose(s, 'play'));
    expect(s.players[0]!.discard).toHaveLength(1);
    expect(s.tasks).toEqual([]);
  });
  it('C34 Critic draws then distributes penalties with one reaction opportunity per opponent', () => {
    let s = ready(play('critic'));
    expect(s.players[0]!.hand).toHaveLength(2);
    s = ready(choose(s, 'accept'));
    expect(s.players[1]!.owned.scandal).toBe(1);
    expect(scores(s)[1]).toBe(2);
  });
  it('C35 all curated supplies conserve cards, replay and agree with private player and spectator views', {
    timeout: 120000,
  }, () => {
    for (const [i, preset] of PRESETS.entries()) {
      const r = fuzzGame(game, {
        seed: `complete-${i}`,
        seats: 2 + i,
        rules: { kingdom: preset.cards },
        deckOrder: packetOrder,
        maxSteps: 12000,
        legalitySample: 1,
        policies: [
          {
            name: 'producer',
            choose(s, seat, raw, rng) {
              const actions = raw as GiltAction[];
              const plays = actions.filter((a) => a.type === 'play');
              if (plays.length) return rng.pick(plays);
              const buy = actions
                .filter((a): a is Extract<GiltAction, { type: 'buy' | 'gain' }> => a.type === 'buy')
                .sort((a, b) => CARDS[b.kind].cost - CARDS[a.kind].cost);
              return (
                buy[0] ??
                actions.find((a) => a.type === 'next' || a.type === 'end' || a.type === 'done') ??
                rng.pick(actions)
              );
            },
          },
        ],
      });
      expect(r.failure, JSON.stringify(r.failure)).toBeNull();
      expect(r.outcome).not.toBeNull();
    }
  });
});

it('C36 public top-deck choices do not create private memory for other viewers', () => {
  let s = play('costumier', ['penny']);
  s = ready(choose(s, 'gain', 'arcade'));
  const card = s.players[0]!.hand.find((c) => c.card !== null && kindOf(c.card) === 'arcade')!;
  const action = { type: 'put', actor: 0, pos: card.pos };
  const next = act(s, action);
  for (const viewer of [1, null]) expect(act(game.view(s, viewer), action)).toEqual(game.view(next, viewer));
});
