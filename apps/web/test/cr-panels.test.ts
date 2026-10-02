/*
 * Rendered output of the Chain Reaction players panel and results, from real engine states, expanded without a
 * DOM by `renderTree`. The panels, their parts and `Avatar` use no hooks. Every row is rendered with an avatar,
 * so the hidden-holdings checks also cover the avatar markup.
 */
import type { ChainReactionState } from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../src/components/avatar.tsx';
import { playUntil, randomLegal } from '../src/games/chain-reaction/fixture.ts';
import { formatMoney, playerRows, resultRows } from '../src/games/chain-reaction/model.ts';
import { PlayersPanel, ResultsView } from '../src/games/chain-reaction/panels.tsx';
import { classOf, type El, findAll, isEl, renderTree, spokenText, textOf } from './render-tree.ts';

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];
const KEYS = ['3b', '9e', 'c4', '71'].map((b) => b.repeat(32));
/** A picture per seat whose URL names the seat, so a row's avatar can be traced to it. */
const pictureOf = (seat: number) => `https://pics.example.com/seat-${seat}.webp`;
const AVATARS = KEYS.map((pk, seat) => h(Avatar, { pubkey: pk, picture: pictureOf(seat) }));

/** The seats of the avatars in `nodes`, by their pictures, in order. */
const avatarSeats = (nodes: readonly El[]): number[] =>
  findAll(nodes, (el) => classOf(el).includes('avatar')).map((a) => {
    const src = findAll([a], (el) => el.tag === 'img')[0]?.attrs.src;
    return KEYS.findIndex((_, seat) => pictureOf(seat) === src);
  });

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
  const tree = renderTree(h(PlayersPanel, { rows: playerRows(s, NAMES, mySeat), avatars: AVATARS }));
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

  it("shows each seat's avatar beside its name, hidden from screen readers, and none without avatars", () => {
    renderRows(s, 1).forEach((row, seat) => {
      expect(avatarSeats([row])).toEqual([seat]);
      const head = findAll([row], (el) => classOf(el).includes('cr-player-name'))[0] as El;
      const avatar = findAll([head], (el) => classOf(el).includes('avatar'))[0] as El;
      expect(avatar.attrs['aria-hidden']).toBe('true');
      expect(spokenText([head])).toContain(NAMES[seat]);
    });
    const bare = renderTree(h(PlayersPanel, { rows: playerRows(s, NAMES, 1) }));
    expect(findAll(bare, (el) => classOf(el).includes('avatar'))).toHaveLength(0);
  });
});

describe('ResultsView', () => {
  it("shows each place with the seat's avatar and name", () => {
    const g = playUntil('panels-over', 4, randomLegal, (g) => g.state.phase.kind === 'over', 5000);
    if (!g) throw new Error('no finished game');
    const rows = resultRows(g.state, NAMES);
    const tree = renderTree(h(ResultsView, { rows, audit: 'pass', names: NAMES, avatars: AVATARS }));
    const body = findAll(tree, (el) => el.tag === 'tbody')[0] as El;
    const trs = findAll([body], (el) => el.tag === 'tr');
    expect(trs.map((tr) => avatarSeats([tr])[0])).toEqual(rows.map((r) => r.seat));
    trs.forEach((tr, i) => {
      const r = rows[i];
      if (!r) throw new Error('no row');
      expect(textOf([tr])).toContain(NAMES[r.seat]);
      expect(textOf([tr])).toContain(formatMoney(r.cash));
    });
  });
});
