export interface Site {
  readonly x: number;
  readonly y: number;
  readonly islands: readonly number[];
}
export interface Lane {
  readonly a: number;
  readonly b: number;
}
export interface Island {
  readonly x: number;
  readonly y: number;
  readonly sites: readonly number[];
}
export interface Mooring {
  readonly lane: number;
  readonly resource: number | null;
}
const directions = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
] as const;
function ring(n: number): [number, number][] {
  let q = 0,
    r = -n;
  const out: [number, number][] = [];
  for (const [dq, dr] of directions)
    for (let i = 0; i < n; i++) {
      out.push([q, r]);
      q += dq;
      r += dr;
    }
  return out;
}
export const AXIAL = [...ring(2), ...ring(1), [0, 0] as [number, number]];
function makeBoard() {
  const sites: { x: number; y: number; islands: number[] }[] = [];
  const lanes: Lane[] = [];
  const islands: Island[] = [];
  const byPoint = new Map<string, number>();
  const byEdge = new Map<string, number>();
  const uses: number[] = [];
  AXIAL.forEach(([q, r], island) => {
    const x = Math.sqrt(3) * (q + r / 2),
      y = 1.5 * r;
    const corners = [30, 90, 150, 210, 270, 330].map((angle) => {
      const sx = Number((x + Math.cos((angle * Math.PI) / 180)).toFixed(6));
      const sy = Number((y + Math.sin((angle * Math.PI) / 180)).toFixed(6));
      const key = `${sx}:${sy}`;
      let site = byPoint.get(key);
      if (site === undefined) {
        site = sites.length;
        byPoint.set(key, site);
        sites.push({ x: sx, y: sy, islands: [] });
      }
      sites[site]?.islands.push(island);
      return site;
    });
    islands.push({ x, y, sites: corners });
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % 6] as number;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      let lane = byEdge.get(key);
      if (lane === undefined) {
        lane = lanes.length;
        byEdge.set(key, lane);
        lanes.push({ a, b });
        uses.push(0);
      }
      uses[lane] = (uses[lane] ?? 0) + 1;
    });
  });
  const boundary = lanes
    .flatMap((_, i) => (uses[i] === 1 ? [i] : []))
    .sort((a, b) => {
      const mid = (i: number) => {
        const e = lanes[i] as Lane;
        const p = sites[e.a] as Site,
          t = sites[e.b] as Site;
        return Math.atan2(p.y + t.y, p.x + t.x);
      };
      return mid(a) - mid(b);
    });
  const resources = [null, 0, null, 1, 2, null, 3, null, 4];
  const moorings = [0, 3, 6, 10, 13, 16, 20, 23, 26].map((p, i) => ({
    lane: boundary[p] as number,
    resource: resources[i] ?? null,
  }));
  return { sites, lanes, islands, moorings };
}
export const BOARD = makeBoard();
export const SAMPLE_TERRAIN = [0, 3, 1, 2, 4, 3, 0, 2, 4, 1, 0, 2, 3, 4, 2, 0, 1, 3, 5];
export const YIELDS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
export function neighbors(site: number): number[] {
  return BOARD.lanes.flatMap((e) => (e.a === site ? [e.b] : e.b === site ? [e.a] : []));
}
export function touches(lane: number, site: number): boolean {
  const e = BOARD.lanes[lane];
  return !!e && (e.a === site || e.b === site);
}
