import { chess } from '@bored-games/chess';
import { describe, expect, it } from 'vitest';
import { ClientError } from '../src/errors.ts';
import { GameSession } from '../src/session.ts';
import { openSession, v1Session } from '../src/session-api.ts';
import type { SessionInput } from '../src/types.ts';
import { GameSessionV2 } from '../src/v2/session.ts';
import { makeModuleGame, ROOT_SEEN, type TestGame } from './helpers.ts';

/*
 * One `Session` interface over both protocol versions (build plan D-A, T6; PROTOCOL-v2 §2): `openSession` picks the
 * class by the root's proto, and each class refuses a root of the other version.
 */

function input(g: TestGame, seat: number | null): SessionInput {
  return {
    modules: g.modules,
    table: g.table,
    joins: g.joins,
    root: g.root,
    me: seat === null ? null : (g.ids[seat] ?? null),
    rootSeenAt: ROOT_SEEN,
  };
}

describe('openSession', () => {
  it('V2-03 folds a proto-1 root with GameSession and a proto-2 root with GameSessionV2; a v1 root never reaches v2', () => {
    const v1 = makeModuleGame(chess, 2, 'open-session-v1', chess.defaultRules(), '1');
    const v2 = makeModuleGame(chess, 2, 'open-session-v2', chess.defaultRules(), '2');
    for (const seat of [0, 1, null]) {
      const s = openSession(input(v1, seat));
      expect(s).toBeInstanceOf(GameSession);
      expect(s.proto).toBe(1);
      expect(v1Session(s)).toBe(s);
    }
    for (const seat of [0, 1, null]) {
      const s = openSession(input(v2, seat));
      expect(s).toBeInstanceOf(GameSessionV2);
      expect(s.proto).toBe(2);
      expect(s.view()).toMatchObject({ proto: 2, fork: null, result: null });
      expect(() => v1Session(s)).toThrow(/a protocol 2 game has no v1 builders/);
    }
    // Neither class folds a root of the other version.
    expect(() => GameSession.create(input(v2, 0))).toThrow(/the root is proto 2, not a v1 game/);
    expect(() => GameSessionV2.create(input(v1, 0))).toThrow(/the root is proto 1, not a v2 game/);
  });

  it('refuses a root that does not parse with a ClientError', () => {
    const g = makeModuleGame(chess, 2, 'open-session-bad', chess.defaultRules(), '1');
    expect(() => openSession({ ...input(g, 0), root: { ...g.root, sig: '00'.repeat(64) } })).toThrow(
      ClientError,
    );
    expect(() =>
      openSession({ ...input(g, 0), root: { ...g.root, tags: [...g.root.tags, ['proto', '3']] } }),
    ).toThrow(/the root does not parse/);
  });
});
