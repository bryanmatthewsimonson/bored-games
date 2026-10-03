/*
 * Bank's display strings for the catalog (D046), after the theme. Bank has only this one brand pack. It is the
 * folk dice game, not a commercial edition, so there is no licensed pack and no "Compare to" line.
 */
import type { BrandNames } from '@bored-games/game-kit';
import { BANK_THEME } from './theme.ts';

export const BANK_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: BANK_THEME.title,
  tagline: BANK_THEME.tagline,
  summary:
    'A push-your-luck dice game for the table. Two dice build a shared pot. On your turn you may bank the pot ' +
    'into your score and sit out the rest of the round, or let it ride. The first three rolls of each round are ' +
    'safe, and a seven on one of them adds 70. After that, a seven busts the round and anyone who has not banked ' +
    'scores nothing for it, while doubles double the pot. The highest score after the last round wins.',
  aliases: ['bank dice', 'the bank dice game'],
};
