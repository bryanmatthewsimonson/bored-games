/*
 * Current Affairs' artwork (D091): the 42 power-station cards and the Era III card, the four fuel tokens, the fuel
 * yard, the money glyph, the seat colours with their marks, and the catalog cover. All of it is drawn here as inline
 * SVG for this game, in one palette taken from the posters of a 1930s power company: deep navy and teal, warm brass,
 * cream, and the orange glow of sodium lamps. Original art, CC0-1.0 (packages/games/current-affairs/ART-LICENSE.md);
 * no external assets.
 *
 * Every component is pure (props only, no hooks), so the few gradient ids are fixed and prefixed `ca-`: two copies
 * of one picture hold identical definitions.
 */
import { FUELS, type Kind, STATIONS, stationOf, YARD_PRICES } from '@bored-games/current-affairs';
import { CURRENT_THEME } from '@bored-games/current-affairs/theme';
import type { ComponentChildren } from 'preact';
import './current-affairs.css';

/* ---------------------------------------------------------------- palette */

const NAVY = '#14233a';
const DEEP = '#0b1424';
const BRASS = '#c9a24a';
const BRASS_HI = '#efd896';
const BRASS_LO = '#7d5d22';
const SODIUM = '#f39a33';
const GLOW = '#ffcf7a';
const CREAM = '#f4ead2';
const SILHOUETTE = '#161a28';
export const DECO_FONT =
  "'Josefin Sans', Futura, 'Century Gothic', 'Avenir Next', 'Trebuchet MS', 'DejaVu Sans', sans-serif";
const NUMBER_FONT =
  "'Bebas Neue', Oswald, 'Arial Narrow', 'DejaVu Sans Condensed', Futura, 'DejaVu Sans', sans-serif";

/* ---------------------------------------------------------------- seats */

/** The six companies' colours: each reads on the cream land and on navy, with a dark rim. */
export const SEAT_COLORS: readonly string[] = [
  '#d9542c',
  '#2f6fd6',
  '#2f9e57',
  '#efb52e',
  '#9356cc',
  '#ece5d3',
];
/** Each company's mark, so colour is never the only cue: drawn as shapes in SVG, usable as text elsewhere. */
export const SEAT_MARKS: readonly string[] = ['●', '■', '▲', '◆', '★', '✚'];
/** The ink that reads on each seat colour. */
export const SEAT_INKS: readonly string[] = [
  '#ffffff',
  '#ffffff',
  '#ffffff',
  '#2b1f04',
  '#ffffff',
  '#2a2418',
];

const STAR_PATH = (cx: number, cy: number, r: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
};

/** A seat's mark as a shape centred on (cx, cy), `r` its outer radius. */
export function SeatGlyph(props: { seat: number; cx: number; cy: number; r: number; fill?: string }) {
  const { cx, cy, r } = props;
  const fill = props.fill ?? SEAT_INKS[props.seat % 6] ?? '#fff';
  switch (props.seat % 6) {
    case 0:
      return <circle cx={cx} cy={cy} r={r * 0.62} fill={fill} />;
    case 1:
      return <rect x={cx - r * 0.56} y={cy - r * 0.56} width={r * 1.12} height={r * 1.12} fill={fill} />;
    case 2:
      return (
        <path d={`M${cx} ${cy - r * 0.78}L${cx + r * 0.76} ${cy + r * 0.56}H${cx - r * 0.76}Z`} fill={fill} />
      );
    case 3:
      return (
        <path
          d={`M${cx} ${cy - r * 0.8}L${cx + r * 0.7} ${cy}L${cx} ${cy + r * 0.8}L${cx - r * 0.7} ${cy}Z`}
          fill={fill}
        />
      );
    case 4:
      return <path d={STAR_PATH(cx, cy + r * 0.06, r * 0.86)} fill={fill} />;
    default:
      return (
        <path
          d={`M${cx - r * 0.22} ${cy - r * 0.72}h${r * 0.44}v${r * 0.5}h${r * 0.5}v${r * 0.44}h${-r * 0.5}v${r * 0.5}h${-r * 0.44}v${-r * 0.5}h${-r * 0.5}v${-r * 0.44}h${r * 0.5}Z`}
          fill={fill}
        />
      );
  }
}

/** A seat's disc: its colour, a dark rim and its mark. */
export function SeatDisc(props: { seat: number; cx: number; cy: number; r: number }) {
  const { seat, cx, cy, r } = props;
  return (
    <g class="ca-seat-disc">
      <circle cx={cx} cy={cy} r={r} fill={SEAT_COLORS[seat % 6]} stroke={DEEP} stroke-width={r * 0.18} />
      <SeatGlyph seat={seat} cx={cx} cy={cy} r={r * 0.62} />
    </g>
  );
}

/** A company's token on its own, for lists and the seat bar. */
export function SeatToken(props: { seat: number; size?: number; title?: string }) {
  const size = props.size ?? 18;
  return (
    <svg
      class="ca-seat-token"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={props.title ? 'img' : undefined}
      aria-label={props.title || undefined}
      aria-hidden={props.title ? undefined : 'true'}
    >
      <SeatDisc seat={props.seat} cx={12} cy={12} r={10.4} />
    </svg>
  );
}

/* ---------------------------------------------------------------- fuel */

/** Each fuel's ground colour, for bars and rows: coal umber, oil black, waste yellow, uranium green. */
export const FUEL_COLORS: readonly string[] = ['#5b4534', '#1c1d23', '#d9ad25', '#3b9a49'];

const fuelName = (fuel: number): string => {
  const id = FUELS[fuel];
  return id ? CURRENT_THEME.fuels[id] : 'Fuel';
};

/** A fuel unit drawn in a 24 × 24 box: a faceted coal lump, an oil drop, a strapped waste bale, a uranium rod. */
export function FuelShape(props: { fuel: number }) {
  switch (props.fuel) {
    case 0:
      return (
        <g stroke-linejoin="round">
          <path
            d="M3.6 15.2 6.4 7.6 12.6 4.2 19 7.2 21 14.4 16.6 20.4H8.4Z"
            fill="#4b3828"
            stroke="#1d130b"
            stroke-width="1.3"
          />
          <path d="M12.6 4.2 11.6 11.6 6.4 7.6Z" fill="#8a6c52" />
          <path d="M11.6 11.6 19 7.2 21 14.4Z" fill="#6a5240" />
          <path d="M11.6 11.6 16.6 20.4H8.4L3.6 15.2Z" fill="#33251a" />
          <path d="M6.4 7.6 3.6 15.2 11.6 11.6Z" fill="#5c4532" />
          <path d="M8.4 7.4 11.6 5.6" stroke="#c9ab8a" stroke-width="1" stroke-linecap="round" />
        </g>
      );
    case 1:
      return (
        <g>
          <path
            d="M12 2.6C12 2.6 4.8 11.2 4.8 15.4A7.2 7.2 0 0 0 19.2 15.4C19.2 11.2 12 2.6 12 2.6Z"
            fill="#16161b"
            stroke="#000"
            stroke-width="1.1"
          />
          <path
            d="M8.2 14.6A4 4 0 0 0 11.4 19.2"
            fill="none"
            stroke="#e9a12f"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <circle cx="14.6" cy="12.6" r="1.3" fill="#f5e3c0" opacity=".85" />
        </g>
      );
    case 2:
      return (
        <g stroke-linejoin="round">
          <path d="M3.4 9 7.6 5H21L17 9Z" fill="#f6d55e" stroke="#5e4508" stroke-width="1.1" />
          <path d="M17 9 21 5V16.4L17 20.4Z" fill="#b38716" stroke="#5e4508" stroke-width="1.1" />
          <rect x="3.4" y="9" width="13.6" height="11.4" fill="#e3b72c" stroke="#5e4508" stroke-width="1.1" />
          <path d="M8 9V20.4M12.6 9V20.4M10.6 5 6.6 9M15.2 5 11.2 9" stroke="#7c5d0e" stroke-width="1.2" />
          <path d="M3.4 14.6H17" stroke="#f6d55e" stroke-width=".8" opacity=".7" />
        </g>
      );
    case 3:
      return (
        <g>
          <circle cx="12" cy="12" r="11" fill="#9cf26a" opacity=".28" />
          <rect
            x="7.6"
            y="2.6"
            width="8.8"
            height="18.8"
            rx="4.2"
            fill="#2f8f3c"
            stroke="#0f3417"
            stroke-width="1.2"
          />
          <rect x="10.2" y="6.4" width="3.6" height="11.2" rx="1.8" fill="#d9ff8c" />
          <path d="M7.6 6.4H16.4M7.6 17.6H16.4" stroke={BRASS_HI} stroke-width="1.4" />
        </g>
      );
    default:
      return <circle cx="12" cy="12" r="8" fill="#888" />;
  }
}

/** A coal lump and an oil drop together: the fuel of a coal-or-oil station. */
function EitherShape() {
  return (
    <g>
      <g transform="translate(-1.6 1.4) scale(.78)">
        <FuelShape fuel={0} />
      </g>
      <g transform="translate(8.4 4.6) scale(.68)">
        <FuelShape fuel={1} />
      </g>
    </g>
  );
}

/** One fuel unit as an icon, named for screen readers. */
export function FuelToken(props: { fuel: number; size?: number }) {
  const size = props.size ?? 20;
  return (
    <svg
      class="ca-fuel"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={fuelName(props.fuel)}
    >
      <FuelShape fuel={props.fuel} />
    </svg>
  );
}

/* ---------------------------------------------------------------- money */

/** A brass coin struck with a lightning bolt, then the sum in dollars. */
export function Money(props: { amount: number }) {
  return (
    <span class="ca-money">
      <svg class="ca-coin" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10.6" fill={BRASS} stroke={BRASS_LO} stroke-width="1.6" />
        <circle cx="12" cy="12" r="7.6" fill="none" stroke={BRASS_HI} stroke-width="1" />
        <path d="M13.4 5.2 8.4 13H11.8L10.6 18.8 15.6 11H12.2Z" fill={NAVY} />
      </svg>
      {`$${props.amount}`}
    </span>
  );
}

/* ---------------------------------------------------------------- the fuel yard */

const YARD_W = 340;
const YARD_LEFT = 38;
const YARD_ROW = 36;

/** The yard: coal, oil and waste on eight $1–$8 spaces of three units, uranium on twelve spaces of one. */
export function FuelYard(props: { yard: readonly number[] }) {
  const height = 10 + YARD_ROW * 4;
  const label = FUELS.map((_, f) => {
    const prices = YARD_PRICES[f] ?? [];
    const c = Math.max(0, Math.min(prices.length, props.yard[f] ?? 0));
    const name = fuelName(f).toLowerCase();
    return c === 0 ? `no ${name}` : `${c} ${name} from $${prices[prices.length - c]}`;
  }).join(', ');
  return (
    <svg class="ca-yard" viewBox={`0 0 ${YARD_W} ${height}`} role="img" aria-label={`Fuel yard: ${label}`}>
      <rect
        x="1"
        y="1"
        width={YARD_W - 2}
        height={height - 2}
        rx="8"
        fill={NAVY}
        stroke={BRASS}
        stroke-width="1.6"
      />
      <rect
        x="4.5"
        y="4.5"
        width={YARD_W - 9}
        height={height - 9}
        rx="5.5"
        fill="none"
        stroke={BRASS_LO}
        stroke-width=".7"
      />
      {FUELS.map((_, f) => {
        const prices = YARD_PRICES[f] ?? [];
        const slots = prices.length;
        const c = Math.max(0, Math.min(slots, props.yard[f] ?? 0));
        const top = 7 + f * YARD_ROW;
        const spaces = [...new Set(prices)];
        const per = slots / spaces.length;
        const cellW = (YARD_W - YARD_LEFT - 8) / spaces.length;
        const unit = f === 3 ? 13 : 10.4;
        return (
          <g key={f} class="ca-yard-row">
            {f > 0 && <path d={`M10 ${top - 1}H${YARD_W - 10}`} stroke="#2a3d5a" stroke-width=".8" />}
            <rect
              x="9"
              y={top + 6}
              width="24"
              height="24"
              rx="5"
              fill={FUEL_COLORS[f]}
              stroke={BRASS_LO}
              stroke-width=".8"
            />
            <g transform={`translate(11 ${top + 8}) scale(${20 / 24})`}>
              <FuelShape fuel={f} />
            </g>
            {spaces.map((price, s) => {
              const x = YARD_LEFT + s * cellW;
              return (
                <g key={price}>
                  <rect
                    x={x + 1.2}
                    y={top + 2}
                    width={cellW - 2.4}
                    height={YARD_ROW - 6}
                    rx="3"
                    fill="#1c2f4a"
                    stroke="#33496b"
                    stroke-width=".7"
                  />
                  <text
                    x={x + cellW / 2}
                    y={top + 11}
                    text-anchor="middle"
                    font-family={DECO_FONT}
                    font-weight="700"
                    font-size="8.4"
                    fill={BRASS_HI}
                  >
                    {`$${price}`}
                  </text>
                  {Array.from({ length: per }, (_, u) => {
                    const slot = s * per + u;
                    const ux = x + cellW / 2 + (u - (per - 1) / 2) * (unit + 0.4) - unit / 2;
                    const uy = top + 14.2;
                    return slot >= slots - c ? (
                      <g key={u} transform={`translate(${ux} ${uy}) scale(${unit / 24})`}>
                        <FuelShape fuel={f} />
                      </g>
                    ) : (
                      <circle
                        key={u}
                        cx={ux + unit / 2}
                        cy={uy + unit / 2}
                        r={unit * 0.34}
                        fill="none"
                        stroke="#3d5578"
                        stroke-width=".8"
                        stroke-dasharray="1.6 1.2"
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------------------------------------------------------- station cards */

/** A station's name in words, for screen readers: "Station 20: burns 3 coal, powers 5 cities". */
export function stationLabel(n: number): string {
  const s = stationOf(n);
  if (!s) return `Station ${n}`;
  const cities = `powers ${s.powers} ${s.powers === 1 ? 'city' : 'cities'}`;
  if (s.kind === 'green') return `Station ${n}: green, burns nothing, ${cities}`;
  const fuel = CURRENT_THEME.kinds[s.kind].toLowerCase();
  return `Station ${n}: burns ${s.burn} ${fuel}, ${cities}`;
}

/** The arched window every station's picture sits in, and the Era III card's taller one. */
const ARCH = 'M12 101V70A38 36 0 0 1 88 70V101Z';
const ERA_ARCH = 'M12 128V74A38 36 0 0 1 88 74V128Z';

/** The window's dusk for each kind of station, top to horizon. */
const SKIES: Readonly<Record<Kind | 'star', readonly [string, string]>> = {
  coal: ['#33253a', '#c8683a'],
  oil: ['#252c4a', '#e49c3e'],
  hybrid: ['#2b2a47', '#d27e40'],
  waste: ['#28362f', '#c9b043'],
  uranium: ['#0f2638', '#3faf90'],
  green: ['#285f8a', '#a8dbd2'],
  star: ['#180f3c', '#8a6ad6'],
};

function SkyDefs() {
  return (
    <defs>
      {Object.entries(SKIES).map(([k, [top, low]]) => (
        <linearGradient key={k} id={`ca-sky-${k}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={top} />
          <stop offset="1" stop-color={low} />
        </linearGradient>
      ))}
      <linearGradient id="ca-brass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color={BRASS_HI} />
        <stop offset=".55" stop-color={BRASS} />
        <stop offset="1" stop-color="#a27c30" />
      </linearGradient>
      <radialGradient id="ca-bulb" cx=".45" cy=".4" r=".6">
        <stop offset="0" stop-color="#fff6d6" />
        <stop offset=".55" stop-color={GLOW} />
        <stop offset="1" stop-color={SODIUM} />
      </radialGradient>
      <clipPath id="ca-arch">
        <path d={ARCH} />
      </clipPath>
      <clipPath id="ca-era-arch">
        <path d={ERA_ARCH} />
      </clipPath>
      <radialGradient id="ca-star" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#ffffff" />
        <stop offset=".35" stop-color="#ffe9a8" />
        <stop offset="1" stop-color="#ffe9a8" stop-opacity="0" />
      </radialGradient>
    </defs>
  );
}

/** A tall chimney with brass bands, its top at y `top`, and a plume drifting east. */
function Stack(props: { x: number; top: number; w?: number; smoke?: boolean }) {
  const { x, top } = props;
  const w = props.w ?? 5;
  return (
    <g>
      {props.smoke !== false && (
        <g fill="#cfc4bc" opacity=".55">
          <circle cx={x + w / 2 + 2} cy={top - 4} r="3.4" />
          <circle cx={x + w / 2 + 7} cy={top - 8} r="4.4" />
          <circle cx={x + w / 2 + 14} cy={top - 10} r="5" opacity=".7" />
        </g>
      )}
      <path d={`M${x} 92L${x + 0.8} ${top}H${x + w - 0.8}L${x + w} 92Z`} fill={SILHOUETTE} />
      <path
        d={`M${x + 0.6} ${top + 3}H${x + w - 0.6}M${x + 0.3} ${top + 9}H${x + w - 0.3}`}
        stroke={BRASS}
        stroke-width="1.1"
      />
    </g>
  );
}

/** A row of lit windows. */
function Windows(props: { x: number; y: number; n: number; gap?: number }) {
  const gap = props.gap ?? 5;
  return (
    <g fill={GLOW}>
      {Array.from({ length: props.n }, (_, i) => (
        <rect key={i} x={props.x + i * gap} y={props.y} width="2.4" height="3.2" rx=".4" />
      ))}
    </g>
  );
}

function CoalWorks(props: { stacks: number }) {
  const xs = props.stacks === 3 ? [27, 37, 47] : [30, 42];
  return (
    <g>
      {xs.map((x, i) => (
        <Stack key={x} x={x} top={40 + i * 4} />
      ))}
      <path d="M20 92V72L28 65V72L36 65V72L44 65V72L52 65V72L60 65V92Z" fill={SILHOUETTE} />
      <path d="M28 65V72M36 65V72M44 65V72M52 65V72" stroke={GLOW} stroke-width=".8" opacity=".6" />
      <Windows x={24} y={80} n={7} />
      <path d="M58 92Q64 78 71 80Q77 76 84 92Z" fill="#2a2018" />
      <path d="M64 85 68 81 72 84M72 88 76 83" stroke="#8a6c52" stroke-width=".9" fill="none" />
    </g>
  );
}

function Tank(props: { x: number; w: number; h: number }) {
  const { x, w, h } = props;
  return (
    <g>
      <path d={`M${x} 92V${92 - h}Q${x + w / 2} ${92 - h - 4} ${x + w} ${92 - h}V92Z`} fill={SILHOUETTE} />
      <path
        d={`M${x} ${92 - h}Q${x + w / 2} ${92 - h - 4} ${x + w} ${92 - h}`}
        fill="none"
        stroke={BRASS}
        stroke-width=".9"
      />
      <path d={`M${x + 1} ${92 - h * 0.45}H${x + w - 1}`} stroke={BRASS_LO} stroke-width=".8" />
    </g>
  );
}

function Flare(props: { x: number; top: number }) {
  const { x, top } = props;
  return (
    <g>
      <path d={`M${x} 92V${top}`} stroke={SILHOUETTE} stroke-width="1.8" />
      <path
        d={`M${x} ${top}C${x - 3.6} ${top - 4} ${x - 1} ${top - 8} ${x} ${top - 12}C${x + 1.4} ${top - 8} ${x + 4} ${top - 5} ${x} ${top}Z`}
        fill={SODIUM}
      />
      <path
        d={`M${x} ${top}C${x - 1.4} ${top - 2} ${x} ${top - 5} ${x} ${top - 7}C${x + 1} ${top - 4} ${x + 1.6} ${top - 2} ${x} ${top}Z`}
        fill="#fff1b8"
      />
    </g>
  );
}

function Refinery(props: { tanks: number }) {
  const tanks = Array.from({ length: props.tanks }, (_, i) => i);
  return (
    <g>
      <Flare x={46} top={46} />
      <path d="M26 92V44H33V92Z" fill={SILHOUETTE} />
      <path d="M25 50H34M25 58H34M25 66H34M25 74H34" stroke={BRASS} stroke-width="1" />
      <path d="M29.5 44V38" stroke={SILHOUETTE} stroke-width="1.4" />
      <path d="M20 92V70H26M33 76H52" stroke={SILHOUETTE} stroke-width="1.6" fill="none" />
      <circle cx="29.5" cy="38" r="1.2" fill={SODIUM} />
      {tanks.map((i) => (
        <Tank key={i} x={52 + i * 11.5 - (props.tanks - 1) * 2} w={11} h={13 + (i % 2) * 4} />
      ))}
      <Windows x={20.5} y={84} n={1} />
    </g>
  );
}

function EitherPlant() {
  return (
    <g>
      <Stack x={28} top={42} />
      <path d="M20 92V68H50V60H60V92Z" fill={SILHOUETTE} />
      <path d="M50 60H60" stroke={BRASS} stroke-width="1" />
      <Windows x={24} y={76} n={5} />
      <Windows x={24} y={84} n={5} />
      <Tank x={64} w={14} h={15} />
      <path d="M60 80H64" stroke={SILHOUETTE} stroke-width="1.6" />
      <path d="M12 92Q17 84 22 86Q26 84 30 92Z" fill="#2a2018" />
    </g>
  );
}

function Incinerator() {
  return (
    <g>
      <path d="M52 92V54L53 46H59L60 54V92Z" fill={SILHOUETTE} />
      <rect x="51" y="44" width="10" height="3.2" rx="1" fill={BRASS} />
      <g fill="#b9b08a" opacity=".45">
        <circle cx="58" cy="40" r="3" />
        <circle cx="62" cy="36" r="3.6" />
      </g>
      <path d="M18 92V78A20 13 0 0 1 58 78V92Z" fill={SILHOUETTE} />
      <path d="M22 78A16 9.5 0 0 1 54 78" fill="none" stroke={BRASS} stroke-width=".9" />
      <path d="M26 92V84H34V92" fill={GLOW} opacity=".9" />
      <Windows x={40} y={83} n={3} />
      <path d="M58 92 76 74" stroke={SILHOUETTE} stroke-width="2.4" />
      {[
        [66, 84],
        [75, 84],
        [70.5, 76.5],
      ].map(([x, y]) => (
        <g key={`${x},${y}`} transform={`translate(${x} ${y}) scale(.36)`}>
          <FuelShape fuel={2} />
        </g>
      ))}
    </g>
  );
}

function Reactor(props: { plume: number }) {
  return (
    <g>
      <g fill="#eef1f0" opacity=".75">
        <circle cx="32" cy={42 - props.plume} r="6" />
        <circle cx="39" cy={38 - props.plume} r="7" />
        <circle cx="27" cy={36 - props.plume} r="5" />
        <circle cx="35" cy={31 - props.plume} r="5" opacity=".6" />
      </g>
      <path d="M18 92C24 78 23 62 21 48H45C43 62 42 78 48 92Z" fill="#b9c4c6" />
      <path d="M33 48H45C43 62 42 78 48 92H38C38 76 37 60 33 48Z" fill="#8b9a9e" />
      <path d="M21.6 54H44.4M22.4 60H43.6" stroke="#6d7d82" stroke-width=".8" />
      <path d="M50 92V74A14 14 0 0 1 78 74V92Z" fill="#d4dbdc" />
      <path d="M64 60A14 14 0 0 1 78 74V92H66V74C66 66 65 62 64 60Z" fill="#a6b2b4" />
      <path d="M50 76H78" stroke="#7c8b8f" stroke-width=".8" />
      <circle cx="64" cy="59" r="2" fill="#b9ff7a" />
      <circle cx="64" cy="59" r="4.6" fill="#b9ff7a" opacity=".3" />
      <rect x="54" y="84" width="20" height="8" fill={SILHOUETTE} />
      <Windows x={56} y={86} n={4} gap={4.6} />
    </g>
  );
}

function Turbine(props: { x: number; base: number; h: number; turn: number }) {
  const { x, base, h, turn } = props;
  const top = base - h;
  const blade = h * 0.5;
  return (
    <g>
      <path d={`M${x - 1.2} ${base}L${x - 0.5} ${top}H${x + 0.5}L${x + 1.2} ${base}Z`} fill={CREAM} />
      <g transform={`translate(${x} ${top}) rotate(${turn})`}>
        {[0, 120, 240].map((a) => (
          <path
            key={a}
            d={`M0 0C1.6 ${-blade * 0.3} 1.4 ${-blade * 0.7} 0 ${-blade}C-.6 ${-blade * 0.6} -.8 ${-blade * 0.3} 0 0Z`}
            fill={CREAM}
            stroke="#5d7f86"
            stroke-width=".4"
            transform={`rotate(${a})`}
          />
        ))}
        <circle r="1.5" fill={BRASS} />
      </g>
    </g>
  );
}

function WindFarm(props: { turbines: number }) {
  const spots: readonly (readonly [number, number, number, number])[] =
    props.turbines === 2
      ? [
          [36, 88, 40, 10],
          [64, 86, 32, 40],
        ]
      : props.turbines === 3
        ? [
            [28, 88, 34, 15],
            [50, 84, 42, 50],
            [72, 89, 28, 80],
          ]
        : [
            [24, 88, 28, 20],
            [41, 85, 40, 45],
            [60, 86, 34, 70],
            [77, 89, 24, 95],
          ];
  return (
    <g>
      <path d="M12 92V86Q30 80 46 84T88 82V92Z" fill="#2d6a52" />
      <path d="M12 92V89Q36 84 60 88T88 87V92Z" fill="#1f4f3d" />
      {spots.map(([x, base, h, turn]) => (
        <Turbine key={x} x={x} base={base} h={h} turn={turn} />
      ))}
    </g>
  );
}

/** Station 50: a star held in a brass ring above a plinth, with solar arrays at its feet. */
function StarFurnace() {
  return (
    <g>
      <g stroke="#f7e3a6" stroke-width=".6" opacity=".35">
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return (
            <path
              key={i}
              d={`M${50 + Math.cos(a) * 16} ${60 + Math.sin(a) * 16}L${50 + Math.cos(a) * 34} ${60 + Math.sin(a) * 34}`}
            />
          );
        })}
      </g>
      <circle cx="50" cy="60" r="20" fill="url(#ca-star)" />
      <ellipse cx="50" cy="60" rx="17" ry="6.5" fill="none" stroke={BRASS} stroke-width="2.6" />
      <ellipse cx="50" cy="60" rx="17" ry="6.5" fill="none" stroke={BRASS_HI} stroke-width=".8" />
      <path d="M50 49 52 58 61 60 52 62 50 71 48 62 39 60 48 58Z" fill="#fffbe8" />
      <path d="M44 92 46 80H54L56 92Z" fill={SILHOUETTE} />
      <path d="M46 80 50 67 54 80" fill="none" stroke={BRASS} stroke-width="1.2" />
      {[16, 26, 64, 74].map((x) => (
        <g key={x}>
          <path
            d={`M${x} 86L${x + 3} 80H${x + 11}L${x + 8} 86Z`}
            fill="#2b3f7a"
            stroke="#a9c1ff"
            stroke-width=".5"
          />
          <path
            d={`M${x + 5.5} 80 ${x + 2.5} 86M${x + 1.5} 83H${x + 9.5}`}
            stroke="#a9c1ff"
            stroke-width=".35"
          />
          <path d={`M${x + 4} 86V90`} stroke={SILHOUETTE} stroke-width="1" />
        </g>
      ))}
    </g>
  );
}

function StationScene(props: { n: number; kind: Kind; burn: number; powers: number }) {
  switch (props.kind) {
    case 'coal':
      return <CoalWorks stacks={props.burn >= 3 ? 3 : 2} />;
    case 'oil':
      return <Refinery tanks={props.burn} />;
    case 'hybrid':
      return <EitherPlant />;
    case 'waste':
      return <Incinerator />;
    case 'uranium':
      return <Reactor plume={(props.n % 3) * 2} />;
    case 'green':
      return props.n === 50 ? (
        <StarFurnace />
      ) : (
        <WindFarm turbines={props.powers <= 2 ? 2 : props.powers <= 4 ? 3 : 4} />
      );
  }
}

/** A short zigzag bolt, from the fuel to the bulb. */
function Bolt(props: { x: number; y: number }) {
  const { x, y } = props;
  return (
    <path
      d={`M${x + 3} ${y - 7}L${x - 1.4} ${y + 0.6}H${x + 1.6}L${x - 1} ${y + 7}L${x + 4.4} ${y - 1}H${x + 1.4}Z`}
      fill={SODIUM}
    />
  );
}

/** A lit bulb with the cities powered in its glass. */
function Bulb(props: { cx: number; cy: number; n: number | string }) {
  const { cx, cy } = props;
  return (
    <g>
      <g stroke={GLOW} stroke-width="1.2" stroke-linecap="round" opacity=".8">
        <path
          d={`M${cx} ${cy - 15.6}v-2.6M${cx - 10.4} ${cy - 12.6}l-1.8-1.8M${cx + 10.4} ${cy - 12.6}l1.8-1.8`}
        />
      </g>
      <circle cx={cx} cy={cy - 2} r="11.4" fill="url(#ca-bulb)" stroke="#8a4d0e" stroke-width=".9" />
      <path
        d={`M${cx - 5} ${cy + 8.4}H${cx + 5}V${cy + 14}H${cx - 5}Z`}
        fill="url(#ca-brass)"
        stroke={BRASS_LO}
        stroke-width=".7"
      />
      <path
        d={`M${cx - 5} ${cy + 10.3}H${cx + 5}M${cx - 5} ${cy + 12.2}H${cx + 5}`}
        stroke={BRASS_LO}
        stroke-width=".6"
      />
      <text
        x={cx}
        y={cy + 2.8}
        text-anchor="middle"
        font-family={NUMBER_FONT}
        font-weight="700"
        font-size="14"
        fill="#3b1c00"
      >
        {props.n}
      </text>
    </g>
  );
}

/** The fuel pill: the fuel's colour holding one token per unit burnt, each on a cream disc (a green station's holds a leaf). */
function FuelPill(props: { kind: Kind; burn: number }) {
  const { kind, burn } = props;
  const y = 109;
  const h = 22;
  const x = 7;
  const w = 52;
  const ground =
    kind === 'green'
      ? '#2f7a52'
      : kind === 'hybrid'
        ? FUEL_COLORS[0]
        : FUEL_COLORS[FUELS.indexOf(kind as never)];
  const disc = 7.4;
  const gap = 1.6;
  const total = burn * disc * 2 + (burn - 1) * gap;
  const token = 12.6;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={ground} />
      {kind === 'hybrid' && (
        <path
          d={`M37 ${y}H${x + w - h / 2}A${h / 2} ${h / 2} 0 0 1 ${x + w - h / 2} ${y + h}H29Z`}
          fill={FUEL_COLORS[1]}
        />
      )}
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="none" stroke={BRASS} stroke-width="1.2" />
      {kind === 'green' ? (
        <g>
          <circle cx={x + w / 2} cy={y + h / 2} r={disc + 0.6} fill={CREAM} />
          <path
            d="M27.6 125.2C27.6 117.6 32 113.6 39.6 113.8C39.6 121.4 35.2 125.2 27.6 125.2Z"
            fill="#4fb46e"
            stroke="#173d28"
            stroke-width=".9"
          />
          <path
            d="M27.6 125.2C30.6 121.4 33.4 118.6 37.2 116.2"
            stroke="#173d28"
            stroke-width=".9"
            fill="none"
          />
        </g>
      ) : (
        Array.from({ length: burn }, (_, i) => {
          const cx = x + w / 2 - total / 2 + disc + i * (disc * 2 + gap);
          const cy = y + h / 2;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={disc} fill={CREAM} />
              <g transform={`translate(${cx - token / 2} ${cy - token / 2}) scale(${token / 24})`}>
                {kind === 'hybrid' ? <EitherShape /> : <FuelShape fuel={FUELS.indexOf(kind as never)} />}
              </g>
            </g>
          );
        })
      )}
    </g>
  );
}

/** The card's frame: navy, a brass rule, and stepped deco corners. */
function CardFrame(props: { children?: ComponentChildren }) {
  return (
    <g>
      <rect x="1" y="1" width="98" height="138" rx="7" fill={NAVY} stroke={DEEP} stroke-width="1.4" />
      <rect x="4" y="4" width="92" height="132" rx="4.5" fill="none" stroke={BRASS} stroke-width="1.3" />
      <path
        d="M4 14H8V8H14V4M96 14H92V8H86V4M4 126H8V132H14V136M96 126H92V132H86V136"
        fill="none"
        stroke={BRASS}
        stroke-width="1"
      />
      {props.children}
    </g>
  );
}

export function StationCard(props: { n: number | 'era'; size?: number; dim?: boolean; selected?: boolean }) {
  const w = props.size ?? 100;
  const h = w * 1.4;
  const cls = `ca-card${props.dim ? ' ca-card-dim' : ''}${props.selected ? ' ca-card-selected' : ''}`;
  if (props.n === 'era') return <EraCard w={w} h={h} cls={cls} selected={props.selected === true} />;
  const s = stationOf(props.n) ?? STATIONS[0];
  if (!s) return null;
  const sky = s.n === 50 ? 'star' : s.kind;
  return (
    <svg class={cls} width={w} height={h} viewBox="0 0 100 140" role="img" aria-label={stationLabel(s.n)}>
      <SkyDefs />
      <CardFrame />
      {/* The window: a dusk sky with a sunburst, the station against it, the ground. */}
      <g clip-path="url(#ca-arch)">
        <path d={ARCH} fill={`url(#ca-sky-${sky})`} />
        <g stroke="#ffffff" stroke-width="3.4" opacity=".07">
          <path d="M50 101 18 44M50 101 34 36M50 101 50 34M50 101 66 36M50 101 82 44" />
        </g>
        <StationScene n={s.n} kind={s.kind} burn={s.burn} powers={s.powers} />
      </g>
      <rect x="12" y="92" width="76" height="9" fill={DEEP} />
      <path d="M12 92H88" stroke={BRASS_LO} stroke-width=".8" />
      <path d={ARCH} fill="none" stroke={BRASS} stroke-width="1.6" />
      <path d="M16 101V70A34 32 0 0 1 84 70" fill="none" stroke={BRASS_LO} stroke-width=".5" />
      {/* The number: the opening bid, on a brass plaque. */}
      <path
        d="M30 7H70L76 13V27L70 33H30L24 27V13Z"
        fill="url(#ca-brass)"
        stroke={BRASS_LO}
        stroke-width="1"
      />
      <path d="M31 9.6H69" stroke="#fff6d8" stroke-width=".8" opacity=".7" />
      <text
        x="50"
        y="29.6"
        text-anchor="middle"
        font-family={NUMBER_FONT}
        font-weight="700"
        font-size="23"
        fill={NAVY}
      >
        {s.n}
      </text>
      <FuelPill kind={s.kind} burn={s.burn} />
      <Bolt x={62.4} y={120} />
      <Bulb cx={80} cy={119} n={s.powers} />
      {props.selected && (
        <rect
          x="2.2"
          y="2.2"
          width="95.6"
          height="135.6"
          rx="6"
          fill="none"
          stroke={SODIUM}
          stroke-width="3"
        />
      )}
    </svg>
  );
}

/** The Era III card: a sunburst behind the numeral, for the last stage of the game. */
function EraCard(props: { w: number; h: number; cls: string; selected: boolean }) {
  return (
    <svg
      class={props.cls}
      width={props.w}
      height={props.h}
      viewBox="0 0 100 140"
      role="img"
      aria-label="The Era III card"
    >
      <SkyDefs />
      <CardFrame />
      <g clip-path="url(#ca-era-arch)">
        <path d={ERA_ARCH} fill="url(#ca-sky-star)" />
        <g stroke={GLOW} stroke-width="1.1" opacity=".55">
          {Array.from({ length: 15 }, (_, i) => {
            const a = Math.PI + (i * Math.PI) / 14;
            return <path key={i} d={`M50 84L${50 + Math.cos(a) * 60} ${84 + Math.sin(a) * 60}`} />;
          })}
        </g>
        <circle cx="50" cy="84" r="24" fill="url(#ca-bulb)" />
        <path
          d="M12 128V104H18V96H24V100H30V90H35V84H38V90H42V98H46V92H52V102H56V94H62V88H66V96H71V100H76V93H82V102H88V128Z"
          fill={SILHOUETTE}
        />
        <g fill={GLOW}>
          {[
            [20, 106],
            [26, 103],
            [32, 94],
            [32, 100],
            [39, 93],
            [43, 104],
            [48, 96],
            [53, 106],
            [58, 98],
            [63, 92],
            [63, 100],
            [68, 104],
            [73, 103],
            [78, 97],
            [84, 106],
          ].map(([x, y]) => (
            <rect key={`${x},${y}`} x={x} y={y} width="1.8" height="2.6" />
          ))}
        </g>
        <path d="M12 113H88V128H12Z" fill={DEEP} />
        <g stroke={GLOW} stroke-width="1.2" stroke-linecap="round" opacity=".5">
          <path d="M30 118H40M56 118H70M44 123H52M22 123H26M74 123H80" />
        </g>
      </g>
      <path d="M12 113H88" stroke={BRASS} stroke-width="1" />
      <path d="M12 128V74A38 36 0 0 1 88 74V128Z" fill="none" stroke={BRASS} stroke-width="1.6" />
      <path
        d="M30 7H70L76 13V27L70 33H30L24 27V13Z"
        fill="url(#ca-brass)"
        stroke={BRASS_LO}
        stroke-width="1"
      />
      <text
        x="51"
        y="25.4"
        text-anchor="middle"
        font-family={DECO_FONT}
        font-weight="700"
        font-size="13"
        letter-spacing="4"
        fill={NAVY}
      >
        ERA
      </text>
      <text
        x="50"
        y="85"
        text-anchor="middle"
        font-family="Georgia, 'DejaVu Serif', serif"
        font-weight="700"
        font-size="27"
        fill={NAVY}
        stroke="#fff3cf"
        stroke-width="1.6"
        paint-order="stroke"
      >
        III
      </text>
      {props.selected && (
        <rect
          x="2.2"
          y="2.2"
          width="95.6"
          height="135.6"
          rx="6"
          fill="none"
          stroke={SODIUM}
          stroke-width="3"
        />
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------- cover */

/** A lattice pylon, its feet at (x, base), `h` tall, in silhouette. */
function Pylon(props: { x: number; base: number; h: number; ink?: string }) {
  const { x, base, h } = props;
  const top = base - h;
  const foot = h * 0.2;
  const waist = h * 0.06;
  const arm = h * 0.3;
  const ink = props.ink ?? '#0a0f1c';
  const levels = [0.25, 0.5, 0.72];
  return (
    <g stroke={ink} fill="none" stroke-linejoin="round">
      <path
        d={`M${x - foot} ${base}L${x - waist} ${top + h * 0.12}L${x} ${top}L${x + waist} ${top + h * 0.12}L${x + foot} ${base}`}
        stroke-width={h * 0.022}
      />
      <path
        d={`M${x - arm} ${top + h * 0.16}H${x + arm}M${x - arm * 0.75} ${top + h * 0.32}H${x + arm * 0.75}M${x - arm} ${top + h * 0.16}L${x - waist} ${top + h * 0.24}M${x + arm} ${top + h * 0.16}L${x + waist} ${top + h * 0.24}`}
        stroke-width={h * 0.016}
      />
      {levels.map((t, i) => {
        const y0 = top + h * 0.12 + h * 0.88 * (levels[i - 1] ?? 0);
        const y1 = top + h * 0.12 + h * 0.88 * t;
        const w0 = waist + (foot - waist) * ((y0 - top - h * 0.12) / (h * 0.88));
        const w1 = waist + (foot - waist) * ((y1 - top - h * 0.12) / (h * 0.88));
        return (
          <path
            key={t}
            d={`M${x - w0} ${y0}L${x + w1} ${y1}M${x + w0} ${y0}L${x - w1} ${y1}M${x - w1} ${y1}H${x + w1}`}
            stroke-width={h * 0.01}
          />
        );
      })}
      {[-arm, -arm * 0.75, arm * 0.75, arm].map((dx, i) => (
        <path
          key={dx}
          d={`M${x + dx} ${top + h * (i === 0 || i === 3 ? 0.16 : 0.32)}v${h * 0.05}`}
          stroke-width={h * 0.012}
        />
      ))}
    </g>
  );
}

/** A sagging wire between two points, with a soft sodium glow. */
function Wire(props: {
  from: readonly [number, number];
  to: readonly [number, number];
  sag?: number;
  glow?: boolean;
}) {
  const [x1, y1] = props.from;
  const [x2, y2] = props.to;
  const sag = props.sag ?? 14;
  const d = `M${x1} ${y1}Q${(x1 + x2) / 2} ${(y1 + y2) / 2 + sag * 2} ${x2} ${y2}`;
  return (
    <g fill="none" stroke-linecap="round">
      {props.glow !== false && <path d={d} stroke={SODIUM} stroke-width="3.2" opacity=".28" />}
      <path d={d} stroke={props.glow === false ? '#0a0f1c' : GLOW} stroke-width=".9" />
    </g>
  );
}

/** The cover's two wind turbines: x, foot, height and the blades' turn. */
const COVER_TURBINES: readonly (readonly [number, number, number, number])[] = [
  [548, 256, 44, 20],
  [578, 254, 52, 65],
];

const COVER_STARS: readonly (readonly [number, number, number])[] = [
  [40, 30, 1.1],
  [88, 62, 0.8],
  [132, 22, 1.3],
  [176, 48, 0.9],
  [214, 16, 1],
  [252, 70, 0.7],
  [346, 30, 1.2],
  [392, 58, 0.8],
  [430, 20, 1],
  [470, 74, 0.9],
  [512, 34, 1.3],
  [556, 60, 0.8],
  [580, 18, 1],
  [20, 84, 0.8],
  [300, 44, 0.8],
];

/** One deco skyscraper: a stepped silhouette with lit windows, `w` wide, its roof at `top`. */
function Tall(props: { x: number; w: number; top: number; steps?: number; spire?: number; lit?: number }) {
  const { x, w, top } = props;
  const steps = props.steps ?? 2;
  const base = 300;
  const unit = w / (steps * 2 + 2);
  const tiers = Array.from({ length: steps + 1 }, (_, i) => ({
    x: x + i * unit,
    y: top + (steps - i) * 10,
    w: w - 2 * i * unit,
  }));
  const lit = props.lit ?? 0.5;
  const cols = Math.max(2, Math.floor((w - 6) / 6));
  const rows = Math.floor((base - top - steps * 10 - 12) / 9);
  const windows: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = (x * 7 + r * 13 + c * 29) % 100;
      if (k < lit * 100)
        windows.push({ x: x + 4 + c * ((w - 8) / (cols - 1 || 1)) - 1, y: top + steps * 10 + 8 + r * 9 });
    }
  }
  return (
    <g>
      {props.spire !== undefined && (
        <g>
          <path d={`M${x + w / 2} ${top - props.spire}V${top}`} stroke="#0d1322" stroke-width="2" />
          <circle cx={x + w / 2} cy={top - props.spire} r="2.4" fill="#ff6a3d" />
          <circle cx={x + w / 2} cy={top - props.spire} r="6" fill="#ff6a3d" opacity=".25" />
        </g>
      )}
      {tiers.map((t) => (
        <rect key={t.y} x={t.x} y={t.y} width={t.w} height={base - t.y} fill="#121a2c" />
      ))}
      <path
        d={`M${x + w * 0.62} ${base}V${top + steps * 10 + 4}`}
        stroke="#1d2840"
        stroke-width={w * 0.38}
        opacity=".7"
      />
      <g fill={GLOW}>
        {windows.map((p) => (
          <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width="2.2" height="3.6" />
        ))}
      </g>
    </g>
  );
}

export function CurrentCover(props: { thumb?: boolean }) {
  return (
    <svg
      class="game-cover ca-cover"
      viewBox="0 0 600 360"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Current Affairs artwork: a city skyline at dusk lit by a web of transmission lines from a coal works, an oil refinery, a uranium dome and wind turbines, under a setting sun"
    >
      <defs>
        <linearGradient id="ca-cover-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0d1730" />
          <stop offset=".34" stop-color="#1f3858" />
          <stop offset=".56" stop-color="#5b4766" />
          <stop offset=".72" stop-color="#d47538" />
          <stop offset=".84" stop-color="#f6b75c" />
        </linearGradient>
        <radialGradient id="ca-cover-sun" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fff0c0" stop-opacity=".95" />
          <stop offset=".3" stop-color="#ffc56b" stop-opacity=".55" />
          <stop offset="1" stop-color="#f29a54" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="ca-cover-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#29354e" />
          <stop offset="1" stop-color="#0c1322" />
        </linearGradient>
        <linearGradient id="ca-cover-plaque" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={BRASS_HI} />
          <stop offset=".5" stop-color={BRASS} />
          <stop offset="1" stop-color="#9a752c" />
        </linearGradient>
        <radialGradient id="ca-cover-vignette" cx=".5" cy=".5" r=".75">
          <stop offset=".6" stop-color="#05080f" stop-opacity="0" />
          <stop offset="1" stop-color="#05080f" stop-opacity=".55" />
        </radialGradient>
        <radialGradient id="ca-cover-halo" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color={GLOW} stop-opacity=".55" />
          <stop offset="1" stop-color={SODIUM} stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="600" height="360" fill="url(#ca-cover-sky)" />
      <g fill="#fbf1d8">
        {COVER_STARS.map(([x, y, r]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r={r} opacity={0.45 + r / 3} />
        ))}
      </g>
      {/* The sunburst and the banded setting sun behind the city. */}
      <g fill="#ffd38a" opacity=".1">
        {Array.from({ length: 9 }, (_, i) => {
          const a0 = Math.PI + (i * 2 + 0.5) * (Math.PI / 18);
          const a1 = a0 + Math.PI / 18;
          return (
            <path
              key={i}
              d={`M300 262L${300 + Math.cos(a0) * 420} ${262 + Math.sin(a0) * 420}L${300 + Math.cos(a1) * 420} ${262 + Math.sin(a1) * 420}Z`}
            />
          );
        })}
      </g>
      <circle cx="300" cy="250" r="150" fill="url(#ca-cover-sun)" />
      <circle cx="300" cy="250" r="54" fill="#ffd690" />
      <g stroke="#e9894a" stroke-width="3">
        <path d="M246 236H354M248 248H352M250 259H350M253 269H347" />
      </g>
      {/* Far hills. */}
      <path
        d="M0 270C60 252 110 258 160 262 230 246 300 254 360 258 430 244 500 240 600 254V360H0Z"
        fill="#3a3352"
      />
      {/* Left: the coal works and the refinery. */}
      <g>
        <g fill="#8d7f8c" opacity=".55">
          <ellipse cx="78" cy="152" rx="18" ry="11" />
          <ellipse cx="104" cy="138" rx="24" ry="13" />
          <ellipse cx="138" cy="128" rx="30" ry="14" opacity=".7" />
          <ellipse cx="60" cy="166" rx="12" ry="8" />
          <ellipse cx="44" cy="176" rx="14" ry="8" opacity=".8" />
          <ellipse cx="22" cy="168" rx="18" ry="9" opacity=".6" />
        </g>
        <path d="M54 300V182L56 168H64L66 182V300ZM76 300V174L78 160H86L88 174V300Z" fill="#121a2c" />
        <path d="M55 176H65M55 186H65M77 168H87M77 178H87" stroke={BRASS} stroke-width="1.6" />
        <path d="M30 300V238L44 228V238L58 228V238L72 228V238L86 228V238L100 228V300Z" fill="#141c2e" />
        <g fill={GLOW}>
          {[36, 46, 56, 66, 76, 86].map((x) => (
            <rect key={x} x={x} y="250" width="4" height="6" />
          ))}
        </g>
        <path d="M128 300V200H138V300Z" fill="#121a2c" />
        <path d="M127 212H139M127 224H139M127 236H139M127 248H139" stroke={BRASS} stroke-width="1.2" />
        <path d="M152 300V212" stroke="#121a2c" stroke-width="3" />
        <path d="M152 212C146 204 150 196 152 188 155 196 158 204 152 212Z" fill={SODIUM} />
        <path d="M152 212C150 208 151 203 152 199 153.5 203 154.5 208 152 212Z" fill="#fff1b8" />
        <circle cx="152" cy="200" r="16" fill="url(#ca-cover-halo)" />
        <path d="M160 300V266Q176 256 192 266V300Z" fill="#141c2e" />
        <path d="M160 266Q176 256 192 266" fill="none" stroke={BRASS} stroke-width="1.2" />
        <path d="M108 300V272Q118 266 128 272V300Z" fill="#141c2e" />
      </g>
      {/* Right: the uranium dome, its cooling stack, and wind turbines on the far hill. */}
      <g>
        <g fill="#e7e2e8" opacity=".6">
          <ellipse cx="444" cy="168" rx="20" ry="12" />
          <ellipse cx="462" cy="150" rx="26" ry="14" />
          <ellipse cx="488" cy="136" rx="30" ry="14" opacity=".7" />
        </g>
        <path d="M412 300C432 258 434 218 424 184H466C456 218 458 258 478 300Z" fill="#2c3754" />
        <path d="M447 184H466C456 218 458 258 478 300H456C452 258 452 218 447 184Z" fill="#1d253b" />
        <path d="M424 184H466" stroke="#c9b48a" stroke-width="1.6" />
        <path d="M427.6 196H462.6M430.4 208H459.8" stroke="#46557a" stroke-width="1.4" />
        <path d="M520 270C540 254 570 252 600 256V300H520Z" fill="#202a44" />
        {COVER_TURBINES.map(([x, base, h, turn]) => (
          <g key={x}>
            <path
              d={`M${x - 1.6} ${base}L${x - 0.6} ${base - h}H${x + 0.6}L${x + 1.6} ${base}Z`}
              fill="#d8d2cc"
            />
            <g transform={`translate(${x} ${base - h}) rotate(${turn})`}>
              {[0, 120, 240].map((a) => (
                <path
                  key={a}
                  d={`M0 0C2 ${-h * 0.15} 1.8 ${-h * 0.35} 0 ${-h * 0.5}C-.8 ${-h * 0.3} -1 ${-h * 0.15} 0 0Z`}
                  fill="#d8d2cc"
                  transform={`rotate(${a})`}
                />
              ))}
              <circle r="2" fill={BRASS} />
            </g>
          </g>
        ))}
      </g>
      {/* The city: deco skyscrapers with a spire in the middle. */}
      <g>
        <Tall x={214} w={30} top={196} steps={2} lit={0.45} />
        <Tall x={238} w={36} top={168} steps={3} lit={0.55} />
        <Tall x={326} w={36} top={178} steps={3} lit={0.5} />
        <Tall x={354} w={32} top={206} steps={2} lit={0.45} />
        <Tall x={380} w={26} top={232} steps={1} lit={0.5} />
        <Tall x={270} w={60} top={124} steps={3} spire={34} lit={0.6} />
        <path d="M300 124V300" stroke={BRASS} stroke-width="1" opacity=".5" />
        <path d="M200 300V262H216V300ZM392 300V268H410V300Z" fill="#141c2e" />
      </g>
      {/* The lines: pylons marching in from both sides, the wires lit. */}
      <Wire from={[66, 182]} to={[112, 214]} sag={4} />
      <Wire from={[132, 204]} to={[112, 214]} sag={2} />
      <Pylon x={112} base={306} h={98} />
      <Wire from={[87, 214]} to={[221, 236]} sag={8} />
      <Wire from={[137, 214]} to={[221, 236]} sag={10} />
      <Pylon x={216} base={318} h={86} />
      <Wire from={[211, 246]} to={[268, 232]} sag={4} />
      <Wire from={[231, 246]} to={[268, 232]} sag={3} />
      <Wire from={[476, 236]} to={[418, 242]} sag={4} />
      <Pylon x={482} base={312} h={84} />
      {/* The uranium dome, in front of the line that leaves it. */}
      <g>
        <path d="M476 300V266A26 26 0 0 1 528 266V300Z" fill="#2a3452" />
        <path d="M502 240A26 26 0 0 1 528 266V300H508V266C508 254 506 246 502 240Z" fill="#1f2741" />
        <path
          d="M478.6 262A23.4 23.4 0 0 1 495 242.4"
          fill="none"
          stroke="#f6c27a"
          stroke-width="1.6"
          stroke-linecap="round"
        />
        <path d="M476 274H528" stroke={BRASS} stroke-width="1" />
        <g fill={GLOW}>
          <rect x="482" y="282" width="4" height="6" />
          <rect x="492" y="282" width="4" height="6" />
          <rect x="512" y="282" width="4" height="6" />
        </g>
        <circle cx="502" cy="240" r="3" fill="#b9ff7a" />
        <circle cx="502" cy="240" r="10" fill="#b9ff7a" opacity=".22" />
      </g>
      <Wire from={[387, 246]} to={[340, 232]} sag={4} />
      <Wire from={[413, 246]} to={[340, 232]} sag={3} />
      <Pylon x={400} base={322} h={80} />
      <Wire from={[497, 236]} to={[560, 222]} sag={6} />
      <Wire from={[497, 236]} to={[600, 236]} sag={12} />
      <Wire from={[0, 220]} to={[87, 214]} sag={10} />
      {/* Sparks along the wires. */}
      <g fill="#fff4cf">
        <circle cx="160" cy="232" r="1.6" />
        <circle cx="440" cy="246" r="1.4" />
        <circle cx="246" cy="244" r="1.3" />
        <circle cx="546" cy="238" r="1.3" />
        <circle cx="36" cy="226" r="1.2" />
      </g>
      {/* The Long Water in front, with the city's lights in it. */}
      <path d="M0 300H600V360H0Z" fill="url(#ca-cover-water)" />
      <path d="M0 300H600" stroke="#d47538" stroke-width="1.4" opacity=".6" />
      <g stroke={GLOW} stroke-linecap="round" opacity=".55">
        <path d="M282 310H318M276 320H324M288 330H312M292 342H308" stroke-width="2" />
        <path d="M236 312H252M346 314H364M64 312H84M146 316H160M440 312H462M496 318H510" stroke-width="1.4" />
        <path d="M234 326H246M352 328H362M70 328H80M444 330H456" stroke-width="1" />
      </g>
      <path d="M0 336C120 330 220 344 320 340 420 336 520 346 600 340V360H0Z" fill="#0a101d" opacity=".7" />
      <rect width="600" height="360" fill="url(#ca-cover-vignette)" />
      {!props.thumb && (
        <g>
          <path
            d="M150 20H450L470 40 450 60H150L130 40Z"
            fill="#05080f"
            opacity=".45"
            transform="translate(3 4)"
          />
          <path
            d="M150 20H450L470 40 450 60H150L130 40Z"
            fill="url(#ca-cover-plaque)"
            stroke={BRASS_LO}
            stroke-width="2"
          />
          <path d="M156 25H444L459 40 444 55H156L141 40Z" fill="none" stroke={NAVY} stroke-width="1" />
          <path
            d="M96 34H124M104 40H126M96 46H124M476 34H504M474 40H496M476 46H504"
            stroke={BRASS_HI}
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <text
            x="300"
            y="50.5"
            text-anchor="middle"
            font-family={DECO_FONT}
            font-weight="700"
            font-size="29"
            letter-spacing="3"
            textLength="270"
            lengthAdjust="spacingAndGlyphs"
            fill={NAVY}
          >
            {CURRENT_THEME.title}
          </text>
          <text
            x="300"
            y="82"
            text-anchor="middle"
            font-family={DECO_FONT}
            font-size="12.5"
            letter-spacing=".6"
            fill={CREAM}
            stroke="#0d1730"
            stroke-width="3"
            stroke-linejoin="round"
            paint-order="stroke"
          >
            {CURRENT_THEME.tagline}
          </text>
        </g>
      )}
    </svg>
  );
}
