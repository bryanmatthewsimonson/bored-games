import { describe, expect, it } from 'vitest';
import { classifyTile, DEFAULT_RULES, legalActions, tileId, tileIndex } from '../../src/index.ts';
import {
  act,
  dispose,
  endTurn,
  ofType,
  place,
  posOf,
  rejects,
  run,
  scenario,
  sharesOf,
  sizeOf,
} from '../helpers.ts';

const cls = (board: Parameters<typeof classifyTile>[0], tile: string) =>
  classifyTile(board, DEFAULT_RULES, tileIndex(tile) as number).kind;

describe('safe, dead and blocked tiles', () => {
  it('C33 safe plus unsafe merger: the safe chain survives', () => {
    const s = scenario({
      chains: { s1: '1A-11A', b1: '11C-11E' },
      hands: ['11B'],
      shares: { b1: [1, 0, 0] },
    });
    const merged = act(s, place(s, 0, '11B'));
    expect(ofType(merged.events, 'mergerStarted')[0]?.safeChains).toBe(1);
    const { state } = act(merged.state, dispose(0, 'b1', 1, 0));
    expect(sizeOf(state, 's1')).toBe(15);
  });

  it('C34 a tile touching two safe chains is dead', () => {
    const s = scenario({ chains: { s1: '1A-11A', p1: '1C-11C' }, hands: ['5B 12I'] });
    expect(cls(s.board, '5B')).toBe('dead');
    rejects(s, place(s, 0, '5B'), 'unplayable');
    expect(legalActions(s, 0).map((a) => (a.type === 'place' ? a.tile : ''))).toEqual(['12I']);
  });

  it('C35 an eighth-chain tile is blocked until a merger frees a chain', () => {
    const s = scenario({
      chains: { b1: '1A-2A', b2: '4A-5A', s1: '7A-8A', s2: '10A-11A', s3: '1C-2C', p1: '4C-5C', p2: '7C-8C' },
      loose: '12I',
      hands: ['12H 3A'],
      shares: { b1: [1, 0, 0], b2: [0, 1, 0] },
    });
    expect(cls(s.board, '12H')).toBe('blocked');
    expect(legalActions(s, 0).map((a) => (a.type === 'place' ? a.tile : ''))).toEqual(['3A']);
    rejects(s, place(s, 0, '12H'), 'unplayable');
    let state = act(s, place(s, 0, '3A')).state;
    state = act(state, { type: 'chooseSurvivor', actor: 0, chain: 'b1' }).state;
    state = act(state, dispose(1, 'b2', 1, 0)).state;
    expect(sizeOf(state, 'b2')).toBe(0);
    expect(cls(state.board, '12H')).toBe('found');
  });

  it('C36 every tile in hand is unplayable: skip placement, still buy', () => {
    const s = scenario({
      chains: { s1: '1A-11A', p1: '1C-11C' },
      hands: ['2B-7B'],
      shares: { s1: [0, 1, 0], p1: [0, 0, 1] },
    });
    expect(legalActions(s, 0)).toEqual([{ type: 'skipPlace', actor: 0 }]);
    rejects(s, place(s, 0, '2B'), 'unplayable');
    const skipped = act(s, { type: 'skipPlace', actor: 0 });
    expect(ofType(skipped.events, 'placementSkipped')).toHaveLength(1);
    const discard = ['2B', '3B', '4B', '5B', '6B', '7B'].map((t) => ({ pos: posOf(s, 0, t), tile: t }));
    const { state, events } = act(skipped.state, endTurn(0, { buy: ['s1'], discard }));
    expect(sharesOf(state, 0, 's1')).toBe(1);
    expect(ofType(events, 'tilesDiscarded')[0]?.tiles).toHaveLength(6);
    expect(state.players[0]?.hand).toHaveLength(6);
    expect(state.discard.map(tileId)).toEqual(['2B', '3B', '4B', '5B', '6B', '7B']);
  });

  it('C37 skipping placement is rejected while a playable tile is held', () => {
    const s = scenario({ chains: { s1: '1A-11A', p1: '1C-11C' }, hands: ['2B 12I'] });
    rejects(s, { type: 'skipPlace', actor: 0 }, 'playable');
  });

  it('C38 dead tiles are discarded at the end of the turn and replaced', () => {
    const s = scenario({
      chains: { s1: '1A-11A', p1: '1C-11C' },
      hands: ['5B 12I 1G 2G 3G 4G'],
      bag: '9I 10I',
    });
    const placed = act(s, place(s, 0, '12I')).state;
    rejects(placed, endTurn(0), 'discard');
    const nextPos = placed.deck.next;
    const { state } = act(placed, endTurn(0, { discard: [{ pos: posOf(s, 0, '5B'), tile: '5B' }] }));
    expect(state.discard.map(tileId)).toEqual(['5B']);
    expect(state.players[0]?.hand.map((h) => h.pos).slice(-2)).toEqual([nextPos, nextPos + 1]);
    expect(state.players[0]?.hand.map((h) => tileId(h.tile as number)).slice(-2)).toEqual(['9I', '10I']);
  });

  it('C39 a dead replacement waits until the end of the next turn', () => {
    const s = scenario({
      chains: { s1: '1A-11A', p1: '1C-11C' },
      hands: ['5B 12I 1G 2G 3G 4G', '8G', '11G'],
      bag: '10I 6B',
      shares: { s1: [0, 1, 0], p1: [0, 0, 1] },
    });
    let state = act(s, place(s, 0, '12I')).state;
    state = act(state, endTurn(0, { discard: [{ pos: posOf(s, 0, '5B'), tile: '5B' }] })).state;
    // 6B (dead) arrived as the replacement; it is kept this turn.
    expect(state.players[0]?.hand.some((h) => h.tile === tileIndex('6B'))).toBe(true);
    state = run(state, [place(state, 1, '8G'), endTurn(1)]).state;
    state = run(state, [place(state, 2, '11G'), endTurn(2)]).state;
    state = act(state, place(state, 0, '1G')).state;
    rejects(state, endTurn(0), 'discard');
    const end = legalActions(state, 0)[0];
    expect(end?.type === 'endTurn' && end.discard.map((d) => d.tile)).toEqual(['6B']);
  });

  it('C40 a tile that dies during the turn is discarded at the end of the same turn', () => {
    const s = scenario({ chains: { s1: '1A-11A', p1: '1C-10C' }, hands: ['5B 11C'] });
    expect(cls(s.board, '5B')).toBe('merge');
    const grown = act(s, place(s, 0, '11C')).state;
    expect(sizeOf(grown, 'p1')).toBe(11);
    rejects(grown, endTurn(0), 'discard');
    act(grown, endTurn(0, { discard: [{ pos: posOf(s, 0, '5B'), tile: '5B' }] }));
  });

  it('C41 a chain refounded while players hold old shares', () => {
    const s = scenario({ loose: '1A 12I 1I', hands: ['2A'], shares: { b1: [0, 5, 0] } });
    const placed = act(s, place(s, 0, '2A')).state;
    const { state, events } = act(placed, { type: 'foundChain', actor: 0, chain: 'b1' });
    expect(ofType(events, 'chainFounded')[0]).toMatchObject({ chain: 'b1', keptShares: 5 });
    expect(sharesOf(state, 0, 'b1')).toBe(1);
    expect(sharesOf(state, 1, 'b1')).toBe(5);
    expect(state.bank[0]).toBe(19);
  });
});
