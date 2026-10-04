/*
 * Bank in the game catalog (D046): facts only. The names and summary come from a brand pack (brand.ts).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { BANK_ID } from './module.ts';

export const BANK_CATALOG: CatalogEntry = {
  id: BANK_ID,
  // A folk dice game under its own public name (D060): its own BoardGameGeek entry, shown on the game page as
  // Chess's is, and no "Compare to" phrase.
  bggId: 412804,
  compareTo: null,
  year: null,
  status: 'beta',
  players: { min: 2, max: 6, best: [3, 4, 5] },
  playMinutes: { min: 10, max: 30 },
  typicalTurns: 40,
  weight: 1.1,
  luck: 5,
  genre: 'party',
  mechanisms: ['dice-rolling', 'push-your-luck'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: false,
  randomness: true,
  tags: ['dice', 'push-your-luck', 'party'],
  minAge: null,
  art: null,
};
