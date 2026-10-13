/* Current Affairs' names for the platform (game picker, cards, titles); the theme is the only source (D046, D091). */
import { CURRENT_THEME } from '@bored-games/current-affairs/theme';
import type { GameMeta } from '../types.ts';

export const CURRENT_META: GameMeta = {
  id: 'current-affairs',
  title: () => CURRENT_THEME.title,
  tagline: () => CURRENT_THEME.tagline,
};
