/*
 * Rendered output of the Chain Reaction players panel, from real engine states. The repo has no DOM library,
 * so `renderTree` expands the panel's vnodes the way Preact would (function components called with their
 * props, Fragments flattened) into a plain element tree. The panel and its parts use no hooks.
 */
import type { ChainReactionState } from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { type ComponentChildren, h, type VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { playUntil, randomLegal } from '../src/games/chain-reaction/fixture.ts';
import { formatMoney, playerRows } from '../src/games/chain-reaction/model.ts';
import { PlayersPanel } from '../src/games/chain-reaction/panels.tsx';

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

interface El {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, unknown>>;
  readonly children: readonly Node[];
}
type Node = El | string;

function renderTree(node: ComponentChildren): Node[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return [String(node)];
  if (Array.isArray(node)) return node.flatMap((n) => renderTree(n as ComponentChildren));
  const v = node as VNode<Record<string, unknown>>;
  if (typeof v.type === 'function') {
    const component = v.type as (props: unknown) => ComponentChildren;
    return renderTree(component(v.props));
  }
  const { children, ...attrs } = v.props;
  return [{ tag: String(v.type), attrs, children: renderTree(children as ComponentChildren) }];
}

const isEl = (n: Node): n is El => typeof n !== 'string';
const classOf = (el: El): string[] => String(el.attrs.class ?? '').split(/\s+/);

function findAll(nodes: readonly Node[], pred: (el: El) => boolean): El[] {
  return nodes.filter(isEl).flatMap((el) => [...(pred(el) ? [el] : []), ...findAll(el.children, pred)]);
}

/** Everything a reader or screen reader gets: text (sr-only included), aria-labels and titles. */
function textOf(nodes: readonly Node[]): string {
  return nodes
    .map((n) =>
      isEl(n)
        ? [n.attrs['aria-label'], n.attrs.title, textOf(n.children)]
            .filter((x) => typeof x === 'string')
            .join(' ')
        : n,
    )
    .join(' ');
}

/** A mid-game state where seats 0 and 2 hold shares, with seat 3's cash spent so "no cash" shows. */
function midGame(): ChainReactionState {
  const g = playUntil(
    'panels',
    4,
    randomLegal,
    (g) =>
      g.state.phase.kind === 'place' &&
      [0, 2].every((seat) => (g.state.players[seat]?.shares ?? []).filter((n) => n > 0).length >= 2),
    3000,
  );
  if (!g) throw new Error('no game');
  return { ...g.state, players: g.state.players.map((p, i) => (i === 3 ? { ...p, cash: 0 } : p)) };
}

function renderRows(s: ChainReactionState, mySeat: number | null): El[] {
  const tree = renderTree(h(PlayersPanel, { rows: playerRows(s, NAMES, mySeat) }));
  const rows = findAll(tree, (el) => el.tag === 'li' && classOf(el).includes('cr-player'));
  expect(rows).toHaveLength(s.seats);
  return rows;
}

/** A row's text without the hand size ("6 tiles"), which stays public. */
const withoutHandSize = (row: El): string => textOf([row]).replace(/\b\d+ tiles?\b/, '');

describe('PlayersPanel', () => {
  const s = midGame();

  it("renders another seat's row with chain chips and a cash marker, and no count or amount anywhere", () => {
    const rows = renderRows(s, 0);
    for (const seat of [1, 2, 3]) {
      const row = rows[seat] as El;
      const p = s.players[seat];
      if (!p) throw new Error('no player');
      const text = textOf([row]);
      expect(text).toContain(p.cash > 0 ? 'has cash' : 'no cash');
      expect(text).toContain(`${p.hand.length} tile`);
      expect(withoutHandSize(row)).not.toMatch(/\d|\$/);
      const chips = findAll([row], (el) => classOf(el).includes('cr-swatch'));
      const held = p.shares.flatMap((n, c) => (n > 0 ? [c] : []));
      expect(chips).toHaveLength(held.length);
      for (const c of held) {
        const id = s.rules.chains[c]?.id as string;
        expect(text).toContain((CHAIN_REACTION_THEME.chains as Record<string, { name: string }>)[id]?.name);
      }
    }
    expect(textOf([rows[3] as El])).toContain('no cash');
    expect(findAll([rows[2] as El], (el) => classOf(el).includes('cr-swatch')).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('renders my own row with exact cash and counts', () => {
    const rows = renderRows(s, 0);
    const me = s.players[0];
    if (!me) throw new Error('no player');
    const row = rows[0] as El;
    const cash = findAll([row], (el) => classOf(el).includes('cr-cash'));
    expect(textOf(cash)).toBe(formatMoney(me.cash));
    const holdings = findAll([row], (el) => classOf(el).includes('cr-holdings'));
    const counts = holdings
      .flatMap((ul) => ul.children.filter(isEl))
      .map((li) => textOf(li.children).replace(/\s+/g, ' ').trim());
    const expected = me.shares.flatMap((n, c) => (n > 0 ? [{ c, n }] : []));
    expect(counts).toHaveLength(expected.length);
    expected.forEach(({ c, n }, i) => {
      const name = (CHAIN_REACTION_THEME.chains as Record<string, { name: string }>)[
        s.rules.chains[c]?.id ?? ''
      ]?.name;
      expect(counts[i]).toMatch(new RegExp(`${name} ?: ${n}$`));
    });
    expect(textOf([row])).not.toMatch(/has cash|no cash/);
  });

  it('renders every row hidden for a spectator, and every row exact at game over', () => {
    for (const row of renderRows(s, null)) expect(withoutHandSize(row)).not.toMatch(/\d|\$/);
    const g = playUntil('panels-over', 4, randomLegal, (g) => g.state.phase.kind === 'over', 5000);
    if (!g) throw new Error('no finished game');
    renderRows(g.state, null).forEach((row, seat) => {
      expect(textOf([row])).toContain(formatMoney(g.state.players[seat]?.cash ?? -1));
    });
  });
});
