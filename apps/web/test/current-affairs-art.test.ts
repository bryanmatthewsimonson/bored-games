/*
 * Current Affairs' artwork (D091), without a browser: every station card and the Era III card, the four fuels, the
 * fuel yard, the money glyph, the seat tokens, the map and the cover render to an <svg>; the cards' spoken labels
 * come from `stationLabel`; cities on offer are focusable buttons; the kept lettering spots still match the search;
 * and nothing rendered names the reference game, its designer or its publishers (CLAUDE.md, D046).
 */
import { CITY_COUNT, LINKS, STATIONS } from '@bored-games/current-affairs';
import { CURRENT_THEME } from '@bored-games/current-affairs/theme';
import { type ComponentChildren, h } from 'preact';
import { describe, expect, it } from 'vitest';
import { findRestricted } from '../../../tests/restricted-names.ts';
import {
  CurrentCover,
  FuelToken,
  FuelYard,
  Money,
  SEAT_COLORS,
  SEAT_INKS,
  SEAT_MARKS,
  SeatToken,
  StationCard,
  stationLabel,
} from '../src/games/current-affairs/art.tsx';
import { CommonwealthMap } from '../src/games/current-affairs/map.tsx';
import {
  RANGE_NAME_SPOT,
  REGION_NAME_SPOTS,
  searchLettering,
} from '../src/games/current-affairs/map-shapes.ts';
import { classOf, findAll, type Node, renderTree, textOf } from './render-tree.ts';

const svgs = (tree: readonly Node[]) => findAll(tree, (el) => el.tag === 'svg');

/** The root svg's spoken name, and the whole tree as text for the name scan. */
function rendered(node: ComponentChildren): { label: string; text: string; tree: Node[] } {
  const tree = renderTree(node);
  const roots = svgs(tree);
  expect(roots.length).toBeGreaterThan(0);
  return { label: String(roots[0]?.attrs['aria-label'] ?? ''), text: JSON.stringify(tree), tree };
}

function clean(text: string): void {
  expect(findRestricted(text, [])).toEqual([]);
}

describe('Current Affairs art', () => {
  it('draws every station with its label, one label per station', () => {
    const labels = new Set<string>();
    for (const s of STATIONS) {
      for (const props of [{}, { size: 56 }, { dim: true }, { selected: true }]) {
        const { label, text } = rendered(h(StationCard, { n: s.n, ...props }));
        expect(label).toBe(stationLabel(s.n));
        clean(text);
      }
      labels.add(stationLabel(s.n));
    }
    expect(STATIONS).toHaveLength(42);
    expect(labels.size).toBe(42);
    expect(stationLabel(20)).toBe('Station 20: burns 3 coal, powers 5 cities');
    expect(stationLabel(21)).toBe('Station 21: burns 2 coal or oil, powers 4 cities');
    expect(stationLabel(6)).toBe('Station 6: burns 1 waste, powers 1 city');
    expect(stationLabel(13)).toBe('Station 13: green, burns nothing, powers 1 city');
    const era = rendered(h(StationCard, { n: 'era' }));
    expect(era.label).toBe('The Era III card');
    clean(era.text);
    const small = svgs(renderTree(h(StationCard, { n: 50, size: 60 })))[0];
    expect(small?.attrs.width).toBe(60);
    expect(small?.attrs.height).toBe(84);
  });

  it('draws the four fuels, the yard, money and the seats', () => {
    const fuels = [0, 1, 2, 3].map((f) => rendered(h(FuelToken, { fuel: f, size: 24 })).label);
    expect(fuels).toEqual(['Coal', 'Oil', 'Waste', 'Uranium']);
    const yard = rendered(h(FuelYard, { yard: [24, 18, 6, 2] }));
    expect(yard.label).toBe(
      'Fuel yard: 24 coal from $1, 18 oil from $3, 6 waste from $7, 2 uranium from $14',
    );
    expect(rendered(h(FuelYard, { yard: [0, 1, 3, 12] })).label).toBe(
      'Fuel yard: no coal, 1 oil from $8, 3 waste from $8, 12 uranium from $1',
    );
    // Units fill a fuel's dearest spaces: 24 + 24 + 24 + 12 unit slots, as many drawn full as the yard holds.
    const prices = findAll(yard.tree, (el) => el.tag === 'text').map((el) => textOf([el]));
    expect(prices.filter((p) => p === '$1')).toHaveLength(4);
    expect(prices.filter((p) => p === '$16')).toHaveLength(1);
    clean(yard.text);
    expect(textOf(renderTree(h(Money, { amount: 50 }))).trim()).toBe('$50');
    expect(SEAT_COLORS).toHaveLength(6);
    expect(new Set(SEAT_COLORS).size).toBe(6);
    expect(new Set(SEAT_MARKS).size).toBe(6);
    expect(SEAT_INKS).toHaveLength(6);
    for (let s = 0; s < 6; s++)
      expect(rendered(h(SeatToken, { seat: s, title: `seat ${s}` })).label).toBe(`seat ${s}`);
  });

  it('draws the map: 42 cities, 95 lines, fogged regions and the houses', () => {
    const houses = Array.from({ length: CITY_COUNT }, (_, c) => (c === 0 ? [0, 2, 5] : c === 25 ? [1] : []));
    const tree = renderTree(
      h(CommonwealthMap, {
        regions: [0, 1, 3],
        houses,
        names: CURRENT_THEME.cities,
        seatNames: ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'],
      }),
    );
    const cities = findAll(tree, (el) => classOf(el).includes('ca-city'));
    expect(cities).toHaveLength(42);
    expect(findAll(tree, (el) => classOf(el).includes('ca-link'))).toHaveLength(LINKS.length);
    expect(LINKS).toHaveLength(95);
    // Amber, Heart and Ember are out of play here: their 21 cities are fogged.
    expect(findAll(tree, (el) => classOf(el).includes('ca-city-fog'))).toHaveLength(21);
    expect(findAll(tree, (el) => classOf(el).includes('ca-region-fog'))).toHaveLength(3);
    const text = textOf(tree);
    for (const name of CURRENT_THEME.cities) expect(text).toContain(name);
    for (const r of Object.values(CURRENT_THEME.regions)) expect(text).toContain(r.toUpperCase());
    expect(text).toContain('Icebridge: substations of Ada, Cy, Flo');
    // Without a click handler, nothing is a button.
    expect(findAll(tree, (el) => el.attrs.role === 'button')).toEqual([]);
    clean(JSON.stringify(tree));
  });

  it('makes each city on offer a focusable button', () => {
    const picked: number[] = [];
    const offers = new Map([
      [25, 22],
      [22, 31],
      [30, 18],
    ]);
    const tree = renderTree(
      h(CommonwealthMap, {
        regions: [3, 4],
        houses: [],
        names: CURRENT_THEME.cities,
        offers,
        onCity: (c: number) => picked.push(c),
        highlight: 30,
      }),
    );
    const buttons = findAll(tree, (el) => el.attrs.role === 'button');
    expect(buttons.map((b) => b.attrs['aria-label'])).toEqual([
      'Wire Gullcove for $31',
      'Wire Kelpford for $22',
      'Wire Sheafton for $18',
    ]);
    for (const b of buttons) expect(b.attrs.tabindex).toBe(0);
    const kelpford = buttons[1];
    if (!kelpford) throw new Error('no Kelpford button');
    (kelpford.attrs.onClick as () => void)();
    let prevented = false;
    (kelpford.attrs.onKeyDown as (e: unknown) => void)({
      key: 'Enter',
      preventDefault: () => (prevented = true),
    });
    (kelpford.attrs.onKeyDown as (e: unknown) => void)({ key: ' ', preventDefault: () => undefined });
    (kelpford.attrs.onKeyDown as (e: unknown) => void)({ key: 'x', preventDefault: () => undefined });
    expect(picked).toEqual([25, 25, 25]);
    expect(prevented).toBe(true);
    expect(findAll(tree, (el) => classOf(el).includes('ca-city-highlight'))).toHaveLength(1);
  });

  it('keeps the lettering where the search puts it', () => {
    const found = searchLettering();
    expect(found.regions).toEqual(REGION_NAME_SPOTS);
    expect(found.range).toEqual(RANGE_NAME_SPOT);
  });

  it('draws the cover, with the title, and the thumbnail without it', () => {
    const cover = rendered(h(CurrentCover, { thumb: false }));
    expect(cover.label).toMatch(/^Current Affairs artwork/);
    expect(cover.text).toContain('Current Affairs');
    expect(cover.text).toContain('Keep the lights on.');
    clean(cover.text);
    const thumb = renderTree(h(CurrentCover, { thumb: true }));
    expect(svgs(thumb)[0]?.attrs.preserveAspectRatio).toBe('xMidYMid slice');
    expect(findAll(thumb, (el) => el.tag === 'text')).toEqual([]);
    clean(JSON.stringify(thumb));
  });
});
