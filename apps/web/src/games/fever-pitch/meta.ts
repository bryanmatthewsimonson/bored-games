/* Fever Pitch's names for the platform (game picker, cards, titles); the theme is the only source (D046, D096). */
import { FEVER_THEME } from '@bored-games/fever-pitch/theme';
import type { GameMeta } from '../types.ts';

export const FEVER_META: GameMeta = {
  id: 'fever-pitch',
  title: () => FEVER_THEME.title,
  tagline: () => FEVER_THEME.tagline,
};
