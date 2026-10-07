/*
 * Room for Doubt in the game catalog (D046, RULES.md "Catalog entry (for the build)"): facts only. The names and
 * the summary come from the brand pack (theme.ts).
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { COMPARE_BGG_ID, COMPARE_TITLE } from './compare.ts';
import { ROOM_FOR_DOUBT_ID } from './module.ts';

export const ROOM_FOR_DOUBT_CATALOG: CatalogEntry = {
  id: ROOM_FOR_DOUBT_ID,
  // Our own names on a published game's mechanics: no BoardGameGeek entry of its own, "Compare to" that game.
  bggId: null,
  compareTo: { title: COMPARE_TITLE, bggId: COMPARE_BGG_ID },
  year: null,
  status: 'beta',
  players: { min: 3, max: 6, best: [4] },
  // Face to face; online, every submission waits on the answers in turn, so a game takes days.
  playMinutes: { min: 45, max: 90 },
  typicalTurns: 60,
  weight: 1.6,
  luck: 2,
  genre: 'family',
  mechanisms: ['deduction', 'dice-rolling', 'grid-movement'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['mystery', 'murder', 'courthouse', 'detective'],
  minAge: 8,
  art: { credit: 'Original board, card and cover art by Bored Games', license: 'CC0-1.0' },
};
