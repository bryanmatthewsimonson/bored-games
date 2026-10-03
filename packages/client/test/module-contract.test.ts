import { createRng, range, shuffle } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { MODULES } from './helpers.ts';

/*
 * Contract checks the session relies on for every registered module with a deck (PROTOCOL §8.3, D052).
 *
 * A module pends a public reveal only before the first player action, where a Resign cancels. A Resign that
 * counts while a public reveal is pending during play is scored once the derived reveals apply, which the fold
 * does after a Resign too (PROTOCOL §8.3), so a game with public reveals during play should get a review of that
 * path before it relaxes this test.
 */

const GAMES = 12;
const MAX_STEPS = 2000;
/** Player actions before a game may be declared over. */
const MIN_STEPS = 150;

describe('modules with a deck pend public reveals only before the first player action', () => {
  for (const module of MODULES.values()) {
    const rules = module.defaultRules();
    const decks = module.decks(rules) as readonly { id: string; size: number }[];
    if (decks.length === 0) continue;
    it(`${module.id}`, () => {
      const deck = decks[0] as { id: string; size: number };
      const { min, max } = module.seatRange(rules);
      for (let g = 0; g < GAMES; g++) {
        const rng = createRng(`reveal-contract-${module.id}-${g}`);
        const seats = min + (g % (max - min + 1));
        const order = shuffle(range(deck.size), rng);
        const init = module.setup({ rules, seats, mode: 'full', deckOrders: { [deck.id]: order } });
        if (!init.ok) throw new Error(init.error.message);
        let state = init.value;
        let acted = false;
        let actions = 0;
        for (let step = 0; step < MAX_STEPS; step++) {
          const p = module.pending(state);
          if (p.type === 'over') break;
          let action: unknown;
          if (p.type === 'reveal') {
            expect(acted, `a public reveal is pending after a player action (game ${g}, step ${step})`).toBe(
              false,
            );
            const pos = [...p.positions].sort((a, b) => a - b)[0] as number;
            action = { type: 'reveal', actor: 'deck', deck: deck.id, pos, card: order[pos] };
          } else if (p.type === 'player') {
            // Play well into the game before ending it when allowed (review M-c), so mid-game states are covered.
            const legal = module.legalActions(state, p.seat) as readonly { declareEnd?: boolean }[];
            const playOn = legal.filter((a) => a.declareEnd !== true);
            const end = step >= MIN_STEPS ? legal.find((a) => a.declareEnd === true) : undefined;
            action = end ?? rng.pick(playOn.length > 0 ? playOn : legal);
            actions++;
            acted = true;
          } else {
            throw new Error(`${module.id} pends a dice beacon, and this check is for decks`);
          }
          const r = module.apply(state, action);
          if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
          state = r.state;
        }
        expect(actions).toBeGreaterThan(Math.min(MIN_STEPS, 60));
      }
    });
  }
});
