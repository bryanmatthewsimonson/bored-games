/*
 * Brand packs and the Game names setting (D046): the names in effect follow the profile's choice when a licensed
 * pack is loaded, and are the trademark-safe ones otherwise. The licensed pack is imported here, from a test;
 * the app's source only loads it behind the build flag (licensed-brands.ts).
 */
import { ORIGINAL_BRAND } from '@bored-games/chain-reaction/licensed/original';
import { CHAIN_REACTION_THEME, SAFE_BRAND } from '@bored-games/chain-reaction/theme';
import { CHESS_BRAND } from '@bored-games/chess/brand';
import { signal } from '@preact/signals';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Branding,
  chooseBranding,
  followBranding,
  gameNames,
  isBranding,
  licensedPacksLoaded,
  setLicensedPacks,
} from '../src/brands.ts';
import { filterCatalog, NO_FILTERS } from '../src/catalog-model.ts';
import { catalogItems } from '../src/components/game-catalog.tsx';
import { gameTitle } from '../src/game-names.ts';
import { CHAIN_REACTION_META } from '../src/games/chain-reaction/meta.ts';
import { activeTheme, isChainReactionBrand } from '../src/games/chain-reaction/theme.ts';
import { loadLicensedBrands } from '../src/licensed-brands.ts';
import { createSettings } from '../src/settings.ts';
import { memoryStorage } from '../src/storage.ts';

const LICENSED = new Map([['chain-reaction', ORIGINAL_BRAND]]);

afterEach(() => {
  chooseBranding('safe');
  setLicensedPacks(null);
});

describe('brand packs', () => {
  it('maps the original pack onto the same chain slots as the safe one', () => {
    expect(isChainReactionBrand(SAFE_BRAND)).toBe(true);
    expect(isChainReactionBrand(ORIGINAL_BRAND)).toBe(true);
    expect(isChainReactionBrand(CHESS_BRAND)).toBe(false);
    expect(Object.keys(ORIGINAL_BRAND.chains).sort()).toEqual(Object.keys(SAFE_BRAND.chains).sort());
    expect(ORIGINAL_BRAND.id).toBe('original');
    expect(ORIGINAL_BRAND.aliases).toContain(ORIGINAL_BRAND.gameTitle);
    const names = Object.values(ORIGINAL_BRAND.chains).map((c) => c.name);
    expect(new Set(names).size).toBe(7);
    // No safe name is reused, so the two packs are never confused.
    for (const c of Object.values(SAFE_BRAND.chains)) expect(names).not.toContain(c.name);
  });

  it('shows the safe names while no licensed pack is loaded, whatever the choice', () => {
    expect(import.meta.env.VITE_LICENSED_BRANDS).not.toBe('1');
    expect(licensedPacksLoaded()).toBe(false);
    chooseBranding('original');
    expect(gameNames('chain-reaction')).toBe(SAFE_BRAND);
    expect(activeTheme.value).toBe(CHAIN_REACTION_THEME);
    expect(gameTitle('chain-reaction')).toBe(SAFE_BRAND.gameTitle);
  });

  it('does not load a licensed pack in a build without the flag', async () => {
    await loadLicensedBrands();
    expect(licensedPacksLoaded()).toBe(false);
  });

  it('switches every name with the choice once the pack is loaded', () => {
    setLicensedPacks(LICENSED);
    expect(licensedPacksLoaded()).toBe(true);
    expect(gameNames('chain-reaction')).toBe(SAFE_BRAND);
    chooseBranding('original');
    expect(gameNames('chain-reaction')).toBe(ORIGINAL_BRAND);
    expect(gameTitle('chain-reaction')).toBe(ORIGINAL_BRAND.gameTitle);
    expect(CHAIN_REACTION_META.title()).toBe(ORIGINAL_BRAND.gameTitle);
    expect(activeTheme.value.brand).toBe('original');
    expect(activeTheme.value.chains.b1.name).toBe(ORIGINAL_BRAND.chains.b1.name);
    expect(activeTheme.value.chains.b1.label).toBe(CHAIN_REACTION_THEME.chains.b1.label);
    // A game without a licensed pack keeps its names.
    expect(gameNames('chess')).toBe(CHESS_BRAND);
    chooseBranding('safe');
    expect(activeTheme.value).toBe(CHAIN_REACTION_THEME);
  });

  it('finds a game by its licensed aliases only while they are in effect', () => {
    const query = { ...NO_FILTERS, query: ORIGINAL_BRAND.gameTitle };
    expect(filterCatalog(catalogItems(), query)).toEqual([]);
    setLicensedPacks(LICENSED);
    chooseBranding('original');
    expect(filterCatalog(catalogItems(), query).map((i) => i.entry.id)).toEqual(['chain-reaction']);
  });

  it("follows the profile's setting", () => {
    setLicensedPacks(LICENSED);
    const setting = signal<Branding>('safe');
    const stop = followBranding(setting);
    expect(gameTitle('chain-reaction')).toBe(SAFE_BRAND.gameTitle);
    setting.value = 'original';
    expect(gameTitle('chain-reaction')).toBe(ORIGINAL_BRAND.gameTitle);
    stop();
    setting.value = 'safe';
    expect(gameTitle('chain-reaction')).toBe(ORIGINAL_BRAND.gameTitle);
  });
});

describe('the Game names setting', () => {
  it('is stored per profile under bg:<profile>:branding, safe by default', () => {
    const store = memoryStorage();
    const s = createSettings('alice', store, false);
    expect(s.branding.value).toBe('safe');
    expect(s.setBranding('original')).toBe(true);
    expect(s.branding.value).toBe('original');
    expect(store.getItem('bg:alice:branding')).toBe('original');
    expect(createSettings('alice', store, false).branding.value).toBe('original');
    expect(createSettings('bob', store, false).branding.value).toBe('safe');
    expect(s.setBranding('safe')).toBe(true);
    expect(store.getItem('bg:alice:branding')).toBeNull();
  });

  it('ignores a stored value it does not know', () => {
    const store = memoryStorage();
    store.setItem('bg:alice:branding', 'fancy');
    expect(createSettings('alice', store, false).branding.value).toBe('safe');
    expect(isBranding('fancy')).toBe(false);
    expect(isBranding('original')).toBe(true);
  });
});
