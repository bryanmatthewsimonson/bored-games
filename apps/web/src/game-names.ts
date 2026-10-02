import { CHAIN_REACTION_META } from './games/chain-reaction/meta.ts';
import type { GameMeta } from './games/types.ts';

/** Every game's names, by module id. Light: no game components, so cards and the lobby can use it. */
export const GAME_METAS: ReadonlyMap<string, GameMeta> = new Map([
  [CHAIN_REACTION_META.id, CHAIN_REACTION_META],
]);

/** The player-facing title of a game module id. Unknown ids are shown as they are. */
export function gameTitle(moduleId: string): string {
  return GAME_METAS.get(moduleId)?.title() ?? moduleId;
}
