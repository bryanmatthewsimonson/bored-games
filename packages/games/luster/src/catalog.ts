/*
 * Luster in the game catalog (D046): facts only. The names and summary come from a brand pack (theme.ts).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';
import { LUSTER_ID } from './module.ts';

export const LUSTER_CATALOG: CatalogEntry = {
  id: LUSTER_ID,
  // An implementation of a published game's mechanics under its own names, so no BoardGameGeek entry of its own;
  // the catalog says "Compare to" that game instead, with a link to its entry (compare.ts, D060), as Chain
  // Reaction does (D053).
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'beta',
  players: { min: 2, max: 4, best: [3] },
  playMinutes: { min: 30, max: 30 },
  typicalTurns: 90,
  weight: 1.8,
  luck: 2,
  genre: 'family',
  mechanisms: ['set-collection', 'card-drafting', 'market'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['gems', 'trading', 'developments', 'tokens', 'engine building'],
  minAge: 10,
  art: { credit: 'Original gemstone and landscape illustrations by Bored Games', license: 'CC0-1.0' },
};
