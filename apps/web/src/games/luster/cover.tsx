/*
 * Luster's cover: the five gems and a gold token over the mountain night of the development cards. Original vector
 * art built from `art.tsx`. Drawn 600 × 360 with the gems in the middle 360, so the square catalog tile crops it.
 */
import { GemFace } from './art.tsx';

const FAN: readonly { color: number; x: number; y: number; size: number; rot: number }[] = [
  { color: 4, x: 158, y: 116, size: 82, rot: -24 },
  { color: 1, x: 214, y: 76, size: 98, rot: -12 },
  { color: 0, x: 300, y: 58, size: 112, rot: 0 },
  { color: 2, x: 386, y: 76, size: 98, rot: 12 },
  { color: 3, x: 442, y: 116, size: 82, rot: 24 },
];

export function LusterCover() {
  return (
    <svg
      class="game-cover"
      viewBox="0 0 600 360"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Luster artwork: five cut gems and a gold token over moonlit mountains"
    >
      <defs>
        <linearGradient id="luster-cover-sky" x2="0" y2="1">
          <stop stop-color="#14303b" />
          <stop offset="1" stop-color="#2f6a72" />
        </linearGradient>
        <radialGradient id="luster-cover-glow">
          <stop stop-color="#fff3d0" stop-opacity=".55" />
          <stop offset="1" stop-color="#fff3d0" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="600" height="360" fill="url(#luster-cover-sky)" />
      <circle cx="300" cy="150" r="170" fill="url(#luster-cover-glow)" />
      <circle cx="486" cy="58" r="22" fill="#fff3d0" opacity=".7" />
      <path
        d="M0 250 86 150 158 222 236 160 300 214 372 150 452 232 530 168 600 214V360H0Z"
        fill="#092e36"
        opacity=".55"
      />
      <path
        d="M0 292 92 216 176 290 270 230 352 286 446 226 528 282 600 246V360H0Z"
        fill="#0b252d"
        opacity=".8"
      />
      <path d="M0 336Q150 312 300 330T600 328V360H0Z" fill="#ead8a8" opacity=".22" />
      {FAN.map((g) => (
        <g key={g.color} transform={`translate(${g.x} ${g.y}) rotate(${g.rot}) scale(${g.size / 100})`}>
          <g transform="translate(-50 0)">
            <GemFace color={g.color} />
          </g>
        </g>
      ))}
      <g transform="translate(300 214) scale(.9)">
        <g transform="translate(-50 -50)">
          <GemFace color={5} />
        </g>
      </g>
      <path
        d="m112 66 4-9 4 9-4 9ZM480 128l3-7 3 7-3 7ZM246 196l3-6 3 6-3 6ZM360 30l3-7 3 7-3 7ZM540 300l3-6 3 6-3 6"
        fill="#f8e4ac"
        opacity=".85"
      />
      <rect x="15" y="15" width="570" height="330" rx="2" stroke="#d0ad72" fill="none" opacity=".55" />
    </svg>
  );
}
