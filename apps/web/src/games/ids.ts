/*
 * The game ids the web app knows, without importing any game code, so the router and other light modules can use
 * them. `registry.ts` holds one entry per id (a test checks they match `MODULES` in net.ts).
 */

/** Every game this app can host, in the order the game picker lists them. */
export const GAME_IDS: readonly string[] = [
  'chain-reaction',
  'chess',
  'bank',
  'luster',
  'right-of-way',
  'driftwrights',
  'holler',
  'room-for-doubt',
  'quill-and-quarry',
  'gilt-and-guile',
];

/** The game of the old `#/rules[/<section>]` links, and the picker's first choice. */
export const DEFAULT_GAME = 'chain-reaction';
