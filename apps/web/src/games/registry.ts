/*
 * The web game registry (D045): every game the app hosts, with its names, its in-game component, its rules page
 * and its setup copy. The platform screens dispatch through it and import no game directly. Adding a game: add
 * its id to ids.ts, its module to MODULES (net.ts) and an entry here (a test checks that the three agree).
 */

import { BankGame } from './bank/game.tsx';
import { BANK_META } from './bank/meta.ts';
import { BankRulesPage } from './bank/rules-page.tsx';
import { CHAIN_REACTION_META } from './chain-reaction/meta.ts';
import { RulesPage as ChainReactionRulesPage } from './chain-reaction/rules-page.tsx';
import { ChainReactionScreen } from './chain-reaction/screen.tsx';
import { ChessGame } from './chess/game.tsx';
import { CHESS_META } from './chess/meta.ts';
import { ChessRulesPage } from './chess/rules-page.tsx';
import { GAME_IDS } from './ids.ts';
import type { WebGame } from './types.ts';

export const GAMES: readonly WebGame[] = [
  {
    ...CHAIN_REACTION_META,
    Component: ChainReactionScreen,
    RulesPage: ChainReactionRulesPage,
    setupCopy: (hasDeck) =>
      hasDeck ? { shuffling: 'Shuffling the deck', dealing: 'Dealing the tiles…' } : null,
  },
  {
    ...CHESS_META,
    Component: ChessGame,
    RulesPage: ChessRulesPage,
    setupCopy: () => null,
  },
  {
    ...BANK_META,
    Component: BankGame,
    RulesPage: BankRulesPage,
    setupCopy: () => null,
  },
];

const BY_ID: ReadonlyMap<string, WebGame> = new Map(GAMES.map((g) => [g.id, g]));

/** The registry entry of a module id, or undefined for a game this app does not host. */
export function webGame(id: string): WebGame | undefined {
  return BY_ID.get(id);
}

/** The registered games in picker order (`GAME_IDS`). */
export function pickerGames(): WebGame[] {
  return GAME_IDS.map((id) => BY_ID.get(id)).filter((g): g is WebGame => g !== undefined);
}
