/*
 * Current Affairs in the game catalog (D046, D091): facts only. The names and summary come from the brand pack
 * (theme.ts).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';

export const CURRENT_CATALOG: CatalogEntry = {
  id: 'current-affairs',
  // Our implementation under its own names: no entry of its own, and a "Compare to" link to the reference's (D053).
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'beta',
  players: { min: 2, max: 6, best: [4, 5] },
  playMinutes: { min: 120, max: 120 },
  typicalTurns: 12,
  weight: 3.3,
  luck: 1,
  genre: 'economic',
  mechanisms: ['auction-bidding', 'network-building', 'market'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: false,
  randomness: true,
  tags: ['electricity', 'power stations', 'utilities', 'auction', 'network', 'fuel market', 'map'],
  minAge: 12,
  art: {
    credit: 'Original Commonwealth map, power station and fuel artwork by Bored Games',
    license: 'CC0-1.0',
  },
};
