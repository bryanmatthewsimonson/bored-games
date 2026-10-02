/**
 * LICENSED. The original names of the published game whose mechanics Chain Reaction implements (D046): its
 * title and its hotel chains, in the same tier slots as the trademark-safe pack (theme.ts). The looks (label
 * letters, colors, patterns) stay the safe ones.
 *
 * This file lives outside `src` on purpose. Nothing imports it statically: the web app loads it with a dynamic
 * import guarded by `import.meta.env.VITE_LICENSED_BRANDS === '1'`, which Vite replaces at build time, so public
 * builds hold none of these names (the repo guard and the public build scan check both). Do not ship a build
 * with the flag on until the names are licensed.
 */
import type { ChainReactionBrand } from '../src/theme.ts';

export const ORIGINAL_BRAND: ChainReactionBrand = {
  id: 'original',
  gameTitle: 'Acquire',
  tagline: 'Build hotel chains, buy stock, merge for profit.',
  summary:
    'Place tiles on a shared board to found hotel chains, buy stock in the ones you believe in, and cash in ' +
    'bonuses when a bigger chain acquires them. Your tiles and your money are private; at the end all stock is ' +
    'sold and the richest player wins.',
  aliases: ['Acquire', 'hotels', 'hotel chains'],
  chains: {
    // Budget tier.
    b1: { name: 'Tower' },
    b2: { name: 'Luxor' },
    // Standard tier.
    s1: { name: 'American' },
    s2: { name: 'Worldwide' },
    s3: { name: 'Festival' },
    // Premium tier.
    p1: { name: 'Imperial' },
    p2: { name: 'Continental' },
  },
};
