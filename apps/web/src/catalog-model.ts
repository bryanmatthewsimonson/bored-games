/*
 * The game catalog's filters and search (D046), pure: from the catalog entries and the names in effect to the
 * games the Home catalog lists, and the words its cards and the game page show.
 */
import {
  type BrandNames,
  type CatalogEntry,
  COMPARE_PREFIX,
  GENRES,
  type Genre,
  type Mechanism,
  MODES,
  type Mode,
} from '@bored-games/game-kit';

/** A game as the catalog lists it: its facts and the names it is shown under. */
export interface CatalogItem {
  readonly entry: CatalogEntry;
  readonly names: BrandNames;
}

/** The player-count chips; the last one means "6 or more". */
export const PLAYER_CHIPS: readonly number[] = [1, 2, 3, 4, 5, 6];
const MANY = 6;

export const playerChipLabel = (n: number): string => (n >= MANY ? `${MANY}+` : String(n));

export type LengthId = 'under-30' | '30-60' | '60-120' | 'over-120';

/**
 * Length buckets by face-to-face play time. A game fits a bucket when its time range reaches into it: under 30
 * when it can end in under half an hour, over 120 when it can last more than two hours.
 */
export const LENGTHS: readonly { readonly id: LengthId; readonly label: string }[] = [
  { id: 'under-30', label: 'Under 30 min' },
  { id: '30-60', label: '30–60 min' },
  { id: '60-120', label: '60–120 min' },
  { id: 'over-120', label: 'Over 2 hours' },
];

export type ComplexityId = 'light' | 'medium' | 'heavy';

/** Complexity buckets by weight (1–5): light below 2, medium below 3, heavy from 3. */
export const COMPLEXITIES: readonly { readonly id: ComplexityId; readonly label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'medium', label: 'Medium' },
  { id: 'heavy', label: 'Heavy' },
];

/** The mode filter's choices, in the order the filter lists them. */
export const MODE_CHOICES: readonly { readonly id: Mode; readonly label: string }[] = [
  { id: 'solo', label: 'Solo' },
  { id: 'cooperative', label: 'Co-op' },
  { id: 'team', label: 'Team' },
  { id: 'competitive', label: 'Competitive' },
];

export const GENRE_LABELS: Readonly<Record<Genre, string>> = {
  abstract: 'Abstract',
  strategy: 'Strategy',
  economic: 'Economic',
  family: 'Family',
  card: 'Card game',
  party: 'Party',
  thematic: 'Thematic',
  wargame: 'Wargame',
};

/** "tile-placement" → "Tile placement". */
export function mechanismLabel(m: Mechanism): string {
  const words = m.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface CatalogFilters {
  readonly query: string;
  /** A player count (6 means 6 or more), or null for any. */
  readonly players: number | null;
  readonly genre: Genre | null;
  readonly mode: Mode | null;
  readonly length: LengthId | null;
  readonly complexity: ComplexityId | null;
}

export const NO_FILTERS: CatalogFilters = {
  query: '',
  players: null,
  genre: null,
  mode: null,
  length: null,
  complexity: null,
};

/** The longest search kept. */
const MAX_QUERY = 100;

/**
 * Filters read back from storage: each field kept only when it is a valid value, else its "any" default, so a
 * stale or edited value never breaks the catalog.
 */
export function parseFilters(raw: unknown): CatalogFilters {
  if (typeof raw !== 'object' || raw === null) return NO_FILTERS;
  const r = raw as Record<string, unknown>;
  const pick = <T>(v: unknown, ok: readonly T[]): T | null => (ok.includes(v as T) ? (v as T) : null);
  return {
    query: typeof r.query === 'string' ? r.query.slice(0, MAX_QUERY) : '',
    players: pick(r.players, PLAYER_CHIPS),
    genre: pick(r.genre, GENRES),
    mode: pick(r.mode, MODES),
    length: pick(
      r.length,
      LENGTHS.map((l) => l.id),
    ),
    complexity: pick(
      r.complexity,
      COMPLEXITIES.map((c) => c.id),
    ),
  };
}

/** How many filters other than the search are set. */
export function activeFilters(f: CatalogFilters): number {
  return [f.players, f.genre, f.mode, f.length, f.complexity].filter((v) => v !== null).length;
}

/** Whether a table of `n` players is possible (`n` = 6 means any of 6 or more). */
export function fitsPlayers(e: CatalogEntry, n: number): boolean {
  return n >= MANY ? e.players.max >= MANY : e.players.min <= n && n <= e.players.max;
}

export function fitsLength(e: CatalogEntry, id: LengthId): boolean {
  const { min, max } = e.playMinutes;
  switch (id) {
    case 'under-30':
      return min < 30;
    case '30-60':
      return min <= 60 && max >= 30;
    case '60-120':
      return min <= 120 && max >= 60;
    case 'over-120':
      return max > 120;
  }
}

export function complexityOf(weight: number): ComplexityId {
  return weight < 2 ? 'light' : weight < 3 ? 'medium' : 'heavy';
}

/** Lower case, dashes as spaces, single spaces: the form both the query and the searched words take. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The words a game is found by: its name and aliases, the title of the game it compares to (so typing the
 * original title finds the game on the public site, D053), its tags and its mechanisms.
 */
export function searchText(item: CatalogItem): string {
  const { names, entry } = item;
  const compare = entry.compareTo === null ? [] : [entry.compareTo.title];
  return normalize(
    [names.gameTitle, ...names.aliases, ...compare, ...entry.tags, ...entry.mechanisms].join(' | '),
  );
}

/** True when every word of `query` appears in the game's search text (an empty query matches every game). */
export function matchesQuery(item: CatalogItem, query: string): boolean {
  const words = normalize(query)
    .split(' ')
    .filter((w) => w !== '');
  const text = searchText(item);
  return words.every((w) => text.includes(w));
}

export function matches(item: CatalogItem, f: CatalogFilters): boolean {
  const e = item.entry;
  return (
    (f.players === null || fitsPlayers(e, f.players)) &&
    (f.genre === null || e.genre === f.genre) &&
    (f.mode === null || e.modes.includes(f.mode)) &&
    (f.length === null || fitsLength(e, f.length)) &&
    (f.complexity === null || complexityOf(e.weight) === f.complexity) &&
    matchesQuery(item, f.query)
  );
}

/** The games that pass every filter, in catalog order. */
export function filterCatalog(items: readonly CatalogItem[], f: CatalogFilters): CatalogItem[] {
  return items.filter((item) => matches(item, f));
}

/** The genres some game in the catalog has, in vocabulary order: the genre filter offers only these. */
export function genresIn(items: readonly CatalogItem[], order: readonly Genre[]): Genre[] {
  return order.filter((g) => items.some((i) => i.entry.genre === g));
}

/** The live result count: "2 games", "1 of 2 games", "No game matches". */
export function resultCountText(shown: number, total: number): string {
  if (shown === 0) return 'No game matches';
  const games = total === 1 ? 'game' : 'games';
  return shown === total ? `${total} ${games}` : `${shown} of ${total} ${games}`;
}

// ---------------------------------------------------------------- card and page words

/** "2 players", "3–6 players". */
export function playersText(e: CatalogEntry): string {
  const { min, max } = e.players;
  return min === max ? `${min} ${min === 1 ? 'player' : 'players'}` : `${min}–${max} players`;
}

/** "Best with 4–5", "Best with 2", "Best with 3 or 5". */
export function bestText(e: CatalogEntry): string {
  const best = [...e.players.best].sort((a, b) => a - b);
  const first = best[0];
  const last = best[best.length - 1];
  if (first === undefined || last === undefined) return '';
  if (best.length === 1) return `Best with ${first}`;
  const consecutive = best.every((n, i) => n === first + i);
  return consecutive ? `Best with ${first}–${last}` : `Best with ${best.slice(0, -1).join(', ')} or ${last}`;
}

/** "90 min", "10–120 min" (face to face). */
export function timeText(e: CatalogEntry): string {
  const { min, max } = e.playMinutes;
  return min === max ? `${min} min` : `${min}–${max} min`;
}

/** "Medium, 2.5 of 5". */
export function complexityText(e: CatalogEntry): string {
  const label = COMPLEXITIES.find((c) => c.id === complexityOf(e.weight))?.label ?? '';
  return `${label}, ${e.weight.toFixed(1)} of 5`;
}

const LUCK = ['None', 'Very little', 'Some', 'Moderate', 'High', 'Very high'] as const;

/** "Some (2 of 5)", "None". */
export function luckText(e: CatalogEntry): string {
  return e.luck === 0 ? LUCK[0] : `${LUCK[e.luck]} (${e.luck} of 5)`;
}

export function modesText(e: CatalogEntry): string {
  return MODE_CHOICES.filter((m) => e.modes.includes(m.id))
    .map((m) => m.label)
    .join(', ');
}

/** A game's BoardGameGeek page, by id only (no slug). */
export function bggUrl(id: number): string {
  return `https://boardgamegeek.com/boardgame/${id}`;
}

/**
 * "Compare to <title>" (D053). The title comes from the catalog entry at run time (Chain Reaction's is cut from its
 * one allowed phrase, compare.ts), so no bundle holds it as a literal of its own.
 */
export function compareText(c: NonNullable<CatalogEntry['compareTo']>): string {
  return `${COMPARE_PREFIX}${c.title}`;
}

/** What the players can see: hidden information or perfect information. */
export function informationText(e: CatalogEntry): string {
  return e.hiddenInfo ? 'Hidden information' : 'Perfect information: nothing is hidden';
}

/** A hue (0–359) for a game's generated tile, from its id: stable, and different for different games. */
export function tileHue(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/** Up to two initials for a generated tile: "CR" for "Chain Reaction", "C" for "Chess". */
export function tileInitials(title: string): string {
  const words = title.split(/\s+/).filter((w) => w !== '');
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}
