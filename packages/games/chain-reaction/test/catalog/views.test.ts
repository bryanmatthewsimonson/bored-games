import { jsonEqual, type LogEntry, replay } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  type ChainReactionState,
  chainReaction,
  knownTo,
  learnTile,
  legalActions,
  setupGame,
  tileId,
  tileIndex,
  viewFor,
} from '../../src/index.ts';
import { act, endTurn, place, rejects, scenario } from '../helpers.ts';

const ORDER = Array.from({ length: 108 }, (_, i) => (i * 37) % 108);

/** A full game after setup, plus the public log so far. */
function started(): { full: ChainReactionState; log: unknown[] } {
  const init = setupGame({
    rules: chainReaction.defaultRules(),
    seats: 3,
    mode: 'full',
    deckOrders: { tiles: ORDER },
  });
  if (!init.ok) throw new Error(init.error.message);
  let full = init.value;
  const log: unknown[] = [];
  for (let pos = 0; pos < 3; pos++) {
    const action = { type: 'reveal', actor: 'deck', deck: 'tiles', pos, card: ORDER[pos] };
    full = act(full, action).state;
    log.push(action);
  }
  return { full, log };
}

describe('hidden information and integrity', () => {
  it('C54 each view hides other players hands', () => {
    const { full, log } = started();
    const seat = full.turn?.seat ?? 0;
    const view = viewFor(full, seat);
    expect(view.deck.order).toBeNull();
    view.players.forEach((p, s) => {
      expect(p.hand).toHaveLength(6);
      expect(p.hand.every((h) => (s === seat ? h.tile !== null : h.tile === null))).toBe(true);
    });
    expect(viewFor(full, null).players.every((p) => p.hand.every((h) => h.tile === null))).toBe(true);

    // A live client starts with unknown tiles and cannot act until it learns them.
    const fresh = setupGame({ rules: chainReaction.defaultRules(), seats: 3, mode: 'view', viewer: seat });
    if (!fresh.ok) throw new Error('setup');
    let mine = fresh.value;
    for (const a of log) mine = act(mine, a).state;
    expect(legalActions(mine, seat)).toEqual([]);
    for (const l of knownTo(full, seat)) {
      const r = learnTile(mine, l);
      if (!r.ok) throw new Error(r.error.message);
      mine = r.state;
    }
    expect(legalActions(mine, seat)).toEqual(legalActions(full, seat));
    expect(jsonEqual(mine, viewFor(full, seat))).toBe(true);
    // Learning a position that is not yours is rejected.
    const other = full.players[(seat + 1) % 3]?.hand[0];
    expect(learnTile(mine, { deck: 'tiles', pos: other?.pos ?? 0, card: other?.tile ?? 0 }).ok).toBe(false);
  });

  it('C55 a placement reveals a hidden tile; conflicting claims are rejected', () => {
    const s = scenario({ loose: '1A 12A 1I', hands: ['6F 9C', '3H'] });
    const viewOf1 = viewFor(s, 1);
    const { state } = act(viewOf1, place(s, 0, '6F'));
    expect(state.board[tileIndex('6F') as number]).toBe(-1);
    expect(state.players[0]?.hand).toHaveLength(1);
    // Seat 0 claiming a tile seat 1 is known to hold.
    const pos = s.players[0]?.hand[0]?.pos ?? 0;
    rejects(viewOf1, { type: 'place', actor: 0, pos, tile: '3H' }, 'conflict');
    // ...or a tile already on the board.
    rejects(viewOf1, { type: 'place', actor: 0, pos, tile: '1A' }, 'conflict');
  });

  it('C56 redaction is idempotent and replay-consistent', () => {
    const { full, log } = started();
    const seat = full.turn?.seat ?? 0;
    const first = legalActions(full, seat)[0];
    const afterPlace = act(full, first).state;
    const end = legalActions(afterPlace, seat)[0];
    const final = act(afterPlace, end).state;
    const publicLog = [...log, first, end];
    for (const viewer of [0, 1, 2, null]) {
      const v = viewFor(final, viewer);
      expect(jsonEqual(viewFor(v, viewer), v)).toBe(true);
      const entries: LogEntry[] = publicLog.map((action) => ({ kind: 'action', action }));
      if (viewer !== null) for (const learn of knownTo(final, viewer)) entries.push({ kind: 'learn', learn });
      const r = replay(
        chainReaction,
        { rules: chainReaction.defaultRules(), seats: 3, mode: 'view', viewer },
        entries,
      );
      expect(r.ok && jsonEqual(r.state, v)).toBe(true);
    }
  });

  it('C57 malformed or non-canonical actions are rejected', () => {
    const s = scenario({ loose: '1A 12A 1I', hands: ['6F'] });
    const pos = s.players[0]?.hand[0]?.pos ?? 0;
    const bad: unknown[] = [
      null,
      [],
      'place',
      { type: 'place', actor: 0, pos, tile: '6F', extra: 1 },
      { type: 'place', actor: 0, pos: String(pos), tile: '6F' },
      { type: 'place', actor: 0, pos, tile: '13A' },
      { type: 'place', actor: 0, pos, tile: '6f' },
      { type: 'place', actor: 3, pos, tile: '6F' },
      { type: 'place', actor: -1, pos, tile: '6F' },
      { type: 'foundChain', actor: 0, chain: 'z9' },
      { type: 'dispose', actor: 0, chain: 'b1', sell: 1.5, trade: 0 },
      { type: 'endTurn', actor: 0, buy: [], declareEnd: 'no', discard: [] },
      {
        type: 'endTurn',
        actor: 0,
        buy: [],
        declareEnd: false,
        discard: [
          { pos: 9, tile: '5B' },
          { pos: 4, tile: '6B' },
        ],
      },
      { type: 'reveal', actor: 0, deck: 'tiles', pos: 0, card: 1 },
      { type: 'teleport', actor: 0 },
    ];
    for (const a of bad) {
      const r = applyAction(s, a);
      expect(r.ok, JSON.stringify(a)).toBe(false);
    }
    expect(applyAction(s, { type: 'place', actor: 0, pos, tile: '6F' }).ok).toBe(true);
  });

  it('C58 wrong seat or wrong phase', () => {
    const s = scenario({
      chains: { s1: '1A-5A', b1: '7A-9A' },
      hands: ['6A', '12I'],
      shares: { b1: [0, 2, 0] },
    });
    rejects(s, place(s, 1, '12I'), 'actor');
    rejects(s, endTurn(0), 'phase');
    rejects(s, { type: 'chooseSurvivor', actor: 0, chain: 's1' }, 'phase');
    rejects(s, { type: 'dispose', actor: 1, chain: 'b1', sell: 0, trade: 0 }, 'phase');
    const merged = act(s, place(s, 0, '6A')).state;
    rejects(merged, { type: 'chooseSurvivor', actor: 0, chain: 's1' }, 'phase');
    rejects(merged, { type: 'orderDefunct', actor: 0, order: ['b1'] }, 'phase');
    rejects(merged, { type: 'dispose', actor: 0, chain: 'b1', sell: 0, trade: 0 }, 'actor');
    rejects(merged, endTurn(0), 'phase');
    expect(tileId(tileIndex('12I') as number)).toBe('12I');
  });
});
