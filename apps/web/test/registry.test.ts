/*
 * The web game registry (D045): every hosted game has a rules module, a registry entry and an id, and they agree.
 */
import { BANK_THEME } from '@bored-games/bank/theme';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { CHESS_THEME } from '@bored-games/chess/theme';
import { describe, expect, it } from 'vitest';
import { GAME_METAS, gameTitle } from '../src/game-names.ts';
import { DEFAULT_GAME, GAME_IDS } from '../src/games/ids.ts';
import { GAMES, pickerGames, webGame } from '../src/games/registry.ts';
import { rulesGame } from '../src/header.tsx';
import { MODULES } from '../src/net.ts';
import { activeGame, route } from '../src/router.ts';

describe('game registry', () => {
  it('has one entry per id, each with a rules module, a component, a rules page and names', () => {
    expect(GAMES.map((g) => g.id)).toEqual([...GAME_IDS]);
    expect([...MODULES.keys()].sort()).toEqual([...GAME_IDS].sort());
    expect([...GAME_METAS.keys()].sort()).toEqual([...GAME_IDS].sort());
    expect(GAME_IDS).toContain(DEFAULT_GAME);
    for (const g of GAMES) {
      expect(webGame(g.id)).toBe(g);
      expect(typeof g.Component).toBe('function');
      expect(typeof g.RulesPage).toBe('function');
      expect(g.title()).not.toBe('');
      expect(g.tagline()).not.toBe('');
    }
    expect(webGame('go')).toBeUndefined();
    expect(pickerGames().map((g) => g.id)).toEqual([...GAME_IDS]);
  });

  it('takes titles from the themes', () => {
    expect(gameTitle('chain-reaction')).toBe(CHAIN_REACTION_THEME.title);
    expect(gameTitle('chess')).toBe(CHESS_THEME.title);
    expect(gameTitle('bank')).toBe(BANK_THEME.title);
    expect(gameTitle('unknown-game')).toBe('unknown-game');
  });

  it('gives setup copy only to a game with a deck', () => {
    expect(webGame('chain-reaction')?.setupCopy(true)).toEqual({
      shuffling: 'Shuffling the deck',
      dealing: 'Dealing the tiles…',
    });
    expect(webGame('chain-reaction')?.setupCopy(false)).toBeNull();
    expect(webGame('chess')?.setupCopy(false)).toBeNull();
    expect(webGame('bank')?.setupCopy(false)).toBeNull();
    // The module agrees: Chess and Bank are deckless, Chain Reaction has one deck.
    expect(MODULES.get('chess')?.decks(MODULES.get('chess')?.defaultRules())).toEqual([]);
    expect(MODULES.get('bank')?.decks(MODULES.get('bank')?.defaultRules())).toEqual([]);
    expect(MODULES.get('chain-reaction')?.decks(MODULES.get('chain-reaction')?.defaultRules())).toHaveLength(
      1,
    );
  });

  it("points the header's Rules link at the rules page's game, the open game's, or the default", () => {
    route.value = { name: 'home' };
    activeGame.value = null;
    expect(rulesGame()).toBe(DEFAULT_GAME);
    activeGame.value = 'chess';
    expect(rulesGame()).toBe('chess');
    route.value = { name: 'rules', game: 'chain-reaction', section: null };
    expect(rulesGame()).toBe('chain-reaction');
    activeGame.value = null;
    route.value = { name: 'home' };
  });
});
