/*
 * The phrase "Compare to" the published game whose mechanics Holler implements (D053, D072), the only form in
 * which the public site names that game. The title is cut from the phrase at run time so it is not a second
 * literal. A regular-expression replace is used because the minifier does not fold it into a literal.
 */

import { COMPARE_PREFIX } from '@bored-games/game-kit';

/** The allowed phrase, whole. */
export const COMPARE_PHRASE = 'Compare to Uno';

/** The words before the title (game-kit's, which the web app shows the phrase with). */
export { COMPARE_PREFIX };

/** The published game's title, cut from the phrase. */
export const COMPARE_TITLE: string = COMPARE_PHRASE.replace(new RegExp(`^${COMPARE_PREFIX}`), '');

/** The published game's BoardGameGeek id: https://boardgamegeek.com/boardgame/2223 (checked 2026-10-05). */
export const COMPARE_BGG_ID = 2223;
