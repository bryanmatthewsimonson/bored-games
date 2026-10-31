/*
 * The game catalog (D046): each hosted game's catalog entry (facts) and its trademark-safe brand pack (names),
 * from the game packages. Light: no game components. `brands.ts` picks the names in effect; a test checks every
 * entry against its rules module.
 */
import { BANK_BRAND } from '@bored-games/bank/brand';
import { BANK_CATALOG } from '@bored-games/bank/catalog';
import { CHAIN_REACTION_CATALOG } from '@bored-games/chain-reaction/catalog';
import { SAFE_BRAND as CHAIN_REACTION_SAFE } from '@bored-games/chain-reaction/theme';
import { CHESS_BRAND } from '@bored-games/chess/brand';
import { CHESS_CATALOG } from '@bored-games/chess/catalog';
import { CURRENT_CATALOG } from '@bored-games/current-affairs/catalog';
import { CURRENT_BRAND } from '@bored-games/current-affairs/theme';
import { DRIFTWRIGHTS_CATALOG } from '@bored-games/driftwrights/catalog';
import { DRIFTWRIGHTS_BRAND } from '@bored-games/driftwrights/theme';
import { FEVER_CATALOG } from '@bored-games/fever-pitch/catalog';
import { FEVER_BRAND } from '@bored-games/fever-pitch/theme';
import type { BrandNames, CatalogEntry } from '@bored-games/game-kit';
import { GILT_AND_GUILE_CATALOG } from '@bored-games/gilt-and-guile/catalog';
import { GILT_AND_GUILE_BRAND } from '@bored-games/gilt-and-guile/theme';
import { HAZARD_CATALOG } from '@bored-games/hazard/catalog';
import { HAZARD_BRAND } from '@bored-games/hazard/theme';
import { HOLLER_BRAND } from '@bored-games/holler/brand';
import { HOLLER_CATALOG } from '@bored-games/holler/catalog';
import { LUSTER_CATALOG } from '@bored-games/luster/catalog';
import { LUSTER_BRAND } from '@bored-games/luster/theme';
import { QUILL_CATALOG } from '@bored-games/quill-and-quarry/catalog';
import { QUILL_BRAND } from '@bored-games/quill-and-quarry/theme';
import { RIGHT_OF_WAY_CATALOG } from '@bored-games/right-of-way/catalog';
import { RIGHT_OF_WAY_BRAND } from '@bored-games/right-of-way/theme';
import { ROOM_FOR_DOUBT_CATALOG } from '@bored-games/room-for-doubt/catalog';
import { ROOM_FOR_DOUBT_BRAND } from '@bored-games/room-for-doubt/theme';
import { STICKS_CATALOG } from '@bored-games/sticks-and-stones/catalog';
import { STICKS_BRAND } from '@bored-games/sticks-and-stones/theme';
import { GAME_IDS } from './ids.ts';

/** One hosted game in the catalog: its facts and its trademark-safe names. */
export interface CatalogGame {
  readonly entry: CatalogEntry;
  readonly safe: BrandNames;
}

const GAMES: readonly CatalogGame[] = [
  { entry: GILT_AND_GUILE_CATALOG, safe: GILT_AND_GUILE_BRAND },
  { entry: CHAIN_REACTION_CATALOG, safe: CHAIN_REACTION_SAFE },
  { entry: CHESS_CATALOG, safe: CHESS_BRAND },
  { entry: BANK_CATALOG, safe: BANK_BRAND },
  { entry: LUSTER_CATALOG, safe: LUSTER_BRAND },
  { entry: RIGHT_OF_WAY_CATALOG, safe: RIGHT_OF_WAY_BRAND },
  { entry: DRIFTWRIGHTS_CATALOG, safe: DRIFTWRIGHTS_BRAND },
  { entry: HOLLER_CATALOG, safe: HOLLER_BRAND },
  { entry: ROOM_FOR_DOUBT_CATALOG, safe: ROOM_FOR_DOUBT_BRAND },
  { entry: QUILL_CATALOG, safe: QUILL_BRAND },
  { entry: HAZARD_CATALOG, safe: HAZARD_BRAND },
  { entry: STICKS_CATALOG, safe: STICKS_BRAND },
  { entry: CURRENT_CATALOG, safe: CURRENT_BRAND },
  { entry: FEVER_CATALOG, safe: FEVER_BRAND },
];

const BY_ID: ReadonlyMap<string, CatalogGame> = new Map(GAMES.map((g) => [g.entry.id, g]));

/** Every hosted game's catalog entry and safe names, by module id, in `GAME_IDS` order. */
export const CATALOG: ReadonlyMap<string, CatalogGame> = new Map(
  GAME_IDS.flatMap((id) => {
    const g = BY_ID.get(id);
    return g === undefined ? [] : [[id, g] as const];
  }),
);

/** Whether a hosted game is cooperative: the players win or lose together, so a Resign is a loss for the team (D097). */
export const isCooperative = (id: string): boolean =>
  CATALOG.get(id)?.entry.modes.includes('cooperative') === true;
