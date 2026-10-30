/*
 * The Spread Thin game screen (D096), without a browser: the tracks, the chart with its targets, a move picked on the
 * chart, the open hands, the history, a relief window and the result; the rules page and the registration. States
 * come from the engine with a known deck, so every case is a reachable position.
 */

import { createRng, packetOrder } from '@bored-games/game-kit';
import {
  DECK_ID,
  DEFAULT_RULES,
  deckOf,
  legalActions,
  pendingOf,
  type SpreadAction,
  type SpreadState,
  spreadThin,
} from '@bored-games/spread-thin';
import { CITY_POINTS } from '@bored-games/spread-thin/atlas';
import { COMPARE_PHRASE } from '@bored-games/spread-thin/compare';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { webGame } from '../src/games/registry.ts';
import { SpreadCover } from '../src/games/spread-thin/art.tsx';
import {
  EMPTY_UI,
  SPREAD_SETUP_COPY,
  SpreadTable,
  SpreadThinGame,
  type Ui,
} from '../src/games/spread-thin/game.tsx';
import { logLine, statusLine } from '../src/games/spread-thin/model.ts';
import { SpreadRulesContent, SpreadThinRulesPage } from '../src/games/spread-thin/rules-page.tsx';
import { findAll, renderTree, textOf } from './render-tree.ts';

const NAMES = ['Ada', 'Bo'];

function applied(s: SpreadState, a: unknown): SpreadState {
  const r = spreadThin.apply(s, a);
  if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error.message}`);
  return r.state;
}

/** Every pending reveal, from the full state's order. */
function settle(s0: SpreadState): SpreadState {
  let s = s0;
  for (let p = pendingOf(s); p.type === 'reveal'; p = pendingOf(s))
    for (const pos of p.positions)
      s = applied(s, { type: 'reveal', actor: 'deck', deck: DECK_ID, pos, card: s.plain?.[String(pos)] });
  return s;
}

function started(): SpreadState {
  const order = packetOrder(deckOf(DEFAULT_RULES, 2), createRng('screen'));
  const r = spreadThin.setup({
    rules: DEFAULT_RULES,
    seats: 2,
    mode: 'full',
    deckOrders: { [DECK_ID]: order },
  });
  if (!r.ok) throw new Error(r.error.message);
  return settle(r.value);
}

const table = (s: SpreadState, me: number | null, ui: Partial<Ui> = {}) =>
  renderTree(
    h(SpreadTable, {
      state: s,
      me,
      names: NAMES,
      avatars: [],
      legal: me === null ? [] : (legalActions(s, me) as SpreadAction[]),
      enabled: true,
      ui: { ...EMPTY_UI, ...ui },
      onUi: () => {},
      onSend: () => {},
    }),
  );

describe('the table', () => {
  it('shows the tracks, the chart with its 48 cities, and every open hand', () => {
    const s = started();
    const tree = table(s, s.turn);
    const text = textOf(tree);
    expect(text).toContain('Spread rate');
    expect(text).toContain('Spillovers');
    expect(findAll(tree, (el) => el.attrs['data-city'] !== undefined)).toHaveLength(CITY_POINTS.length);
    for (const seat of [0, 1]) expect(text).toContain(NAMES[seat] as string);
    // Both hands are on the table for everyone, a spectator included.
    const cards = findAll(table(s, null), (el) =>
      / (city|relief) card$/.test(String(el.attrs['aria-label'] ?? '')),
    );
    expect(cards).toHaveLength(8);
    expect(statusLine(s, NAMES, s.turn)).toBe('Your turn: 4 actions left.');
  });

  it('offers the reachable cities on the chart, then the ways to reach the one picked', () => {
    const s = started();
    const targets = findAll(
      table(s, s.turn),
      (el) => el.attrs.role === 'button' && el.attrs['data-city'] !== undefined,
    );
    expect(targets.length).toBeGreaterThanOrEqual(3);
    const to = Number(targets[0]?.attrs['data-city']);
    const moves = findAll(table(s, s.turn, { city: to }), (el) => el.attrs['data-testid'] === 'st-move');
    expect(moves.length).toBeGreaterThan(0);
    // Out of turn, the chart offers nothing.
    expect(
      findAll(
        table(s, 1 - s.turn),
        (el) => el.attrs.role === 'button' && el.attrs['data-city'] !== undefined,
      ),
    ).toEqual([]);
  });

  it('writes the history in words and shows the result', () => {
    let s = applied(started(), { type: 'end', actor: started().turn });
    s = settle(s);
    const lines = s.history.map((e) => logLine(e, s, NAMES));
    expect(lines[0]).toMatch(/^Roles dealt: /);
    expect(lines.some((l) => l.includes('drew'))).toBe(true);
    const over: SpreadState = {
      ...s,
      phase: 'over',
      result: { places: [1, 1], scores: [0, 0], reason: 'spillovers' },
    };
    expect(textOf(table(over, 0))).toContain('The team loses.');
    expect(statusLine(over, NAMES, 0)).toBe('Defeat: the eighth spillover.');
  });
});

describe('the art, the rules page and the registration', () => {
  it('draws the cover and the thumbnail', () => {
    for (const thumb of [false, true]) {
      const tree = renderTree(h(SpreadCover, { thumb }));
      expect(findAll(tree, (el) => el.tag === 'svg')[0]?.attrs['aria-label']).toMatch(/^Spread Thin artwork/);
    }
  });

  it('writes the rules with every role and relief card and the compare link', () => {
    const text = textOf(renderTree(h(SpreadRulesContent, {})));
    expect(text).toContain(COMPARE_PHRASE);
    for (const word of [
      'Archivist',
      'Coordinator',
      'Paramedic',
      'Engineer',
      'Warden',
      'Courier',
      'Virologist',
    ])
      expect(text).toContain(word);
    for (const word of ['Medevac', 'Early Warning', 'Field Permit', 'Lull', 'Herd Immunity'])
      expect(text).toContain(word);
    expect(text).toMatch(/Resign\s+is always open/);
  });

  it('registers the game, its setup copy and no automatic move', () => {
    const game = webGame('spread-thin');
    expect(game?.Component).toBe(SpreadThinGame);
    expect(game?.RulesPage).toBe(SpreadThinRulesPage);
    expect(game?.setupCopy(true)).toEqual(SPREAD_SETUP_COPY);
    expect(game?.autoMove).toBeUndefined();
  });
});
