import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';
export const DRIFTWRIGHTS_CATALOG: CatalogEntry = {
  id: 'driftwrights',
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'beta',
  players: { min: 3, max: 4, best: [4] },
  playMinutes: { min: 60, max: 90 },
  typicalTurns: 80,
  weight: 2.3,
  luck: 3,
  genre: 'strategy',
  mechanisms: ['dice-rolling', 'network-building', 'negotiation-trading', 'hand-management'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['islands', 'building', 'trading', 'supplies', 'networks'],
  minAge: 10,
  art: { credit: 'Original floating island artwork by Bored Games', license: 'CC0-1.0' },
};
