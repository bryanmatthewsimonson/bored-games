/*
 * The licensed brand packs (D046), in builds made with `VITE_LICENSED_BRANDS=1` only (`VITE_LICENSED_BRANDS=1
 * pnpm dev` to try them). Vite replaces the flag with a constant at build time, so in a public build the guarded
 * dynamic import is dead code and the packs never reach the bundle (tests/public-build.test.ts checks the built
 * files). Nothing else may import from a `licensed/` directory (tests/repo-guards.test.ts).
 */
import { setLicensedPacks } from './brands.ts';

/** Loads the licensed packs when this build carries them; does nothing otherwise. Never rejects. */
export async function loadLicensedBrands(): Promise<void> {
  if (import.meta.env.VITE_LICENSED_BRANDS === '1') {
    try {
      const { ORIGINAL_BRAND } = await import('@bored-games/chain-reaction/licensed/original');
      setLicensedPacks(new Map([['chain-reaction', ORIGINAL_BRAND]]));
    } catch {
      // Without the pack the safe names stay in effect, and Settings says the choice is unavailable.
    }
  }
}
