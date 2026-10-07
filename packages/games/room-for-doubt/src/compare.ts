/*
 * The phrase "Compare to" the published game whose mechanics Room for Doubt implements (D076, as D053, D060 and
 * D066 for Chain Reaction, Luster and Right of Way): the only form in which the public site names that game, on the
 * catalog card and the game page, with a link to its BoardGameGeek entry. Its title is an everyday word, so the
 * trademark guard (tests/restricted-names.ts) restricts it only as an exact-case whole word, and allows exactly this
 * phrase: it is ONE string literal, here, and the title is cut from it at run time.
 */

import { COMPARE_PREFIX } from '@bored-games/game-kit';

/** The allowed phrase, whole. */
export const COMPARE_PHRASE = 'Compare to Clue';

export { COMPARE_PREFIX };

/** The published game's title, cut from the phrase. */
export const COMPARE_TITLE: string = COMPARE_PHRASE.replace(new RegExp(`^${COMPARE_PREFIX}`), '');

/** The published game's BoardGameGeek id: https://boardgamegeek.com/boardgame/1294 (D076). */
export const COMPARE_BGG_ID = 1294;
