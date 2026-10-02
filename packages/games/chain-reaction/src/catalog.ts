/*
 * Chain Reaction in the game catalog (D046): facts only. The names, summary and search aliases come from a brand
 * pack (theme.ts for the trademark-safe one).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { CHAIN_REACTION_ID } from './module.ts';

export const CHAIN_REACTION_CATALOG: CatalogEntry = {
  id: CHAIN_REACTION_ID,
  // An implementation of a published game's mechanics under its own names, so no BoardGameGeek entry of its own.
  bggId: null,
  year: null,
  status: 'stable',
  players: { min: 3, max: 6, best: [4, 5] },
  playMinutes: { min: 90, max: 90 },
  typicalTurns: null,
  weight: 2.5,
  luck: 2,
  genre: 'economic',
  mechanisms: ['tile-placement', 'stock-holding', 'hand-management', 'market'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['stocks', 'shares', 'mergers', 'business', 'investment', 'tiles', 'classic'],
  minAge: null,
  art: null,
};
