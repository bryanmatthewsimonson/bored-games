import { gameNames } from './brands.ts';
import { BANK_META } from './games/bank/meta.ts';
import { CHAIN_REACTION_META } from './games/chain-reaction/meta.ts';
import { CHESS_META } from './games/chess/meta.ts';
import type { GameMeta } from './games/types.ts';

/** Every game's names, by module id. Light: no game components, so cards and the lobby can use it. */
export const GAME_METAS: ReadonlyMap<string, GameMeta> = new Map([
  [CHAIN_REACTION_META.id, CHAIN_REACTION_META],
  [CHESS_META.id, CHESS_META],
  [BANK_META.id, BANK_META],
]);

/**
 * The player-facing title of a game module id, under the names in effect (D046). Unknown ids are shown as they
 * are. Reads the branding: a component calling it re-renders when the names change.
 */
export function gameTitle(moduleId: string): string {
  return gameNames(moduleId)?.gameTitle ?? GAME_METAS.get(moduleId)?.title() ?? moduleId;
}
