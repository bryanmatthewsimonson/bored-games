/*
 * The D052 Resign contract (PROTOCOL §8.3) over every module the app registers (`MODULES`, net.ts), the list that
 * ships, rather than the client tests' own registry: a module with a deck pends a public reveal only before the
 * first player action, at every seat count where it allows a Resign. The only exemption is a module that opts out
 * of Resign at every seat count (`resignAllowed(rules, seats) → false`, Luster today), and the test says which.
 */
import type { GameModule } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { checkRevealContract, resignSeatCounts } from '../../../packages/client/test/reveal-contract.ts';
import { MODULES } from '../src/net.ts';

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

const hasDeck = (m: AnyModule): boolean => m.decks(m.defaultRules()).length > 0;

describe('D052: every registered module with a deck pends public reveals only before the first action', () => {
  const deckModules = [...MODULES.values()].filter(hasDeck);

  it('covers every registered module with a deck, and exempts exactly those that never allow a Resign', () => {
    expect(deckModules.map((m) => m.id)).toContain('chain-reaction');
    const exempt = deckModules.filter((m) => resignSeatCounts(m).length === 0).map((m) => m.id);
    expect(exempt).toEqual(['luster', 'right-of-way', 'driftwrights']);
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
      if (module.id === 'driftwrights') {
        it('driftwrights: keeps Resign disabled for private supply transfers and mixed card/dice operations', () => {
          expect(module.privateSelection).toBeTypeOf('function');
          expect(module.rolls).toBeTypeOf('function');
          expect(resignSeatCounts(module)).toEqual([]);
        });
        continue;
      }
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
