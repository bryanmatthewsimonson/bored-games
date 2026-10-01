/**
 * THE one file holding every user-facing name for Tilestock (working
 * codename). Renaming the game or its chains is a change to this file only.
 * Engine code never imports it; ids on the left are permanent engine ids.
 *
 * Every chain is distinguished by a letter label and a fill pattern as well as
 * a color, so color is never the only cue. Label letters avoid A-I, which
 * name the board's rows.
 */
export interface ChainTheme {
  readonly name: string;
  readonly label: string;
  readonly color: string;
  readonly pattern: 'solid' | 'stripes' | 'dots' | 'grid' | 'diagonal' | 'waves' | 'checks';
}

export const TILESTOCK_THEME = {
  title: 'Tilestock',
  tagline: 'Found chains, trade shares, force mergers.',
  chains: {
    b1: { name: 'Jade', label: 'J', color: '#2e9d6b', pattern: 'solid' },
    b2: { name: 'Lapis', label: 'L', color: '#2f5fb3', pattern: 'stripes' },
    s1: { name: 'Onyx', label: 'O', color: '#3b3b44', pattern: 'dots' },
    s2: { name: 'Quartz', label: 'Q', color: '#c98bb9', pattern: 'grid' },
    s3: { name: 'Ruby', label: 'R', color: '#b8333f', pattern: 'diagonal' },
    p1: { name: 'Sapphire', label: 'S', color: '#1d3f8f', pattern: 'waves' },
    p2: { name: 'Topaz', label: 'T', color: '#d99a2b', pattern: 'checks' },
  } satisfies Record<string, ChainTheme>,
  tiers: { budget: 'Budget', standard: 'Standard', premium: 'Premium' },
} as const;
