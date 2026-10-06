import { RIGHT_OF_WAY_THEME } from '@bored-games/right-of-way/theme';
import type { GameMeta } from '../types.ts';

export const RIGHT_OF_WAY_META: GameMeta = {
  id: 'right-of-way',
  title: () => RIGHT_OF_WAY_THEME.title,
  tagline: () => RIGHT_OF_WAY_THEME.tagline,
};
