import type { BrandNames } from '@bored-games/game-kit';

export const LUSTER_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Luster',
  tagline: 'Gather light. Shape glass. Build a brilliant workshop.',
  summary:
    'Collect colored light and turn it into glass workshops. Each workshop makes future creations easier, while patron commissions reward a balanced collection. Race to fifteen radiance in a shared market for two to four players.',
  aliases: ['glass', 'workshops', 'radiance'],
};
export const LUSTER_THEME = {
  title: LUSTER_BRAND.gameTitle,
  tagline: LUSTER_BRAND.tagline,
  colors: ['Ivory', 'Azure', 'Moss', 'Rose', 'Ink', 'Prism'],
  symbols: ['○', '◇', '△', '♡', '⬡', '✦'],
  tiers: ['Study', 'Studio', 'Atelier'],
  patrons: [
    'Orchard',
    'Nightfall',
    'Lagoon',
    'Lantern',
    'Horizon',
    'Ember',
    'Daybreak',
    'Wildflower',
    'Rainfall',
    'Moonrise',
  ],
} as const;
