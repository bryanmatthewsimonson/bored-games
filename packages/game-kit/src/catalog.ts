/*
 * The game catalog (D046): what each game package says about itself so the platform can list, filter and search
 * games, after the BoardGameGeek and BoardGameArena taxonomies. A `CatalogEntry` holds facts only; every display
 * string (the game's name, its summary, its search aliases) comes from a brand pack (`BrandNames`), so a game can
 * be shown under more than one set of names. Pure: plain data and checks.
 */
import type { GameModule } from './types.ts';

/** The genres, one per game. */
export const GENRES = [
  'abstract',
  'strategy',
  'economic',
  'family',
  'card',
  'party',
  'thematic',
  'wargame',
] as const;
export type Genre = (typeof GENRES)[number];

/** The controlled vocabulary of mechanisms. A new one is a change here, with a DECISIONS note. */
export const MECHANISMS = [
  'tile-placement',
  'stock-holding',
  'hand-management',
  'market',
  'auction-bidding',
  'set-collection',
  'trick-taking',
  'card-drafting',
  'deck-building',
  'dice-rolling',
  'push-your-luck',
  'area-control',
  'grid-movement',
  'capture-elimination',
  'pattern-building',
  'network-building',
  'deduction',
  'bluffing',
  'negotiation-trading',
  'simultaneous-selection',
] as const;
export type Mechanism = (typeof MECHANISMS)[number];

/** How the players relate: against each other, in teams, all together against the game, or alone. */
export const MODES = ['competitive', 'team', 'cooperative', 'solo'] as const;
export type Mode = (typeof MODES)[number];

export const TURNS = ['sequential', 'simultaneous'] as const;
export type TurnStructure = (typeof TURNS)[number];

export const STATUSES = ['stable', 'beta', 'experimental'] as const;
export type CatalogStatus = (typeof STATUSES)[number];

export type Luck = 0 | 1 | 2 | 3 | 4 | 5;

/** The words before a `compareTo` title wherever it is shown: "Compare to <title>" (D053). */
export const COMPARE_PREFIX = 'Compare to ';

/** One game in the catalog: facts about the game, never a display name. */
export interface CatalogEntry {
  /** The rules module id (`GameModule.id`). */
  readonly id: string;
  /** The game's BoardGameGeek id, or null. */
  readonly bggId: number | null;
  /**
   * The published game this one implements under its own names, for a "Compare to <title>" link to its
   * BoardGameGeek entry (D053), or null. The title is the published game's, so the public site may show it only
   * in that phrase: the trademark guard allows nothing else.
   */
  readonly compareTo: { readonly title: string; readonly bggId: number } | null;
  /** The year the game was first published, or null. */
  readonly year: number | null;
  readonly status: CatalogStatus;
  /** Seat counts: exactly the module's `seatRange` for its default rules; `best` lies within them. */
  readonly players: { readonly min: number; readonly max: number; readonly best: readonly number[] };
  /** Minutes for a game played face to face (an asynchronous game online takes days). */
  readonly playMinutes: { readonly min: number; readonly max: number };
  /** About how many turns a game takes, or null. */
  readonly typicalTurns: number | null;
  /** Complexity, 1.0 (light) to 5.0 (heavy), on the BoardGameGeek scale. */
  readonly weight: number;
  /** How much chance decides, 0 (none) to 5. */
  readonly luck: Luck;
  readonly genre: Genre;
  readonly mechanisms: readonly Mechanism[];
  readonly modes: readonly Mode[];
  readonly turn: TurnStructure;
  /** Some information is hidden from some players (a hand, a deck). */
  readonly hiddenInfo: boolean;
  /** Chance takes part (a shuffle, dice). */
  readonly randomness: boolean;
  /** Free search words, lower case. */
  readonly tags: readonly string[];
  readonly minAge: number | null;
  /** Credit for the card art, or null for a generated tile. */
  readonly art: { readonly credit: string; readonly license: string } | null;
}

/**
 * A game's display strings under one branding (D046). Each game has a trademark-safe pack in its `src`; a
 * licensed pack, when there is one, lives outside `src` and ships only in builds made for it.
 */
export interface BrandNames {
  /** The pack id: 'safe', or the id of a licensed pack such as 'original'. */
  readonly id: string;
  readonly gameTitle: string;
  /** One line, for cards and the rules page. */
  readonly tagline: string;
  /** A paragraph, for the game page. */
  readonly summary: string;
  /** Other names the game is searched by. */
  readonly aliases: readonly string[];
}

const isInt = (n: unknown): n is number => Number.isInteger(n);

/**
 * Every way `entry` disagrees with `module` or with the vocabularies, as messages; empty when it is consistent.
 * Checks: the id; the players against `seatRange(defaultRules())`; the best counts within them; the play time;
 * weight and luck in range; the vocabularies; `hiddenInfo` exactly when the game has a deck; `randomness` exactly
 * when it has a deck or rolls dice (`rolls`); and BoardGameGeek ids (its own and `compareTo`'s) positive integers,
 * with a `compareTo` title.
 */
export function catalogProblems(
  entry: CatalogEntry,
  // biome-ignore lint/suspicious/noExplicitAny: any game's module.
  module: GameModule<any, any, any>,
): string[] {
  const out: string[] = [];
  const rules = module.defaultRules();
  const range = module.seatRange(rules);
  if (entry.id !== module.id) out.push(`id ${entry.id} is not the module id ${module.id}`);
  const p = entry.players;
  if (p.min !== range.min || p.max !== range.max)
    out.push(`players ${p.min}-${p.max} differ from the seat range ${range.min}-${range.max}`);
  if (p.best.length === 0 || !p.best.every((n) => isInt(n) && n >= p.min && n <= p.max))
    out.push('best player counts must be within the seat range');
  const t = entry.playMinutes;
  if (!isInt(t.min) || !isInt(t.max) || t.min <= 0 || t.min > t.max)
    out.push('play minutes must be min <= max');
  if (!(entry.weight >= 1 && entry.weight <= 5)) out.push('weight must be within 1-5');
  if (!isInt(entry.luck) || entry.luck < 0 || entry.luck > 5) out.push('luck must be an integer 0-5');
  if (!GENRES.includes(entry.genre)) out.push(`unknown genre ${entry.genre}`);
  for (const m of entry.mechanisms) if (!MECHANISMS.includes(m)) out.push(`unknown mechanism ${m}`);
  if (entry.mechanisms.length === 0) out.push('at least one mechanism');
  for (const m of entry.modes) if (!MODES.includes(m)) out.push(`unknown mode ${m}`);
  if (entry.modes.length === 0) out.push('at least one mode');
  if (entry.modes.includes('solo') !== p.min <= 1) out.push('solo mode exactly when one player may play');
  if (!TURNS.includes(entry.turn)) out.push(`unknown turn structure ${entry.turn}`);
  if (!STATUSES.includes(entry.status)) out.push(`unknown status ${entry.status}`);
  const hasDeck = module.decks(rules).length > 0;
  const rollsDice = typeof module.rolls === 'function';
  if (entry.hiddenInfo !== hasDeck)
    out.push(`hiddenInfo must be ${hasDeck}: the game ${hasDeck ? 'has' : 'has no'} deck`);
  const chance = hasDeck || rollsDice;
  if (entry.randomness !== chance)
    out.push(`randomness must be ${chance}: chance comes from a deck or from dice`);
  if (entry.tags.some((tag) => tag !== tag.toLowerCase() || tag.trim() === ''))
    out.push('tags are non-empty and lower case');
  const bggOk = (n: number): boolean => isInt(n) && n > 0;
  if (entry.bggId !== null && !bggOk(entry.bggId)) out.push('bggId must be a positive integer or null');
  const c = entry.compareTo;
  if (c !== null && (c.title.trim() === '' || !bggOk(c.bggId)))
    out.push('compareTo needs a title and a positive integer bggId');
  return out;
}
