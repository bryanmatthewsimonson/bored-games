/*
 * Spread Thin in the game catalog (D046, D096): facts only. The names and summary come from the brand pack
 * (theme.ts).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';

export const SPREAD_CATALOG: CatalogEntry = {
  id: 'spread-thin',
  // Our implementation under its own names: no entry of its own, and a "Compare to" link to the reference's (D053).
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'beta',
  players: { min: 2, max: 4, best: [3, 4] },
  playMinutes: { min: 45, max: 45 },
  typicalTurns: 20,
  weight: 2.4,
  luck: 3,
  genre: 'thematic',
  mechanisms: ['action-points', 'hand-management', 'set-collection', 'variable-powers'],
  modes: ['cooperative'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['cooperative', 'co-op', 'outbreak', 'medicine', 'cure', 'contagion', 'map', 'roles', 'teamwork'],
  minAge: 8,
  art: {
    credit: 'Original world map, card, role and token artwork by Bored Games',
    license: 'CC0-1.0',
  },
};
