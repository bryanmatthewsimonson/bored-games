/* Holler's names for the platform (game picker, cards, titles); the theme is the only source. */
import { HOLLER_THEME } from '@bored-games/holler/theme';
import type { GameMeta } from '../types.ts';

export const HOLLER_META: GameMeta = {
  id: 'holler',
  title: () => HOLLER_THEME.title,
  tagline: () => HOLLER_THEME.tagline,
};
