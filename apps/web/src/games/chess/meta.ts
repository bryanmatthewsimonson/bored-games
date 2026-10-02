/* Chess's names for the platform (game picker, cards, titles); the theme is the only source. */
import { CHESS_THEME } from '@bored-games/chess/theme';
import type { GameMeta } from '../types.ts';

export const CHESS_META: GameMeta = {
  id: 'chess',
  title: () => CHESS_THEME.title,
  tagline: () => CHESS_THEME.tagline,
};
