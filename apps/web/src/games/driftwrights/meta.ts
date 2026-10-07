import { DRIFTWRIGHTS_THEME } from '@bored-games/driftwrights/theme';
import type { GameMeta } from '../types.ts';
export const DRIFTWRIGHTS_META: GameMeta = {
  id: 'driftwrights',
  title: () => DRIFTWRIGHTS_THEME.title,
  tagline: () => DRIFTWRIGHTS_THEME.tagline,
};
