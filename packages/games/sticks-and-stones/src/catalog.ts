/*
 * Sticks & Stones in the game catalog (D046, D089): facts only. The names and summary come from the brand pack
 * (theme.ts).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';

export const STICKS_CATALOG: CatalogEntry = {
  id: 'sticks-and-stones',
  // Our implementation under its own names: no entry of its own, and a "Compare to" link to the reference's (D053).
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'beta',
  players: { min: 2, max: 4, best: [4] },
  playMinutes: { min: 60, max: 90 },
  typicalTurns: 20,
  weight: 2.5,
  luck: 2,
  genre: 'strategy',
  mechanisms: ['worker-placement', 'dice-rolling', 'set-collection'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['workers', 'prehistory', 'dice', 'village', 'monuments', 'engine building'],
  minAge: 10,
  art: { credit: 'Original clan camp, discovery and monument artwork by Bored Games', license: 'CC0-1.0' },
};
