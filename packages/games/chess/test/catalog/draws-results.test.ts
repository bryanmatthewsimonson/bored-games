import { replay } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { chess, DEFAULT_RULES, legalActionsOf } from '../../src/index.ts';
import { act, move, ofType, play, rejects, start } from '../helpers.ts';

const accept = (actor: number) => ({ type: 'acceptDraw', actor });

describe('draw offers', () => {
  it('C48 a draw offer rides on a move and may be accepted on the next turn', () => {
    const s0 = start();
    const offered = act(s0, move(s0, 'e2e4', true));
    expect(offered.state.drawOffer).toBe(0);
    expect(ofType(offered.events, 'drawOffered')).toEqual([{ type: 'drawOffered', seat: 0 }]);
    expect(offered.state.history[0]?.drawOffered).toBe(true);
    expect(legalActionsOf(offered.state, 1)).toContainEqual(accept(1));
    const done = act(offered.state, accept(1));
    expect(done.state.result).toEqual({ reason: 'agreement', winner: null });
    expect(done.state.drawOffer).toBeNull();
    expect(chess.outcome(done.state)).toEqual({ places: [1, 1], scores: [1, 1], reason: 'agreement' });
  });

  it('C49 moving declines the offer', () => {
    const s0 = start();
    const offered = act(s0, move(s0, 'e2e4', true)).state;
    const declined = act(offered, move(offered, 'e7e5'));
    expect(ofType(declined.events, 'drawDeclined')).toEqual([{ type: 'drawDeclined', seat: 1 }]);
    expect(declined.state.drawOffer).toBeNull();
    rejects(declined.state, accept(0), 'no-offer');
    expect(legalActionsOf(declined.state, 0)).not.toContainEqual(accept(0));
    const later = play(declined.state, 'g1f3');
    rejects(later, accept(1), 'no-offer');
  });

  it('C50 only the opponent may accept, and only a standing offer', () => {
    const s0 = start();
    rejects(s0, accept(0), 'no-offer');
    const offered = act(s0, move(s0, 'e2e4', true)).state;
    rejects(offered, accept(0), 'turn');
    expect(legalActionsOf(offered, 0)).toEqual([]);
  });

  it('C51 a counter-offer replaces the declined one', () => {
    const s0 = start();
    const offered = act(s0, move(s0, 'e2e4', true)).state;
    const counter = act(offered, move(offered, 'e7e5', true));
    expect(ofType(counter.events, 'drawDeclined')).toHaveLength(1);
    expect(ofType(counter.events, 'drawOffered')).toEqual([{ type: 'drawOffered', seat: 1 }]);
    expect(counter.state.drawOffer).toBe(1);
    expect(act(counter.state, accept(0)).state.result?.reason).toBe('agreement');
  });

  it('C52 an offer on a game-ending move is void', () => {
    const s = play(start(), 'f2f3 e7e5 g2g4');
    const mate = act(s, move(s, 'd8h4', true));
    expect(mate.state.result?.reason).toBe('checkmate');
    expect(mate.state.drawOffer).toBeNull();
    expect(ofType(mate.events, 'drawOffered')).toEqual([]);
  });
});

describe('results, views and resignation', () => {
  it('C53 standings are 1-1 during play and equal the final scores', () => {
    const s = play(start(), 'f2f3 e7e5 g2g4');
    expect(chess.standings(s)).toEqual([1, 1]);
    expect(chess.outcome(s)).toBeNull();
    const mated = play(s, 'd8h4');
    expect(chess.standings(mated)).toEqual([0, 2]);
    const s0 = start();
    const drawn = act(act(s0, move(s0, 'e2e4', true)).state, accept(1)).state;
    expect(chess.standings(drawn)).toEqual([1, 1]);
    const whiteWins = play(start(), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
    expect(whiteWins.result).toEqual({ reason: 'checkmate', winner: 0 });
    expect(chess.outcome(whiteWins)).toEqual({ places: [1, 2], scores: [2, 0], reason: 'checkmate' });
  });

  it('C54 resignation is not a module action', () => {
    rejects(start(), { type: 'resign', actor: 0 }, 'malformed');
    rejects(start(), { type: 'resign', actor: 1 }, 'malformed');
  });

  it('C55 perfect information: no decks, identical views, nothing to learn', () => {
    const moves = 'e2e4 c7c5 g1f3 d7d6';
    const s = play(start(), moves);
    expect(chess.decks(DEFAULT_RULES)).toEqual([]);
    expect(chess.dealt(s)).toEqual([]);
    expect(chess.knownTo(s, 0)).toEqual([]);
    expect(chess.knownTo(s, 1)).toEqual([]);
    expect(chess.revealsOf(s, move(s, 'd2d4'))).toEqual([]);
    for (const viewer of [0, 1, null]) {
      expect(chess.view(s, viewer)).toEqual(s);
      const actions = moves.split(' ').map((uci, i) => ({ type: 'move', actor: i % 2, uci }));
      const r = replay(
        chess,
        { rules: DEFAULT_RULES, seats: 2, mode: 'view', viewer },
        actions.map((action) => ({ kind: 'action', action })),
      );
      expect(r.ok && r.state).toEqual(s);
    }
    const learned = chess.learn(s, { deck: 'x', pos: 0, card: 0 });
    expect(learned.ok ? null : learned.error.code).toBe('no-hidden');
    const full = chess.setup({ rules: DEFAULT_RULES, seats: 2, mode: 'full', deckOrders: { x: [0] } });
    expect(full.ok ? null : full.error.code).toBe('deck');
  });
});
