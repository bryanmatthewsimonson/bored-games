import { describe, expect, it } from 'vitest';
import { type CatalogEntry, catalogProblems, GENRES, MECHANISMS, MODES } from '../src/index.ts';
import { createToy } from './toy.ts';

const toy = createToy();

const ENTRY: CatalogEntry = {
  id: 'toy',
  bggId: null,
  compareTo: null,
  year: null,
  status: 'experimental',
  players: { min: 2, max: 4, best: [3] },
  playMinutes: { min: 5, max: 10 },
  typicalTurns: 6,
  weight: 1.2,
  luck: 3,
  genre: 'card',
  mechanisms: ['hand-management'],
  modes: ['competitive'],
  turn: 'sequential',
  hiddenInfo: true,
  randomness: true,
  tags: ['cards'],
  minAge: null,
  art: null,
};

describe('catalogProblems', () => {
  it('accepts an entry that agrees with its module', () => {
    expect(catalogProblems(ENTRY, toy)).toEqual([]);
    const linked = { ...ENTRY, bggId: 12, compareTo: { title: 'Other Game', bggId: 3 } };
    expect(catalogProblems(linked, toy)).toEqual([]);
  });

  it('has the documented vocabularies', () => {
    expect(GENRES).toHaveLength(8);
    expect(MECHANISMS).toHaveLength(20);
    expect(new Set(MECHANISMS).size).toBe(20);
    expect(MODES).toEqual(['competitive', 'team', 'cooperative', 'solo']);
  });

  it.each<[string, Partial<CatalogEntry>]>([
    ['another id', { id: 'other' }],
    ['players off the seat range', { players: { min: 2, max: 5, best: [3] } }],
    ['a best count outside the range', { players: { min: 2, max: 4, best: [5] } }],
    ['no best count', { players: { min: 2, max: 4, best: [] } }],
    ['reversed minutes', { playMinutes: { min: 20, max: 10 } }],
    ['weight 0', { weight: 0 }],
    ['luck 6', { luck: 6 as 5 }],
    ['an unknown genre', { genre: 'sports' as 'card' }],
    ['an unknown mechanism', { mechanisms: ['juggling' as 'market'] }],
    ['no mode', { modes: [] }],
    ['solo for a game of 2 or more', { modes: ['solo', 'competitive'] }],
    ['perfect information with a deck', { hiddenInfo: false, randomness: false }],
    ['an upper-case tag', { tags: ['Cards'] }],
    ['a bggId of 0', { bggId: 0 }],
    ['a fractional bggId', { bggId: 1.5 }],
    ['a compareTo without a title', { compareTo: { title: ' ', bggId: 3 } }],
    ['a compareTo with a bad bggId', { compareTo: { title: 'Other Game', bggId: -1 } }],
  ])('rejects %s', (_label, change) => {
    expect(catalogProblems({ ...ENTRY, ...change }, toy)).not.toEqual([]);
  });

  it('requires perfect information and no chance from a deckless game', () => {
    const deckless = { ...toy, decks: () => [] };
    expect(catalogProblems(ENTRY, deckless)).toHaveLength(1);
    expect(catalogProblems({ ...ENTRY, hiddenInfo: false, randomness: false }, deckless)).toEqual([]);
    // Either flag alone is enough for a game with a deck.
    expect(catalogProblems({ ...ENTRY, randomness: false }, toy)).toEqual([]);
  });
});
