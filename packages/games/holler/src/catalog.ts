/*
 * Holler in the game catalog (D046): facts only. Names come from the safe brand pack.
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';
import { HOLLER_ID } from './module.ts';

export const HOLLER_CATALOG: CatalogEntry = {
  id: HOLLER_ID,
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'experimental',
  players: { min: 2, max: 10, best: [4, 5, 6] },
  playMinutes: { min: 15, max: 30 },
  typicalTurns: 80,
  weight: 1.1,
  luck: 4,
  genre: 'card',
  mechanisms: ['hand-management', 'bluffing'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['shedding', 'family'],
  minAge: null,
  art: { credit: 'Bored Games', license: 'same as the repository' },
};
