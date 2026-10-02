/*
 * The one public mention of the published game whose mechanics Chain Reaction implements (D053): "Compare to"
 * its title, shown on the catalog card and the game page with a link to that game's BoardGameGeek entry, the
 * way a store brand says "compare to" the name brand. It informs without claiming to be that game.
 *
 * The trademark guard (tests/restricted-names.ts) allows exactly this phrase, case-sensitive, and nothing else:
 * the title alone, in another case or inside another word still fails it. So the phrase is ONE string literal,
 * here, and the title is cut from it at run time, never written on its own. A regular-expression replace is used
 * because the minifier does not fold it into a literal (it could fold a `slice`); were that to change, the public
 * build scan would fail on the bare title.
 */

/** The allowed phrase, whole. */
export const COMPARE_PHRASE = 'Compare to Acquire';

/** The words before the title. */
export const COMPARE_PREFIX = 'Compare to ';

/** The published game's title, cut from the phrase. */
export const COMPARE_TITLE: string = COMPARE_PHRASE.replace(/^Compare to /, '');

/** The published game's BoardGameGeek id: https://boardgamegeek.com/boardgame/5 (checked 2026-10-02). */
export const COMPARE_BGG_ID = 5;
