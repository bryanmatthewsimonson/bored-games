import { describe, expect, it } from 'vitest';
import {
  type ChainReactionState,
  chainReaction,
  DEFAULT_RULES,
  LOOSE,
  pendingDecision,
  setupGame,
  TILE_COUNT,
  tileIndex,
  viewFor,
} from '../../src/index.ts';
import { act, ofType } from '../helpers.ts';

/** A deck order whose first tiles are `front` (setup tiles first), the rest ascending. */
function deckWith(front: string[]): number[] {
  const f = front.map((t) => tileIndex(t) as number);
  return [...f, ...Array.from({ length: TILE_COUNT }, (_, i) => i).filter((i) => !f.includes(i))];
}

function newGame(setup: string[], rules = DEFAULT_RULES): ChainReactionState {
  const res = setupGame({ rules, seats: setup.length, mode: 'full', deckOrders: { tiles: deckWith(setup) } });
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
}

function revealAll(s: ChainReactionState) {
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

  it('C03 hands are dealt at setup in seat order', () => {
    // Positions are assigned right after setup, before any setup tile is revealed.
    const fresh = newGame(['3C', '9A', '1B']);
    expect(fresh.phase).toEqual({ kind: 'setup' });
    expect(fresh.setupTiles).toEqual([null, null, null]);
    expect(fresh.players.map((p) => p.hand.map((h) => h.pos))).toEqual([
      [3, 4, 5, 6, 7, 8],
      [9, 10, 11, 12, 13, 14],
      [15, 16, 17, 18, 19, 20],
    ]);
    expect(fresh.deck.next).toBe(21);

    // The first player is still decided by the setup tiles (seat 1 here); the deal is unchanged by it.
    const { state, events } = revealAll(fresh);
    expect(state.firstPlayer).toBe(1);
    const positions = state.players.map((p) => p.hand.map((h) => h.pos));
    expect(positions[0]).toEqual([3, 4, 5, 6, 7, 8]);
    expect(positions[1]).toEqual([9, 10, 11, 12, 13, 14]);
    expect(positions[2]).toEqual([15, 16, 17, 18, 19, 20]);
    expect(state.deck.next).toBe(21);
    expect(ofType(events, 'tilesDealt').map((e) => [e.seat, e.positions])).toEqual([
      [0, [3, 4, 5, 6, 7, 8]],
      [1, [9, 10, 11, 12, 13, 14]],
      [2, [15, 16, 17, 18, 19, 20]],
    ]);

    // Each hand is hidden from the other players.
    for (let viewer = 0; viewer < 3; viewer++) {
      const v = viewFor(state, viewer);
      v.players.forEach((p, seat) => {
        expect(p.hand.map((h) => h.pos)).toEqual(positions[seat]);
        if (seat !== viewer) expect(p.hand.every((h) => h.tile === null)).toBe(true);
      });
    }
  });

  it('view mode: the viewer learns slots assigned at setup (D022)', () => {
    const full = newGame(['3C', '9A', '1B']);
    const view = setupGame({ rules: DEFAULT_RULES, seats: 3, mode: 'view', viewer: 2 });
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.players.map((p) => p.hand.map((h) => h.pos))).toEqual(
      full.players.map((p) => p.hand.map((h) => h.pos)),
    );
    expect(view.value.players.every((p) => p.hand.every((h) => h.tile === null))).toBe(true);
    const slot = full.players[2]?.hand[0];
    const learned = chainReaction.learn?.(view.value, {
      deck: 'tiles',
      pos: slot?.pos as number,
      card: slot?.tile as number,
    });
    expect(learned?.ok).toBe(true);
    if (learned?.ok) expect(learned.state.players[2]?.hand[0]).toEqual(slot);
  });

  it('reveals must come in position order and match the deck (setup integrity)', () => {
    const s = newGame(['3C', '9A', '1B']);
    const wrongPos = { type: 'reveal', actor: 'deck', deck: 'tiles', pos: 1, card: tileIndex('9A') };
    expect(act.bind(null, s, wrongPos)).toThrow(/expected a reveal of position 0/);
    const wrongCard = { type: 'reveal', actor: 'deck', deck: 'tiles', pos: 0, card: tileIndex('4C') };
    expect(act.bind(null, s, wrongCard)).toThrow(/does not match the deck/);
  });
});
