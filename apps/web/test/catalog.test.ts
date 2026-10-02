/*
 * The game catalog (D046): every registered rules module has a catalog entry that agrees with it (seat range,
 * deck and hidden information) and a trademark-safe brand pack.
 */
import { COMPARE_PHRASE, COMPARE_TITLE } from '@bored-games/chain-reaction/compare';
import { catalogProblems } from '@bored-games/game-kit';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { catalogItems, GameCard } from '../src/components/game-catalog.tsx';
import { CATALOG } from '../src/games/catalog.ts';
import { GAME_IDS } from '../src/games/ids.ts';
import { MODULES } from '../src/net.ts';
import { renderTree, spokenText } from './render-tree.ts';

describe('game catalog', () => {
  it('has one entry per hosted game, in picker order', () => {
    expect([...CATALOG.keys()]).toEqual([...GAME_IDS]);
    expect([...MODULES.keys()].sort()).toEqual([...CATALOG.keys()].sort());
  });

  for (const [id, module] of MODULES) {
    it(`${id}: the entry agrees with the rules module`, () => {
      const g = CATALOG.get(id);
      expect(g, `no catalog entry for ${id}`).toBeDefined();
      if (g === undefined) return;
      expect(catalogProblems(g.entry, module)).toEqual([]);
      const range = module.seatRange(module.defaultRules());
      expect([g.entry.players.min, g.entry.players.max]).toEqual([range.min, range.max]);
      expect(g.entry.hiddenInfo || g.entry.randomness).toBe(module.decks(module.defaultRules()).length > 0);
    });

    it(`${id}: has trademark-safe names`, () => {
      const safe = CATALOG.get(id)?.safe;
      expect(safe?.id).toBe('safe');
      expect(safe?.gameTitle).not.toBe('');
      expect(safe?.tagline).not.toBe('');
      expect(safe?.summary.length).toBeGreaterThan(40);
    });
  }

  it('records the agreed facts for Chain Reaction and Chess', () => {
    const cr = CATALOG.get('chain-reaction')?.entry;
    expect(cr).toMatchObject({
      players: { min: 3, max: 6, best: [4, 5] },
      playMinutes: { min: 90, max: 90 },
      weight: 2.5,
      luck: 2,
      genre: 'economic',
      mechanisms: ['tile-placement', 'stock-holding', 'hand-management', 'market'],
      modes: ['competitive'],
      hiddenInfo: true,
      randomness: true,
    });
    // No BoardGameGeek entry of its own: "Compare to" the published game instead (D053), title cut from the phrase.
    expect(cr?.bggId).toBeNull();
    expect(cr?.compareTo).toEqual({ title: COMPARE_TITLE, bggId: 5 });
    expect(`Compare to ${cr?.compareTo?.title}`).toBe(COMPARE_PHRASE);
    const chess = CATALOG.get('chess')?.entry;
    expect(chess?.bggId).toBe(171);
    expect(chess?.compareTo).toBeNull();
    expect(chess).toMatchObject({
      players: { min: 2, max: 2 },
      playMinutes: { min: 10, max: 120 },
      weight: 3.6,
      luck: 0,
      genre: 'abstract',
      mechanisms: ['grid-movement', 'capture-elimination'],
      hiddenInfo: false,
      randomness: false,
    });
  });

  it('shows "Compare to" on the card of a game that compares to another, and only there', () => {
    const card = (id: string): string => {
      const item = catalogItems().find((i) => i.entry.id === id);
      if (item === undefined) throw new Error(id);
      return spokenText(renderTree(h(GameCard, { item })));
    };
    expect(card('chain-reaction')).toContain(COMPARE_PHRASE);
    expect(card('chess')).not.toContain('Compare to');
  });
});
