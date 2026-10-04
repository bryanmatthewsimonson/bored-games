import { describe, expect, it } from 'vitest';
import {
  currentModules,
  fuzzGame,
  isRollEntry,
  moduleFor,
  moduleProtocols,
  type ProtocolVersion,
} from '../src/index.ts';
import { type DiceState, diceToy } from './dice-toy.ts';

/* The module registry and protocol versions (PROTOCOL-v2 §2 item 6, §10; build plan D-B). */

const mod = (id: string, version: string, protocols?: readonly ProtocolVersion[]) =>
  protocols === undefined ? { id, version } : { id, version, protocols };

describe('the module registry (D-B)', () => {
  const bank2 = mod('bank', '0.2.0', [2]);
  const bank1 = mod('bank', '0.1.0', [1]);
  const chess = mod('chess', '0.1.0', [1, 2]);
  const registry = new Map([
    ['bank', bank2],
    ['bank@0.1.0', bank1],
    ['chess', chess],
  ]);

  it('moduleProtocols: a module without `protocols` runs under protocol 1 only', () => {
    expect(moduleProtocols(mod('x', '1.0.0'))).toEqual([1]);
    expect(moduleProtocols(chess)).toEqual([1, 2]);
    expect(moduleProtocols(bank2)).toEqual([2]);
  });

  it('moduleFor: the current module when its version matches, else the kept `id@version` one', () => {
    expect(moduleFor(registry, 'bank', '0.2.0')).toBe(bank2);
    expect(moduleFor(registry, 'bank', '0.1.0')).toBe(bank1);
    expect(moduleFor(registry, 'chess', '0.1.0')).toBe(chess);
  });

  it('moduleFor: undefined for an unknown game or version, or a kept entry that is another module', () => {
    expect(moduleFor(registry, 'bank', '0.3.0')).toBeUndefined();
    expect(moduleFor(registry, 'chess', '0.0.9')).toBeUndefined();
    expect(moduleFor(registry, 'luster', '0.2.0')).toBeUndefined();
    const wrong = new Map([
      ['bank@0.1.0', mod('bank', '0.1.1')],
      ['chess@0.0.1', mod('bank', '0.0.1')],
    ]);
    expect(moduleFor(wrong, 'bank', '0.1.0')).toBeUndefined();
    expect(moduleFor(wrong, 'chess', '0.0.1')).toBeUndefined();
    // A current key holding another id is not that game.
    expect(moduleFor(new Map([['chess', bank2]]), 'chess', '0.2.0')).toBeUndefined();
  });

  it('currentModules skips the `@` keys, in registry order', () => {
    expect([...currentModules(registry).entries()]).toEqual([
      ['bank', bank2],
      ['chess', chess],
    ]);
  });
});

describe('roll entries (PROTOCOL-v2 §6.2, §10)', () => {
  it('isRollEntry tells a protocol 2 entry from a protocol 1 DiceRoll', () => {
    expect(isRollEntry({ id: 0, count: 2, sides: 6 })).toBe(true);
    expect(isRollEntry({ id: 3, last: 1 })).toBe(false);
    expect(isRollEntry({ id: 0, count: 0, sides: 6 })).toBe(false);
    expect(isRollEntry({ id: 0, count: 2, sides: 1.5 })).toBe(false);
    // The range faces draws (PROTOCOL-v2 §10): count 1..64, sides 2..256.
    expect(isRollEntry({ id: 0, count: 64, sides: 256 })).toBe(true);
    expect(isRollEntry({ id: 0, count: 1, sides: 2 })).toBe(true);
    expect(isRollEntry({ id: 0, count: 65, sides: 6 })).toBe(false);
    expect(isRollEntry({ id: 0, count: 2, sides: 1 })).toBe(false);
    expect(isRollEntry({ id: 0, count: 2, sides: 257 })).toBe(false);
    expect(isRollEntry({ id: '0', count: 2, sides: 6 })).toBe(false);
    expect(isRollEntry(null)).toBe(false);
    expect(isRollEntry(undefined)).toBe(false);
  });

  it("the fuzzer draws the beacon's faces from the roll entry's count and sides", () => {
    for (const rules of [
      { turns: 6, count: 3, sides: 4 },
      { turns: 4, count: 1, sides: 20 },
    ]) {
      const game = diceToy(rules);
      for (const seed of ['a', 'b', 'c']) {
        const report = fuzzGame(game, { seed, seats: 3, rules });
        expect(report.failure).toBeNull();
        const rolled = report.actions.filter((a) => (a as { type: string }).type === 'rolled') as {
          dice: number[];
        }[];
        expect(rolled).toHaveLength(rules.turns);
        for (const r of rolled) {
          expect(r.dice).toHaveLength(rules.count);
          for (const d of r.dice) expect(d >= 1 && d <= rules.sides).toBe(true);
        }
      }
    }
  });

  it('the toy rejects faces that do not match its entry (so the fuzz check above has teeth)', () => {
    const game = diceToy();
    const s0 = game.setup({ rules: game.defaultRules(), seats: 2, mode: 'full', deckOrders: {} });
    if (!s0.ok) throw new Error('setup');
    const s1 = game.apply(s0.value, { type: 'roll', actor: 0 });
    if (!s1.ok) throw new Error('roll');
    expect(game.pending(s1.state)).toEqual({ type: 'beacon', id: 0 });
    expect(game.apply(s1.state, { type: 'rolled', actor: 'beacon', id: 0, dice: [1, 2] }).ok).toBe(false);
    expect(game.apply(s1.state, { type: 'rolled', actor: 'beacon', id: 0, dice: [1, 2, 5] }).ok).toBe(false);
    const ok = game.apply(s1.state, { type: 'rolled', actor: 'beacon', id: 0, dice: [1, 2, 4] });
    expect(ok.ok && (ok.state as DiceState).scores).toEqual([7, 0]);
  });
});
