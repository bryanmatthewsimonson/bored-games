/* Chain Reaction's names for the platform (game picker, cards, titles), from the brand pack in effect (D046). */
import { SAFE_BRAND } from '@bored-games/chain-reaction/theme';
import { gameNames } from '../../brands.ts';
import type { GameMeta } from '../types.ts';

export const CHAIN_REACTION_ID = 'chain-reaction';

export const CHAIN_REACTION_META: GameMeta = {
  id: CHAIN_REACTION_ID,
  title: () => (gameNames(CHAIN_REACTION_ID) ?? SAFE_BRAND).gameTitle,
  tagline: () => (gameNames(CHAIN_REACTION_ID) ?? SAFE_BRAND).tagline,
};
