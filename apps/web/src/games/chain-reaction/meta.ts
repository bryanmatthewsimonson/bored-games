/* Chain Reaction's names for the platform (game picker, cards, titles); the theme is the only source. */
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import type { GameMeta } from '../types.ts';

export const CHAIN_REACTION_META: GameMeta = {
  id: 'chain-reaction',
  title: () => CHAIN_REACTION_THEME.title,
  tagline: () => CHAIN_REACTION_THEME.tagline,
};
