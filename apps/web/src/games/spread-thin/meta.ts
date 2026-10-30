/* Spread Thin's names for the platform (game picker, cards, titles); the theme is the only source (D046, D096). */
import { SPREAD_THEME } from '@bored-games/spread-thin/theme';
import type { GameMeta } from '../types.ts';

export const SPREAD_META: GameMeta = {
  id: 'spread-thin',
  title: () => SPREAD_THEME.title,
  tagline: () => SPREAD_THEME.tagline,
};
