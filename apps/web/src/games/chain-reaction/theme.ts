/*
 * The Chain Reaction theme in effect (D046): the brand pack the player sees (brands.ts) joined with the chains'
 * looks. Components read `activeTheme.value` while rendering, so they re-render when the names change, and pass
 * the theme to the pure model functions, which never pick one themselves.
 */
import {
  CHAIN_REACTION_THEME,
  CHAIN_SLOTS,
  type ChainReactionBrand,
  type ChainReactionTheme,
  chainReactionTheme,
} from '@bored-games/chain-reaction/theme';
import type { BrandNames } from '@bored-games/game-kit';
import { computed, type ReadonlySignal } from '@preact/signals';
import { gameNames } from '../../brands.ts';
import { CHAIN_REACTION_ID } from './meta.ts';

/** A pack that names every chain slot: a Chain Reaction brand pack. */
export function isChainReactionBrand(names: BrandNames): names is ChainReactionBrand {
  const chains = (names as { chains?: unknown }).chains;
  if (typeof chains !== 'object' || chains === null) return false;
  return CHAIN_SLOTS.every((slot) => {
    const c = (chains as Record<string, { name?: unknown } | undefined>)[slot];
    return typeof c?.name === 'string' && c.name !== '';
  });
}

/** The theme for the pack in effect; the trademark-safe theme for any other. */
export const activeTheme: ReadonlySignal<ChainReactionTheme> = computed(() => {
  const names = gameNames(CHAIN_REACTION_ID);
  return names !== undefined && names.id !== CHAIN_REACTION_THEME.brand && isChainReactionBrand(names)
    ? chainReactionTheme(names)
    : CHAIN_REACTION_THEME;
});
