import { DEFAULT_RULES, ROUTES, type RowState, rightOfWay } from '@bored-games/right-of-way';
import { RIGHT_OF_WAY_THEME } from '@bored-games/right-of-way/theme';
import { type ComponentChildren, h } from 'preact';
import { describe, expect, it } from 'vitest';
import { CharterCard, FreightCard } from '../src/games/right-of-way/art.tsx';
import { Board } from '../src/games/right-of-way/board.tsx';
import { RightOfWayGame } from '../src/games/right-of-way/game.tsx';
import { charterLines, claimsBySide, statusText } from '../src/games/right-of-way/model.ts';
import { RightOfWayRulesContent } from '../src/games/right-of-way/rules-page.tsx';
import { ownCardReason, sealVerdict } from '../src/share-vet.ts';
import { findAll, renderTree, textOf } from './render-tree.ts';

const D = (pos: number, to: number | null) => ({ deck: 'rail', pos, to });

/** A full game at its setup yard, every seat's first charters still to keep. */
function fullSetup(seats = 3): RowState {
  const order = Array.from({ length: 580 }, (_, i) => i);
  const r = rightOfWay.setup({ rules: DEFAULT_RULES, seats, mode: 'full', deckOrders: { rail: order } });
  if (!r.ok) throw new Error(r.error.message);
  let s = r.value;
  for (;;) {
    const p = rightOfWay.pending(s);
    if (p.type !== 'reveal') return s;
    const pos = p.positions[0] as number;
    const next = rightOfWay.apply(s, { type: 'reveal', actor: 'deck', deck: 'rail', pos, card: order[pos] });
    if (!next.ok) throw new Error(next.error.message);
    s = next.state;
  }
}

describe('vetting sealed shares and end reveals (D066)', () => {
  it('a card first held and passed on stays private; once dealt to the public, everyone shares it', () => {
    const passed = [D(7, 0), D(7, 1)];
    expect(ownCardReason([7], 0, passed)).not.toBeNull();
    expect(ownCardReason([7], 2, passed)).toBeNull();
    const shown = [...passed, D(7, null)];
    expect(ownCardReason([7], 0, shown)).toBeNull();
    expect(ownCardReason([7], 1, shown)).toBeNull();
  });

  it('sends a sealed share only for a re-dealt card this seat first held, to its holder, while owed', () => {
    const dealt = [D(7, 0), D(9, 2), D(7, 1)];
    const base = { mySeat: 0, dealt, sentElsewhere: () => false };
    expect(sealVerdict({ ...base, items: [{ pos: 7, to: 1 }], owed: [{ pos: 7, to: 1 }] })).toBe('send');
    expect(sealVerdict({ ...base, items: [{ pos: 7, to: 2 }], owed: [{ pos: 7, to: 2 }] })).toMatch(
      /elsewhere/,
    );
    expect(sealVerdict({ ...base, items: [{ pos: 9, to: 1 }], owed: [{ pos: 9, to: 1 }] })).toMatch(
      /not yours/,
    );
    expect(sealVerdict({ ...base, items: [{ pos: 7, to: 1 }], owed: [] })).toMatch(/no longer owed/);
    expect(sealVerdict({ ...base, mySeat: 1, items: [{ pos: 7, to: 1 }], owed: null })).toMatch(/not yours/);
    expect(
      sealVerdict({ ...base, items: [{ pos: 7, to: 1 }], owed: null, sentElsewhere: () => true }),
    ).toMatch(/another device/);
    // Shown to everyone since: nothing is sealed any more.
    expect(
      sealVerdict({ ...base, dealt: [...dealt, D(7, null)], items: [{ pos: 7, to: 1 }], owed: null }),
    ).toMatch(/not yours/);
  });
});

describe('Right of Way presentation', () => {
  it('cards carry a cargo name and symbol; a face-down card or charter shows nothing more', () => {
    const label = (node: ComponentChildren) =>
      String(findAll(renderTree(node), (e) => e.tag === 'svg')[0]?.attrs['aria-label'] ?? '');
    for (let c = 0; c < 9; c++) expect(label(h(FreightCard, { color: c }))).toBe(RIGHT_OF_WAY_THEME.cargo[c]);
    expect(label(h(FreightCard, { color: null }))).toBe('Face down');
    expect(label(h(CharterCard, { index: null }))).toContain('face-down charter');
    expect(label(h(CharterCard, { index: 29 }))).toContain('22 points');
  });

  it('the board draws every route side; only claimable sides are buttons', () => {
    const s = fullSetup();
    const tree = renderTree(
      h(Board, {
        state: s,
        claimable: new Set(['2:0']),
        picked: null,
        onPick: () => undefined,
        marked: new Set<number>(),
        names: [],
      }),
    );
    expect(
      findAll(tree, (e) => e.attrs.class === 'row-side' || e.attrs.class === 'row-side row-side-claimable'),
    ).toHaveLength(ROUTES.reduce((n, r) => n + r.sides.length, 0));
    const buttons = findAll(tree, (e) => e.attrs.role === 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.attrs['data-route']).toBe(2);
  });

  it("a seat's view shows its own charters and only counts of the others'", () => {
    const view = rightOfWay.view(fullSetup(), 1);
    expect(statusText(view, 1, ['Ann', 'Bo', 'Cy'], false)).toMatch(/keep/);
    expect(view.players[0]?.offered.every((c) => c.card === null)).toBe(true);
    expect(view.players[1]?.offered.every((c) => c.card !== null)).toBe(true);
    expect(charterLines(view, 0)).toEqual([]);
    expect(claimsBySide([]).size).toBe(0);
    expect(typeof RightOfWayGame).toBe('function');
  });

  it('the rules page states the numbers from the engine', () => {
    const text = textOf(renderTree(h(RightOfWayRulesContent, {})));
    for (const re of [/110 freight cards/, /14 wild Engines/, /45\s+pieces of track/, /two or fewer pieces/])
      expect(text).toMatch(re);
  });
});
