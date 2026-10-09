import { QUILL_THEME } from '@bored-games/quill-and-quarry/theme';
import type { GameMeta } from '../types.ts';
export const QUILL_META: GameMeta = {
  id: 'quill-and-quarry',
  title: () => QUILL_THEME.title,
  tagline: () => QUILL_THEME.tagline,
};
