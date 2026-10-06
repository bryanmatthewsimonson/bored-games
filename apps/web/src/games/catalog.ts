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
import type { BrandNames, CatalogEntry } from '@bored-games/game-kit';
import { LUSTER_CATALOG } from '@bored-games/luster/catalog';
import { LUSTER_BRAND } from '@bored-games/luster/theme';
import { RIGHT_OF_WAY_CATALOG } from '@bored-games/right-of-way/catalog';
import { RIGHT_OF_WAY_BRAND } from '@bored-games/right-of-way/theme';
import { GAME_IDS } from './ids.ts';

/** One hosted game in the catalog: its facts and its trademark-safe names. */
export interface CatalogGame {
  readonly entry: CatalogEntry;
  readonly safe: BrandNames;
}

const GAMES: readonly CatalogGame[] = [
  { entry: CHAIN_REACTION_CATALOG, safe: CHAIN_REACTION_SAFE },
  { entry: CHESS_CATALOG, safe: CHESS_BRAND },
  { entry: BANK_CATALOG, safe: BANK_BRAND },
  { entry: LUSTER_CATALOG, safe: LUSTER_BRAND },
  { entry: RIGHT_OF_WAY_CATALOG, safe: RIGHT_OF_WAY_BRAND },
];

const BY_ID: ReadonlyMap<string, CatalogGame> = new Map(GAMES.map((g) => [g.entry.id, g]));

/** Every hosted game's catalog entry and safe names, by module id, in `GAME_IDS` order. */
export const CATALOG: ReadonlyMap<string, CatalogGame> = new Map(
  GAME_IDS.flatMap((id) => {
    const g = BY_ID.get(id);
    return g === undefined ? [] : [[id, g] as const];
  }),
);
