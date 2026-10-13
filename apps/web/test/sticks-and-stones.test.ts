/*
 * The Sticks & Stones game screen (D089), without a browser: the decisions of the moment for each stage, the status
 * and log lines, the camp's spots, and the privacy of a face-down discovery. States come from the engine's own test
 * helpers, so every case is a position the rules can reach.
 */
import { type SticksAction, sticksAndStones } from '@bored-games/sticks-and-stones';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import {
  act,
  huntRound,
  legal,
  orderWith,
  placeAll,
  rollWith,
  started,
  withClan,
} from '../../../packages/games/sticks-and-stones/test/helpers.ts';
import { DUPLICATES_CHOICES } from '../src/components/new-table-form.tsx';
import { webGame } from '../src/games/registry.ts';
import {
  STICKS_SETUP_COPY,
  SticksGame,
  SticksTable,
  type TableProps,
} from '../src/games/sticks-and-stones/game.tsx';
import { choicesOf, logLine, playerRows, statusLine } from '../src/games/sticks-and-stones/model.ts';
import { SticksRulesPage } from '../src/games/sticks-and-stones/rules-page.tsx';
import { findAll, renderTree, textOf } from './render-tree.ts';

const NAMES = ['Ada', 'Bo', 'Cy'];
type S = ReturnType<typeof started>;

const table = (s: S, me: number | null, extra: Partial<TableProps> = {}) =>
  renderTree(
    h(SticksTable, {
      state: s,
      me,
      names: NAMES,
      avatars: [],
      legal: me === null ? [] : (legal(s, me) as SticksAction[]),
      enabled: true,
      selected: null,
      pays: {},
      ticked: { tools: [], spares: [] },
      events: [],
      ended: false,
      onSelect: () => {},
      onPay: () => {},
      onTick: () => {},
      onSend: () => {},
      ...extra,
    }),
  );
const actions = (tree: ReturnType<typeof renderTree>) =>
  findAll(tree, (el) => el.tag === 'button' && el.attrs['data-action'] !== undefined).map((b) =>
    JSON.parse(String(b.attrs['data-action'])),
  );

describe('the decisions of the moment', () => {
  it('placing: one click on a spot with one count, a count to choose on the hunt and the grounds', () => {
    const s = started(3);
    const c = choicesOf(legal(s, 0));
    expect(c.places.get('hunt')).toEqual([1, 2, 3, 4, 5]);
    expect(c.places.get('hut')).toEqual([2]);
    expect(statusLine(s, NAMES, 0)).toBe('Round 1: You send people out.');
    expect(statusLine(s, NAMES, 1)).toBe('Round 1: Ada sends people out.');
    const spots = findAll(table(s, 0), (el) => el.attrs['data-spot'] !== undefined);
    // The eight camp spots, four discoveries and three monument sites.
    expect(spots).toHaveLength(15);
    expect(spots.filter((el) => el.attrs.tabindex === 0)).toHaveLength(15);
    expect(
      findAll(table(s, 1), (el) => el.attrs.tabindex === 0 && el.attrs['data-spot'] !== undefined),
    ).toHaveLength(0);
    const counts = actions(table(s, 0, { selected: 'wood' }));
    expect(counts).toEqual([1, 2, 3, 4, 5].map((n) => ({ type: 'place', actor: 0, spot: 'wood', count: n })));
  });

  it('resolving: a roll per ground, a payment or a pass for a card and a monument', () => {
    const s = withClan(
      placeAll(started(2, orderWith([24])), [
        [0, 'card2'],
        [1, 'hunt', 5],
        [0, 'stack0'],
        [0, 'wood', 3],
      ]),
      0,
      (c) => ({ ...c, goods: [2, 1, 1, 0] }),
    );
    const sent = actions(table(s, 0));
    expect(sent).toContainEqual({ type: 'use', actor: 0, spot: 'wood' });
    expect(sent).toContainEqual({ type: 'skip', actor: 0, spot: 'card2' });
    expect(sent).toContainEqual({ type: 'skip', actor: 0, spot: 'stack0' });
    // The cheapest payment is offered first for a card; the monument's only price for a fixed one.
    expect(sent.find((a) => a.type === 'buy')).toEqual({ type: 'buy', actor: 0, slot: 2, pay: [2, 1, 0, 0] });
    expect(sent.find((a) => a.type === 'build')).toEqual({
      type: 'build',
      actor: 0,
      stack: 0,
      pay: [2, 1, 0, 0],
    });
    expect(statusLine(s, NAMES, 0)).toBe('Round 1: You bring the people home.');
  });

  it('tools: the dice, the tools to tick and the yield', () => {
    const base = withClan(
      placeAll(started(2), [
        [0, 'wood', 2],
        [1, 'hunt', 5],
        [0, 'hunt', 3],
      ]),
      0,
      (c) => ({ ...c, tools: [2], used: [false] }),
    );
    const s = rollWith(act(base, { type: 'use', actor: 0, spot: 'wood' }), [2, 3]);
    expect(s.stage).toBe('tools');
    expect(actions(table(s, 0))).toEqual([{ type: 'tools', actor: 0, tools: [], spares: [] }]);
    expect(textOf(table(s, 0))).toMatch(/=\s+5\s+→\s+1\s+wood/);
    const ticked = table(s, 0, { ticked: { tools: [0], spares: [] } });
    expect(actions(ticked)).toEqual([{ type: 'tools', actor: 0, tools: [0], spares: [] }]);
    expect(textOf(ticked)).toMatch(/Add 2 and take 2/);
  });

  it('feeding: the shortfall in goods, or going hungry', () => {
    const s = huntRound(withClan(started(2), 0, (c) => ({ ...c, food: 0, goods: [2, 1, 0, 0] })));
    expect(s.stage).toBe('feed');
    expect(actions(table(s, 0))).toEqual([
      { type: 'feed', actor: 0, pay: [2, 1, 0, 0] },
      { type: 'feed', actor: 0, pay: null },
    ]);
    expect(textOf(table(s, 0))).toMatch(/lacks\s+3\s+food/);
  });

  it('a gift of the dice: one button per face, with what it gives', () => {
    const s = withClan(
      placeAll(started(2, orderWith([24, 1])), [
        [0, 'card1'],
        [1, 'hunt', 5],
        [0, 'hunt', 4],
      ]),
      0,
      (c) => ({ ...c, goods: [2, 0, 0, 0] }),
    );
    const g = rollWith(act(s, { type: 'buy', actor: 0, slot: 1, pay: [2, 0, 0, 0] }), [6, 1]);
    expect(actions(table(g, 0))).toEqual([
      { type: 'pick', actor: 0, face: 1 },
      { type: 'pick', actor: 0, face: 6 },
    ]);
    expect(textOf(table(g, 0))).toMatch(/a harvest step/);
    expect(statusLine(g, NAMES, 1)).toBe('Gifts of the dice: Ada takes a die.');
  });
});

describe('the clans and the log', () => {
  it('counts each clan and writes moves in plain words', () => {
    const s = started(3);
    const rows = playerRows(s, NAMES);
    expect(rows.map((r) => [r.people, r.food, r.home, r.standing])).toEqual([
      [5, 12, 5, 0],
      [5, 12, 5, 0],
      [5, 12, 5, 0],
    ]);
    expect(logLine({ type: 'placed', seat: 1, spot: 'gold', count: 2 }, NAMES)).toBe(
      'Bo sends 2 to Amber Creek.',
    );
    expect(
      logLine(
        { type: 'gathered', seat: 0, spot: 'hunt', good: -1, dice: [3, 4], bonus: 1, amount: 4 },
        NAMES,
      ),
    ).toBe('Ada rolls 3+4 +1 in tools: 4 food.');
    expect(logLine({ type: 'fed', seat: 2, food: 3, goods: 0, hungry: true }, NAMES)).toBe(
      'Cy went hungry: −10 points.',
    );
    expect(logLine({ type: 'bought', seat: 0, card: 4, slot: 3 }, NAMES)).toBe(
      'Ada takes a discovery: Pottery, with 7 food.',
    );
  });

  it('shows a face-down discovery to its owner alone', () => {
    const s0 = withClan(
      placeAll(started(2, orderWith([24, 0])), [
        [0, 'card1'],
        [1, 'hunt', 5],
        [0, 'hunt', 4],
      ]),
      0,
      (c) => ({ ...c, goods: [2, 0, 0, 0] }),
    );
    const s = act(s0, { type: 'buy', actor: 0, slot: 1, pay: [2, 0, 0, 0] });
    const hidden = s.clans[0]?.hidden[0];
    expect(hidden?.card).toBe(3);
    const mine = textOf(table(sticksAndStones.view(s, 0), 0));
    expect(mine).toMatch(/Face down: only you see it/);
    const theirs = table(sticksAndStones.view(s, 1), 1);
    expect(textOf(theirs)).toMatch(/\+ 1 face down/);
    const labels = (tree: ReturnType<typeof renderTree>) =>
      findAll(tree, (el) => el.tag === 'svg').map((el) => String(el.attrs['aria-label'] ?? ''));
    expect(labels(table(sticksAndStones.view(s, 0), 0)).some((l) => /two goods of your choice/.test(l))).toBe(
      true,
    );
    expect(labels(theirs).some((l) => /two goods of your choice/.test(l))).toBe(false);
    expect(
      labels(table(sticksAndStones.view(s, null), null)).some((l) => /two goods of your choice/.test(l)),
    ).toBe(false);
  });
});

describe('registration', () => {
  it('registers the game, its rules page, its setup copy and its table option', () => {
    const game = webGame('sticks-and-stones');
    expect(game?.Component).toBe(SticksGame);
    expect(game?.RulesPage).toBe(SticksRulesPage);
    expect(game?.setupCopy(true)).toEqual(STICKS_SETUP_COPY);
    expect(DUPLICATES_CHOICES.map((c) => c.value)).toEqual(['squared', 'ones']);
    for (const c of DUPLICATES_CHOICES)
      expect(sticksAndStones.validateRules({ duplicates: c.value }).ok).toBe(true);
  });
});
