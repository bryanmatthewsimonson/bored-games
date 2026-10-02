/*
 * The names each game is shown under (D046): its brand pack in effect. Every game has a trademark-safe pack in
 * the catalog. Components that call these functions while rendering re-render when the names change.
 */
import type { BrandNames } from '@bored-games/game-kit';
import { CATALOG } from './games/catalog.ts';

/** The brand pack a game is shown under, or undefined for a game this app does not host. */
export function gameNames(gameId: string): BrandNames | undefined {
  return CATALOG.get(gameId)?.safe;
}
