/*
 * Hazard in the game catalog (D046, D088): facts only. The names and summary come from the brand pack (theme.ts).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';

export const HAZARD_CATALOG: CatalogEntry = {
  id: 'hazard',
  // Our implementation under its own names: no entry of its own, and a "Compare to" link to the reference's (D053).
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'beta',
  players: { min: 3, max: 6, best: [4, 5] },
  playMinutes: { min: 120, max: 240 },
  typicalTurns: 120,
  weight: 2.1,
  luck: 4,
  genre: 'wargame',
  mechanisms: ['area-control', 'dice-rolling', 'set-collection', 'capture-elimination'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['conquest', 'map', 'dice', 'armies', 'world'],
  minAge: 10,
  art: { credit: 'Original Meridian atlas and charter artwork by Bored Games', license: 'CC0-1.0' },
};
