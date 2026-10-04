import type { BrandNames } from '@bored-games/game-kit';

export const LUSTER_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Luster',
  tagline: 'Precious gems. Clever trades. A little ambition.',
  summary:
    'Collect gems, invest in developments and earn the favor of nobles. Every purchase builds your trading power. Race to fifteen prestige in a shared market for two to four players.',
  aliases: ['gems', 'diamonds', 'rubies', 'emeralds', 'trading'],
};
export const LUSTER_THEME = {
  title: LUSTER_BRAND.gameTitle,
  tagline: LUSTER_BRAND.tagline,
  colors: ['Diamond', 'Sapphire', 'Emerald', 'Ruby', 'Onyx', 'Gold'],
  symbols: ['○', '◇', '△', '♡', '⬡', '✦'],
  tiers: ['Mines', 'Workshops', 'Guilds'],
  /** The gem rule option's labels (New table form, rules page; RULES.md C11). */
  gems: {
    published: 'Three colors (fewer only when fewer are left)',
    any: 'Any number of colors, up to three',
  },
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
