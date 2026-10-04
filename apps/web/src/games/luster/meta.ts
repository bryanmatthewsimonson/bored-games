import { LUSTER_THEME } from '@bored-games/luster/theme';
import type { GameMeta } from '../types.ts';
export const LUSTER_META: GameMeta = {
  id: 'luster',
  title: () => LUSTER_THEME.title,
  tagline: () => LUSTER_THEME.tagline,
};
