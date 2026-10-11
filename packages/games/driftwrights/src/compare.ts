/*
 * The public comparison phrase is stored once here; the catalog derives the title from it (D053).
 * The branding guards permit the whole phrase and reject the reference title on its own.
 */
import { COMPARE_PREFIX } from '@bored-games/game-kit';

export const COMPARE_PHRASE = 'Compare to Catan';
export { COMPARE_PREFIX };
export const COMPARE_TITLE: string = COMPARE_PHRASE.replace(new RegExp(`^${COMPARE_PREFIX}`), '');
export const COMPARE_BGG_ID = 13;
