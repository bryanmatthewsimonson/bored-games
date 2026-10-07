/*
 * The board plate (spec section 6, D074): `board.svg`, drawn from the grid in `board.txt` so the picture cannot drift
 * from the rules. One 48-unit cell per square inside a 60-unit margin; every id and `data-door` mark below is what the
 * art test and a future renderer look for.
 */
import { createHash } from 'node:crypto';
import { type Board, type Dir, type Door, PASSAGES, type RoomId, SIZE, type Square } from '../board.ts';
import {
  FONT_SANS,
  FONT_SERIF,
  fitText,
  ON_ACCENT,
  PALETTE,
  PARTIES,
  type PaletteName,
  type PartyInfo,
  SCENES,
} from '../data.ts';
import { EMBLEMS, glyph, SCENE_GLYPHS } from '../glyphs.ts';
import { el, svgDocument, text } from '../svg.ts';

export const CELL = 48;
export const MARGIN = 60;
const FIELD = SIZE * CELL;
const TOTAL = FIELD + 2 * MARGIN;

/** The pixel position of a grid line. */
const px = (n: number): number => MARGIN + n * CELL;
const round1 = (n: number): number => Math.round(n * 10) / 10;

const TINT: Readonly<Record<RoomId, PaletteName>> = {
  courtroom: 'oxblood',
  chambers: 'umber',
  jury: 'slate',
  robing: 'teal',
  registry: 'ochre',
  store: 'oxblood',
  cells: 'slate',
  belfry: 'teal',
  gallery: 'umber',
};

const ARCH_ROTATION: Readonly<Record<Dir, number>> = { '^': 0, '>': 90, v: 180, '<': 270 };

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const width = (r: Rect): number => r.x1 - r.x0 + 1;
const height = (r: Rect): number => r.y1 - r.y0 + 1;

/** The squares' bounding box (inclusive); a room that is not a plain rectangle cannot be drawn as one block. */
function roomRect(id: RoomId, squares: readonly Square[]): Rect {
  const xs = squares.map((s) => s.x);
  const ys = squares.map((s) => s.y);
  const rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  if (width(rect) * height(rect) !== squares.length) throw new Error(`room ${id} is not a rectangle`);
  return rect;
}

const centre = (r: Rect): { x: number; y: number } => ({
  x: px(r.x0) + (width(r) * CELL) / 2,
  y: px(r.y0) + (height(r) * CELL) / 2,
});

/** A brass doorway in the door's square, its curved head toward the doorstep. */
function doorArch(d: Door): string {
  const x = px(d.door.x) + CELL / 2;
  const y = px(d.door.y) + CELL / 2;
  return el(
    'g',
    { 'data-door': d.room, transform: `translate(${x} ${y}) rotate(${ARCH_ROTATION[d.dir]})` },
    el('path', {
      d: 'M-15 24V-9A15 15 0 0 1 15 -9V24Z',
      fill: PALETTE.brass,
      stroke: PALETTE.ink,
      'stroke-width': 2,
    }),
    el('path', { d: 'M-8 24V-7A8 8 0 0 1 8 -7V24Z', fill: PALETTE.ivory }),
  );
}

/** A trapdoor with a ring: the mouth of an Old Gaol Passage, set in the room's inner corner nearest the board's. */
function hatch(rect: Rect, passage: string): string {
  const left = rect.x0 === 0;
  const top = rect.y0 === 0;
  const x = px(left ? rect.x0 + 1 : rect.x1 - 1) + CELL / 2;
  const y = px(top ? rect.y0 + 1 : rect.y1 - 1) + CELL / 2;
  return el(
    'g',
    { 'data-passage': passage, transform: `translate(${x} ${y})` },
    el('rect', {
      x: -15,
      y: -15,
      width: 30,
      height: 30,
      rx: 3,
      fill: PALETTE.parchment,
      stroke: PALETTE.ink,
      'stroke-width': 3,
    }),
    el('path', { d: 'M-5 -15V15M5 -15V15', fill: 'none', stroke: PALETTE.ink, 'stroke-width': 2 }),
    el('path', { d: 'M-11 -10H-6M6 -10H11', fill: 'none', stroke: PALETTE.ink, 'stroke-width': 3 }),
    el('circle', { cx: 0, cy: 7, r: 3.5, fill: PALETTE.parchment, stroke: PALETTE.ink, 'stroke-width': 2.5 }),
  );
}

function room(board: Board, id: RoomId): string {
  const scene = SCENES.find((s) => s.id === id);
  if (scene === undefined) throw new Error(`no scene for ${id}`);
  const rect = roomRect(id, board.rooms[id]);
  const x = px(rect.x0);
  const y = px(rect.y0);
  const w = width(rect) * CELL;
  const h = height(rect) * CELL;
  // The label block sits inside the room's inner squares, clear of the doors on its edge squares.
  const { x: cx, y: cy } = centre(rect);
  const name = fitText(scene.name, 22, w - 2 * CELL - 8);
  const top = cy - 46;
  const passage = PASSAGES.find(([a, b]) => a === id || b === id);
  return el(
    'g',
    { id: `room-${id}` },
    el('rect', { x, y, width: w, height: h, fill: PALETTE.parchment }),
    el('rect', {
      x,
      y,
      width: w,
      height: h,
      fill: PALETTE[TINT[id]],
      'fill-opacity': 0.3,
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
    glyph(SCENE_GLYPHS[id], cx - 32, top, 64, PALETTE.ink),
    text(scene.name, {
      x: cx,
      y: top + 87,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': name.size,
      'font-weight': 700,
      fill: PALETTE.ink,
      textLength: name.textLength,
      lengthAdjust: name.textLength === undefined ? undefined : 'spacingAndGlyphs',
    }),
    passage === undefined ? undefined : hatch(rect, `${passage[0]}-${passage[1]}`),
    ...board.doors.filter((d) => d.room === id).map(doorArch),
  );
}

/** A passage runs under the rooms, so only its stretch across the corridors shows. */
function passage(board: Board, a: RoomId, b: RoomId): string {
  const from = centre(roomRect(a, board.rooms[a]));
  const to = centre(roomRect(b, board.rooms[b]));
  return el(
    'g',
    { id: `passage-${a}-${b}` },
    el('line', {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke: PALETTE.ink,
      'stroke-width': 5,
      'stroke-opacity': 0.55,
      'stroke-dasharray': '16 12',
      'stroke-linecap': 'round',
    }),
  );
}

/** The Rotunda: a dome seen from above, ribbed, with the strongbox that holds the Verdict at its centre. */
function rotunda(rect: Rect): string {
  const x = px(rect.x0);
  const y = px(rect.y0);
  const w = width(rect) * CELL;
  const h = height(rect) * CELL;
  const { x: cx, y: cy } = centre(rect);
  const outer = Math.min(w, h) / 2 - 12;
  const inner = outer - 28;
  const ribs = Array.from({ length: 16 }, (_, k) => {
    const a = (k * Math.PI) / 8;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return `M${round1(cx + inner * c)} ${round1(cy + inner * s)}L${round1(cx + outer * c)} ${round1(cy + outer * s)}`;
  }).join('');
  return el(
    'g',
    { id: 'rotunda' },
    el('rect', { x, y, width: w, height: h, fill: PALETTE.ink }),
    el('circle', { cx, cy, r: inner, fill: PALETTE.slate, 'fill-opacity': 0.35 }),
    el('circle', { cx, cy, r: outer, fill: 'none', stroke: PALETTE.brass, 'stroke-width': 6 }),
    el('circle', { cx, cy, r: inner, fill: 'none', stroke: PALETTE.brass, 'stroke-width': 3 }),
    el('path', { d: ribs, fill: 'none', stroke: PALETTE.brass, 'stroke-width': 2 }),
    el(
      'g',
      { transform: `translate(${cx} ${cy - 14})` },
      el('rect', {
        x: -34,
        y: -8,
        width: 68,
        height: 40,
        rx: 4,
        fill: PALETTE.ivory,
        stroke: PALETTE.brass,
        'stroke-width': 3,
      }),
      el('path', {
        d: 'M-34 -8V-22Q-34 -30 -26 -30H26Q34 -30 34 -22V-8Z',
        fill: PALETTE.ivory,
        stroke: PALETTE.brass,
        'stroke-width': 3,
      }),
      el('path', { d: 'M-18 -30V32M18 -30V32', fill: 'none', stroke: PALETTE.brass, 'stroke-width': 3 }),
      el('circle', { cx: 0, cy: 10, r: 6, fill: PALETTE.brass, stroke: PALETTE.ink, 'stroke-width': 2 }),
      el('path', { d: 'M0 8V13', stroke: PALETTE.ink, 'stroke-width': 2, 'stroke-linecap': 'round' }),
    ),
    text('VERDICT', {
      x: cx,
      y: cy + 62,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': 24,
      'font-weight': 700,
      'letter-spacing': 5,
      fill: PALETTE.parchment,
    }),
  );
}

type Side = 'top' | 'right' | 'bottom' | 'left';

function sideOf(s: Square): Side {
  if (s.y === 0) return 'top';
  if (s.x === SIZE - 1) return 'right';
  if (s.y === SIZE - 1) return 'bottom';
  return 'left';
}

/**
 * The plate outside the board edge: the party's emblem on its accent disc, its monogram and its door's name.
 * Drawn with its origin on the edge and "outward" up, or down on the bottom edge so the text stays upright; the
 * side edges rotate it to run along the edge.
 */
function plaque(party: PartyInfo, down: boolean): string {
  const nameY = down ? 14 : -6;
  const discY = down ? 35 : -35;
  const name = fitText(party.entrance, 13, 120, 11);
  return el(
    'g',
    {},
    text(party.entrance, {
      x: 0,
      y: nameY,
      'text-anchor': 'middle',
      'font-family': FONT_SANS,
      'font-size': name.size,
      fill: PALETTE.ink,
      textLength: name.textLength,
      lengthAdjust: name.textLength === undefined ? undefined : 'spacingAndGlyphs',
    }),
    el('circle', {
      cx: -18,
      cy: discY,
      r: 14,
      fill: PALETTE[party.accent],
      stroke: PALETTE.ink,
      'stroke-width': 2,
    }),
    glyph(EMBLEMS[party.emblem], -28, discY - 10, 20, PALETTE[ON_ACCENT[party.accent]]),
    text(party.monogram, {
      x: 0,
      y: discY + 5.5,
      'font-family': FONT_SANS,
      'font-size': 16,
      'font-weight': 700,
      fill: PALETTE.ink,
    }),
  );
}

function entrance(board: Board, n: number): string {
  const square = board.entrances[n - 1];
  const party = PARTIES[n - 1];
  if (square === undefined || party === undefined) throw new Error(`entrance ${n} is missing`);
  const cx = px(square.x) + CELL / 2;
  const cy = px(square.y) + CELL / 2;
  const side = sideOf(square);
  const anchor = {
    top: { x: cx, y: MARGIN, turn: 0 },
    right: { x: MARGIN + FIELD, y: cy, turn: 90 },
    bottom: { x: cx, y: MARGIN + FIELD, turn: 0 },
    left: { x: MARGIN, y: cy, turn: -90 },
  }[side];
  return el(
    'g',
    { id: `entrance-${n}`, 'data-party': party.id },
    el('circle', { cx, cy, r: 21, fill: PALETTE.brass, stroke: PALETTE.ink, 'stroke-width': 3 }),
    text(String(n), {
      x: cx,
      y: cy + 9,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': 26,
      'font-weight': 700,
      fill: PALETTE.ink,
    }),
    el(
      'g',
      { transform: `translate(${anchor.x} ${anchor.y}) rotate(${anchor.turn})` },
      plaque(party, side === 'bottom'),
    ),
  );
}

/** Column outlines in the west margin, either side of the Prisoners' Door plate: the Colonnade along the corridor. */
function colonnade(): string {
  const column = (row: number): string => {
    const cy = px(row) + CELL / 2;
    return el(
      'g',
      { transform: `translate(30 ${cy})` },
      el('rect', {
        x: -8,
        y: -14,
        width: 16,
        height: 28,
        fill: 'none',
        stroke: PALETTE.ink,
        'stroke-width': 2,
      }),
      el('rect', {
        x: -11,
        y: -19,
        width: 22,
        height: 5,
        fill: 'none',
        stroke: PALETTE.ink,
        'stroke-width': 2,
      }),
      el('rect', {
        x: -11,
        y: 14,
        width: 22,
        height: 5,
        fill: 'none',
        stroke: PALETTE.ink,
        'stroke-width': 2,
      }),
    );
  };
  return el('g', { id: 'colonnade', opacity: 0.8 }, ...[6, 7, 8, 9, 10, 14, 15, 16].map(column));
}

/** The whole plate, drawn from `board`; `boardText` is hashed into a comment so a stale plate is detectable. */
export function renderBoard(board: Board, boardText: string): string {
  const hash = createHash('sha256').update(boardText).digest('hex');
  const squares = board.corridor.map((s) => `M${px(s.x)} ${px(s.y)}h${CELL}v${CELL}h-${CELL}Z`).join('');
  const body = [
    el('rect', { width: TOTAL, height: TOTAL, fill: PALETTE.parchment }),
    el('rect', {
      x: 6,
      y: 6,
      width: TOTAL - 12,
      height: TOTAL - 12,
      fill: 'none',
      stroke: PALETTE.brass,
      'stroke-width': 3,
    }),
    el('rect', { x: MARGIN, y: MARGIN, width: FIELD, height: FIELD, fill: PALETTE.ivory }),
    el('path', {
      id: 'corridor',
      d: squares,
      fill: PALETTE.ivory,
      stroke: PALETTE.brass,
      'stroke-width': 1.5,
      'stroke-opacity': 0.55,
    }),
    ...PASSAGES.map(([a, b]) => passage(board, a, b)),
    ...SCENES.map((s) => room(board, s.id)),
    rotunda(board.rotunda),
    colonnade(),
    ...PARTIES.map((_, i) => entrance(board, i + 1)),
    el('rect', {
      x: MARGIN,
      y: MARGIN,
      width: FIELD,
      height: FIELD,
      fill: 'none',
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
  ].join('\n');
  return svgDocument(
    {
      width: TOTAL,
      height: TOTAL,
      title: 'Room for Doubt: the board',
      desc: 'Plan of the Aldermoor Assize Courts: nine rooms and the Rotunda round a grid of corridor squares, six numbered Entrances on the outer ring, a door on each room and the two Old Gaol Passages between the corner rooms.',
      comment: `board.txt sha256: ${hash}`,
    },
    body,
  );
}
