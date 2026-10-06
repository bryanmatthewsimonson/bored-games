/*
 * The phrase "Compare to" the published game whose mechanics Right of Way implements (D066, as D053 and D060 for
 * Chain Reaction and Luster): the only form in which the public site names that game, on the catalog card and the
 * game page, with a link to its BoardGameGeek entry. The trademark guard (tests/restricted-names.ts) allows exactly
 * this phrase, so it is ONE string literal, here, and the title is cut from it at run time.
 */

import { COMPARE_PREFIX } from '@bored-games/game-kit';

/** The allowed phrase, whole. */
export const COMPARE_PHRASE = 'Compare to Ticket to Ride';

export { COMPARE_PREFIX };

/** The published game's title, cut from the phrase. */
export const COMPARE_TITLE: string = COMPARE_PHRASE.replace(new RegExp(`^${COMPARE_PREFIX}`), '');

/** The published game's BoardGameGeek id: https://boardgamegeek.com/boardgame/9209 (D066). */
export const COMPARE_BGG_ID = 9209;
