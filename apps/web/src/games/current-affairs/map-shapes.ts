/*
 * The drawing of the Commonwealth (docs/games/current-affairs/RULES.md, "The map"), worked out once from the city
 * points of the package's atlas: the coastline, the six regions as merged Voronoi cells of their cities, the Long
 * Water running south to the gulf, the peaks of the Copper Range, and where each city's name and each line's cost
 * badge go so that they keep clear of the lines. The river and the range are scenery: they set no costs. Pure and deterministic: no randomness, only a
 * fixed hash, so every client draws the same land. Presentation only; the engine never reads it.
 * Original art, CC0-1.0 (packages/games/current-affairs/ART-LICENSE.md).
 */

import { CITY_COUNT, CITY_REGION, LINKS, REGIONS } from '@bored-games/current-affairs';
import { ATLAS_HEIGHT, ATLAS_WIDTH, CITY_POINTS } from '@bored-games/current-affairs/atlas';
import { CURRENT_THEME } from '@bored-games/current-affairs/theme';

export type Pt = readonly [number, number];

export const W = ATLAS_WIDTH;
export const H = ATLAS_HEIGHT;
export const CITY_R = 17;

const pt = (c: number): Pt => CITY_POINTS[c] ?? [0, 0];

/* ---------------------------------------------------------------- small helpers */

/** A fixed hash of two numbers to [0, 1). */
function hash(a: number, b: number): number {
  let h =
    Math.imul(Math.round(a * 16) ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(Math.round(b * 16) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** A closed (or open) Catmull-Rom curve through `pts`, as cubic Béziers. */
export function smoothPath(pts: readonly Pt[], closed: boolean): string {
  const n = pts.length;
  if (n < 2) return '';
  const at = (i: number): Pt => {
    if (closed) return pts[((i % n) + n) % n] as Pt;
    return pts[Math.max(0, Math.min(n - 1, i))] as Pt;
  };
  const first = at(0);
  let d = `M${f1(first[0])} ${f1(first[1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** `pts` with each segment cut in `parts` and the cut points pushed sideways by a fixed wobble of `amp`. */
function crinkle(pts: readonly Pt[], parts: number, amp: number, closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i] as Pt;
    const b = pts[(i + 1) % n] as Pt;
    out.push(a);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    for (let k = 1; k < parts; k++) {
      const t = k / parts;
      const off = (hash(a[0] + k * 7, a[1] + b[0]) - 0.5) * 2 * amp;
      out.push([a[0] + dx * t - (dy / len) * off, a[1] + dy * t + (dx / len) * off]);
    }
  }
  if (!closed) out.push(pts[n - 1] as Pt);
  return out;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r: Pt = [b[0] - a[0], b[1] - a[1]];
  const s: Pt = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function segmentHitsBox(a: Pt, b: Pt, box: Box): boolean {
  if (Math.max(a[0], b[0]) < box.x0 || Math.min(a[0], b[0]) > box.x1) return false;
  if (Math.max(a[1], b[1]) < box.y0 || Math.min(a[1], b[1]) > box.y1) return false;
  const inside = (p: Pt) => p[0] >= box.x0 && p[0] <= box.x1 && p[1] >= box.y0 && p[1] <= box.y1;
  if (inside(a) || inside(b)) return true;
  // The segment crosses the box only if the box's corners are not all on one side of its line.
  const side = (x: number, y: number) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const s0 = side(box.x0, box.y0);
  const s1 = side(box.x1, box.y0);
  const s2 = side(box.x1, box.y1);
  const s3 = side(box.x0, box.y1);
  return !((s0 > 0 && s1 > 0 && s2 > 0 && s3 > 0) || (s0 < 0 && s1 < 0 && s2 < 0 && s3 < 0));
}

const boxesMeet = (p: Box, q: Box): boolean => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;

/* ---------------------------------------------------------------- the coast */

/**
 * The coast, clockwise from the north-west: down the western shore, round the southern cape, east along the gulf and
 * the southern shore, then up the long eastern coast. The land runs on past the sheet's northern edge. Each point
 * keeps 38 or more from every city (the art test checks it).
 */
export const COAST_POINTS: readonly Pt[] = [
  [203, -14],
  [182, 36],
  [130, 72],
  [92, 118],
  [42, 150],
  [38, 190],
  [63, 228],
  [81, 262],
  [94, 312],
  [110, 352],
  [117, 404],
  [169, 424],
  [182, 470],
  [212, 516],
  [221, 566],
  [185, 612],
  [178, 660],
  [228, 682],
  [275, 662],
  [309, 630],
  [343, 594],
  [381, 566],
  [436, 578],
  [490, 568],
  [542, 586],
  [591, 574],
  [632, 556],
  [674, 552],
  [712, 566],
  [757, 548],
  [800, 566],
  [844, 556],
  [882, 528],
  [914, 494],
  [940, 462],
  [962, 420],
  [965, 372],
  [968, 318],
  [972, 262],
  [970, 202],
  [965, 150],
  [957, 108],
  [951, 62],
  [962, 22],
  [959, -14],
];

const COAST_FINE: readonly Pt[] = crinkle(COAST_POINTS, 3, 6, false);
const LAND_POINTS: readonly Pt[] = [...COAST_FINE, [968, -60], [168, -60]];

/** The land, as one closed path. */
export const LAND_PATH: string = smoothPath(LAND_POINTS, true);
/** The coastline alone (open: the land runs on past the sheet's northern edge). */
export const COAST_PATH: string = smoothPath(COAST_FINE, false);

/** Two islets: one in the gulf, one off the eastern coast. */
export const ISLETS: readonly string[] = [
  smoothPath(
    crinkle(
      [
        [372, 630],
        [398, 620],
        [418, 634],
        [402, 652],
        [376, 648],
      ],
      2,
      2.5,
      true,
    ),
    true,
  ),
  smoothPath(
    crinkle(
      [
        [940, 556],
        [958, 548],
        [972, 562],
        [956, 578],
      ],
      2,
      2,
      true,
    ),
    true,
  ),
];

/* ---------------------------------------------------------------- the regions */

interface Cell {
  /** Vertices; `edge[k]` is the city across the edge from vertex k to vertex k+1, or -1 for the sheet's edge. */
  readonly pts: Pt[];
  readonly edge: number[];
}

const BOX: readonly Pt[] = [
  [-30, -30],
  [W + 30, -30],
  [W + 30, H + 30],
  [-30, H + 30],
];

function voronoiCell(i: number): Cell {
  let pts: Pt[] = BOX.map((p) => p);
  let edge: number[] = BOX.map(() => -1);
  const p = pt(i);
  for (let j = 0; j < CITY_COUNT; j++) {
    if (j === i) continue;
    const q = pt(j);
    const nx = q[0] - p[0];
    const ny = q[1] - p[1];
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    const side = (v: Pt) => (v[0] - mx) * nx + (v[1] - my) * ny;
    const nextPts: Pt[] = [];
    const nextEdge: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k] as Pt;
      const b = pts[(k + 1) % pts.length] as Pt;
      const sa = side(a);
      const sb = side(b);
      const label = edge[k] as number;
      const cut = (): Pt => {
        const t = sa / (sa - sb);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      };
      if (sa <= 0 && sb <= 0) {
        nextPts.push(a);
        nextEdge.push(label);
      } else if (sa <= 0 && sb > 0) {
        nextPts.push(a, cut());
        nextEdge.push(label, j);
      } else if (sa > 0 && sb <= 0) {
        nextPts.push(cut());
        nextEdge.push(label);
      }
    }
    pts = nextPts;
    edge = nextEdge;
  }
  return { pts, edge };
}

const CELLS: readonly Cell[] = Array.from({ length: CITY_COUNT }, (_, i) => voronoiCell(i));

/** The points strictly between `a` and `b` of the shared edge's wobble, in the direction a → b. */
function wobble(a: Pt, b: Pt): Pt[] {
  const flip = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const [p, q] = flip ? [b, a] : [a, b];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (len < 24) return [];
  const parts = len > 90 ? 4 : 2;
  const amp = Math.min(9, len * 0.07);
  const mids = crinkle([p, q], parts, amp, false).slice(1, -1);
  return flip ? mids.reverse() : mids;
}

/** Each cell's outline with its shared edges wobbled the same way from both sides. */
function cellPath(c: Cell): string {
  const out: Pt[] = [];
  for (let k = 0; k < c.pts.length; k++) {
    const a = c.pts[k] as Pt;
    const b = c.pts[(k + 1) % c.pts.length] as Pt;
    out.push(a);
    if ((c.edge[k] as number) >= 0) out.push(...wobble(a, b));
  }
  return `M${out.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L')}Z`;
}

/** Each region's area: the cells of its seven cities, as one path (clip it to the land). */
export const REGION_PATHS: readonly string[] = REGIONS.map((_, r) =>
  CELLS.filter((_, i) => CITY_REGION[i] === r)
    .map(cellPath)
    .join(''),
);

/** The border between two regions, by the pair of region indices "a-b" (a < b). */
export const REGION_BORDERS: readonly { readonly a: number; readonly b: number; readonly d: string }[] =
  (() => {
    const byPair = new Map<string, string>();
    CELLS.forEach((c, i) => {
      for (let k = 0; k < c.pts.length; k++) {
        const j = c.edge[k] as number;
        if (j < 0 || j < i) continue;
        const ri = CITY_REGION[i] as number;
        const rj = CITY_REGION[j] as number;
        if (ri === rj) continue;
        const a = c.pts[k] as Pt;
        const b = c.pts[(k + 1) % c.pts.length] as Pt;
        const line = [a, ...wobble(a, b), b];
        const key = `${Math.min(ri, rj)}-${Math.max(ri, rj)}`;
        byPair.set(key, `${byPair.get(key) ?? ''}M${line.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L')}`);
      }
    });
    return [...byPair].map(([key, d]) => {
      const [a, b] = key.split('-').map(Number);
      return { a: a as number, b: b as number, d };
    });
  })();

/* ---------------------------------------------------------------- the Long Water */

/** The Long Water, from the northern hills south through the open country east of the heartland to the gulf. */
const RIVER_POINTS: readonly Pt[] = [
  [668, -14],
  [662, 40],
  [654, 96],
  [652, 150],
  [644, 204],
  [640, 256],
  [636, 306],
  [646, 352],
  [652, 398],
  [646, 446],
  [656, 494],
  [662, 530],
  [668, 580],
];

const RIVER_FINE: readonly Pt[] = crinkle(RIVER_POINTS, 2, 3, false);
/** The Long Water, north to south, into the gulf. */
export const RIVER_PATH: string = smoothPath(RIVER_FINE, false);
/** A stretch beside the river, north to south, for its name. */
export const RIVER_LABEL_PATH: string = smoothPath(
  RIVER_FINE.filter((p) => p[1] >= 0 && p[1] <= 110).map((p): Pt => [p[0] + 10, p[1]]),
  false,
);

/** Where a line crosses the Long Water, with the line's direction, for a little bridge. */
export const BRIDGES: readonly { readonly x: number; readonly y: number; readonly angle: number }[] = (() => {
  const out: { x: number; y: number; angle: number }[] = [];
  for (const [a, b] of LINKS) {
    const pa = pt(a);
    const pb = pt(b);
    for (let k = 0; k + 1 < RIVER_FINE.length; k++) {
      const hit = segmentsCross(pa, pb, RIVER_FINE[k] as Pt, RIVER_FINE[k + 1] as Pt);
      if (hit) {
        out.push({ x: hit[0], y: hit[1], angle: (Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) * 180) / Math.PI });
        break;
      }
    }
  }
  return out;
})();

/* ---------------------------------------------------------------- clearances */

const SEGMENTS: readonly (readonly [Pt, Pt])[] = LINKS.map(([a, b]) => [pt(a), pt(b)]);

const clearOfLines = (p: Pt): number => Math.min(...SEGMENTS.map(([a, b]) => distToSegment(p, a, b)));
const clearOfCities = (p: Pt): number =>
  Math.min(...CITY_POINTS.map((c) => Math.hypot(c[0] - p[0], c[1] - p[1])));

/* ---------------------------------------------------------------- lettering */

export const REGION_NAME_SIZE = 17;
export const REGION_NAME_SPACING = 3;
const regionNameWidth = (r: number): number =>
  CURRENT_THEME.regions[REGIONS[r] ?? 'frost'].length * (REGION_NAME_SIZE * 0.8 + REGION_NAME_SPACING);
const REGION_NAME_H = REGION_NAME_SIZE * 0.78;
const RANGE_W = 128;
const RANGE_H = 12;

/** The box a line of lettering `w` wide and `h` high takes, its baseline's middle at (x, y). */
const letteringBox = (x: number, y: number, w: number, h: number): Box => ({
  x0: x - w / 2,
  y0: y - h,
  x1: x + w / 2,
  y1: y + 2,
});

/**
 * Each region's name's baseline middle, placed by hand in open ground; `letteringClashes` checks them. A coastal
 * region with no room among its cities has its name lettered offshore, in its own tint, as charts do.
 */
export const REGION_NAME_SPOTS: readonly Pt[] = [
  [780, 66],
  [402, 72],
  [216, 78],
  [774, 528],
  [112, 548],
  [520, 628],
];
/** The Copper Range's name's baseline middle. */
export const RANGE_NAME_SPOT: Pt = [430, 38];

const LETTERING_BOXES: readonly Box[] = [
  ...REGION_NAME_SPOTS.map((p, r) => letteringBox(p[0], p[1], regionNameWidth(r), REGION_NAME_H)),
  letteringBox(RANGE_NAME_SPOT[0], RANGE_NAME_SPOT[1], RANGE_W, RANGE_H),
];

/* ---------------------------------------------------------------- badges */

/** Where along a line its badge may sit, middle first; never on a medallion. */
const SLIDES: readonly number[] = [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8];

const badgeBox = (p: Pt, l: number): Box => {
  const half = LINKS[l]?.[2] === 0 ? 16 : 12;
  return { x0: p[0] - half, y0: p[1] - 9, x1: p[0] + half, y1: p[1] + 9 };
};

/**
 * Where each line's cost badge sits: its middle, slid along the line away from cities, the river, the lettering and
 * (on the second pass) the cities' names.
 */
function slideBadges(names: readonly Box[]): Pt[] {
  return LINKS.map(([a, b], l) => {
    const pa = pt(a);
    const pb = pt(b);
    let best: Pt = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    let bestScore = -Infinity;
    for (const t of SLIDES) {
      const p: Pt = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
      const river = Math.min(...RIVER_FINE.map((r) => Math.hypot(r[0] - p[0], r[1] - p[1])));
      const box = badgeBox(p, l);
      const lettering = LETTERING_BOXES.some((q) => boxesMeet(q, box)) ? 80 : 0;
      const named = names.filter((q) => boxesMeet(q, box)).length * 50;
      const clear = clearOfCities(p);
      const onMedallion = clear < CITY_R + 13 ? 200 : 0;
      const score =
        Math.min(clear, 60) +
        Math.min(river, 22) * 2 -
        Math.abs(t - 0.5) * 20 -
        lettering -
        named -
        onMedallion;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  });
}

/** Each line's possible badge boxes: every slide that keeps off the medallions and the lettering. */
const BADGE_ROOM: readonly (readonly Box[])[] = LINKS.map(([a, b], l) => {
  const pa = pt(a);
  const pb = pt(b);
  const room = SLIDES.map((t): Pt => [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t])
    .filter((p) => clearOfCities(p) >= CITY_R + 13)
    .map((p) => badgeBox(p, l))
    .filter((box) => !LETTERING_BOXES.some((q) => boxesMeet(q, box)));
  return room.length > 0 ? room : [badgeBox([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], l)];
});

/* ---------------------------------------------------------------- city names */

export const NAME_SIZE = 15;
const charW = NAME_SIZE * 0.66;

export interface NameSpot {
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
}

function nameBox(s: NameSpot, chars: number): Box {
  const w = chars * charW;
  const x0 = s.anchor === 'start' ? s.x : s.anchor === 'end' ? s.x - w : s.x - w / 2;
  return { x0: x0 - 2, y0: s.y - NAME_SIZE * 0.8, x1: x0 + w + 2, y1: s.y + NAME_SIZE * 0.25 };
}

/** Whether `box` comes within `pad` of city `c`'s medallion. */
function meetsCity(box: Box, c: number, pad = 2): boolean {
  const [x, y] = pt(c);
  const dx = Math.max(box.x0 - x, 0, x - box.x1);
  const dy = Math.max(box.y0 - y, 0, y - box.y1);
  return Math.hypot(dx, dy) < CITY_R + pad;
}

/** Whether `p` lies on land (the coast's polygon, before smoothing; close enough to keep lettering ashore). */
function onLand(p: Pt): boolean {
  let inside = false;
  const poly = LAND_POINTS;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt;
    const b = poly[j] as Pt;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

/** The places a city's name may go: below, above, beside, or at a corner. */
function nameOptions(c: number): NameSpot[] {
  const [x, y] = pt(c);
  const d = CITY_R + 5;
  return [
    { x, y: y + d + NAME_SIZE * 0.72, anchor: 'middle' },
    { x, y: y - d - 3, anchor: 'middle' },
    { x: x + d, y: y + NAME_SIZE * 0.32, anchor: 'start' },
    { x: x - d, y: y + NAME_SIZE * 0.32, anchor: 'end' },
    { x: x + d - 6, y: y + d + NAME_SIZE * 0.5, anchor: 'start' },
    { x: x - d + 6, y: y + d + NAME_SIZE * 0.5, anchor: 'end' },
    { x: x + d - 6, y: y - d, anchor: 'start' },
    { x: x - d + 6, y: y - d, anchor: 'end' },
    { x: x + d - 2, y: y - 10, anchor: 'start' },
    { x: x - d + 2, y: y - 10, anchor: 'end' },
    { x: x + d - 2, y: y + 18, anchor: 'start' },
    { x: x - d + 2, y: y + 18, anchor: 'end' },
    { x, y: y + d + NAME_SIZE * 0.72 + 8, anchor: 'middle' },
    { x, y: y - d - 11, anchor: 'middle' },
  ];
}

/**
 * Each city's name position, for these names: clear of the lines, cities and each other where it can be, and never
 * where it would leave a line's badge nowhere to go (badges then slide clear of the names).
 */
export function placeNames(names: readonly string[]): readonly NameSpot[] {
  const spots: (NameSpot | null)[] = Array.from({ length: CITY_COUNT }, () => null);
  const boxes: (Box | null)[] = Array.from({ length: CITY_COUNT }, () => null);
  for (let pass = 0; pass < 3; pass++) {
    for (let c = 0; c < CITY_COUNT; c++) {
      const len = (names[c] ?? '').length;
      let best = nameOptions(c)[0] as NameSpot;
      let bestScore = Infinity;
      nameOptions(c).forEach((o, rank) => {
        const box = nameBox(o, len);
        let score = rank * 0.6;
        for (const [a, b] of SEGMENTS) if (segmentHitsBox(a, b, box)) score += 4;
        // A name may cover part of a line, but never every place its badge could go; a free tag least of all.
        BADGE_ROOM.forEach((room, l) => {
          if (!room.some((b) => boxesMeet(b, box))) return;
          const open = room.filter((b) => !boxes.some((q, k) => k !== c && q !== null && boxesMeet(q, b)));
          if (open.every((b) => boxesMeet(b, box))) score += LINKS[l]?.[2] === 0 ? 200 : 60;
          else score += 2;
        });
        for (const b of LETTERING_BOXES) if (boxesMeet(b, box)) score += 20;
        if (RIVER_FINE.some((p) => p[0] > box.x0 && p[0] < box.x1 && p[1] > box.y0 - 6 && p[1] < box.y1 + 6))
          score += 6;
        for (let k = 0; k < CITY_COUNT; k++) if (k !== c && meetsCity(box, k)) score += 40;
        boxes.forEach((b, k) => {
          if (k !== c && b && boxesMeet(b, box)) score += 50;
        });
        // A name must read as its own city's: nearer it than any other.
        const mid: Pt = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
        const own = Math.hypot(mid[0] - pt(c)[0], mid[1] - pt(c)[1]);
        for (let k = 0; k < CITY_COUNT; k++) {
          if (k === c) continue;
          const other = Math.hypot(mid[0] - pt(k)[0], mid[1] - pt(k)[1]);
          if (other < own - 4) score += 40;
          else if (other < own * 1.3) score += 14;
        }
        if (box.x0 < 16 || box.x1 > W - 16 || box.y0 < 16 || box.y1 > H - 16) score += 40;
        if (!onLand([box.x0, box.y1]) || !onLand([box.x1, box.y1]) || !onLand([box.x0, box.y0])) score += 30;
        if (score < bestScore) {
          bestScore = score;
          best = o;
        }
      });
      spots[c] = best;
      boxes[c] = nameBox(best, len);
    }
  }
  return spots.map((s) => s as NameSpot);
}

const boxesOfNames = (spots: readonly NameSpot[]): Box[] =>
  spots.map((s, c) => nameBox(s, (CURRENT_THEME.cities[c] ?? '').length));

const STOCK_NAMES: readonly Box[] = boxesOfNames(placeNames(CURRENT_THEME.cities));

/** Where each line's cost badge is drawn: slid clear of the cities' names too. */
export const BADGES: readonly Pt[] = slideBadges(STOCK_NAMES);
const FINAL_BADGE_BOXES: readonly Box[] = BADGES.map(badgeBox);

/**
 * What each piece of lettering runs into (a city, a city's name, a cost badge, another piece of lettering, the river
 * or the sea), as readable strings; empty when the lettering sits clear. The art test checks it stays empty.
 */
export function letteringClashes(): string[] {
  const out: string[] = [];
  const labels = [...REGIONS.map((r) => CURRENT_THEME.regions[r]), 'the Copper Range'];
  LETTERING_BOXES.forEach((box, i) => {
    const what = labels[i];
    for (let c = 0; c < CITY_COUNT; c++) if (meetsCity(box, c)) out.push(`${what} meets city ${c}`);
    STOCK_NAMES.forEach((b, c) => {
      if (boxesMeet(b, box)) out.push(`${what} meets the name of city ${c}`);
    });
    FINAL_BADGE_BOXES.forEach((b, l) => {
      if (boxesMeet(b, box)) out.push(`${what} meets badge ${l}`);
    });
    LETTERING_BOXES.forEach((b, k) => {
      if (k > i && boxesMeet(b, box)) out.push(`${what} meets ${labels[k]}`);
    });
    if (
      RIVER_FINE.some((p) => p[0] > box.x0 - 4 && p[0] < box.x1 + 4 && p[1] > box.y0 - 4 && p[1] < box.y1 + 4)
    )
      out.push(`${what} meets the river`);
    const corners: Pt[] = [
      [box.x0, box.y0],
      [box.x1, box.y0],
      [box.x0, box.y1],
      [box.x1, box.y1],
      [(box.x0 + box.x1) / 2, box.y0],
      [(box.x0 + box.x1) / 2, box.y1],
    ];
    const ashore = onLand([(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2]);
    if (ashore && !corners.every(onLand)) out.push(`${what} runs into the sea`);
    if (!ashore && corners.some(onLand)) out.push(`${what} runs ashore`);
  });
  return out;
}

/** Whether a region's name is lettered offshore (in the sea beside its coast). */
export const NAME_OFFSHORE: readonly boolean[] = REGION_NAME_SPOTS.map(
  (p) => !onLand([p[0], p[1] - REGION_NAME_H / 2]),
);

/* ---------------------------------------------------------------- the Copper Range */

/** Whether `p` is nearer a city of `region` than any other city. */
function inCellOf(p: Pt, region: number): boolean {
  let best = -1;
  let bestD = Infinity;
  for (let c = 0; c < CITY_COUNT; c++) {
    const q = pt(c);
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return CITY_REGION[best] === region;
}

/** The peaks of the Copper Range: in Highcopper, wherever the lines, cities, badges and lettering leave room. */
export const PEAKS: readonly { readonly x: number; readonly y: number; readonly s: number }[] = (() => {
  const out: { x: number; y: number; s: number }[] = [];
  const copper = REGIONS.indexOf('copper');
  const lettering = LETTERING_BOXES;
  const mine = CITY_POINTS.filter((_, i) => CITY_REGION[i] === copper);
  const y0 = Math.min(...mine.map((p) => p[1])) - 50;
  const y1 = Math.max(...mine.map((p) => p[1])) + 50;
  const x0 = Math.min(...mine.map((p) => p[0])) - 60;
  const x1 = Math.max(...mine.map((p) => p[0])) + 60;
  for (let y = Math.max(30, y0); y <= y1; y += 13) {
    for (let x = x0; x <= x1; x += 15) {
      const jx = x + (hash(x, y) - 0.5) * 8 + ((y / 13) % 2) * 7;
      const jy = y + (hash(y, x) - 0.5) * 6;
      const p: Pt = [jx, jy];
      if (!inCellOf(p, copper)) continue;
      const lines = clearOfLines(p);
      const cities = clearOfCities(p);
      const badges = Math.min(...BADGES.map((b) => Math.hypot(b[0] - p[0], b[1] - p[1])));
      const river = Math.min(...RIVER_FINE.map((r) => Math.hypot(r[0] - jx, r[1] - jy)));
      if (lines < 13 || cities < 40 || badges < 20 || river < 16) continue;
      const peakBox: Box = { x0: jx - 12, y0: jy - 10, x1: jx + 12, y1: jy + 7 };
      if (lettering.some((b) => boxesMeet(b, peakBox))) continue;
      if (STOCK_NAMES.some((b) => boxesMeet(b, peakBox))) continue;
      if (out.some((q) => Math.hypot(q.x - jx, q.y - jy) < 17)) continue;
      out.push({ x: jx, y: jy, s: Math.min(1.25, 0.7 + (lines - 13) / 26) });
    }
  }
  return out;
})();

/* ---------------------------------------------------------------- the sea's waves */

/** Short wave strokes scattered over the sea, clear of the coast. */
export const WAVES: readonly Pt[] = (() => {
  const out: Pt[] = [];
  for (let y = 24; y < H; y += 22) {
    for (let x = 10; x < W; x += 34) {
      const p: Pt = [x + ((y / 22) % 2) * 17 + (hash(x, y) - 0.5) * 8, y + (hash(y, x) - 0.5) * 6];
      out.push(p);
    }
  }
  return out;
})();
