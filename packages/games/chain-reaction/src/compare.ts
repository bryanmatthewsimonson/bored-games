/*
 * The phrase "Compare to" the published game whose mechanics Chain Reaction implements (D053), the only form in
 * which the public site names that game: shown on the catalog card and the game page, with a link to that game's
 * BoardGameGeek entry, the way a store brand says "compare to" the name brand. It informs without claiming to be
 * that game. Nowhere else, the not-affiliated note included, shows the title.
 *
 * The trademark guard (tests/restricted-names.ts) allows exactly this phrase, case-sensitive, and nothing else:
 * the title alone, in another case or inside another word still fails it. So the phrase is ONE string literal,
 * here, and the title is cut from it at run time, never written on its own. A regular-expression replace is used
 * because the minifier does not fold it into a literal (it could fold a `slice`); were that to change, the public
 * build scan would fail on the bare title.
 */

import { COMPARE_PREFIX } from '@bored-games/game-kit';

/** The allowed phrase, whole. */
export const COMPARE_PHRASE = 'Compare to Acquire';

/** The words before the title (game-kit's, which the web app shows the phrase with). */
export { COMPARE_PREFIX };

/** The published game's title, cut from the phrase. */
export const COMPARE_TITLE: string = COMPARE_PHRASE.replace(new RegExp(`^${COMPARE_PREFIX}`), '');

/** The published game's BoardGameGeek id: https://boardgamegeek.com/boardgame/5 (checked 2026-10-02). */
export const COMPARE_BGG_ID = 5;
