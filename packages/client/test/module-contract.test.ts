import { createRng, range, shuffle } from '@bored-games/game-kit';
import { cardAt, type HollerState } from '@bored-games/holler';
import { describe, expect, it } from 'vitest';
import { MODULES } from './helpers.ts';

/*
 * Contract checks the session relies on for every registered module with a deck (PROTOCOL §8.3, D052, D060).
 *
 * A module pends a public reveal only before the first player action, where a Resign cancels. A Resign that
 * counts while a public reveal is pending during play is scored once the derived reveals apply, which the fold
 * does after a Resign too (PROTOCOL §8.3). Holler is the reviewed exception (D060):
 * - What is revealed: the other seats' remaining hands, after someone has gone out, so the score is a function
 *   of public cards. A played card was already public. A card still in a live hand is not revealed early.
 * - Resign while a reveal is pending: PROTOCOL §8.3 already folds derived reveals after a Resign. No new resign
 *   rule is required for that case.
 * - The exemption is `module.id === 'holler'` only. This test accepts `shuffle` and `grant` for that module,
 *   installs an epoch order in full mode, applies `{type:'granted'}`, and reads a revealed card from the
 *   full-mode state. Other modules keep the mid-game reveal rejection and the dice-beacon throw.
 */

/** A play that leaves one card without declaring it sticks the next turn, so the contract prefers the declaration. */
function continuing(moduleId: string, legal: readonly unknown[]): readonly unknown[] {
  if (moduleId !== 'holler') return legal;
  const declared = legal.filter((action) => {
    const play = action as { type?: string; holler?: boolean; pos?: number };
    if (play.type !== 'play' || play.holler === true) return true;
    return !legal.some((other) => {
      const twin = other as { type?: string; holler?: boolean; pos?: number };
      return twin.type === 'play' && twin.holler === true && twin.pos === play.pos;
    });
  });
  return declared.length > 0 ? declared : legal;
}

function revealedCard(moduleId: string, state: unknown, order: readonly number[], pos: number): number {
  if (moduleId === 'holler') {
    const card = cardAt((state as HollerState).orders, pos);
    if (card === null) throw new Error(`holler position ${pos} has no card`);
    return card;
  }
  const card = order[pos];
  if (card === undefined) throw new Error(`position ${pos} is outside the opening order`);
  return card;
}

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
            if (module.id !== 'holler') {
              expect(
                acted,
                `a public reveal is pending after a player action (game ${g}, step ${step})`,
              ).toBe(false);
            }
            const pos = [...p.positions].sort((a, b) => a - b)[0] as number;
            action = {
              type: 'reveal',
              actor: 'deck',
              deck: deck.id,
              pos,
              card: revealedCard(module.id, state, order, pos),
            };
          } else if (p.type === 'player') {
            // Play well into the game before ending it when allowed (review M-c), so mid-game states are covered.
            const legal = module.legalActions(state, p.seat) as readonly { declareEnd?: boolean }[];
            const playOn = continuing(
              module.id,
              legal.filter((a) => a.declareEnd !== true),
            );
            const end = step >= MIN_STEPS ? legal.find((a) => a.declareEnd === true) : undefined;
            const pool = playOn.length > 0 ? playOn : legal;
            if (pool.length === 0)
              throw new Error(`${module.id} lists no legal action (game ${g}, step ${step})`);
            action = end ?? rng.pick(pool);
            actions++;
            acted = true;
          } else if (module.id === 'holler' && p.type === 'shuffle') {
            const plain = [...(module.shufflePlaintexts?.(state) ?? [])];
            if (plain.length === 0) throw new Error('an epoch has no plaintexts');
            const shuffled = shuffle(plain, rng);
            const installed = module.installDeckOrder?.(state, p.epoch, shuffled);
            if (!installed?.ok) throw new Error('installDeckOrder rejected an epoch order');
            if (installed.events.length !== 0) throw new Error('installDeckOrder emitted events');
            state = installed.state;
            action = { type: 'epoch', actor: 'deck', epoch: p.epoch, size: plain.length };
          } else if (module.id === 'holler' && p.type === 'grant') {
            action = { type: 'granted', actor: 'deck' };
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
