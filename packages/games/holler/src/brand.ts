/*
 * Holler's display strings for the catalog (D046). One safe pack. The compare line lives only in compare.ts.
 */
import type { BrandNames } from '@bored-games/game-kit';
import { HOLLER_THEME } from './theme.ts';

export const HOLLER_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: HOLLER_THEME.title,
  tagline: HOLLER_THEME.tagline,
  summary:
    'A shedding game for two to ten. Match the suit, the rank, or the action, name a new suit with a Mark ' +
    'or a Levy, and say Holler when you lay down your next-to-last card. The first to 500 points wins.',
  aliases: ['holler card game'],
};
