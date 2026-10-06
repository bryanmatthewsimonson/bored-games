/*
 * The playing pieces (spec section 6, D072): six party pawns, six Exhibit tokens and the six faces of a die, on one
 * sheet. Each pawn carries its party's emblem and monogram, so no pawn is told apart by colour alone.
 */
import { EXHIBITS, FONT_SANS, FONT_SERIF, fitText, ON_ACCENT, PALETTE, PARTIES } from '../data.ts';
import { EMBLEMS, EXHIBIT_GLYPHS, glyph } from '../glyphs.ts';
import { el, svgDocument, text } from '../svg.ts';

const WIDTH = 1000;
const HEIGHT = 560;

/** The centre of column `i` of six. */
const colX = (i: number): number => 100 + 160 * i;

/** Pip positions on a 96 px die face, as offsets from its middle. */
const PIPS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 0]],
  [
    [-26, -26],
    [26, 26],
  ],
  [
    [-26, -26],
    [0, 0],
    [26, 26],
  ],
  [
    [-26, -26],
    [26, -26],
    [-26, 26],
    [26, 26],
  ],
  [
    [-26, -26],
    [26, -26],
    [0, 0],
    [-26, 26],
    [26, 26],
  ],
  [
    [-26, -26],
    [26, -26],
    [-26, 0],
    [26, 0],
    [-26, 26],
    [26, 26],
  ],
];

function pawn(i: number, party: (typeof PARTIES)[number]): string {
  const cx = colX(i);
  const name = fitText(party.name, 16, 150);
  const on = PALETTE[ON_ACCENT[party.accent]];
  return el(
    'g',
    { id: `pawn-${party.id}` },
    el('circle', { cx, cy: 84, r: 58, fill: PALETTE[party.accent], stroke: PALETTE.ink, 'stroke-width': 4 }),
    el('circle', {
      cx,
      cy: 84,
      r: 49,
      fill: 'none',
      stroke: on,
      'stroke-width': 2,
      'stroke-opacity': 0.5,
    }),
    glyph(EMBLEMS[party.emblem], cx - 36, 48, 72, on),
    el('circle', { cx, cy: 168, r: 16, fill: PALETTE.ivory, stroke: PALETTE.brass, 'stroke-width': 4 }),
    text(party.monogram, {
      x: cx,
      y: 173.5,
      'text-anchor': 'middle',
      'font-family': FONT_SANS,
      'font-size': 15,
      'font-weight': 700,
      fill: PALETTE.ink,
    }),
    text(party.name, {
      x: cx,
      y: 214,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': name.size,
      fill: PALETTE.ink,
      textLength: name.textLength,
    }),
  );
}

function token(i: number, exhibit: (typeof EXHIBITS)[number]): string {
  const cx = colX(i);
  const name = fitText(exhibit.name, 16, 150);
  return el(
    'g',
    { id: `token-${exhibit.id}` },
    el('rect', {
      x: cx - 58,
      y: 246,
      width: 116,
      height: 116,
      rx: 20,
      fill: PALETTE.brass,
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
    el('rect', {
      x: cx - 50,
      y: 254,
      width: 100,
      height: 100,
      rx: 14,
      fill: 'none',
      stroke: PALETTE.ink,
      'stroke-width': 2,
      'stroke-opacity': 0.5,
    }),
    glyph(EXHIBIT_GLYPHS[exhibit.id], cx - 38, 266, 76, PALETTE.ink),
    text(exhibit.name, {
      x: cx,
      y: 392,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': name.size,
      fill: PALETTE.ink,
      textLength: name.textLength,
    }),
  );
}

function die(i: number): string {
  const cx = colX(i);
  return el(
    'g',
    { id: `die-${i + 1}` },
    el('rect', {
      x: cx - 46,
      y: 424,
      width: 92,
      height: 92,
      rx: 14,
      fill: PALETTE.ivory,
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
    ...(PIPS[i] ?? []).map(([dx, dy]) =>
      el('circle', { cx: cx + dx, cy: 470 + dy, r: 8, fill: PALETTE.ink }),
    ),
  );
}

export function renderPieces(): string {
  const body = [
    el('rect', { width: WIDTH, height: HEIGHT, fill: PALETTE.parchment }),
    ...PARTIES.map((p, i) => pawn(i, p)),
    ...EXHIBITS.map((e, i) => token(i, e)),
    ...PIPS.map((_, i) => die(i)),
  ].join('\n');
  return svgDocument(
    {
      width: WIDTH,
      height: HEIGHT,
      title: 'Room for Doubt: pieces',
      desc: 'Six party pawns, each with its emblem and monogram; six Exhibit tokens; and the six faces of a die.',
    },
    body,
  );
}
