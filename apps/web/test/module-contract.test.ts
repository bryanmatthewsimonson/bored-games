/*
 * The D052 Resign contract (PROTOCOL §8.3) over every module the app registers (`MODULES`, net.ts), the list that
 * ships, rather than the client tests' own registry: a module with a deck pends a public reveal only before the
 * first player action, at every seat count where it allows a Resign. The only exemption is a module that opts out
 * of Resign at every seat count (`resignAllowed(rules, seats) → false`, Luster today), and the test says which.
 */
import { type GameModule, moduleProtocols } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { checkRevealContract, resignSeatCounts } from '../../../packages/client/test/reveal-contract.ts';
import { checkRollContract } from '../../../packages/client/test/roll-contract.ts';
import { MODULES } from '../src/net.ts';

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

const hasDeck = (m: AnyModule): boolean => m.decks(m.defaultRules()).length > 0;

describe('D052: every registered module with a deck pends public reveals only before the first action', () => {
  const deckModules = [...MODULES.values()].filter(hasDeck);

  it('covers every registered module with a deck, and exempts exactly those that never allow a Resign', () => {
    expect(deckModules.map((m) => m.id)).toContain('chain-reaction');
    const exempt = deckModules.filter((m) => resignSeatCounts(m).length === 0).map((m) => m.id);
    expect(exempt).toEqual(['luster']);
    for (const id of exempt) {
      const m = MODULES.get(id) as AnyModule;
      const { min, max } = m.seatRange(m.defaultRules());
      for (let seats = min; seats <= max; seats++)
        expect(m.resignAllowed?.(m.defaultRules(), seats), `${id} at ${seats} seats`).toBe(false);
    }
  });

  for (const module of deckModules) {
    const seats = resignSeatCounts(module);
    if (seats.length === 0) {
      // Exempt, and for a reason: it does pend public reveals during play, so it must keep Resign disabled until
      // a Resign rule for them exists (D052). This also proves the check can run a partitioned deck.
      it(`${module.id}: exempt (Resign disabled at every seat count), and would fail the check`, () => {
        const { min } = module.seatRange(module.defaultRules());
        expect(() => checkRevealContract(module, [min])).toThrow(
          /public reveal is pending after a player action/,
        );
      });
      continue;
    }
    it(`${module.id} (seats ${seats.join(', ')})`, () => checkRevealContract(module, seats));
  }
});

describe('the protocol 2 module contract over every registered module (PROTOCOL-v2 §10)', () => {
  it('no registered module declares audit "none": PROTOCOL-v2 §9.5 (V2-48) must be built first', () => {
    for (const m of MODULES.values()) expect(m.audit?.(m.defaultRules()) ?? 'reveal', m.id).toBe('reveal');
  });

  for (const module of [...MODULES.values()].filter(
    (m) => moduleProtocols(m).includes(2) && typeof m.rolls === 'function',
  )) {
    const { min, max } = module.seatRange(module.defaultRules());
    const seats = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    it(`${module.id} ${module.version}: protocol 2 roll entries`, () => checkRollContract(module, seats));
  }
});
