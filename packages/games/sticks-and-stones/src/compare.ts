/*
 * The phrase "Compare to" the published game whose mechanics Sticks & Stones implements (D089, as D053 and D088):
 * the only form in which the public site names that game, on the catalog card and the game page, with a link to its
 * BoardGameGeek entry. The trademark guard (tests/restricted-names.ts) allows exactly this phrase, case-sensitive:
 * it is ONE string literal, here, and the title is cut from it at run time, never written on its own.
 */

import { COMPARE_PREFIX } from '@bored-games/game-kit';

/** The allowed phrase, whole. */
export const COMPARE_PHRASE = 'Compare to Stone Age';

export { COMPARE_PREFIX };

/** The published game's title, cut from the phrase. */
export const COMPARE_TITLE: string = COMPARE_PHRASE.replace(new RegExp(`^${COMPARE_PREFIX}`), '');

/** The published game's BoardGameGeek id: https://boardgamegeek.com/boardgame/34635 (D089). */
export const COMPARE_BGG_ID = 34635;
