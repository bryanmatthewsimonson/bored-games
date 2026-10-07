/*
 * The cover (spec section 6, D074): night at the Aldermoor Assize Courts, the evening before the verdict. A columned
 * portico over steps, a lit belfry with a clock showing midnight, storm clouds and rain, and a street lamp throwing
 * its long shadow up the steps. Flat shapes in the nine palette colours; the rain is placed by a fixed-seed generator,
 * so the file is the same every run.
 */
import { FONT_SERIF, PALETTE } from '../data.ts';
import { el, svgDocument, text } from '../svg.ts';

const WIDTH = 1200;
const HEIGHT = 800;
const GROUND = 700;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** A small linear congruential generator: the same stream for the same seed. */
function stream(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Rain: `count` slanted strokes scattered over the whole picture, drawn as one path. */
function rain(seed: number, count: number, opacity: number, width: number): string {
  const next = stream(seed);
  let d = '';
  for (let i = 0; i < count; i++) {
    const x = round1(next() * 1260 - 30);
    const y = round1(next() * HEIGHT);
    const len = round1(26 + next() * 26);
    d += `M${x} ${y}l${round1(-len * 0.28)} ${len}`;
  }
  return el('path', {
    d,
    fill: 'none',
    stroke: PALETTE.ivory,
    'stroke-width': width,
    'stroke-opacity': opacity,
    'stroke-linecap': 'round',
  });
}

/** Storm clouds as overlapping ellipses: [centre x, centre y, radius x, radius y]. */
const CLOUDS: readonly (readonly [number, number, number, number])[] = [
  [110, 60, 190, 46],
  [420, 36, 230, 44],
  [780, 60, 250, 50],
  [1100, 44, 210, 46],
  [40, 150, 170, 44],
  [310, 126, 210, 48],
  [640, 150, 240, 44],
  [960, 126, 220, 50],
  [1190, 170, 150, 40],
];

/** An arched window `w` wide and `h` tall with its sill at (x, y + h). */
const arch = (x: number, y: number, w: number, h: number): string =>
  `M${x} ${y + h}V${y + w / 2}A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2}V${y + h}Z`;

function window(x: number, y: number, lit: boolean): string {
  return el('path', {
    d: arch(x, y, 36, 60),
    fill: lit ? PALETTE.ochre : PALETTE.ink,
    'fill-opacity': lit ? 0.92 : 0.8,
    stroke: lit ? PALETTE.ink : PALETTE.slate,
    'stroke-width': 3,
  });
}

function column(cx: number): string {
  return el(
    'g',
    {},
    el('rect', {
      x: cx - 16,
      y: 472,
      width: 32,
      height: 168,
      fill: PALETTE.ivory,
      'fill-opacity': 0.62,
      stroke: PALETTE.ink,
      'stroke-width': 3,
    }),
    el('rect', {
      x: cx - 22,
      y: 466,
      width: 44,
      height: 10,
      fill: PALETTE.ivory,
      'fill-opacity': 0.8,
      stroke: PALETTE.ink,
      'stroke-width': 3,
    }),
    el('rect', {
      x: cx - 22,
      y: 632,
      width: 44,
      height: 10,
      fill: PALETTE.ivory,
      'fill-opacity': 0.8,
      stroke: PALETTE.ink,
      'stroke-width': 3,
    }),
    el('path', {
      d: `M${cx - 5} 478V630M${cx + 5} 478V630`,
      stroke: PALETTE.ink,
      'stroke-width': 1.5,
      'stroke-opacity': 0.35,
    }),
  );
}

/** The belfry on the roof: bell chamber, clock face at midnight, and a pyramid roof. */
function belfry(): string {
  return el(
    'g',
    { id: 'cover-belfry' },
    el('rect', {
      x: 540,
      y: 230,
      width: 120,
      height: 130,
      fill: PALETTE.umber,
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
    el('path', { d: arch(576, 242, 48, 56), fill: PALETTE.ochre, stroke: PALETTE.ink, 'stroke-width': 3 }),
    el('path', {
      d: 'M590 270H610Q610 260 600 256Q590 260 590 270ZM596 274H604',
      fill: PALETTE.ink,
      stroke: PALETTE.ink,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
    }),
    el('circle', { cx: 600, cy: 324, r: 24, fill: PALETTE.ivory, stroke: PALETTE.ink, 'stroke-width': 4 }),
    el('path', {
      d: 'M600 303V306M600 342V345M579 324H582M618 324H621',
      stroke: PALETTE.ink,
      'stroke-width': 2.5,
    }),
    el('path', {
      d: 'M600 324V308M600 324L593 314',
      stroke: PALETTE.ink,
      'stroke-width': 3,
      'stroke-linecap': 'round',
    }),
    el('path', { d: 'M524 232H676L600 176Z', fill: PALETTE.slate, stroke: PALETTE.ink, 'stroke-width': 4 }),
    el('path', { d: 'M600 176V164', stroke: PALETTE.brass, 'stroke-width': 4, 'stroke-linecap': 'round' }),
  );
}

function building(): string {
  const steps = [0, 1, 2, 3, 4].map((i) =>
    el(
      'g',
      {},
      el('rect', {
        x: 260 + i * 20,
        y: GROUND - 12 * (i + 1),
        width: 680 - i * 40,
        height: 12,
        fill: PALETTE.slate,
        'fill-opacity': 0.6,
        stroke: PALETTE.ink,
        'stroke-width': 3,
      }),
      el('path', {
        d: `M${264 + i * 20} ${GROUND - 12 * (i + 1) + 2}H${936 - i * 20}`,
        stroke: PALETTE.ivory,
        'stroke-width': 2,
        'stroke-opacity': 0.3,
      }),
    ),
  );
  const leftLit = [true, false, true, true];
  const rightLit = [false, true, true, false];
  const wings = [
    ...[250, 304].flatMap((x, c) => [
      window(x, 480, leftLit[c] ?? false),
      window(x, 574, leftLit[c + 2] ?? false),
    ]),
    ...[860, 914].flatMap((x, c) => [
      window(x, 480, rightLit[c] ?? false),
      window(x, 574, rightLit[c + 2] ?? false),
    ]),
  ];
  return el(
    'g',
    { id: 'cover-building' },
    el('rect', {
      x: 230,
      y: 450,
      width: 740,
      height: 252,
      fill: PALETTE.umber,
      'fill-opacity': 0.62,
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
    belfry(),
    el('rect', {
      x: 340,
      y: 440,
      width: 520,
      height: 30,
      fill: PALETTE.umber,
      stroke: PALETTE.ink,
      'stroke-width': 4,
    }),
    el('path', { d: 'M330 442H870L600 352Z', fill: PALETTE.umber, stroke: PALETTE.ink, 'stroke-width': 4 }),
    el('path', {
      d: 'M372 432H828L600 372Z',
      fill: 'none',
      stroke: PALETTE.brass,
      'stroke-width': 2.5,
      'stroke-opacity': 0.7,
    }),
    el('circle', { cx: 600, cy: 416, r: 9, fill: PALETTE.brass, stroke: PALETTE.ink, 'stroke-width': 2 }),
    el('rect', { x: 360, y: 470, width: 480, height: 170, fill: PALETTE.ink, 'fill-opacity': 0.9 }),
    el('path', { d: arch(578, 548, 44, 92), fill: PALETTE.ochre, stroke: PALETTE.ink, 'stroke-width': 3 }),
    ...[-200, -120, -40, 40, 120, 200].map((dx) => column(600 + dx)),
    ...wings,
    ...steps,
  );
}

/** A street lamp at the left, its glow, and its shadow thrown up the steps. */
function lamp(): string {
  return el(
    'g',
    { id: 'cover-lamp' },
    el('circle', { cx: 150, cy: 520, r: 190, fill: PALETTE.ochre, 'fill-opacity': 0.08 }),
    el('circle', { cx: 150, cy: 520, r: 110, fill: PALETTE.ochre, 'fill-opacity': 0.12 }),
    el('circle', { cx: 150, cy: 520, r: 56, fill: PALETTE.ochre, 'fill-opacity': 0.2 }),
    el('path', {
      d: `M142 ${GROUND + 4}L160 ${GROUND + 4}L668 ${GROUND - 36}L668 ${GROUND - 48}Z`,
      fill: PALETTE.ink,
      'fill-opacity': 0.62,
    }),
    el('rect', { x: 146, y: 540, width: 8, height: 160, fill: PALETTE.brass }),
    el('rect', { x: 138, y: 690, width: 24, height: 10, fill: PALETTE.brass }),
    el('path', {
      d: 'M132 540H168L160 506H140Z',
      fill: PALETTE.ochre,
      stroke: PALETTE.brass,
      'stroke-width': 4,
      'stroke-linejoin': 'round',
    }),
    el('path', { d: 'M134 506H166L150 486Z', fill: PALETTE.brass }),
  );
}

export function renderCover(): string {
  const next = stream(7);
  const clouds = CLOUDS.map(([cx, cy, rx, ry], i) =>
    el('ellipse', {
      cx,
      cy: cy + (next() > 0.5 ? 4 : 0),
      rx,
      ry,
      fill: PALETTE.slate,
      'fill-opacity': i < 4 ? 0.3 : 0.45,
    }),
  );
  const body = [
    el('rect', { width: WIDTH, height: HEIGHT, fill: PALETTE.ink }),
    ...clouds,
    el('ellipse', { cx: 600, cy: 96, rx: 500, ry: 78, fill: PALETTE.ink, 'fill-opacity': 0.4 }),
    el('path', {
      d: 'M1090 36L1056 134H1086L1040 270L1130 112H1096L1130 36Z',
      fill: PALETTE.ivory,
      'fill-opacity': 0.85,
    }),
    el('rect', {
      y: GROUND,
      width: WIDTH,
      height: HEIGHT - GROUND,
      fill: PALETTE.slate,
      'fill-opacity': 0.28,
    }),
    building(),
    lamp(),
    rain(11, 150, 0.2, 1.5),
    rain(23, 90, 0.34, 2),
    el('rect', {
      x: 14,
      y: 14,
      width: WIDTH - 28,
      height: HEIGHT - 28,
      fill: 'none',
      stroke: PALETTE.brass,
      'stroke-width': 3,
    }),
    text('ROOM FOR DOUBT', {
      x: 600,
      y: 104,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': 80,
      'font-weight': 700,
      'letter-spacing': 6,
      fill: PALETTE.parchment,
    }),
    text('Leave no room for doubt.', {
      x: 600,
      y: 146,
      'text-anchor': 'middle',
      'font-family': FONT_SERIF,
      'font-size': 30,
      'font-style': 'italic',
      fill: PALETTE.brass,
    }),
  ].join('\n');
  return svgDocument(
    {
      width: WIDTH,
      height: HEIGHT,
      title: 'Room for Doubt: the cover',
      desc: 'Night at the Aldermoor Assize Courts: a columned portico and steps, a lit belfry with a clock at midnight, storm clouds and rain, and a street lamp throwing a long shadow across the steps.',
    },
    el('g', { id: 'cover' }, body),
  );
}
