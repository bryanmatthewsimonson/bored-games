/*
 * The Hazard game screen (D088), without a browser: the atlas geometry against the package's grid, the decisions of
 * the moment for each stage, the labels and the status line, and the privacy of a rendered hand. States come from
 * the engine's own test helpers, so every case is a position the rules can reach.
 */
import { ATLAS_LANES, ATLAS_ROWS, type HazardAction, hazard, LINKS, PROVINCES } from '@bored-games/hazard';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import {
  act,
  attacking,
  claimAll,
  contributeAndRoll,
  fresh,
  lastStand,
  legalActions,
  opened,
  orderRoll,
  revealCash,
  takeA2,
  withHand,
} from '../../../packages/games/hazard/test/helpers.ts';
import { DEFENSE_CHOICES } from '../src/components/new-table-form.tsx';
import { HAZARD_SETUP_COPY, HazardGame, HazardTable, type TableProps } from '../src/games/hazard/game.tsx';
import {
  ATLAS,
  attackDiceFor,
  cashGroups,
  choicesOf,
  logLine,
  mapMode,
  playerRows,
  provinceLabel,
  SEAT_LOOKS,
  selectionSurvives,
  statusLine,
} from '../src/games/hazard/model.ts';
import { HazardRulesPage } from '../src/games/hazard/rules-page.tsx';
import { webGame } from '../src/games/registry.ts';
import { findAll, renderTree, textOf } from './render-tree.ts';

const NAMES = ['Ada', 'Bo', 'Cy'];
const choices = (s: Parameters<typeof legalActions>[0], seat: number) =>
  choicesOf(legalActions(s, seat) as HazardAction[]);

describe('the atlas', () => {
  it('draws one hex per land cell, every border once, and the sixteen sea lanes', () => {
    const land = ATLAS_ROWS.join('').replaceAll('.', '').length;
    expect(ATLAS.hexes).toHaveLength(land);
    expect(new Set(ATLAS.hexes.map((h) => h.province)).size).toBe(42);
    expect(ATLAS.lanes).toHaveLength(ATLAS_LANES.length);
    expect(ATLAS.lanes.filter((l) => l.edge).map((l) => [l.a, l.b])).toEqual([['a1', 'e4']]);
    // Every land link has at least one drawn border; the coast closes every realm.
    expect(ATLAS.borders.length).toBeGreaterThanOrEqual(LINKS.length - ATLAS_LANES.length);
    expect(ATLAS.coasts.length).toBeGreaterThan(100);
    for (const p of PROVINCES) {
      const a = ATLAS.anchors[p];
      expect(a.cx).toBeGreaterThan(0);
      expect(a.cx).toBeLessThan(ATLAS.width);
      expect(a.cy).toBeLessThan(ATLAS.height);
    }
    expect(ATLAS.realmLabels).toHaveLength(6);
  });

  it('gives six seat colours, each with its own pattern', () => {
    expect(new Set(SEAT_LOOKS.map((l) => l.pattern)).size).toBe(6);
    expect(new Set(SEAT_LOOKS.map((l) => l.fill)).size).toBe(6);
  });
});

describe('the decisions of the moment', () => {
  it('the first-player roll, then claiming', () => {
    const s = fresh(3);
    expect(choices(s, 0).roll).toEqual({ type: 'roll', actor: 0 });
    expect(statusLine(s, NAMES, 0)).toMatch(/You to start the roll/);
    const c = orderRoll(s, [6, 2, 1]);
    const mode = mapMode(choices(c, 0), null);
    expect(mode.kind).toBe('claim');
    expect(mode.single).toHaveLength(42);
    expect(statusLine(c, NAMES, 0)).toBe('You claim an empty province.');
    expect(statusLine(c, NAMES, 1)).toBe('Ada claims an empty province.');
  });

  it('placing and mustering are one click on a highlighted province', () => {
    const p = claimAll(orderRoll(fresh(3), [6, 2, 1]));
    expect(mapMode(choices(p, p.turn), null).kind).toBe('place');
    const s = opened(3);
    const mode = mapMode(choices(s, 0), null);
    expect(mode.kind).toBe('muster');
    expect(mode.single).toContain('a1');
    expect(mode.single).not.toContain('a2');
    expect(statusLine(s, NAMES, 0)).toBe('Your muster: 4 troops to place.');
  });

  it('an attack is a province of yours, then a linked enemy, then the dice', () => {
    const s = attacking({ a1: [0, 5], e4: [1, 2], a2: [1, 1], a4: [0, 1] });
    const c = choices(s, 0);
    const first = mapMode(c, null);
    expect(first.kind).toBe('attack');
    expect(first.pick).toContain('a1');
    expect(first.pick).not.toContain('a4');
    const second = mapMode(c, 'a1');
    expect(second.target).toEqual(['a2', 'e4']);
    expect(attackDiceFor(c, 'a1', 'e4')).toEqual([1, 2, 3]);
    expect(c.endAttack).toEqual({ type: 'endAttack', actor: 0 });
  });

  it('the defender sees its choice; others see whose it is', () => {
    const s = act(attacking({ a1: [0, 6], a2: [1, 2] }), {
      type: 'attack',
      actor: 0,
      from: 'a1',
      to: 'a2',
      dice: 3,
    });
    expect(choices(s, 1).defends.map((a) => a.dice)).toEqual([1, 2]);
    expect(statusLine(s, NAMES, 1)).toBe('You defend Longwinter against 3 dice.');
    expect(statusLine(s, NAMES, 2)).toBe('Bo defends Longwinter against 3 dice.');
  });

  it('cashing groups each set with its bonus choices', () => {
    const s = withHand(opened(3), 0, [0, 3, 6, 9, 12, 15]);
    const groups = cashGroups(choices(s, 0));
    const first = groups.find((g) => g.positions.join() === '0,3,6');
    expect(first?.actions.map((a) => a.bonus)).toEqual(['a1', 'a4', 'a7']);
  });
});

describe('labels and the record', () => {
  it('names a province with its realm, holder and troops', () => {
    const s = attacking({ c2: [1, 4] });
    expect(provinceLabel(s, 'c2', NAMES)).toBe('Fenhallow, the Old Crowns, Bo (cobalt), 4 troops');
    expect(provinceLabel(fresh(3), 'a1', NAMES)).toBe('Wolfsgate, Hollowpine, unclaimed');
  });

  it('counts each player, and says who is out', () => {
    const t = takeA2(lastStand()).state;
    const rows = playerRows(t, NAMES);
    expect(rows[1]?.out).toBe(true);
    expect(rows[1]?.provinces).toBe(0);
    expect(rows[0]?.provinces).toBeGreaterThan(0);
    expect(rows.reduce((n, r) => n + r.provinces, 0)).toBe(42);
  });

  it('writes battles, captures and eliminations in plain words', () => {
    const r = act(attacking({ a1: [0, 6], a2: [1, 3] }, { defense: 'auto' }), {
      type: 'attack',
      actor: 0,
      from: 'a1',
      to: 'a2',
      dice: 3,
    });
    const t = contributeAndRoll(r, [6, 3, 1, 3, 3]);
    void t;
    expect(
      logLine(
        { type: 'battle', seat: 0, from: 'a1', to: 'a2', attack: [6, 3, 1], defend: [3, 3], lost: [1, 1] },
        NAMES,
      ),
    ).toBe('Dice 6 3 1 against 3 3: the attacker loses one, the defender loses one.');
    expect(logLine({ type: 'eliminated', seat: 1, by: 0, charters: 2 }, NAMES)).toBe(
      'Bo is out. Ada takes 2 charters.',
    );
    expect(logLine({ type: 'won', seat: 0 }, NAMES)).toBe('Ada holds all 42 provinces and wins.');
    expect(hazard.id).toBe('hazard');
  });
});

describe('the table', () => {
  const table = (state: TableProps['state'], me: number | null, extra: Partial<TableProps> = {}) =>
    renderTree(
      h(HazardTable, {
        state,
        me,
        names: NAMES,
        avatars: [],
        legal: me === null ? [] : (legalActions(state, me) as HazardAction[]),
        enabled: true,
        selected: null,
        target: null,
        count: null,
        events: [],
        ended: false,
        onPick: () => {},
        onSend: () => {},
        onCount: () => {},
        onClear: () => {},
        ...extra,
      }),
    );
  const charters = (tree: ReturnType<typeof renderTree>) =>
    findAll(tree, (el) => el.tag === 'svg' && String(el.attrs.class ?? '').includes('hz-card')).map((el) =>
      String(el.attrs['aria-label']),
    );

  it('names every province as a button, and only the clickable ones take focus', () => {
    const s = opened(3);
    const tree = table(s, 0);
    const provinces = findAll(tree, (el) => el.attrs['data-province'] !== undefined);
    expect(provinces).toHaveLength(42);
    for (const g of provinces)
      expect(g.attrs['aria-label']).toBe(provinceLabel(s, g.attrs['data-province'] as 'a1', NAMES));
    const focusable = provinces.filter((g) => g.attrs.tabindex === 0).map((g) => g.attrs['data-province']);
    expect(focusable).toContain('a1');
    expect(focusable).not.toContain('a2');
    // Out of turn, nothing is clickable.
    expect(findAll(table(s, 1), (el) => el.attrs.tabindex === 0)).toHaveLength(0);
  });

  it('shows a hand only to its holder; others and spectators see backs or nothing', () => {
    const s = withHand(opened(3), 0, [10, 11, 43]);
    expect(charters(table(hazard.view(s, 0), 0))).toEqual([
      'Greatcanopy Horse charter',
      'Condor Heights Cannon charter',
      'Crown charter',
      'Greatcanopy Horse charter',
      'Condor Heights Cannon charter',
      'Crown charter',
    ]);
    const other = table(hazard.view(s, 1), 1);
    expect(charters(other)).toEqual([]);
    expect(textOf(other)).not.toMatch(/Greatcanopy Horse|Crown charter/);
    expect(charters(table(hazard.view(s, null), null))).toEqual([]);
  });

  it('tells a seat that is out to keep its page open', () => {
    const t = takeA2(lastStand()).state;
    expect(textOf(table(hazard.view(t, 1), 1))).toMatch(/You are out of the game\. Keep this page open/);
    expect(textOf(table(hazard.view(t, 2), 2))).not.toMatch(/You are out/);
  });

  it('offers the defender its dice, and the attacker the dice for a chosen pair', () => {
    const s = act(attacking({ a1: [0, 6], a2: [1, 2] }), {
      type: 'attack',
      actor: 0,
      from: 'a1',
      to: 'a2',
      dice: 3,
    });
    const buttons = findAll(
      table(hazard.view(s, 1), 1),
      (el) => el.tag === 'button' && el.attrs['data-action'] !== undefined,
    );
    expect(buttons.map((b) => JSON.parse(String(b.attrs['data-action'])))).toEqual([
      { type: 'defend', actor: 1, dice: 1 },
      { type: 'defend', actor: 1, dice: 2 },
    ]);
    const a = attacking({ a1: [0, 6], a2: [1, 2] });
    const dice = findAll(
      table(a, 0, { selected: 'a1', target: 'a2' }),
      (el) => el.tag === 'button' && el.attrs['data-action'] !== undefined,
    )
      .map((b) => JSON.parse(String(b.attrs['data-action'])))
      .filter((x) => x.type === 'attack');
    expect(dice.map((x) => x.dice)).toEqual([1, 2, 3]);
  });
});

describe('registration', () => {
  it('registers the game, its rules page, its setup copy and its table option', () => {
    const game = webGame('hazard');
    expect(game?.Component).toBe(HazardGame);
    expect(game?.RulesPage).toBe(HazardRulesPage);
    expect(game?.setupCopy(true)).toEqual(HAZARD_SETUP_COPY);
    expect(DEFENSE_CHOICES.map((c) => c.value)).toEqual(['choose', 'auto']);
    for (const c of DEFENSE_CHOICES) expect(hazard.validateRules({ defense: c.value }).ok).toBe(true);
  });
});

describe('fixes from the final review', () => {
  it('keeps the provinces of an attack chosen through the defence and the roll, and drops them at a new stage', () => {
    for (const stage of ['attack', 'defend', 'roll', 'advance', 'march'] as const)
      expect(selectionSurvives(stage)).toBe(true);
    for (const stage of ['muster', 'claim', 'place', 'reveal', 'shuffle', 'over'] as const)
      expect(selectionSurvives(stage)).toBe(false);
  });

  it('says "cash down" only while charters must still be cashed, then that the troops are being placed', () => {
    const t = takeA2(withHand(withHand(lastStand(), 0, [0, 3, 6, 1]), 1, [9, 12, 15])).state;
    expect(statusLine(t, NAMES, 0)).toMatch(/cash charters down to four/);
    const cashed = revealCash(act(t, { type: 'cash', actor: 0, positions: [0, 3, 6], bonus: 'a1' })).state;
    expect(statusLine(cashed, NAMES, 0)).toBe('Place the 4 troops from your cashed set, then attack on.');
  });
});
