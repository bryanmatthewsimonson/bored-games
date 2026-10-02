/*
 * The names each game is shown under (D046): the brand pack in effect. Every game has a trademark-safe pack in
 * the catalog. A build made with `VITE_LICENSED_BRANDS=1` also loads licensed packs (`licensed-brands.ts`), and a
 * player who chose them in Settings ("Game names") sees those; public builds hold no licensed pack at all.
 *
 * The state is signals: a component that calls these functions while rendering re-renders when the choice or
 * the loaded packs change.
 */
import type { BrandNames } from '@bored-games/game-kit';
import { effect, type ReadonlySignal, signal } from '@preact/signals';
import { CATALOG } from './games/catalog.ts';

/** A player's choice of names: the trademark-safe ones, or the licensed originals where a pack exists. */
export type Branding = 'safe' | 'original';

export const isBranding = (v: unknown): v is Branding => v === 'safe' || v === 'original';

const choice = signal<Branding>('safe');
/** The licensed packs this build loaded, by game id; null when there are none (every public build). */
const licensed = signal<ReadonlyMap<string, BrandNames> | null>(null);

/** Follows a profile's Branding setting (main.tsx). Returns a function that stops following. */
export function followBranding(setting: ReadonlySignal<Branding>): () => void {
  return effect(() => {
    choice.value = setting.value;
  });
}

/** Sets the choice directly (tests; the app follows the setting instead). */
export function chooseBranding(b: Branding): void {
  choice.value = b;
}

/** Installs the licensed packs (the loader in licensed-brands.ts, and tests); null removes them. */
export function setLicensedPacks(packs: ReadonlyMap<string, BrandNames> | null): void {
  licensed.value = packs;
}

/** True once a licensed pack is loaded: Settings then offers the choice. */
export function licensedPacksLoaded(): boolean {
  return licensed.value !== null && licensed.value.size > 0;
}

/** A game's licensed pack, when one is loaded. */
export function licensedPack(gameId: string): BrandNames | undefined {
  return licensed.value?.get(gameId);
}

/** The pack `gameId` is shown under now: the licensed one when chosen and loaded, else the trademark-safe one. */
export function gameNames(gameId: string): BrandNames | undefined {
  const safe = CATALOG.get(gameId)?.safe;
  if (safe === undefined) return undefined;
  return choice.value === 'original' ? (licensedPack(gameId) ?? safe) : safe;
}
