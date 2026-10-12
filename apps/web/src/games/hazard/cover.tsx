/*
 * Hazard's cover (D088): a corner of the Meridian's chart (the game's own atlas, enlarged) held in four colours,
 * a battle arrow across a strait, and five dice tumbling in front: three crimson for the attack, two ivory for the
 * defence. The title rides a ribbon across the top. Drawn 600 × 360 with the dice in the middle 360, so the square
 * catalog tile crops it; the thumbnail leaves out the lettering. Original art, CC0-1.0.
 */
import { PROVINCES, type ProvinceId } from '@bored-games/hazard';
import { HAZARD_THEME as THEME } from '@bored-games/hazard/theme';
import { Compass, SeatPatterns } from './atlas.tsx';
import { DieArt } from './dice.tsx';
import { ATLAS, seatLook } from './model.ts';

/** Who holds each province on the cover: a few seats in big patches, so the colours read at tile size. */
const HOLDER: Readonly<Partial<Record<string, number>>> = { c: 0, d: 3, e: 2, a: 1, b: 1, f: 2 };
const OWN = (p: ProvinceId): number => {
  if (p === 'e10' || p === 'e8') return 0;
  if (p === 'c6' || p === 'c5') return 3;
  return HOLDER[p[0] as string] ?? 0;
};
const TROOPS: Readonly<Partial<Record<ProvinceId, number>>> = {
  c7: 12,
  e10: 9,
  d2: 7,
  c6: 4,
  d1: 5,
  e1: 6,
  e8: 3,
  c4: 2,
  d3: 8,
};

/** The crop of the atlas the cover shows, in atlas units: the strait between the Old Crowns, Sunscorch and the Vast. */
const CROP = { x: 150, y: 20, w: 640, h: 384 };

function Tumble(props: {
  value: number;
  side: 'attack' | 'defend';
  x: number;
  y: number;
  tilt: number;
  size: number;
}) {
  const k = props.size / 30;
  return (
    <g transform={`translate(${props.x} ${props.y}) rotate(${props.tilt}) scale(${k}) translate(-15 -15)`}>
      <rect x="3" y="5" width="28" height="28" rx="6" fill="#000" opacity=".28" />
      <DieArt value={props.value} side={props.side} />
    </g>
  );
}

export function HazardCover(props: { thumb?: boolean }) {
  const k = 600 / CROP.w;
  const hexes = ATLAS.hexes.filter(
    (h) =>
      h.cx > CROP.x - 20 && h.cx < CROP.x + CROP.w + 20 && h.cy > CROP.y - 20 && h.cy < CROP.y + CROP.h + 20,
  );
  const tokens = PROVINCES.filter((p) => TROOPS[p] !== undefined);
  const from = ATLAS.anchors.c7;
  const to = ATLAS.anchors.e10;
  return (
    <svg
      class="game-cover hz-cover"
      viewBox="0 0 600 360"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Hazard artwork: a corner of an old sea chart held in four colours, an arrow of attack across a strait, and five dice tumbling, three crimson and two ivory"
    >
      <defs>
        <linearGradient id="hz-cover-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#d5e4df" />
          <stop offset="1" stop-color="#a9c4c1" />
        </linearGradient>
        <pattern id="hz-cover-waves" width="26" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 9q6.5-6 13 0t13 0" fill="none" stroke="#7fa3a2" stroke-width=".8" opacity=".6" />
        </pattern>
        <radialGradient id="hz-cover-vignette" cx=".5" cy=".55" r=".75">
          <stop offset=".55" stop-color="#000" stop-opacity="0" />
          <stop offset="1" stop-color="#2b1d0e" stop-opacity=".45" />
        </radialGradient>
        <SeatPatterns prefix="hz-cover" />
        <marker
          id="hz-cover-arrow"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto"
        >
          <path d="M0 0L10 5L0 10Z" fill="#7a1f1f" />
        </marker>
      </defs>
      <rect width="600" height="360" fill="url(#hz-cover-sea)" />
      <g transform={`scale(${k}) translate(${-CROP.x} ${-CROP.y})`}>
        <rect
          x={CROP.x - 40}
          y={CROP.y - 40}
          width={CROP.w + 80}
          height={CROP.h + 80}
          fill="url(#hz-cover-waves)"
        />
        {hexes.map((h) => (
          <polygon
            key={`l${h.x},${h.y}`}
            points={h.points}
            fill="#efe2c2"
            stroke="#efe2c2"
            stroke-width=".8"
          />
        ))}
        {/* The holders' colours washed over the parchment, as on an old campaign chart. */}
        <g opacity=".8">
          {hexes.map((h) => (
            <polygon
              key={`${h.x},${h.y}`}
              points={h.points}
              fill={`url(#hz-cover-seat-${OWN(h.province)})`}
              stroke={seatLook(OWN(h.province)).fill}
              stroke-width=".8"
            />
          ))}
        </g>
        <path
          d={ATLAS.borders.map((s) => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join('')}
          fill="none"
          stroke="rgb(43 36 27 / 55%)"
          stroke-width="1"
        />
        <path
          d={ATLAS.coasts.map((s) => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join('')}
          fill="none"
          stroke="#2b241b"
          stroke-width="2.4"
          stroke-linecap="round"
        />
        {ATLAS.lanes
          .filter((l) => !l.edge)
          .map((l) => (
            <path
              key={`${l.a}${l.b}`}
              d={l.d}
              fill="none"
              stroke="#3d5a66"
              stroke-width="1.6"
              stroke-dasharray="2 4"
            />
          ))}
        <line
          x1={from.cx}
          y1={from.cy}
          x2={to.cx}
          y2={to.cy}
          stroke="#7a1f1f"
          stroke-width="4"
          stroke-linecap="round"
          stroke-dasharray="7 4"
          marker-end="url(#hz-cover-arrow)"
        />
        {tokens.map((p) => {
          const { cx, cy } = ATLAS.anchors[p];
          const look = seatLook(OWN(p));
          return (
            <g key={p}>
              <circle cx={cx} cy={cy + 1.4} r="10" fill="#000" opacity=".25" />
              <circle cx={cx} cy={cy} r="10" fill={look.fill} stroke="#fdf6e3" stroke-width="1.8" />
              <text
                x={cx}
                y={cy + 3.6}
                text-anchor="middle"
                fill={look.ink}
                font-size="10.5"
                font-weight="700"
                font-family="system-ui, sans-serif"
              >
                {TROOPS[p]}
              </text>
            </g>
          );
        })}
        <Compass x={CROP.x + 560} y={CROP.y + 320} r={30} />
      </g>
      <rect width="600" height="360" fill="url(#hz-cover-vignette)" />
      <Tumble value={6} side="attack" x={232} y={252} tilt={-18} size={64} />
      <Tumble value={5} side="attack" x={300} y={270} tilt={11} size={64} />
      <Tumble value={3} side="attack" x={262} y={318} tilt={34} size={60} />
      <Tumble value={4} side="defend" x={372} y={236} tilt={-8} size={58} />
      <Tumble value={2} side="defend" x={394} y={306} tilt={22} size={58} />
      {!props.thumb && (
        <g>
          <path d="M140 30h320l-14 22 14 22H140l14-22Z" fill="#7a1f1f" />
          <path d="M152 36h296M152 68h296" stroke="#e9c97a" stroke-width="1.2" opacity=".8" />
          <text
            x="300"
            y="63"
            text-anchor="middle"
            fill="#fbf2dc"
            font-family="'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
            font-size="30"
            font-weight="700"
            letter-spacing="10"
          >
            {THEME.title.toUpperCase()}
          </text>
          <text
            x="300"
            y="96"
            text-anchor="middle"
            fill="#2b241b"
            font-family="'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
            font-size="13"
            font-style="italic"
            paint-order="stroke"
            stroke="#f3e9d2"
            stroke-width="3"
          >
            {THEME.tagline}
          </text>
        </g>
      )}
      <rect x="8" y="8" width="584" height="344" fill="none" stroke="#4a3f2f" stroke-width="2" />
      <rect x="13" y="13" width="574" height="334" fill="none" stroke="#4a3f2f" stroke-width=".8" />
    </svg>
  );
}
