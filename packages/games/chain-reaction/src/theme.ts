/**
 * THE one file in `src` holding user-facing names for Chain Reaction: the trademark-safe brand pack, and the
 * look of each chain. Renaming the game or its chains is a change to this file only. Engine code never imports
 * it; ids on the left are permanent engine ids.
 *
 * A brand pack (D046) gives the game's names, and may override each chain's label letter and color (`looks`,
 * D053: the original pack brings the original colors and initials). Every chain is distinguished by a letter
 * label and a fill pattern as well as a color, so color is never the only cue; a pack keeps the safe patterns.
 * The safe label letters avoid A-I, which name the board's rows (the row letters sit on the board's edge, not in
 * chain cells, so a pack's letters need not). A licensed pack lives outside `src` (`licensed/`) and ships only
 * in builds made with it.
 */
import type { BrandNames } from '@bored-games/game-kit';
import type { Tier } from './rules.ts';

/** The chain ids of the default rules, in price-tier order. */
export type ChainSlot = 'b1' | 'b2' | 's1' | 's2' | 's3' | 'p1' | 'p2';

/** How a chain looks: the safe look, unless a brand pack overrides it (`ChainReactionBrand.looks`). */
export interface ChainLook {
  readonly label: string;
  readonly color: string;
  readonly pattern: 'solid' | 'stripes' | 'dots' | 'grid' | 'diagonal' | 'waves' | 'checks';
}

/** A chain as the screens show it: its name from the brand pack and its look. */
export interface ChainTheme extends ChainLook {
  readonly name: string;
}

/** Chain Reaction's names under one branding: the game's and one per chain slot, and optionally their looks. */
export interface ChainReactionBrand extends BrandNames {
  readonly chains: Readonly<Record<ChainSlot, { readonly name: string }>>;
  /** Looks that replace the safe ones, per slot (D053); a slot left out keeps its safe look. */
  readonly looks?: Partial<Record<ChainSlot, ChainLook>>;
}

/** Everything the screens need to name and draw the game: a brand pack joined with the looks. */
export interface ChainReactionTheme {
  /** The brand pack's id. */
  readonly brand: string;
  readonly title: string;
  readonly tagline: string;
  readonly chains: Readonly<Record<ChainSlot, ChainTheme>>;
  readonly tiers: Readonly<Record<Tier, string>>;
}

/** The trademark-safe names, shipped everywhere. */
export const SAFE_BRAND: ChainReactionBrand = {
  id: 'safe',
  gameTitle: 'Chain Reaction',
  tagline: 'Found chains, trade shares, force mergers.',
  summary:
    'Place tiles on a shared board to found chains, buy shares in the ones you believe in, and cash in ' +
    'bonuses when a bigger chain swallows them. Your tiles and your money are private; at the end every ' +
    'share is sold and the richest player wins.',
  aliases: [],
  chains: {
    b1: { name: 'Jade' },
    b2: { name: 'Lapis' },
    s1: { name: 'Onyx' },
    s2: { name: 'Quartz' },
    s3: { name: 'Ruby' },
    p1: { name: 'Sapphire' },
    p2: { name: 'Topaz' },
  },
};

const LOOKS: Readonly<Record<ChainSlot, ChainLook>> = {
  b1: { label: 'J', color: '#2e9d6b', pattern: 'solid' },
  b2: { label: 'L', color: '#2f5fb3', pattern: 'stripes' },
  s1: { label: 'O', color: '#3b3b44', pattern: 'dots' },
  s2: { label: 'Q', color: '#c98bb9', pattern: 'grid' },
  s3: { label: 'R', color: '#b8333f', pattern: 'diagonal' },
  p1: { label: 'S', color: '#1d3f8f', pattern: 'waves' },
  p2: { label: 'T', color: '#d99a2b', pattern: 'checks' },
};

export const CHAIN_SLOTS: readonly ChainSlot[] = ['b1', 'b2', 's1', 's2', 's3', 'p1', 'p2'];

const TIERS: Readonly<Record<Tier, string>> = { budget: 'Budget', standard: 'Standard', premium: 'Premium' };

/** The theme for `brand`: its names, with the chains' looks (the safe ones, under the pack's) and the tier names. */
export function chainReactionTheme(brand: ChainReactionBrand): ChainReactionTheme {
  const chains = {} as Record<ChainSlot, ChainTheme>;
  for (const slot of CHAIN_SLOTS)
    chains[slot] = { name: brand.chains[slot].name, ...LOOKS[slot], ...brand.looks?.[slot] };
  return { brand: brand.id, title: brand.gameTitle, tagline: brand.tagline, chains, tiers: TIERS };
}

/** The trademark-safe theme. */
export const CHAIN_REACTION_THEME: ChainReactionTheme = chainReactionTheme(SAFE_BRAND);
