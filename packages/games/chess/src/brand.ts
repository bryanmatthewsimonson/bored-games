/*
 * Chess's display strings for the catalog (D046), after the theme. Chess has only this one brand pack.
 */
import type { BrandNames } from '@bored-games/game-kit';
import { CHESS_THEME } from './theme.ts';

export const CHESS_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: CHESS_THEME.title,
  tagline: CHESS_THEME.tagline,
  summary:
    'The classic game of two armies on an 8 by 8 board. Move your pieces to attack, defend and trap the ' +
    'opposing king; checkmate wins. Every rule of tournament chess applies, with automatic draws by ' +
    'stalemate, repetition, the fifty-move rule and insufficient material.',
  aliases: ['international chess', 'western chess'],
};
