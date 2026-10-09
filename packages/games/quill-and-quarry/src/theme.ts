import type { BrandNames } from '@bored-games/game-kit';
export const QUILL_THEME = {
  title: 'Quill & Quarry',
  tagline: 'Find your words. Make your mark.',
  paper: '#f5f0e5',
  ink: '#233e41',
  gold: '#b58242',
  teal: '#447c79',
  premiums: { '2L': 'Double letter', '3L': 'Triple letter', '2W': 'Double word', '3W': 'Triple word' },
} as const;
export const QUILL_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: QUILL_THEME.title,
  tagline: QUILL_THEME.tagline,
  summary:
    'A meeting of sharp minds and well-chosen words. Build an interlocking landscape of letters, discover valuable crossings, and turn seven humble tiles into something remarkable. An English word game for two to four, with a dictionary agreed by your table.',
  aliases: ['quill and quarry', 'word game', 'letter tiles'],
};
