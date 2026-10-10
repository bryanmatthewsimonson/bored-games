import { gameNames } from './brands.ts';
import { BANK_META } from './games/bank/meta.ts';
import { CHAIN_REACTION_META } from './games/chain-reaction/meta.ts';
import { CHESS_META } from './games/chess/meta.ts';
import { DRIFTWRIGHTS_META } from './games/driftwrights/meta.ts';
import { GILT_AND_GUILE_META } from './games/gilt-and-guile/meta.ts';
import { HOLLER_META } from './games/holler/meta.ts';
import { LUSTER_META } from './games/luster/meta.ts';
import { QUILL_META } from './games/quill-and-quarry/meta.ts';
import { RIGHT_OF_WAY_META } from './games/right-of-way/meta.ts';
import { ROOM_FOR_DOUBT_META } from './games/room-for-doubt/meta.ts';
import type { GameMeta } from './games/types.ts';

/** Every game's names, by module id. Light: no game components, so cards and the lobby can use it. */
export const GAME_METAS: ReadonlyMap<string, GameMeta> = new Map([
  [CHAIN_REACTION_META.id, CHAIN_REACTION_META],
  [CHESS_META.id, CHESS_META],
  [BANK_META.id, BANK_META],
  [LUSTER_META.id, LUSTER_META],
  [RIGHT_OF_WAY_META.id, RIGHT_OF_WAY_META],
  [DRIFTWRIGHTS_META.id, DRIFTWRIGHTS_META],
  [HOLLER_META.id, HOLLER_META],
  [ROOM_FOR_DOUBT_META.id, ROOM_FOR_DOUBT_META],
  [QUILL_META.id, QUILL_META],
  [GILT_AND_GUILE_META.id, GILT_AND_GUILE_META],
]);

/**
 * The player-facing title of a game module id, under the names in effect (D046). Unknown ids are shown as they
 * are. Reads the branding: a component calling it re-renders when the names change.
 */
export function gameTitle(moduleId: string): string {
  return gameNames(moduleId)?.gameTitle ?? GAME_METAS.get(moduleId)?.title() ?? moduleId;
}
