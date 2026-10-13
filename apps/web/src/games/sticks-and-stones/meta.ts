/* Sticks & Stones' names for the platform (game picker, cards, titles); the theme is the only source (D046, D089). */
import { STICKS_THEME } from '@bored-games/sticks-and-stones/theme';
import type { GameMeta } from '../types.ts';

export const STICKS_META: GameMeta = {
  id: 'sticks-and-stones',
  title: () => STICKS_THEME.title,
  tagline: () => STICKS_THEME.tagline,
};
