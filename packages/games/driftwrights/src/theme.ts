import type { BrandNames } from '@bored-games/game-kit';
export const DRIFTWRIGHTS_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Driftwrights',
  tagline: 'Raise a haven. Weave a network. Weather the rivalry.',
  summary:
    'Build hearths and sky links across floating islands. Gather supplies, negotiate trades and commission ventures while the Squall shifts the balance. Race to ten prestige with three or four guilds.',
  aliases: ['floating islands', 'sky links', 'trading', 'guilds'],
};
export const DRIFTWRIGHTS_THEME = {
  title: 'Driftwrights',
  tagline: 'Raise a haven. Weave a network. Weather the rivalry.',
  resources: ['Timber', 'Clay', 'Fiber', 'Grain', 'Metal'],
  ventures: ['Gale Guide', 'Twin Links', 'Supply Windfall', 'Guild Requisition'],
  landmarks: ['Cloud Archive', 'Wind Conservatory', 'Sky Observatory', 'Beacon Hall', 'Commons Pavilion'],
  colors: ['#1c7374', '#c9684f', '#866398', '#ac7a23'],
} as const;
