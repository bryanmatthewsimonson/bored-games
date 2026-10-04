import { bank, bankV1 } from '@bored-games/bank';
import { parseJoin, parseRoot, parseTable, validateRoot, validateTable } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/session.ts';
import { MODULES, makeModuleGame, ROOT_SEEN, type TestGame } from './helpers.ts';

/*
 * Bank's two engines behind one registry (build plan D-B, D-C; PROTOCOL-v2 §2 items 5 and 6): Bank 0.2.0 under
 * `bank` runs under protocol 2 only, Bank 0.1.0 under `bank@0.1.0` under protocol 1 only. Real signed tables, Joins
 * and roots of each pairing, judged by the shipping-shaped registry.
 */

function problems(g: TestGame): { table: string[]; root: string[] } {
  const table = parseTable(g.table);
  const joins = new Map(g.joins.map((ev) => parseJoin(ev)).map((j) => [j.id, j]));
  return {
    table: validateTable(table, MODULES),
    root: validateRoot(parseRoot(g.root), table, joins, MODULES),
  };
}

function create(g: TestGame, seat: number | null): GameSession {
  const id = seat === null ? null : (g.ids[seat] ?? null);
  return GameSession.create({
    modules: g.modules,
    table: g.table,
    joins: g.joins,
    root: g.root,
    me: id,
    rootSeenAt: ROOT_SEEN,
  });
}

describe('Bank 0.2.0 and Bank 0.1.0 in one registry', () => {
  it('V2-05 a Bank table or root is rejected unless its engine version supports its proto', () => {
    // Bank 0.2.0 at proto 1, and Bank 0.1.0 at proto 2: rejected, table and root alike.
    const newAtV1 = makeModuleGame(bank, 2, 'bank-0.2.0-proto-1', bank.defaultRules(), '1');
    expect(problems(newAtV1)).toEqual({
      table: ['bank 0.2.0 does not support proto 1'],
      root: ['bank 0.2.0 does not support proto 1'],
    });
    expect(() => create(newAtV1, 0)).toThrow(/invalid game root: bank 0\.2\.0 does not support proto 1/);
    const oldAtV2 = makeModuleGame(bankV1, 2, 'bank-0.1.0-proto-2', bankV1.defaultRules(), '2');
    expect(problems(oldAtV2)).toEqual({
      table: ['bank 0.1.0 does not support proto 2'],
      root: ['bank 0.1.0 does not support proto 2'],
    });
    // Bank 0.2.0 at proto 2 and Bank 0.1.0 at proto 1: accepted.
    const current = makeModuleGame(bank, 2, 'bank-0.2.0-proto-2', bank.defaultRules(), '2');
    expect(problems(current)).toEqual({ table: [], root: [] });
    expect(() => create(current, 0)).toThrow(/the root is proto 2, not a v1 game/);
    const older = makeModuleGame(bankV1, 2, 'bank-0.1.0-proto-1', bankV1.defaultRules(), '1');
    expect(problems(older)).toEqual({ table: [], root: [] });
    expect(() => create(older, 0)).not.toThrow();
    // A version the registry does not hold at all is rejected too.
    const unknown = makeModuleGame(
      { ...bankV1, version: '0.0.9' },
      2,
      'bank-0.0.9',
      bankV1.defaultRules(),
      '1',
    );
    expect(problems(unknown).table).toEqual(['there is no module for game bank 0.0.9']);
  });

  it('a v1 Bank 0.1.0 game folds with Bank 0.1.0 (moduleFor through bank@0.1.0), not the current Bank 0.2.0', () => {
    const g = makeModuleGame(bankV1, 3, 'bank-0.1.0-fold', bankV1.defaultRules(), '1');
    for (const seat of [0, 1, null]) {
      const s = create(g, seat);
      expect((s as unknown as { module: unknown }).module).toBe(bankV1);
    }
    // Its first roll asks for v1 contributions as turns: the 0.1.0 rule, which 0.2.0 does not have.
    const roller = create(g, 0);
    const roll = roller.legalActions()[0];
    expect(roll).toEqual({ type: 'roll', actor: 0, rollId: 0 });
    const ev = roller.buildAction(roll, g.rnd, ROOT_SEEN + 1);
    const spectator = create(g, null);
    expect(spectator.receive(ev, ROOT_SEEN + 1).status).toBe('accepted');
    expect(spectator.view().pending).toEqual({ type: 'player', seat: 2, decision: 'contribute' });
  });
});
