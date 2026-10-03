/*
 * Scripted full-mode games for the dev preview route and the model tests. This is a test fixture, not a
 * play mode: it reveals tiles from the known deck order and picks every move with a script.
 */
import {
  type ChainReactionAction,
  type ChainReactionEvent,
  type ChainReactionState,
  chainReaction,
  DEFAULT_RULES,
  TILE_COUNT,
} from '@bored-games/chain-reaction';
import { createRng, type Rng, range, shuffle } from '@bored-games/game-kit';
import { lastPlacedTile } from './model.ts';

export interface ScriptedGame {
  readonly state: ChainReactionState;
  readonly events: readonly ChainReactionEvent[];
  /** The tile placed most recently, or null before the first placement. */
  readonly lastTile: number | null;
}

/** Picks the next move for the seat that must act, from its legal actions. */
export type Script = (state: ChainReactionState, legal: readonly ChainReactionAction[], rng: Rng) => number;

export const firstLegal: Script = () => 0;
export const randomLegal: Script = (_s, legal, rng) => rng.int(legal.length);

/** A new full-mode game whose deck order is shuffled from `seed`. */
export function newGame(seed: string, seats: number): ScriptedGame {
  const order = shuffle(range(TILE_COUNT), createRng(`deck/${seed}`));
  const r = chainReaction.setup({ rules: DEFAULT_RULES, seats, mode: 'full', deckOrders: { tiles: order } });
  if (!r.ok) throw new Error(r.error.message);
  return { state: r.value, events: [], lastTile: null };
}

/** Applies one step: a reveal from the deck order, or the scripted player's move. Null once the game is over. */
export function step(game: ScriptedGame, script: Script, rng: Rng): ScriptedGame | null {
  const s = game.state;
  const pending = chainReaction.pending(s);
  let action: unknown;
  if (pending.type === 'over') return null;
  if (pending.type === 'reveal') {
    const pos = pending.positions[0] as number;
    action = { type: 'reveal', actor: 'deck', deck: 'tiles', pos, card: s.deck.order?.[pos] };
  } else if (pending.type === 'player') {
    const legal = chainReaction.legalActions(s, pending.seat) as ChainReactionAction[];
    action = legal[script(s, legal, rng)];
  } else {
    throw new Error('Chain Reaction does not roll dice');
  }
  const r = chainReaction.apply(s, action);
  if (!r.ok) throw new Error(`scripted move rejected: ${r.error.message}`);
  const events = [...game.events, ...r.events];
  return { state: r.state, events, lastTile: lastPlacedTile(r.events) ?? game.lastTile };
}

/** Plays from `seed` until `stop` holds (checked before each step) or `maxSteps` run out. */
export function playUntil(
  seed: string,
  seats: number,
  script: Script,
  stop: (game: ScriptedGame) => boolean,
  maxSteps = 2000,
): ScriptedGame | null {
  const rng = createRng(`moves/${seed}`);
  let game: ScriptedGame | null = newGame(seed, seats);
  for (let i = 0; i < maxSteps && game; i++) {
    if (stop(game)) return game;
    game = step(game, script, rng);
  }
  return null;
}
