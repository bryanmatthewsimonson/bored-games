/*
 * Right of Way in the game catalog (D046): facts only. The names and summary come from the brand pack (theme.ts).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';
import { RIGHT_OF_WAY_ID } from './module.ts';

export const RIGHT_OF_WAY_CATALOG: CatalogEntry = {
  id: RIGHT_OF_WAY_ID,
  // Our own names on a published game's mechanics: no BoardGameGeek entry of its own, "Compare to" that game.
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'beta',
  players: { min: 2, max: 5, best: [4] },
  playMinutes: { min: 30, max: 60 },
  typicalTurns: 100,
  weight: 1.9,
  luck: 2,
  genre: 'family',
  mechanisms: ['network-building', 'set-collection', 'hand-management', 'card-drafting'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['trains', 'routes', 'maps', 'charters'],
  minAge: 8,
  art: { credit: 'Original board, card and cover art by Bored Games', license: 'CC0-1.0' },
};
