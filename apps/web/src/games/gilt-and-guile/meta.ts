import { GILT_AND_GUILE_THEME } from '@bored-games/gilt-and-guile/theme';
import type { GameMeta } from '../types.ts';
export const GILT_AND_GUILE_META: GameMeta = {
  id: 'gilt-and-guile',
  title: () => GILT_AND_GUILE_THEME.title,
  tagline: () => GILT_AND_GUILE_THEME.tagline,
};
