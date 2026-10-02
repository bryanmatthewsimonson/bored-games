/**
 * LICENSED. The original names of the published game whose mechanics Chain Reaction implements (D046): its
 * title and its hotel chains, in the same tier slots as the trademark-safe pack (theme.ts), with the original
 * looks (D053): each hotel's color and initial. Each chain keeps its safe fill pattern, for color-blind play.
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
  // The hotel colors of the current editions (Hasbro/Avalon Hill 2016, Renegade 60th Anniversary 2024): Tower
  // yellow, Luxor red, American blue, Worldwide brown, Festival green, Imperial pink, Continental turquoise.
  // Checked against secondary sources only (search summaries, 2026-10-02), not a scan of the components; the hex
  // values are ours, chosen to read under the label's dark letter. Labels are the hotels' initials, and may fall in
  // A-I: the board's row letters sit on its edge, never in a chain cell. Patterns stay the safe ones.
  looks: {
    b1: { label: 'T', color: '#e2b91f', pattern: 'solid' },
    b2: { label: 'L', color: '#d2352d', pattern: 'stripes' },
    s1: { label: 'A', color: '#2b5cb0', pattern: 'dots' },
    s2: { label: 'W', color: '#8b5a2b', pattern: 'grid' },
    s3: { label: 'F', color: '#2e9a48', pattern: 'diagonal' },
    p1: { label: 'I', color: '#e46aa6', pattern: 'waves' },
    p2: { label: 'C', color: '#1eaeb4', pattern: 'checks' },
  },
};
