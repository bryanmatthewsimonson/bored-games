/*
 * The drawing of the Commonwealth (docs/games/current-affairs/RULES.md, "The map"), worked out once from the city
 * points of the package's atlas: the coastline, the six regions as merged Voronoi cells of their cities, the Long
 * Water between the northern and southern regions, the peaks of the Copper Range, and where each city's name and
 * each line's cost badge go so that they keep clear of the lines. Pure and deterministic: no randomness, only a
 * fixed hash, so every client draws the same land. Presentation only; the engine never reads it.
 * Original art, CC0-1.0 (packages/games/current-affairs/ART-LICENSE.md).
 */

import { CITY_COUNT, CITY_REGION, LINKS, REGIONS } from '@bored-games/current-affairs';
import { ATLAS_HEIGHT, ATLAS_WIDTH, CITY_POINTS } from '@bored-games/current-affairs/atlas';
import { CURRENT_THEME } from '@bored-games/current-affairs/theme';

export type Pt = readonly [number, number];

export const W = ATLAS_WIDTH;
export const H = ATLAS_HEIGHT;
export const CITY_R = 20;

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
 * The west and south coasts, north to east: the sea lies to the west and the south, and the land runs on past the
 * sheet's northern and eastern edges. Each point keeps 40 or more from every city.
 */
const COAST_POINTS: readonly Pt[] = [
  [64, -14],
  [60, 30],
  [42, 72],
  [50, 118],
  [30, 160],
  [42, 214],
  [58, 262],
  [36, 304],
  [18, 340],
  [34, 372],
  [40, 412],
  [70, 448],
  [62, 492],
  [74, 540],
  [92, 578],
  [104, 628],
  [146, 660],
  [206, 666],
  [262, 648],
  [314, 660],
  [376, 672],
  [438, 648],
  [500, 660],
  [548, 642],
  [604, 650],
  [652, 672],
  [722, 664],
  [780, 676],
  [846, 668],
  [906, 652],
  [960, 664],
  [1014, 650],
];

const LAND_POINTS: readonly Pt[] = [...crinkle(COAST_POINTS, 3, 6, false), [1014, -14]];

/** The land, as one closed path. */
export const LAND_PATH: string = smoothPath(LAND_POINTS, true);
/** The coastline alone (open: the land's other edges run off the sheet). */
export const COAST_PATH: string = smoothPath(crinkle(COAST_POINTS, 3, 6, false), false);

/** Two islets in the south-western sea. */
export const ISLETS: readonly string[] = [
  smoothPath(
    crinkle(
      [
        [16, 456],
        [34, 446],
        [44, 462],
        [32, 480],
        [14, 476],
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
        [56, 660],
        [74, 652],
        [86, 666],
        [70, 680],
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

const RIVER_POINTS: readonly Pt[] = [
  [1014, 346],
  [958, 354],
  [902, 338],
  [846, 352],
  [790, 340],
  [744, 350],
  [692, 340],
  [640, 330],
  [588, 344],
  [530, 334],
  [480, 342],
  [430, 334],
  [376, 344],
  [322, 334],
  [268, 346],
  [214, 338],
  [160, 346],
  [110, 336],
  [66, 344],
  [22, 340],
];

const RIVER_FINE: readonly Pt[] = crinkle(RIVER_POINTS, 2, 3, false);
/** The Long Water, east to west, into the western sea. */
export const RIVER_PATH: string = smoothPath(RIVER_FINE, false);
/** A stretch of the river, west to east, for its name. */
export const RIVER_LABEL_PATH: string = smoothPath(
  RIVER_FINE.filter((p) => p[0] >= 588 && p[0] <= 712)
    .slice()
    .reverse()
    .map((p): Pt => [p[0], p[1] - 11]),
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

/* ---------------------------------------------------------------- badges */

/** Where each line's cost badge sits: its middle, slid along the line if a city is close. */
export const BADGES: readonly Pt[] = LINKS.map(([a, b]) => {
  const pa = pt(a);
  const pb = pt(b);
  let best: Pt = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  let bestScore = -1;
  for (const t of [0.5, 0.44, 0.56, 0.38, 0.62]) {
    const p: Pt = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
    const score = Math.min(clearOfCities(p), 60) - Math.abs(t - 0.5) * 20;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
});

/* ---------------------------------------------------------------- city names */

export const NAME_SIZE = 15;
const charW = NAME_SIZE * 0.6;

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

const BADGE_BOXES: readonly Box[] = BADGES.map((b) => ({
  x0: b[0] - 12,
  y0: b[1] - 9,
  x1: b[0] + 12,
  y1: b[1] + 9,
}));
const CITY_BOXES: readonly Box[] = CITY_POINTS.map((c) => ({
  x0: c[0] - CITY_R - 2,
  y0: c[1] - CITY_R - 2,
  x1: c[0] + CITY_R + 2,
  y1: c[1] + CITY_R + 2,
}));

/** Each city's name position, given the names' lengths: below, above, right or left, whichever crosses least. */
export function placeNames(names: readonly string[]): readonly NameSpot[] {
  const placed: Box[] = [];
  const spots: NameSpot[] = [];
  for (let c = 0; c < CITY_COUNT; c++) {
    const [x, y] = pt(c);
    const len = (names[c] ?? '').length;
    const d = CITY_R + 5;
    const options: NameSpot[] = [
      { x, y: y + d + NAME_SIZE * 0.72, anchor: 'middle' },
      { x, y: y - d - 3, anchor: 'middle' },
      { x: x + d, y: y + NAME_SIZE * 0.32, anchor: 'start' },
      { x: x - d, y: y + NAME_SIZE * 0.32, anchor: 'end' },
      { x: x + d - 6, y: y + d + NAME_SIZE * 0.5, anchor: 'start' },
      { x: x - d + 6, y: y + d + NAME_SIZE * 0.5, anchor: 'end' },
      { x: x + d - 6, y: y - d, anchor: 'start' },
      { x: x - d + 6, y: y - d, anchor: 'end' },
    ];
    let best = options[0] as NameSpot;
    let bestScore = Infinity;
    options.forEach((o, rank) => {
      const box = nameBox(o, len);
      let score = rank * 0.6;
      for (const [a, b] of SEGMENTS) if (segmentHitsBox(a, b, box)) score += 4;
      for (const b of BADGE_BOXES) if (boxesMeet(b, box)) score += 6;
      CITY_BOXES.forEach((b, k) => {
        if (k !== c && boxesMeet(b, box)) score += 10;
      });
      for (const b of placed) if (boxesMeet(b, box)) score += 12;
      if (box.x0 < 16 || box.x1 > W - 16 || box.y0 < 16 || box.y1 > H - 16) score += 40;
      if (!onLand([box.x0, box.y1]) || !onLand([box.x1, box.y1]) || !onLand([box.x0, box.y0])) score += 30;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    });
    spots.push(best);
    placed.push(nameBox(best, len));
  }
  return spots;
}

const STOCK_NAMES: readonly Box[] = (() => {
  const spots = placeNames(CURRENT_THEME.cities);
  return spots.map((s, c) => nameBox(s, (CURRENT_THEME.cities[c] ?? '').length));
})();

/* ---------------------------------------------------------------- lettering */

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

/** The box a line of lettering `w` wide and `h` high takes, its baseline's middle at (x, y). */
const letteringBox = (x: number, y: number, w: number, h: number): Box => ({
  x0: x - w / 2,
  y0: y - h,
  x1: x + w / 2,
  y1: y + 2,
});

/** The clearest spot in `region` for a line of lettering `w` wide and `h` high, near the region's middle. */
function letteringSpot(region: number, w: number, h: number, avoid: readonly Box[]): Pt {
  const cities = CITY_POINTS.filter((_, i) => CITY_REGION[i] === region);
  const cx = cities.reduce((s, p) => s + p[0], 0) / cities.length;
  const cy = cities.reduce((s, p) => s + p[1], 0) / cities.length;
  let best: Pt = [cx, cy];
  let bestScore = -Infinity;
  const xs = cities.map((p) => p[0]);
  const ys = cities.map((p) => p[1]);
  const top = Math.max(30, Math.min(...ys) - 60);
  const bottom = Math.min(H - 20, Math.max(...ys) + 60);
  const left = Math.max(30, Math.min(...xs) - 80);
  const right = Math.min(W - 30, Math.max(...xs) + 80);
  for (let y = top; y <= bottom; y += 6) {
    for (let x = left; x <= right; x += 8) {
      const box = letteringBox(x, y, w, h);
      if (box.x0 < 22 || box.x1 > W - 22 || box.y0 < 22 || box.y1 > H - 22) continue;
      const corners: Pt[] = [
        [x, y - h / 2],
        [box.x0 - 8, box.y0 - 8],
        [box.x1 + 8, box.y0 - 8],
        [box.x0 - 8, box.y1 + 8],
        [box.x1 + 8, box.y1 + 8],
      ];
      if (!corners.every((p) => inCellOf(p, region) && onLand(p))) continue;
      let score = -Math.hypot(x - cx, y - cy) * 0.04;
      for (const [a, b] of SEGMENTS) if (segmentHitsBox(a, b, box)) score -= 3;
      for (const b of BADGE_BOXES) if (boxesMeet(b, box)) score -= 9;
      for (const b of CITY_BOXES) if (boxesMeet(b, box)) score -= 60;
      for (const b of STOCK_NAMES) if (boxesMeet(b, box)) score -= 60;
      for (const b of avoid) if (boxesMeet(b, box)) score -= 60;
      for (const p of RIVER_FINE) {
        if (p[0] > box.x0 && p[0] < box.x1 && Math.abs(p[1] - (y - h / 2)) < h / 2 + 6) {
          score -= 40;
          break;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
  }
  return best;
}

export const REGION_NAME_SIZE = 19;
export const REGION_NAME_SPACING = 5;
const regionNameWidth = (r: number): number =>
  CURRENT_THEME.regions[REGIONS[r] ?? 'frost'].length * (REGION_NAME_SIZE * 0.78 + REGION_NAME_SPACING);
const REGION_NAME_H = REGION_NAME_SIZE * 0.78;
const RANGE_W = 128;
const RANGE_H = 12;

/**
 * Where the regions' names and the Copper Range's are lettered: the clearest spot in each region, near its cities'
 * middle. The search takes a few hundred milliseconds, too long for a page load, so its answer is kept below as
 * REGION_NAME_SPOTS and RANGE_NAME_SPOT; the art test checks that they still match.
 */
export function searchLettering(): { regions: readonly Pt[]; range: Pt } {
  const regions: Pt[] = [];
  const boxes: Box[] = [];
  REGIONS.forEach((_, r) => {
    const spot = letteringSpot(r, regionNameWidth(r), REGION_NAME_H, boxes);
    regions.push(spot);
    boxes.push(letteringBox(spot[0], spot[1], regionNameWidth(r), REGION_NAME_H));
  });
  const range = letteringSpot(REGIONS.indexOf('copper'), RANGE_W, RANGE_H, boxes);
  return { regions, range };
}

/** Each region's name's baseline middle (searchLettering's answer). */
export const REGION_NAME_SPOTS: readonly Pt[] = [
  [214, 228],
  [504, 246],
  [810, 240],
  [198, 577],
  [504, 646],
  [818, 588],
];
/** The Copper Range's name's baseline middle (searchLettering's answer). */
export const RANGE_NAME_SPOT: Pt = [448, 36];

const LETTERING_BOXES: readonly Box[] = [
  ...REGION_NAME_SPOTS.map((p, r) => letteringBox(p[0], p[1], regionNameWidth(r), REGION_NAME_H)),
  letteringBox(RANGE_NAME_SPOT[0], RANGE_NAME_SPOT[1], RANGE_W, RANGE_H),
];

/* ---------------------------------------------------------------- the Copper Range */

/** The peaks of the Copper Range: in Highcopper, wherever the lines, cities, badges and lettering leave room. */
export const PEAKS: readonly { readonly x: number; readonly y: number; readonly s: number }[] = (() => {
  const out: { x: number; y: number; s: number }[] = [];
  const copper = REGIONS.indexOf('copper');
  const lettering = LETTERING_BOXES;
  for (let y = 40; y <= 300; y += 13) {
    for (let x = 360; x <= 660; x += 15) {
      const jx = x + (hash(x, y) - 0.5) * 8 + ((y / 13) % 2) * 7;
      const jy = y + (hash(y, x) - 0.5) * 6;
      const p: Pt = [jx, jy];
      if (!inCellOf(p, copper)) continue;
      const lines = clearOfLines(p);
      const cities = clearOfCities(p);
      const badges = Math.min(...BADGES.map((b) => Math.hypot(b[0] - p[0], b[1] - p[1])));
      if (lines < 13 || cities < 40 || badges < 20) continue;
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
