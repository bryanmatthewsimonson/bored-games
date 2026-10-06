/*
 * Original Right of Way art for the web game (CC0, docs/games/right-of-way/art): cargo symbols, freight cards and
 * charters. Every colour has a symbol too, so colour is never the only cue.
 */
import { CHARTERS, ENGINE, ROUTES, TOWNS } from '@bored-games/right-of-way';
import { RIGHT_OF_WAY_THEME } from '@bored-games/right-of-way/theme';

export const INK = '#1f2a44';
export const PAPER = '#f3ead7';
export const CARGO_FILL = [
  '#b8412f',
  '#d9792b',
  '#e6c045',
  '#3d7a3a',
  '#2e66ab',
  '#74468f',
  '#f7f4ec',
  '#2a2a2e',
  '#c9a04a',
];
export const GRAY_FILL = '#a7a397';
/** Light cargo colours take ink symbols; dark ones take paper. */
export const GLYPH_INK = [PAPER, PAPER, INK, PAPER, PAPER, PAPER, INK, PAPER, INK];

const GLYPHS: readonly string[] = [
  'M-7 -5H7V5H-7Z M-7 0H7M0 -5V0M-3.5 0V5M3.5 0V5',
  'M0 -7L7 0L0 7L-7 0Z M-3.5 -3.5L3.5 3.5',
  'M0 8V-1M0 8L-5 0M0 8L5 0 M-2.2 -4.5A2.2 4.2 0 1 0 2.2 -4.5A2.2 4.2 0 1 0 -2.2 -4.5 M-7 -3L-4 -1 M7 -3L4 -1',
  'M0 -8L6 1H3L7 6H-7L-3 1H-6Z M0 6V9',
  'M0 -8V8M-7 -4L7 4M-7 4L7 -4 M-2 -6L0 -4L2 -6M-2 6L0 4L2 6',
  'M0 -4.5A6 6 0 1 0 0.01 -4.5Z M0 -4.5C1 -7 3 -8 5 -8',
  'M-7 4A3.5 3.5 0 0 1 -5 -2A4.5 4.5 0 0 1 3 -4A4 4 0 0 1 7 4Z',
  'M-7 0L-3.5 -6H3.5L7 0L3.5 6H-3.5Z',
  'M-8 4H8M-7 4V-2H1V-6H5V4M1 -2H5M-5 -2V-5H-2V-2 M-4 6A1.8 1.8 0 1 0 -3.99 6Z M3 6A1.8 1.8 0 1 0 3.01 6Z',
];

/** A cargo symbol (colour 0–7, or ENGINE), centred on 0,0 in a 20×20 box. */
export function Glyph(props: { color: number; ink?: string; size?: number }) {
  const d = GLYPHS[props.color] ?? '';
  const k = (props.size ?? 20) / 20;
  return (
    <path
      d={d}
      transform={`scale(${k})`}
      fill="none"
      stroke={props.ink ?? GLYPH_INK[props.color] ?? INK}
      stroke-width={1.6}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  );
}

/** A small freight card: its colour, symbol and cargo name. `color` null shows a face-down card. */
export function FreightCard(props: { color: number | null; label?: string }) {
  const c = props.color;
  const name = c === null ? 'Face down' : RIGHT_OF_WAY_THEME.cargo[c];
  return (
    <svg class="row-card" viewBox="0 0 60 84" role="img" aria-label={props.label ?? name}>
      <rect
        x="1.5"
        y="1.5"
        width="57"
        height="81"
        rx="7"
        fill={c === null ? INK : PAPER}
        stroke={INK}
        stroke-width="2"
      />
      {c === null ? (
        <>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x="14" y={12 + i * 11} width="32" height="4" rx="1" fill="#6d5a3b" />
          ))}
          <path d="M22 8V76M38 8V76" stroke="#cfd6df" stroke-width="2.5" />
        </>
      ) : (
        <>
          <rect
            x="6"
            y="6"
            width="48"
            height="52"
            rx="4"
            fill={CARGO_FILL[c]}
            stroke={INK}
            stroke-width="1.5"
          />
          {c === ENGINE &&
            [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
              <rect key={k} x={6 + k * 6} y="52" width="6" height="6" fill={CARGO_FILL[k]} />
            ))}
          <g transform="translate(30 30)">
            <Glyph color={c} size={34} />
          </g>
          <text
            x="30"
            y="74"
            text-anchor="middle"
            font-size="10"
            font-weight="700"
            fill={INK}
            font-family="Georgia, serif"
          >
            {name}
          </text>
        </>
      )}
    </svg>
  );
}

const sx = (x: number): number => 6 + ((x - 70) * 108) / 1250;
const sy = (y: number): number => 6 + ((y - 60) * 66) / 775;

/** A charter card: its towns, value and a mini map. `index` null shows a face-down charter. */
export function CharterCard(props: { index: number | null; done?: boolean }) {
  const t = props.index === null ? undefined : CHARTERS[props.index];
  if (t === undefined)
    return (
      <svg class="row-charter" viewBox="0 0 120 80" role="img" aria-label="A face-down charter">
        <rect x="1" y="1" width="118" height="78" rx="7" fill="#9a2f2a" stroke={INK} stroke-width="2" />
        <text
          x="60"
          y="46"
          text-anchor="middle"
          font-size="13"
          font-weight="700"
          fill={PAPER}
          font-family="Georgia, serif"
        >
          CHARTER
        </text>
      </svg>
    );
  const a = TOWNS[t.a];
  const b = TOWNS[t.b];
  return (
    <svg
      class="row-charter"
      viewBox="0 0 120 80"
      role="img"
      aria-label={`Charter ${RIGHT_OF_WAY_THEME.towns[t.a]} to ${RIGHT_OF_WAY_THEME.towns[t.b]}, ${t.value} points${props.done ? ', completed' : ''}`}
    >
      <rect x="1" y="1" width="118" height="78" rx="7" fill="#f1e6cc" stroke={INK} stroke-width="2" />
      <rect x="5" y="5" width="110" height="70" rx="4" fill="#dfe9e6" />
      <path
        d={ROUTES.map((r) => {
          const p = TOWNS[r.a];
          const q = TOWNS[r.b];
          return p && q
            ? `M${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}L${sx(q.x).toFixed(1)} ${sy(q.y).toFixed(1)}`
            : '';
        }).join('')}
        stroke="#b3c1be"
        stroke-width="0.7"
      />
      {a && b && (
        <>
          <path
            d={`M${sx(a.x)} ${sy(a.y)}L${sx(b.x)} ${sy(b.y)}`}
            stroke="#9a2f2a"
            stroke-width="1.6"
            stroke-dasharray="3 2"
          />
          <circle cx={sx(a.x)} cy={sy(a.y)} r="3.2" fill="#9a2f2a" />
          <circle cx={sx(b.x)} cy={sy(b.y)} r="3.2" fill="#9a2f2a" />
        </>
      )}
      <circle
        cx="100"
        cy="60"
        r="14"
        fill={props.done ? '#3c8a5c' : '#b8412f'}
        stroke={INK}
        stroke-width="1.5"
      />
      <text
        x="100"
        y="65"
        text-anchor="middle"
        font-size="13"
        font-weight="700"
        fill={PAPER}
        font-family="Georgia, serif"
      >
        {t.value}
      </text>
    </svg>
  );
}
