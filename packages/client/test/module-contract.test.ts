import { type GameModule, moduleProtocols } from '@bored-games/game-kit';
import { luster } from '@bored-games/luster';
import { describe, expect, it } from 'vitest';
import { diceToy } from '../../game-kit/test/dice-toy.ts';
import { MODULES } from './helpers.ts';
import { checkRevealContract, resignSeatCounts } from './reveal-contract.ts';
import { checkRollContract } from './roll-contract.ts';

/*
 * Contract checks the session relies on for every module with a deck that these tests register (PROTOCOL §8.3,
 * D052; reveal-contract.ts). The web tests run the same check over every module the app registers
 * (apps/web/test/module-contract.test.ts), which is the list that ships.
 */

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

/** These tests' registry plus Luster, which the session tests fold through their own helpers. */
const ALL: readonly AnyModule[] = [...MODULES.values(), luster];

const seatCounts = (m: AnyModule): number[] => {
  const { min, max } = m.seatRange(m.defaultRules());
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
};

describe('modules with a deck pend public reveals only before the first player action', () => {
  for (const module of MODULES.values()) {
    if (module.decks(module.defaultRules()).length === 0) continue;
    it(`${module.id}`, () => {
      const seats = resignSeatCounts(module);
      expect(seats.length, `${module.id} opts out of Resign; the web test exempts it`).toBeGreaterThan(0);
      checkRevealContract(module, seats);
    });
  }

  it('luster opts out of Resign at every seat count (Luster audit F5, D052), so it is exempt', () => {
    expect(resignSeatCounts(luster)).toEqual([]);
    for (const seats of seatCounts(luster))
      expect(luster.resignAllowed?.(luster.defaultRules(), seats)).toBe(false);
  });
});

describe('protocol versions and the protocol 2 module contract (PROTOCOL-v2 §2 item 6, §10)', () => {
  it('every module declares the protocols it runs under: Bank 0.2.0 v2 only, Bank 0.1.0 v1 only, the others both', () => {
    const declared = Object.fromEntries(ALL.map((m) => [`${m.id}@${m.version}`, moduleProtocols(m)]));
    expect(declared).toEqual({
      [`chain-reaction@${MODULES.get('chain-reaction')?.version}`]: [1, 2],
      [`chess@${MODULES.get('chess')?.version}`]: [1, 2],
      'bank@0.2.0': [2],
      'bank@0.1.0': [1],
      [`luster@${luster.version}`]: [1, 2],
    });
  });

  it('no module defines audit at all: PROTOCOL-v2 §9.5 (V2-48) is not built yet', () => {
    // `audit(rules)` depends on the rules, so probing the defaults could miss a rules option that yields 'none'
    // (T2/T3 review L1). While §9.5 is unbuilt no module may define it; the first one that does builds §9.5.
    for (const m of ALL) expect(m.audit, `${m.id} ${m.version}`).toBeUndefined();
  });

  // Every protocol 2 module that rolls (Bank 0.2.0); the toy below proves the check has teeth.
  const rollers = ALL.filter((m) => moduleProtocols(m).includes(2) && typeof m.rolls === 'function');
  for (const module of rollers)
    it(`${module.id} ${module.version}: protocol 2 roll entries`, () =>
      checkRollContract(module, seatCounts(module)));

  it('the protocol 2 rollers are exactly Bank 0.2.0', () => {
    expect(rollers.map((m) => `${m.id}@${m.version}`)).toEqual(['bank@0.2.0']);
  });

  it('the roll contract passes a protocol 2 dice toy, and fails one that lists protocol 1 rolls', () => {
    const toy = diceToy();
    checkRollContract(toy, [2, 3]);
    const v1Rolls: AnyModule = {
      ...toy,
      rolls: (s: { rolls: { id: number }[] }) => s.rolls.map((r) => ({ id: r.id, last: 0 })),
    };
    expect(() => checkRollContract(v1Rolls, [2])).toThrow(/not a RollEntry/);
    const late: AnyModule = {
      ...toy,
      pending: (s: { beacon: number | null }) =>
        s.beacon !== null ? { type: 'player', seat: 0, decision: 'wait' } : toy.pending(s as never),
    };
    expect(() => checkRollContract(late, [2])).toThrow(/no beacon pends right after the roll/);
  });
});
