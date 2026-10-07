/* Room for Doubt's names for the platform (game picker, cards, titles); the theme is the only source (D046, D078). */
import { ROOM_FOR_DOUBT_THEME } from '@bored-games/room-for-doubt/theme';
import type { GameMeta } from '../types.ts';

export const ROOM_FOR_DOUBT_META: GameMeta = {
  id: 'room-for-doubt',
  title: () => ROOM_FOR_DOUBT_THEME.title,
  tagline: () => ROOM_FOR_DOUBT_THEME.tagline,
};
