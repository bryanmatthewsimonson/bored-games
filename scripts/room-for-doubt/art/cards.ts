/*
 * The card sheet (spec section 6, D072): the 21 faces, the back and the Verdict envelope on one sheet of three rows of
 * nine slots. A face has a band top and bottom in its category colour, the corner index in both bands (the bottom one
 * turned half round, so a fanned hand reads from either end), a large pictogram on a tinted seal, the name and a
 * footer line. Names go through `fitText`, so no text is squeezed.
 */
import {
  EXHIBITS,
  FONT_SANS,
  FONT_SERIF,
  fitText,
  ON_ACCENT,
  PALETTE,
  PARTIES,
  type PaletteName,
  SCENES,
} from '../data.ts';
import { EMBLEMS, EXHIBIT_GLYPHS, glyph, SCENE_GLYPHS } from '../glyphs.ts';
import { el, svgDocument, text } from '../svg.ts';

export const CARD_W = 250;
export const CARD_H = 350;
const GAP = 24;
const MARGIN = 40;
const COLS = 9;
const SHEET_W = 2 * MARGIN + COLS * CARD_W + (COLS - 1) * GAP;
const SHEET_H = 2 * MARGIN + 3 * CARD_H + 2 * GAP;

const BAND = 44;
const TOP_BAND = `M0 ${BAND}V14A14 14 0 0 1 14 0H236A14 14 0 0 1 250 14V${BAND}Z`;
const BOTTOM_BAND = `M0 ${CARD_H - BAND}H250V336A14 14 0 0 1 236 ${CARD_H}H14A14 14 0 0 1 0 336Z`;

interface Face {
  readonly id: string;
  readonly category: string;
  readonly band: PaletteName;
  /** The colour of the band's marks. */
  readonly on: PaletteName;
  /** A Party's monogram; the other cards put a small copy of the pictogram in the corner. */
  readonly monogram: string | null;
  readonly art: string;
  readonly name: string;
  readonly footer: string;
}

const sentence = (s: string): string => s.slice(0, 1).toUpperCase() + s.slice(1);

const FACES: readonly Face[] = [
  ...PARTIES.map(
    (p): Face => ({
      id: `card-${p.id}`,
      category: 'PARTY',
      band: p.accent,
      on: ON_ACCENT[p.accent],
      monogram: p.monogram,
      art: EMBLEMS[p.emblem],
      name: p.name,
      footer: sentence(p.role),
    }),
  ),
  ...EXHIBITS.map(
    (e): Face => ({
      id: `card-${e.id}`,
      category: 'EXHIBIT',
      band: 'brass',
      on: 'ink',
      monogram: null,
      art: EXHIBIT_GLYPHS[e.id],
      name: e.name,
      footer: 'Exhibit',
    }),
  ),
  ...SCENES.map(
    (s): Face => ({
      id: `card-${s.id}`,
      category: 'SCENE',
      band: 'slate',
      on: 'ivory',
      monogram: null,
      art: SCENE_GLYPHS[s.id],
      name: s.name,
      footer: 'Scene',
    }),
  ),
];

const slot = (col: number, row: number): { x: number; y: number } => ({
  x: MARGIN + col * (CARD_W + GAP),
  y: MARGIN + row * (CARD_H + GAP),
});

const faces = (category: string): readonly Face[] => FACES.filter((f) => f.category === category);

/** Where each card sits on the sheet: Parties and the back, Exhibits and the envelope, then the Scenes. */
export const CARD_LAYOUT: readonly { id: string; x: number; y: number }[] = [
  ...faces('PARTY').map((f, i) => ({ id: f.id, ...slot(i, 0) })),
  { id: 'card-back', ...slot(6, 0) },
  ...faces('EXHIBIT').map((f, i) => ({ id: f.id, ...slot(i, 1) })),
  { id: 'verdict-envelope', ...slot(6, 1) },
  ...faces('SCENE').map((f, i) => ({ id: f.id, ...slot(i, 2) })),
];

/** The corner index: a Party's monogram, or a small pictogram. Drawn for the top-left band. */
function corner(f: Face): string {
  const color = PALETTE[f.on];
  return f.monogram === null
    ? glyph(f.art, 12, 8, 28, color)
    : text(f.monogram, {
        x: 14,
        y: 30,
        'font-family': FONT_SERIF,
        'font-size': 22,
        'font-weight': 700,
        fill: color,
      });
}

function face(f: Face): string {
  const name = fitText(f.name, 24, 210);
  const footer = fitText(f.footer, 14, 210);
  // An ivory band would vanish into the card, so its seal is a faint ink shadow instead of a tint.
  const seal =
    f.band === 'ivory' ? { color: PALETTE.ink, opacity: 0.08 } : { color: PALETTE[f.band], opacity: 0.2 };
  return [
    el('rect', { width: CARD_W, height: CARD_H, rx: 14, fill: PALETTE.parchment }),
    el('path', { d: TOP_BAND, fill: PALETTE[f.band] }),
    el('path', { d: BOTTOM_BAND, fill: PALETTE[f.band] }),
    el('path', {
      d: `M0 ${BAND}H250M0 ${CARD_H - BAND}H250`,
      fill: 'none',
      stroke: PALETTE.ink,
      'stroke-width': 2,
    }),
    text(f.category, {
      x: 125,
      y: 28,
      'text-anchor': 'middle',
      'font-family': FONT_SANS,
      'font-size': 14,
      'font-weight': 700,
      'letter-spacing': 4,
      fill: PALETTE[f.on],
    }),
    corner(f),
    el('g', { transform: 'rotate(180 125 175)' }, corner(f)),
    el('circle', { cx: 125, cy: 130, r: 78, fill: seal.color, 'fill-opacity': seal.opacity }),
    glyph(f.art, 61, 66, 128, PALETTE.ink),
    text(f.name, {
      x: 125,
      y: 240,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': name.size,
      'font-weight': 700,
      fill: PALETTE.ink,
      textLength: name.textLength,
    }),
    el('path', { d: 'M80 256H170', stroke: PALETTE.brass, 'stroke-width': 2 }),
    text(f.footer, {
      x: 125,
      y: 284,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': footer.size,
      fill: PALETTE.ink,
      textLength: footer.textLength,
    }),
    el('rect', {
      x: 2,
      y: 2,
      width: CARD_W - 4,
      height: CARD_H - 4,
      rx: 13,
      fill: 'none',
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
  ].join('');
}

/** The back every card shares: oxblood, a double brass border and a brass seal. */
function back(): string {
  return [
    el('rect', { width: CARD_W, height: CARD_H, rx: 14, fill: PALETTE.oxblood }),
    el('rect', {
      x: 10,
      y: 10,
      width: 230,
      height: 330,
      rx: 8,
      fill: 'none',
      stroke: PALETTE.brass,
      'stroke-width': 3,
    }),
    el('rect', {
      x: 18,
      y: 18,
      width: 214,
      height: 314,
      rx: 5,
      fill: 'none',
      stroke: PALETTE.brass,
      'stroke-width': 1.5,
    }),
    el('circle', { cx: 125, cy: 175, r: 78, fill: 'none', stroke: PALETTE.brass, 'stroke-width': 2 }),
    el('circle', { cx: 125, cy: 175, r: 62, fill: PALETTE.brass, stroke: PALETTE.ink, 'stroke-width': 3 }),
    text('R·D', {
      x: 125,
      y: 192,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': 48,
      'font-weight': 700,
      fill: PALETTE.ink,
    }),
    text('ROOM FOR DOUBT', {
      x: 125,
      y: 312,
      'text-anchor': 'middle',
      'font-family': FONT_SANS,
      'font-size': 13,
      'font-weight': 700,
      'letter-spacing': 4,
      fill: PALETTE.ivory,
    }),
    el('rect', {
      x: 2,
      y: 2,
      width: CARD_W - 4,
      height: CARD_H - 4,
      rx: 13,
      fill: 'none',
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
  ].join('');
}

/** The envelope the Verdict's three cards are sealed in. */
function envelope(): string {
  return [
    el('rect', { width: CARD_W, height: CARD_H, rx: 6, fill: PALETTE.parchment }),
    el('path', {
      d: `M0 ${CARD_H}L125 312L250 ${CARD_H}`,
      fill: 'none',
      stroke: PALETTE.ink,
      'stroke-width': 2.5,
      'stroke-opacity': 0.6,
    }),
    el('path', { d: 'M0 0H250L125 170Z', fill: PALETTE.ivory, stroke: PALETTE.ink, 'stroke-width': 3 }),
    el('circle', { cx: 125, cy: 170, r: 36, fill: PALETTE.oxblood, stroke: PALETTE.ink, 'stroke-width': 2 }),
    el('circle', {
      cx: 125,
      cy: 170,
      r: 27,
      fill: 'none',
      stroke: PALETTE.ivory,
      'stroke-width': 1.5,
      'stroke-opacity': 0.6,
    }),
    text('V', {
      x: 125,
      y: 184,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': 40,
      'font-weight': 700,
      fill: PALETTE.ivory,
    }),
    el('path', { d: 'M45 236H205M45 288H205', stroke: PALETTE.brass, 'stroke-width': 2 }),
    text('THE VERDICT', {
      x: 125,
      y: 271,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': 26,
      'font-weight': 700,
      'letter-spacing': 3,
      fill: PALETTE.ink,
    }),
    el('rect', {
      x: 2,
      y: 2,
      width: CARD_W - 4,
      height: CARD_H - 4,
      rx: 5,
      fill: 'none',
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
  ].join('');
}

export function renderCards(): string {
  const content = new Map<string, string>([
    ...FACES.map((f) => [f.id, face(f)] as const),
    ['card-back', back()],
    ['verdict-envelope', envelope()],
  ]);
  const body = [
    el('rect', { width: SHEET_W, height: SHEET_H, fill: PALETTE.ink }),
    ...CARD_LAYOUT.map(
      ({ id, x, y }) => `<g id="${id}" transform="translate(${x} ${y})">${content.get(id) ?? ''}</g>`,
    ),
  ].join('\n');
  return svgDocument(
    {
      width: SHEET_W,
      height: SHEET_H,
      title: 'Room for Doubt: the cards',
      desc: 'Six Party cards and the card back, six Exhibit cards and the Verdict envelope, and nine Scene cards, each with its own pictogram.',
    },
    body,
  );
}
