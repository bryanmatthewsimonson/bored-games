import { signal } from '@preact/signals';
import { DEFAULT_GAME, GAME_IDS } from './games/ids.ts';

/**
 * Hash routes:
 *   #/                          Home
 *   #/t/<creatorHex>/<tableId>  a Table (lobby)
 *   #/g/<rootId>                a Game
 *   #/rules/<gameId>[/<section>] a game's rules, optionally scrolled to one section
 *   #/rules[/<section>]         the old form: Chain Reaction's rules (DEFAULT_GAME)
 *   #/credits                   third-party art and its licenses
 *   #/dev/<page>[/<scene>]      a dev-only preview (rendered only when import.meta.env.DEV)
 */
export type Route =
  | { name: 'home' }
  | { name: 'table'; creator: string; tableId: string }
  | { name: 'game'; rootId: string }
  | { name: 'rules'; game: string; section: string | null }
  | { name: 'credits' }
  | { name: 'dev'; page: string; scene: string | null }
  | { name: 'not-found'; hash: string };

const TABLE = /^\/t\/([0-9a-f]{64})\/([A-Za-z0-9._-]{1,64})\/?$/;
const GAME = /^\/g\/([0-9a-f]{64})\/?$/;
const RULES = /^\/rules(?:\/([a-z0-9-]{1,32}))?(?:\/([a-z0-9-]{1,32}))?\/?$/;
const DEV = /^\/dev\/([a-z0-9-]{1,32})(?:\/([a-z0-9-]{1,32}))?\/?$/;

export function parseRoute(hash: string): Route {
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  if (path === '' || path === '/') return { name: 'home' };
  if (path === '/credits' || path === '/credits/') return { name: 'credits' };
  const t = TABLE.exec(path);
  if (t) return { name: 'table', creator: t[1] as string, tableId: t[2] as string };
  const g = GAME.exec(path);
  if (g) return { name: 'game', rootId: g[1] as string };
  const r = RULES.exec(path);
  if (r) {
    const [first, second] = [r[1] ?? null, r[2] ?? null];
    if (first === null) return { name: 'rules', game: DEFAULT_GAME, section: null };
    if (second !== null) return { name: 'rules', game: first, section: second };
    // One segment: a game id, or a section of the default game's rules (the old links).
    return GAME_IDS.includes(first)
      ? { name: 'rules', game: first, section: null }
      : { name: 'rules', game: DEFAULT_GAME, section: first };
  }
  const d = DEV.exec(path);
  if (d) return { name: 'dev', page: d[1] as string, scene: d[2] ?? null };
  return { name: 'not-found', hash };
}

export const homeHref = (): string => '#/';
export const tableHref = (creator: string, tableId: string): string => `#/t/${creator}/${tableId}`;
export const gameHref = (rootId: string): string => `#/g/${rootId}`;
export const creditsHref = (): string => '#/credits';
/** A game's rules page, optionally at one section. */
export const rulesHref = (game: string, section?: string): string =>
  section ? `#/rules/${game}/${section}` : `#/rules/${game}`;

/**
 * The game the current screen is about (a table's or a game's), so the header's Rules link can follow it; null
 * elsewhere. Set by those screens while they are mounted.
 */
export const activeGame = signal<string | null>(null);

/** The current route. Written only by `startRouter`. */
export const route = signal<Route>(parseRoute(''));

interface RouterWindow {
  location: { hash: string };
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

/** Follow `location.hash`. Returns a function that stops following. */
export function startRouter(win: RouterWindow): () => void {
  const update = (): void => {
    route.value = parseRoute(win.location.hash);
  };
  update();
  win.addEventListener('hashchange', update);
  return () => win.removeEventListener('hashchange', update);
}
