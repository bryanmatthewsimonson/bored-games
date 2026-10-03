import { parseRoot } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { ClientError } from '../src/errors.ts';
import { seatForGameKeys } from '../src/recover.ts';
import { GameSession } from '../src/session.ts';
import { makeGame, ROOT_SEEN } from './helpers.ts';

const game = makeGame(3, 'client-recover');
const root = parseRoot(game.root);

describe('seat recovery from saved game keys (D057)', () => {
  it('finds the seat whose session key and deck key both match', () => {
    for (const [seat, id] of game.ids.entries())
      expect(seatForGameKeys(root, id.sessionSk, id.deckSecret)).toBe(seat);
  });

  it('finds nothing when the session key or the deck secret is another seat’s, or unknown', () => {
    const [a, b] = game.ids;
    if (a === undefined || b === undefined) throw new Error('no seats');
    expect(seatForGameKeys(root, a.sessionSk, b.deckSecret)).toBeNull();
    expect(seatForGameKeys(root, b.sessionSk, a.deckSecret)).toBeNull();
    expect(seatForGameKeys(root, a.sessionSk, a.deckSecret + 1n)).toBeNull();
    const stranger = new Uint8Array(32).fill(7);
    expect(seatForGameKeys(root, stranger, a.deckSecret)).toBeNull();
  });

  it('finds nothing for malformed keys, and never throws', () => {
    const a = game.ids[0];
    if (a === undefined) throw new Error('no seats');
    expect(seatForGameKeys(root, new Uint8Array(32), a.deckSecret)).toBeNull();
    expect(seatForGameKeys(root, new Uint8Array(31).fill(1), a.deckSecret)).toBeNull();
    expect(seatForGameKeys(root, a.sessionSk, 0n)).toBeNull();
    expect(seatForGameKeys(root, a.sessionSk, -1n)).toBeNull();
    expect(seatForGameKeys({ seats: [] }, a.sessionSk, a.deckSecret)).toBeNull();
  });

  it('a session built from the recovered seat and keys plays that seat', () => {
    const id = game.ids[2];
    if (id === undefined) throw new Error('no seat 2');
    const seat = seatForGameKeys(root, id.sessionSk, id.deckSecret);
    if (seat === null) throw new Error('not recovered');
    const input = {
      modules: game.modules,
      table: game.table,
      joins: game.joins,
      root: game.root,
      rootSeenAt: ROOT_SEEN,
    };
    const s = GameSession.create({
      ...input,
      me: { seat, sessionSk: id.sessionSk, deckSecret: id.deckSecret },
    });
    expect(s.view().mySeat).toBe(2);
    // Another seat's number with these keys is refused.
    expect(() =>
      GameSession.create({ ...input, me: { seat: 1, sessionSk: id.sessionSk, deckSecret: id.deckSecret } }),
    ).toThrow(ClientError);
  });
});
