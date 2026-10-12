/* Hazard's names for the platform (game picker, cards, titles); the theme is the only source (D046, D088). */
import { HAZARD_THEME } from '@bored-games/hazard/theme';
import type { GameMeta } from '../types.ts';

export const HAZARD_META: GameMeta = {
  id: 'hazard',
  title: () => HAZARD_THEME.title,
  tagline: () => HAZARD_THEME.tagline,
};
