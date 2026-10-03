/* Bank's names for the platform (game picker, cards, titles); the theme is the only source. */
import { BANK_THEME } from '@bored-games/bank/theme';
import type { GameMeta } from '../types.ts';

export const BANK_META: GameMeta = {
  id: 'bank',
  title: () => BANK_THEME.title,
  tagline: () => BANK_THEME.tagline,
};
