/**
 * User-facing names for Holler. Engine code never imports this file.
 * Hue is never the only suit signal: each suit has a pattern id the screen draws.
 */
export const HOLLER_THEME = {
  title: 'Holler',
  tagline: 'Match the suit, the rank, or the action, and holler before your last card.',
  declaration: 'Holler!',
  suits: [
    { id: 'notch', name: 'Notch', hue: '#c4552a', pattern: 'chevron' },
    { id: 'tide', name: 'Tide', hue: '#2a6f8f', pattern: 'wave' },
    { id: 'seed', name: 'Seed', hue: '#6e8b3d', pattern: 'seed' },
    { id: 'kiln', name: 'Kiln', hue: '#a33b4a', pattern: 'diamond' },
  ],
  actions: {
    halt: 'Halt',
    swing: 'Swing',
    pull: 'Pull',
    mark: 'Mark',
    levy: 'Levy',
  },
  paper: '#f3efe6',
  ink: '#1c2230',
} as const;
