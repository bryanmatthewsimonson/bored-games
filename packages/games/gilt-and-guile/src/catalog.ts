import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';
export const GILT_AND_GUILE_CATALOG: CatalogEntry = {
  id: 'gilt-and-guile',
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'experimental',
  players: { min: 2, max: 4, best: [2, 3] },
  playMinutes: { min: 30, max: 45 },
  typicalTurns: 90,
  weight: 2.3,
  luck: 2,
  genre: 'strategy',
  mechanisms: ['deck-building', 'hand-management', 'market'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['theatre', 'cards', 'engine building', 'art deco'],
  minAge: 10,
  art: { credit: 'Original Gilt & Guile vector illustrations by Bored Games', license: 'CC0-1.0' },
};
