/**
 * User-facing names for Holler. Engine code never imports this file.
 * A card's suit is shown only as its color: four bright colors and a name for each (owner, D085).
 */
export const HOLLER_THEME = {
  title: 'Holler',
  tagline: 'Match the color, the number, or the action, and holler before your last card.',
  declaration: 'Holler!',
  colors: [
    { id: 'red', name: 'Red', hue: '#e23d3d' },
    { id: 'yellow', name: 'Yellow', hue: '#f2b411' },
    { id: 'green', name: 'Green', hue: '#2f9e55' },
    { id: 'blue', name: 'Blue', hue: '#1f6fd1' },
  ],
  actions: {
    halt: 'Halt',
    swing: 'Swing',
    pull: 'Pull',
    mark: 'Mark',
    levy: 'Levy',
  },
  paper: '#ffffff',
  ink: '#1c2230',
} as const;
