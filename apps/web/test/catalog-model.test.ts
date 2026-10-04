/*
 * The catalog's filters and search (D046), on the real entries and on made-up ones at the edges of each bucket.
 */
import type { CatalogEntry } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  bestText,
  bggUrl,
  type CatalogFilters,
  type CatalogItem,
  compareText,
  complexityOf,
  complexityText,
  filterCatalog,
  fitsLength,
  fitsPlayers,
  genresIn,
  luckText,
  matchesQuery,
  mechanismLabel,
  NO_FILTERS,
  normalize,
  parseFilters,
  playerChipLabel,
  playersText,
  resultCountText,
  tileHue,
  tileInitials,
  timeText,
} from '../src/catalog-model.ts';
import { catalogItems } from '../src/components/game-catalog.tsx';
import { CATALOG } from '../src/games/catalog.ts';

const items = catalogItems();
const ids = (f: Partial<CatalogFilters>): string[] =>
  filterCatalog(items, { ...NO_FILTERS, ...f }).map((i) => i.entry.id);

const base = CATALOG.get('chess')?.entry as CatalogEntry;
const made = (change: Partial<CatalogEntry>, title = 'Made Up'): CatalogItem => ({
  entry: { ...base, id: 'made-up', ...change },
  names: { id: 'safe', gameTitle: title, tagline: 't', summary: 's', aliases: ['Other Name'] },
});

describe('catalog filters', () => {
  it('lists every hosted game with no filter, in catalog order', () => {
    expect(ids({})).toEqual(items.map((item) => item.entry.id));
    expect(ids({})).toContain('luster');
    expect(activeFilters(NO_FILTERS)).toBe(0);
  });

  it('filters by player count, 6 meaning 6 or more', () => {
    expect(ids({ players: 1 })).toEqual([]);
    expect(ids({ players: 2 })).toEqual(['chess', 'bank', 'luster']);
    expect(ids({ players: 3 })).toEqual(['chain-reaction', 'bank', 'luster']);
    expect(ids({ players: 6 })).toEqual(['chain-reaction', 'bank']);
    expect(fitsPlayers(made({ players: { min: 2, max: 8, best: [4] } }).entry, 6)).toBe(true);
    expect(fitsPlayers(made({ players: { min: 7, max: 10, best: [8] } }).entry, 6)).toBe(true);
    expect(fitsPlayers(made({ players: { min: 7, max: 10, best: [8] } }).entry, 5)).toBe(false);
    expect(playerChipLabel(6)).toBe('6+');
    expect(playerChipLabel(1)).toBe('1');
  });

  it('filters by genre, mode, length and complexity', () => {
    expect(ids({ genre: 'abstract' })).toEqual(['chess']);
    expect(ids({ genre: 'economic' })).toEqual(['chain-reaction']);
    expect(ids({ genre: 'party' })).toEqual(['bank']);
    expect(ids({ genre: 'family' })).toEqual(['luster']);
    expect(ids({ mode: 'competitive' })).toEqual(['chain-reaction', 'chess', 'bank', 'luster']);
    expect(ids({ mode: 'cooperative' })).toEqual([]);
    expect(ids({ mode: 'solo' })).toEqual([]);
    expect(ids({ length: 'under-30' })).toEqual(['chess', 'bank']);
    expect(ids({ length: '60-120' })).toEqual(['chain-reaction', 'chess']);
    expect(ids({ length: 'over-120' })).toEqual([]);
    expect(ids({ complexity: 'medium' })).toEqual(['chain-reaction']);
    expect(ids({ complexity: 'heavy' })).toEqual(['chess']);
    expect(ids({ complexity: 'light' })).toEqual(['bank', 'luster']);
    expect(ids({ players: 2, genre: 'economic' })).toEqual([]);
    expect(activeFilters({ ...NO_FILTERS, players: 2, mode: 'team' })).toBe(2);
  });

  it('puts each length and weight in the right bucket at the edges', () => {
    const at = (min: number, max: number) => made({ playMinutes: { min, max } }).entry;
    expect(fitsLength(at(29, 29), 'under-30')).toBe(true);
    expect(fitsLength(at(30, 30), 'under-30')).toBe(false);
    expect(fitsLength(at(30, 30), '30-60')).toBe(true);
    expect(fitsLength(at(60, 60), '30-60')).toBe(true);
    expect(fitsLength(at(61, 90), '30-60')).toBe(false);
    expect(fitsLength(at(120, 120), '60-120')).toBe(true);
    expect(fitsLength(at(120, 120), 'over-120')).toBe(false);
    expect(fitsLength(at(90, 180), 'over-120')).toBe(true);
    expect([1, 1.99, 2, 2.99, 3, 5].map(complexityOf)).toEqual([
      'light',
      'light',
      'medium',
      'medium',
      'heavy',
      'heavy',
    ]);
  });

  it('offers only the genres some game has', () => {
    expect(genresIn(items, ['abstract', 'party', 'economic'])).toEqual(['abstract', 'party', 'economic']);
  });
});

describe('catalog search', () => {
  it('matches names, tags and mechanisms, case-insensitively and word by word', () => {
    expect(ids({ query: 'chess' })).toEqual(['chess']);
    expect(ids({ query: 'CHAIN' })).toEqual(['chain-reaction']);
    expect(ids({ query: 'mergers' })).toEqual(['chain-reaction']);
    expect(ids({ query: 'tile placement' })).toEqual(['chain-reaction']);
    expect(ids({ query: 'tile-placement' })).toEqual(['chain-reaction']);
    expect(ids({ query: 'capture' })).toEqual(['chess']);
    expect(ids({ query: 'classic' })).toEqual(['chain-reaction', 'chess']);
    expect(ids({ query: 'luster' })).toEqual(['luster']);
    expect(ids({ query: 'emeralds' })).toEqual(['luster']);
    expect(ids({ query: '  ' })).toEqual(items.map((item) => item.entry.id));
    expect(ids({ query: 'chess mergers' })).toEqual([]);
    expect(ids({ query: 'zzz' })).toEqual([]);
  });

  it('matches aliases', () => {
    expect(matchesQuery(made({}), 'other name')).toBe(true);
    expect(matchesQuery(made({}), 'made')).toBe(true);
    expect(matchesQuery(made({}), 'missing')).toBe(false);
    expect(normalize('  Tile-Placement  x ')).toBe('tile placement x');
  });

  it('matches the title of the game a game compares to (D053, D060), and only for that game', () => {
    for (const id of ['chain-reaction', 'luster']) {
      const compare = CATALOG.get(id)?.entry.compareTo;
      if (compare == null) throw new Error(`${id} compares to a published game`);
      expect(ids({ query: compare.title })).toEqual([id]);
      expect(ids({ query: compare.title.toUpperCase() })).toEqual([id]);
      expect(matchesQuery(made({ compareTo: null }), compare.title)).toBe(false);
    }
    expect(matchesQuery(made({ compareTo: { title: 'Elder Game', bggId: 9 } }), 'elder')).toBe(true);
  });

  it('combines search and filters', () => {
    expect(ids({ query: 'classic', players: 2 })).toEqual(['chess']);
  });
});

describe('catalog words', () => {
  it('describes players, time, complexity and luck', () => {
    const cr = CATALOG.get('chain-reaction')?.entry as CatalogEntry;
    expect(playersText(cr)).toBe('3–6 players');
    expect(playersText(base)).toBe('2 players');
    expect(playersText(made({ players: { min: 1, max: 1, best: [1] } }).entry)).toBe('1 player');
    expect(bestText(cr)).toBe('Best with 4–5');
    expect(bestText(made({ players: { min: 2, max: 6, best: [5, 3] } }).entry)).toBe('Best with 3 or 5');
    expect(timeText(cr)).toBe('90 min');
    expect(timeText(base)).toBe('10–120 min');
    expect(complexityText(cr)).toBe('Medium, 2.5 of 5');
    expect(complexityText(base)).toBe('Heavy, 3.6 of 5');
    expect(luckText(cr)).toBe('Some (2 of 5)');
    expect(luckText(base)).toBe('None');
    expect(mechanismLabel('capture-elimination')).toBe('Capture elimination');
  });

  it('links to BoardGameGeek by id and says "Compare to" the title', () => {
    expect(bggUrl(171)).toBe('https://boardgamegeek.com/boardgame/171');
    expect(compareText({ title: 'Elder Game', bggId: 9 })).toBe('Compare to Elder Game');
  });

  it('counts results for the live region', () => {
    expect(resultCountText(2, 2)).toBe('2 games');
    expect(resultCountText(1, 2)).toBe('1 of 2 games');
    expect(resultCountText(1, 1)).toBe('1 game');
    expect(resultCountText(0, 2)).toBe('No game matches');
  });

  it('generates a stable tile per game', () => {
    expect(tileInitials('Chain Reaction')).toBe('CR');
    expect(tileInitials('Chess')).toBe('C');
    expect(tileHue('chess')).toBe(tileHue('chess'));
    expect(tileHue('chess')).not.toBe(tileHue('chain-reaction'));
    expect(tileHue('chess')).toBeGreaterThanOrEqual(0);
    expect(tileHue('chess')).toBeLessThan(360);
  });
});

describe('stored filters', () => {
  it('round-trips valid filters and drops anything invalid', () => {
    const f: CatalogFilters = {
      query: 'chess',
      players: 6,
      genre: 'abstract',
      mode: 'team',
      length: 'over-120',
      complexity: 'heavy',
    };
    expect(parseFilters(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(parseFilters(null)).toEqual(NO_FILTERS);
    expect(parseFilters('x')).toEqual(NO_FILTERS);
    expect(
      parseFilters({ query: 7, players: 9, genre: 'sports', mode: 'co-op', length: '5', complexity: 'x' }),
    ).toEqual(NO_FILTERS);
    expect(parseFilters({ query: 'a'.repeat(500) }).query).toHaveLength(100);
  });
});
