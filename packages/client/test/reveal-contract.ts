/*
 * The public-reveal contract the session relies on for a module with a deck (PROTOCOL §8.3, D052), as a helper
 * so that both the client tests (their own MODULES) and the web tests (every module the app registers,
 * apps/web/src/net.ts) run it.
 *
 * A module pends a public reveal only before the first player action, where a Resign cancels. A Resign that
 * counts while a public reveal is pending during play is scored once the derived reveals apply, which the fold
 * does after a Resign too (PROTOCOL §8.3), so a game with public reveals during play should get a review of that
 * path before it relaxes this contract. A module that opts out of Resign at every seat count
 * (`resignAllowed(rules, seats) → false`) is exempt: the hazard needs a Resign. Holler is the reviewed
 * exception (D073): after a seat goes out it reveals the other hands, and an empty pile or a new round pends
 * an epoch and then a grant. The exemption is `module.id === 'holler'` only.
 */
import { createRng, type GameModule, range, shuffle } from '@bored-games/game-kit';
import { cardAt, type HollerState } from '@bored-games/holler';
import { expect } from 'vitest';

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

const GAMES = 12;
const MAX_STEPS = 2000;
/** Player actions before a game may be declared over. */
const MIN_STEPS = 150;

/** The seat counts of `module`'s default rules at which it allows a Resign (all of them, if it does not say). */
export function resignSeatCounts(module: AnyModule): number[] {
  const rules = module.defaultRules();
  const { min, max } = module.seatRange(rules);
  return range(max - min + 1)
    .map((i) => min + i)
    .filter((seats) => module.resignAllowed?.(rules, seats) ?? true);
}

/** A deck order for `deck`: one uniform shuffle, or each partition shuffled within its own range. */
function deckOrder(
  deck: { size: number; partitions?: readonly { size: number }[] },
  rng: ReturnType<typeof createRng>,
): number[] {
  const parts = deck.partitions ?? [{ size: deck.size }];
  let offset = 0;
  return parts.flatMap((p) => {
    const part = shuffle(range(p.size), rng).map((c) => c + offset);
    offset += p.size;
    return part;
  });
}

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

/**
 * Plays `GAMES` games of `module` (its first deck) at each of `seatCounts` in turn, with seeded random legal
 * actions, and fails if a public reveal is pending after a player action. Holler may reveal during play.
 */
export function checkRevealContract(module: AnyModule, seatCounts: readonly number[]): void {
  const rules = module.defaultRules();
  const decks = module.decks(rules) as readonly {
    id: string;
    size: number;
    partitions?: readonly { size: number }[];
  }[];
  const deck = decks[0];
  if (deck === undefined) throw new Error(`${module.id} has no deck`);
  expect(seatCounts.length, `${module.id}: no seat count to check`).toBeGreaterThan(0);
  for (let g = 0; g < GAMES; g++) {
    const rng = createRng(`reveal-contract-${module.id}-${g}`);
    const seats = seatCounts[g % seatCounts.length] as number;
    const order = deckOrder(deck, rng);
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
          expect(acted, `a public reveal is pending after a player action (game ${g}, step ${step})`).toBe(
            false,
          );
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
}
