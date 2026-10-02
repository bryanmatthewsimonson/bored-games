/*
 * Chess in the game catalog (D046): facts only. The names and summary come from a brand pack (brand.ts).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { CHESS_ID } from './module.ts';

export const CHESS_CATALOG: CatalogEntry = {
  id: CHESS_ID,
  bggId: 171,
  compareTo: null,
  year: null,
  status: 'beta',
  players: { min: 2, max: 2, best: [2] },
  playMinutes: { min: 10, max: 120 },
  typicalTurns: 80,
  weight: 3.6,
  luck: 0,
  genre: 'abstract',
  mechanisms: ['grid-movement', 'capture-elimination'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: false,
  randomness: false,
  tags: ['classic', 'two-player', 'board', 'checkmate', 'pieces'],
  minAge: null,
  art: null,
};
