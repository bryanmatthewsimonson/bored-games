/*
 * The names that must never ship in a public build (CLAUDE.md, D017, D046): the reference game's name, its
 * designer's, and its published editions' chain names. They may appear only in `licensed/` directories (and in
 * docs). The repo guard (repo-guards.test.ts) scans the sources with it; the public build scan
 * (public-build.test.ts) scans the built files.
 */
export const RESTRICTED_NAMES: readonly string[] = [
  'Acquire',
  'Sackson',
  'Tower',
  'Luxor',
  'American',
  'Worldwide',
  'Festival',
  'Imperial',
  'Continental',
  'Zeta',
  'Hydra',
  'Fusion',
  'America',
  'Quantum',
  'Phoenix',
];

/** Any restricted name as a whole word. */
export const RESTRICTED = new RegExp(`\\b(${RESTRICTED_NAMES.join('|')})\\b`);

/** Every restricted name in `text`, once each. */
export function restrictedIn(text: string): string[] {
  return RESTRICTED_NAMES.filter((n) => new RegExp(`\\b${n}\\b`).test(text));
}
