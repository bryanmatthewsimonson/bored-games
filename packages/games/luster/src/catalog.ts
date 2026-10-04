import type { CatalogEntry } from '@bored-games/game-kit';
import { LUSTER_ID } from './module.ts';
export const LUSTER_CATALOG: CatalogEntry = {
  id: LUSTER_ID,
  bggId: null,
  compareTo: null,
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
