/*
 * The phrase "Compare to" the published game whose mechanics Hazard implements (D088, as D053 and D078 for Chain
 * Reaction and Room for Doubt): the only form in which the public site names that game, on the catalog card and the
 * game page, with a link to its BoardGameGeek entry. Its title is an everyday word, so the trademark guard
 * (tests/restricted-names.ts) restricts it only as an exact-case whole word, and allows exactly this phrase: it is
 * ONE string literal, here, and the title is cut from it at run time.
 */

import { COMPARE_PREFIX } from '@bored-games/game-kit';

/** The allowed phrase, whole. */
export const COMPARE_PHRASE = 'Compare to Risk';

export { COMPARE_PREFIX };

/** The published game's title, cut from the phrase. */
export const COMPARE_TITLE: string = COMPARE_PHRASE.replace(new RegExp(`^${COMPARE_PREFIX}`), '');

/** The published game's BoardGameGeek id: https://boardgamegeek.com/boardgame/181 (D088). */
export const COMPARE_BGG_ID = 181;
