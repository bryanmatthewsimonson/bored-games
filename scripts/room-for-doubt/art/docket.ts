/*
 * The printable docket (spec section 6, D072): an A4 page listing the 21 cards, each with six tick boxes (the first
 * for the cards in your own hand, then one for each other player) and a notes area. Pure deduction paper: it says
 * nothing about the rules.
 */
import { EXHIBITS, FONT_SANS, FONT_SERIF, fitText, PALETTE, PARTIES, SCENES } from '../data.ts';
import { EMBLEMS, EXHIBIT_GLYPHS, glyph, SCENE_GLYPHS } from '../glyphs.ts';
import { el, svgDocument, text } from '../svg.ts';

const WIDTH = 794;
const HEIGHT = 1123;
const MARGIN = 48;
const ROW = 30;
const HEAD = 32;
const GAP = 14;
const BOX = 22;
const BOX_X = 408;
const BOX_DX = 56;
const LABELS = ['Mine', '1', '2', '3', '4', '5'];

interface Item {
  readonly id: string;
  readonly name: string;
  readonly art: string;
}

const SECTIONS: readonly { readonly title: string; readonly items: readonly Item[] }[] = [
  { title: 'PARTIES', items: PARTIES.map((p) => ({ id: p.id, name: p.name, art: EMBLEMS[p.emblem] })) },
  { title: 'EXHIBITS', items: EXHIBITS.map((e) => ({ id: e.id, name: e.name, art: EXHIBIT_GLYPHS[e.id] })) },
  { title: 'SCENES', items: SCENES.map((s) => ({ id: s.id, name: s.name, art: SCENE_GLYPHS[s.id] })) },
];

function row(item: Item, y: number): string {
  const name = fitText(item.name, 16, 200);
  return el(
    'g',
    { id: `docket-row-${item.id}` },
    glyph(item.art, MARGIN, y + 4, 22, PALETTE.ink),
    text(item.name, {
      x: MARGIN + 36,
      y: y + 20,
      'font-family': FONT_SERIF,
      'font-size': name.size,
      fill: PALETTE.ink,
      textLength: name.textLength,
    }),
    ...LABELS.map((_, k) =>
      el('rect', {
        x: BOX_X + k * BOX_DX,
        y: y + 4,
        width: BOX,
        height: BOX,
        rx: 3,
        fill: 'none',
        stroke: PALETTE.ink,
        'stroke-width': 1.5,
      }),
    ),
    el('path', {
      d: `M${MARGIN} ${y + ROW}H${WIDTH - MARGIN}`,
      stroke: PALETTE.brass,
      'stroke-width': 1,
      'stroke-opacity': 0.6,
    }),
  );
}

function section(title: string, items: readonly Item[], y: number): string {
  return el(
    'g',
    {},
    text(title, {
      x: MARGIN,
      y: y + 22,
      'font-family': FONT_SANS,
      'font-size': 14,
      'font-weight': 700,
      'letter-spacing': 3,
      fill: PALETTE.ink,
    }),
    ...LABELS.map((label, k) =>
      text(label, {
        x: BOX_X + k * BOX_DX + BOX / 2,
        y: y + 22,
        'text-anchor': 'middle',
        'font-family': FONT_SANS,
        'font-size': 12,
        fill: PALETTE.slate,
      }),
    ),
    el('path', {
      d: `M${MARGIN} ${y + HEAD - 2}H${WIDTH - MARGIN}`,
      stroke: PALETTE.brass,
      'stroke-width': 2,
    }),
    ...items.map((item, i) => row(item, y + HEAD + i * ROW)),
  );
}

export function renderDocket(): string {
  const parts: string[] = [
    el('rect', { width: WIDTH, height: HEIGHT, fill: PALETTE.ivory }),
    text('DOCKET', {
      x: MARGIN,
      y: 86,
      'font-family': FONT_SERIF,
      'font-size': 44,
      'font-weight': 700,
      'letter-spacing': 8,
      fill: PALETTE.oxblood,
    }),
    text('The Aldermoor Assize Courts · Michaelmas 1934', {
      x: MARGIN,
      y: 114,
      'font-family': FONT_SERIF,
      'font-size': 16,
      'font-style': 'italic',
      fill: PALETTE.slate,
    }),
    text('Name', { x: 470, y: 86, 'font-family': FONT_SANS, 'font-size': 14, fill: PALETTE.slate }),
    el('path', { d: `M520 88H${WIDTH - MARGIN}`, stroke: PALETTE.ink, 'stroke-width': 1.5 }),
    el('path', { d: `M${MARGIN} 130H${WIDTH - MARGIN}`, stroke: PALETTE.oxblood, 'stroke-width': 3 }),
  ];
  let y = 146;
  for (const s of SECTIONS) {
    parts.push(section(s.title, s.items, y));
    y += HEAD + s.items.length * ROW + GAP;
  }
  // Notes fill what is left of the page.
  const bottom = HEIGHT - MARGIN;
  const boxTop = y + 26;
  const lines: string[] = [];
  for (let ly = boxTop + 28; ly < bottom - 8; ly += 28)
    lines.push(`M${MARGIN + 12} ${ly}H${WIDTH - MARGIN - 12}`);
  parts.push(
    el(
      'g',
      { id: 'docket-notes' },
      text('NOTES', {
        x: MARGIN,
        y: y + 18,
        'font-family': FONT_SANS,
        'font-size': 14,
        'font-weight': 700,
        'letter-spacing': 3,
        fill: PALETTE.ink,
      }),
      el('rect', {
        x: MARGIN,
        y: boxTop,
        width: WIDTH - 2 * MARGIN,
        height: bottom - boxTop,
        rx: 6,
        fill: 'none',
        stroke: PALETTE.ink,
        'stroke-width': 1.5,
      }),
      el('path', { d: lines.join(''), stroke: PALETTE.brass, 'stroke-width': 1, 'stroke-opacity': 0.6 }),
    ),
  );
  return svgDocument(
    {
      width: WIDTH,
      height: HEIGHT,
      title: 'Room for Doubt: docket',
      desc: 'A printable A4 docket: one row for each of the 21 cards with six tick boxes, and a notes area.',
    },
    parts.join('\n'),
  );
}
