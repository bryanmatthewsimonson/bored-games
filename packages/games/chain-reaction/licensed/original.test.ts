/*
 * LICENSED. The original pack maps the published companies onto the tier slots of DEFAULT_RULES (D046). This
 * test names them, so it lives beside the pack in `licensed/`, the only place the repo guard allows them.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../src/index.ts';
import { type ChainSlot, SAFE_BRAND } from '../src/theme.ts';
import { ORIGINAL_BRAND } from './original.ts';

describe('the original brand pack', () => {
  it('puts each company in its tier', () => {
    const byTier = (tier: string) =>
      DEFAULT_RULES.chains
        .filter((c) => c.tier === tier)
        .map((c) => ORIGINAL_BRAND.chains[c.id as ChainSlot].name);
    expect(byTier('budget')).toEqual(['Tower', 'Luxor']);
    expect(byTier('standard')).toEqual(['American', 'Worldwide', 'Festival']);
    expect(byTier('premium')).toEqual(['Imperial', 'Continental']);
  });

  it('names the game and is searchable by its title', () => {
    expect(ORIGINAL_BRAND.gameTitle).toBe('Acquire');
    expect(ORIGINAL_BRAND.aliases).toContain('Acquire');
    expect(Object.keys(ORIGINAL_BRAND.chains)).toEqual(Object.keys(SAFE_BRAND.chains));
  });
});
