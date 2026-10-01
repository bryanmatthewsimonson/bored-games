import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  LOOSE,
  pendingDecision,
  setupGame,
  TILE_COUNT,
  type TilestockState,
  tileIndex,
} from '../../src/index.ts';
import { act, ofType } from '../helpers.ts';

/** A deck order whose first tiles are `front` (setup tiles first), the rest ascending. */
function deckWith(front: string[]): number[] {
  const f = front.map((t) => tileIndex(t) as number);
  return [...f, ...Array.from({ length: TILE_COUNT }, (_, i) => i).filter((i) => !f.includes(i))];
}

function newGame(setup: string[], rules = DEFAULT_RULES): TilestockState {
  const res = setupGame({ rules, seats: setup.length, mode: 'full', deckOrders: { tiles: deckWith(setup) } });
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
}

function revealAll(s: TilestockState) {
  let state = s;
  const events = [];
  for (let pos = 0; pos < s.seats; pos++) {
    const step = act(state, { type: 'reveal', actor: 'deck', deck: 'tiles', pos, card: s.deck.order?.[pos] });
    state = step.state;
    events.push(...step.events);
  }
  return { state, events };
}

describe('setup', () => {
  it('C01 setup tiles never form chains', () => {
    const { state } = revealAll(newGame(['5C', '6C', '9I']));
    for (const t of ['5C', '6C', '9I']) expect(state.board[tileIndex(t) as number]).toBe(LOOSE);
    expect(state.board.filter((c) => c !== null && c >= 0)).toEqual([]);
  });

  it('C02 first player is closest to 1A, row then column', () => {
    const { state, events } = revealAll(newGame(['3C', '9A', '1B']));
    expect(state.firstPlayer).toBe(1);
    expect(ofType(events, 'firstPlayer')).toEqual([{ type: 'firstPlayer', seat: 1 }]);
    expect(pendingDecision(state)).toEqual({ type: 'player', seat: 1, decision: 'place' });

    const columnFirst = revealAll(
      newGame(['3C', '9A', '1B'], { ...DEFAULT_RULES, firstPlayerOrder: 'columnThenRow' }),
    );
    expect(columnFirst.state.firstPlayer).toBe(2);
  });

  it('C03 hands are dealt in turn order from the first player', () => {
    const { state } = revealAll(newGame(['3C', '9A', '1B']));
    const positions = state.players.map((p) => p.hand.map((h) => h.pos));
    expect(positions[1]).toEqual([3, 4, 5, 6, 7, 8]);
    expect(positions[2]).toEqual([9, 10, 11, 12, 13, 14]);
    expect(positions[0]).toEqual([15, 16, 17, 18, 19, 20]);
    expect(state.deck.next).toBe(21);
  });

  it('reveals must come in position order and match the deck (setup integrity)', () => {
    const s = newGame(['3C', '9A', '1B']);
    const wrongPos = { type: 'reveal', actor: 'deck', deck: 'tiles', pos: 1, card: tileIndex('9A') };
    expect(act.bind(null, s, wrongPos)).toThrow(/expected a reveal of position 0/);
    const wrongCard = { type: 'reveal', actor: 'deck', deck: 'tiles', pos: 0, card: tileIndex('4C') };
    expect(act.bind(null, s, wrongCard)).toThrow(/does not match the deck/);
  });
});
