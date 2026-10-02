/*
 * LICENSED. The original pack maps the published companies onto the tier slots of DEFAULT_RULES (D046). This
 * test names them, so it lives beside the pack in `licensed/`, the only place the repo guard allows them.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../src/index.ts';
import { CHAIN_REACTION_THEME, type ChainSlot, chainReactionTheme, SAFE_BRAND } from '../src/theme.ts';
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

  it('brings the original looks: initials and hotel colors, over the safe patterns (D053)', () => {
    const theme = chainReactionTheme(ORIGINAL_BRAND);
    const slots = Object.keys(SAFE_BRAND.chains) as ChainSlot[];
    expect(slots.map((s) => theme.chains[s].label).join('')).toBe('TLAWFIC');
    expect(slots.map((s) => theme.chains[s].pattern)).toEqual(
      slots.map((s) => CHAIN_REACTION_THEME.chains[s].pattern),
    );
    // Yellow, red, blue, brown, green, pink, turquoise: each hue in its own range.
    const hue = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number,
      ];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const hues = slots.map((s) => Math.round(hue(theme.chains[s].color)));
    const ranges: [number, number][] = [
      [40, 60], // Tower, yellow
      [0, 10], // Luxor, red
      [205, 230], // American, blue
      [20, 40], // Worldwide, brown
      [120, 150], // Festival, green
      [320, 340], // Imperial, pink
      [175, 195], // Continental, turquoise
    ];
    hues.forEach((h, i) => {
      const [lo, hi] = ranges[i] as [number, number];
      expect(h, slots[i]).toBeGreaterThanOrEqual(lo);
      expect(h, slots[i]).toBeLessThanOrEqual(hi);
    });
  });

  it('names the game and is searchable by its title', () => {
    expect(ORIGINAL_BRAND.gameTitle).toBe('Acquire');
    expect(ORIGINAL_BRAND.aliases).toContain('Acquire');
    expect(Object.keys(ORIGINAL_BRAND.chains)).toEqual(Object.keys(SAFE_BRAND.chains));
  });
});
