/*
 * The Commonwealth (docs/games/current-affairs/RULES.md, "The map"), drawn as a utility company's wall chart: a
 * navy sea along the west, the southern gulf and the long eastern coast, six tinted regions, the Long Water and the
 * peaks of the Copper Range as scenery (they set no costs), every line with its cost on a brass badge (a free line
 * is drawn doubled, with a "free" tag), and each city as a round medallion with three sockets, 10, 15 and 20,
 * filled in build order with the companies' colours and marks. Regions out of play are fogged. Cities the viewer
 * may wire glow and are focusable buttons. Original art, CC0-1.0 (packages/games/current-affairs/ART-LICENSE.md).
 */
import { CITY_COUNT, CITY_REGION, LINKS, REGIONS, SLOT_COST } from '@bored-games/current-affairs';
import { CITY_POINTS } from '@bored-games/current-affairs/atlas';
import { CURRENT_THEME } from '@bored-games/current-affairs/theme';
import { DECO_FONT, SeatDisc } from './art.tsx';
import {
  BADGES,
  BRIDGES,
  CITY_R,
  COAST_PATH,
  H,
  ISLETS,
  LAND_PATH,
  NAME_OFFSHORE,
  NAME_SIZE,
  type NameSpot,
  PEAKS,
  placeNames,
  RANGE_NAME_SPOT,
  REGION_BORDERS,
  REGION_NAME_SIZE,
  REGION_NAME_SPACING,
  REGION_NAME_SPOTS,
  REGION_PATHS,
  RIVER_LABEL_PATH,
  RIVER_PATH,
  W,
  WAVES,
} from './map-shapes.ts';
import './current-affairs.css';

export interface MapProps {
  /** The regions in play, by index into REGIONS; the others are fogged. Empty while none are drawn yet: all shown. */
  regions: readonly number[];
  /** For each city, the seats with a substation there, in build order. */
  houses: readonly (readonly number[])[];
  /** City names by city index. */
  names: readonly string[];
  /** The cities the viewer may wire now, with what each costs in all (substation and lines). */
  offers?: ReadonlyMap<number, number>;
  onCity?: (city: number) => void;
  /** A city to pick out. */
  highlight?: number | null;
  /** Seat names, for the cities' spoken labels. */
  seatNames?: readonly string[];
}

/** Each region's land tint and the ink of its name. */
const REGION_LOOKS: readonly { readonly fill: string; readonly ink: string }[] = [
  { fill: '#d3e3e6', ink: '#2c5866' },
  { fill: '#e6c4a6', ink: '#7a4022' },
  { fill: '#f1dd94', ink: '#76560f' },
  { fill: '#c6dece', ink: '#2c5c44' },
  { fill: '#e3e2ad', ink: '#5e5a1c' },
  { fill: '#ecbea6', ink: '#863922' },
];

const BRASS = '#c9a24a';
const BRASS_HI = '#efd896';
const BRASS_LO = '#7d5d22';
const LINE_INK = '#2b2a2c';
/** The three sockets of a city, 10 at the top, 15 bottom left, 20 bottom right. */
const SOCKETS: readonly (readonly [number, number])[] = [
  [0, -7.9],
  [-6.9, 4],
  [6.9, 4],
];
const SOCKET_R = 6.1;

let nameCache: { key: string; spots: readonly NameSpot[] } | null = null;

/** The city names' places, worked out once per set of names. */
function cityNameSpots(names: readonly string[]): readonly NameSpot[] {
  const key = names.join('|');
  if (nameCache?.key !== key) nameCache = { key, spots: placeNames(names) };
  return nameCache.spots;
}

const pt = (c: number): readonly [number, number] => CITY_POINTS[c] ?? [0, 0];

/** Pylon ticks across a line, every 26 units. */
function ticks(a: readonly [number, number], b: readonly [number, number]): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const n = Math.floor((len - 2 * CITY_R) / 26);
  let d = '';
  for (let i = 1; i <= n; i++) {
    const t = CITY_R + ((len - 2 * CITY_R) * i) / (n + 1);
    const x = a[0] + ux * t;
    const y = a[1] + uy * t;
    d += `M${(x - uy * 3.6).toFixed(1)} ${(y + ux * 3.6).toFixed(1)}L${(x + uy * 3.6).toFixed(1)} ${(y - ux * 3.6).toFixed(1)}`;
  }
  return d;
}

/** A compass rose, the north point in brass. */
function Compass(props: { x: number; y: number; r: number }) {
  const { x, y, r } = props;
  return (
    <g class="ca-compass" transform={`translate(${x} ${y})`}>
      <circle r={r * 0.72} fill="none" stroke={BRASS} stroke-width="1" opacity=".8" />
      {[0, 90, 180, 270].map((a) => (
        <g key={a} transform={`rotate(${a})`}>
          <path d={`M0 ${-r}L${r * 0.16} 0H${-r * 0.16}Z`} fill={a === 0 ? BRASS_HI : '#6d86a3'} />
          <path d={`M0 ${-r}L${-r * 0.16} 0H0Z`} fill={a === 0 ? BRASS : '#4a6380'} />
        </g>
      ))}
      <text
        y={-r - 4}
        text-anchor="middle"
        font-family={DECO_FONT}
        font-weight="700"
        font-size="11"
        fill={BRASS_HI}
      >
        N
      </text>
    </g>
  );
}

/** A mountain glyph of the Copper Range: a peak with a lit eastern face and a brass ridge. */
function Peak(props: { x: number; y: number; s: number }) {
  const { x, y, s } = props;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <path d="M-10 6L-1.5 -8.5L2 -3.6L4.5 -6.6L11 6Z" fill="#b98a67" />
      <path d="M-1.5 -8.5L1 6H11L4.5 -6.6L2 -3.6Z" fill="#9a6d4e" />
      <path
        d="M-10 6L-1.5 -8.5L2 -3.6L4.5 -6.6L11 6"
        fill="none"
        stroke="#6b4129"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
      <path
        d="M-4 -4.4L-1.5 -8.5L.6 -5.4"
        fill="none"
        stroke="#fbf2e0"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </g>
  );
}

function cityLabel(
  c: number,
  names: readonly string[],
  houses: readonly number[],
  seatNames: readonly string[] | undefined,
): string {
  const name = names[c] ?? `City ${c + 1}`;
  if (houses.length === 0) return `${name}: no substations`;
  const who = houses.map((s) => seatNames?.[s] ?? `Seat ${s + 1}`).join(', ');
  return `${name}: substations of ${who}`;
}

export function CommonwealthMap(props: MapProps) {
  const names = props.names;
  const spots = cityNameSpots(names);
  const inPlay = new Set(props.regions.length > 0 ? props.regions : REGIONS.map((_, r) => r));
  const live = (c: number) => inPlay.has(CITY_REGION[c] ?? -1);
  const offers = props.offers;
  const onCity = props.onCity;

  return (
    <div class="ca-map">
      {/* biome-ignore lint/a11y/useSemanticElements: the map is one SVG; a fieldset cannot hold its drawing. */}
      <svg
        class="ca-map-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`Map of ${CURRENT_THEME.land}`}
      >
        <defs>
          <clipPath id="ca-land-clip">
            <path d={LAND_PATH} />
          </clipPath>
          <pattern
            id="ca-fog"
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="9" height="9" fill="#c9c6bf" />
            <rect width="2.2" height="9" fill="#a9a59d" />
          </pattern>
          <radialGradient id="ca-offer-glow" cx=".5" cy=".5" r=".5">
            <stop offset="0" stop-color="#ffcf7a" stop-opacity=".95" />
            <stop offset=".55" stop-color="#f39a33" stop-opacity=".55" />
            <stop offset="1" stop-color="#f39a33" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="ca-sea-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#1b3a58" />
            <stop offset="1" stop-color="#112538" />
          </linearGradient>
        </defs>

        {/* The sea and its waves, the islets, and a pale shelf along the coast. */}
        <rect width={W} height={H} fill="url(#ca-sea-fade)" />
        <g stroke="#2d5677" stroke-width="1.3" fill="none" stroke-linecap="round">
          {WAVES.map(([x, y]) => (
            <path key={`${x},${y}`} d={`M${x.toFixed(1)} ${y.toFixed(1)}q4 -3.4 8 0t8 0`} />
          ))}
        </g>
        <path d={LAND_PATH} fill="none" stroke="#2f6a86" stroke-width="16" opacity=".55" />
        <path d={LAND_PATH} fill="none" stroke="#4d8ea6" stroke-width="6" opacity=".5" />
        {ISLETS.map((d) => (
          <path key={d} d={d} fill="#d9cfb4" stroke={BRASS} stroke-width="1.2" />
        ))}

        {/* The land: six regions, fogged where out of play, their borders, the river and the peaks. */}
        <g clip-path="url(#ca-land-clip)">
          <rect width={W} height={H} fill="#efe5cc" />
          {REGION_PATHS.map((d, r) => {
            const look = REGION_LOOKS[r] ?? { fill: '#ddd', ink: '#333' };
            const on = inPlay.has(r);
            return (
              <g key={REGIONS[r]} class={on ? 'ca-region' : 'ca-region ca-region-fog'}>
                <path d={d} fill={look.fill} stroke={look.fill} stroke-width="1.4" />
                {!on && <path d={d} fill="url(#ca-fog)" opacity=".85" />}
              </g>
            );
          })}
          {REGION_BORDERS.map((b) => (
            <g key={`${b.a}-${b.b}`}>
              <path
                d={b.d}
                fill="none"
                stroke="#fffaf0"
                stroke-width="5"
                opacity=".6"
                stroke-linecap="round"
              />
              <path
                d={b.d}
                fill="none"
                stroke="#6a5a44"
                stroke-width="1.5"
                stroke-dasharray="7 3 1.5 3"
                stroke-linecap="round"
              />
            </g>
          ))}
          <path
            d={RIVER_PATH}
            fill="none"
            stroke="#efe5cc"
            stroke-width="15"
            opacity=".7"
            stroke-linecap="round"
          />
          <path d={RIVER_PATH} fill="none" stroke="#2f6a86" stroke-width="9" stroke-linecap="round" />
          <path
            d={RIVER_PATH}
            fill="none"
            stroke="#7fb6c8"
            stroke-width="2.4"
            stroke-linecap="round"
            opacity=".8"
          />
          <g class="ca-peaks">
            {PEAKS.map((p) => (
              <Peak key={`${p.x},${p.y}`} x={p.x} y={p.y} s={p.s} />
            ))}
          </g>
        </g>
        <path d={COAST_PATH} fill="none" stroke={BRASS} stroke-width="2.6" stroke-linejoin="round" />
        <path
          d={COAST_PATH}
          fill="none"
          stroke="#5b4417"
          stroke-width=".8"
          stroke-linejoin="round"
          opacity=".7"
        />

        {/* Lettering: region names, the river and the range. */}
        <g class="ca-region-names" font-family={DECO_FONT} font-weight="700" text-anchor="middle">
          {REGIONS.map((r, i) => {
            const [x, y] = REGION_NAME_SPOTS[i] ?? [0, 0];
            const look = REGION_LOOKS[i] ?? { fill: '#ddd', ink: '#333' };
            return (
              <text
                key={r}
                x={x}
                y={y}
                font-size={REGION_NAME_SIZE}
                letter-spacing={REGION_NAME_SPACING}
                fill={NAME_OFFSHORE[i] ? look.fill : look.ink}
                opacity={(inPlay.has(i) ? 0.66 : 0.45) + (NAME_OFFSHORE[i] ? 0.25 : 0)}
              >
                {CURRENT_THEME.regions[r].toUpperCase()}
              </text>
            );
          })}
        </g>
        <text
          class="ca-range-name"
          x={RANGE_NAME_SPOT[0]}
          y={RANGE_NAME_SPOT[1]}
          text-anchor="middle"
          font-family="Georgia, 'DejaVu Serif', serif"
          font-style="italic"
          font-size="13"
          letter-spacing="1.5"
          fill="#6b3a1f"
          opacity={inPlay.has(REGIONS.indexOf('copper')) ? 0.9 : 0.5}
        >
          the Copper Range
        </text>
        <path id="ca-river-label" d={RIVER_LABEL_PATH} fill="none" />
        <text
          class="ca-river-name"
          font-family="Georgia, 'DejaVu Serif', serif"
          font-style="italic"
          font-size="11.5"
          letter-spacing="0.5"
          fill="#1f5470"
        >
          <textPath href="#ca-river-label" startOffset="50%" text-anchor="middle">
            the Long Water
          </textPath>
        </text>

        {/* The lines, each with its cost; pylon ticks across them, a bridge where they cross the Long Water. */}
        <g class="ca-links">
          {LINKS.map(([a, b, cost], i) => {
            const pa = pt(a);
            const pb = pt(b);
            const on = live(a) && live(b);
            const [bx, by] = BADGES[i] ?? [0, 0];
            const free = cost === 0;
            return (
              <g key={`${a}-${b}`} class={on ? 'ca-link' : 'ca-link ca-link-fog'}>
                {free && on ? (
                  <path
                    d={`M${pa[0]} ${pa[1]}L${pb[0]} ${pb[1]}`}
                    stroke={LINE_INK}
                    stroke-width="6"
                    class="ca-link-free"
                  />
                ) : null}
                <path
                  d={`M${pa[0]} ${pa[1]}L${pb[0]} ${pb[1]}`}
                  stroke={free && on ? '#efe5cc' : LINE_INK}
                  stroke-width={free && on ? 2 : on ? 2.4 : 1.6}
                  stroke-dasharray={on ? undefined : '5 4'}
                />
                {on && !free && <path d={ticks(pa, pb)} stroke={LINE_INK} stroke-width="1.2" />}
                <rect
                  x={bx - (free ? 15 : 11)}
                  y={by - 8}
                  width={free ? 30 : 22}
                  height="16"
                  rx="8"
                  fill={free ? (on ? '#e3f0d4' : '#dcdcd2') : on ? BRASS : '#cfc9bb'}
                  stroke={free ? (on ? '#2f6b45' : '#8d877b') : on ? '#5b4417' : '#8d877b'}
                  stroke-width="1.2"
                />
                <text
                  x={bx}
                  y={by + (free ? 3.8 : 4.2)}
                  text-anchor="middle"
                  font-family={DECO_FONT}
                  font-weight="700"
                  font-size={free ? 10.5 : 11.5}
                  fill={free ? (on ? '#1f5a34' : '#6d685e') : on ? '#14233a' : '#6d685e'}
                >
                  {free ? 'free' : cost}
                </text>
              </g>
            );
          })}
        </g>
        <g class="ca-bridges" stroke={LINE_INK} stroke-width="1.6" fill="none">
          {BRIDGES.map((b) => (
            <g
              key={`${b.x},${b.y}`}
              transform={`translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${b.angle.toFixed(1)})`}
            >
              <path d="M-9 -3.6H9M-9 3.6H9" />
              <path d="M-9 -3.6l-2.6 -2.6M9 -3.6l2.6 -2.6M-9 3.6l-2.6 2.6M9 3.6l2.6 2.6" stroke-width="1.2" />
            </g>
          ))}
        </g>

        {/* The cities. */}
        <g class="ca-cities">
          {Array.from({ length: CITY_COUNT }, (_, c) => {
            const [x, y] = pt(c);
            const on = live(c);
            const here = props.houses[c] ?? [];
            const cost = offers?.get(c);
            const offered = cost !== undefined && on;
            const active = onCity !== undefined && on && (offers === undefined || offered);
            const name = names[c] ?? '';
            const spot = spots[c] ?? { x, y: y + 30, anchor: 'middle' as const };
            const highlight = props.highlight === c;
            // The price tag goes on the side away from the name.
            const tagY = spot.y > y + 4 ? y - CITY_R - 19 : y + CITY_R + 3;
            const label = offered ? `Wire ${name} for $${cost}` : cityLabel(c, names, here, props.seatNames);
            const cls = `ca-city${on ? '' : ' ca-city-fog'}${offered ? ' ca-city-offer' : ''}${highlight ? ' ca-city-highlight' : ''}`;
            const body = (
              <>
                {offered && <circle cx={x} cy={y} r="31" fill="url(#ca-offer-glow)" class="ca-offer-halo" />}
                {highlight && (
                  <g class="ca-highlight" fill="none" stroke="#f39a33" stroke-linecap="round">
                    <circle cx={x} cy={y} r={CITY_R + 7} stroke-width="3" />
                    <path
                      d={[0, 45, 90, 135, 180, 225, 270, 315]
                        .map((deg) => {
                          const a = (deg * Math.PI) / 180;
                          const r0 = CITY_R + 11;
                          const r1 = CITY_R + 17;
                          return `M${(x + Math.cos(a) * r0).toFixed(1)} ${(y + Math.sin(a) * r0).toFixed(1)}L${(x + Math.cos(a) * r1).toFixed(1)} ${(y + Math.sin(a) * r1).toFixed(1)}`;
                        })
                        .join('')}
                      stroke-width="2.4"
                    />
                  </g>
                )}
                <circle cx={x} cy={y + 1.6} r={CITY_R} fill="#000" opacity=".25" />
                <circle
                  cx={x}
                  cy={y}
                  r={CITY_R}
                  fill="#14233a"
                  stroke={offered ? '#ffcf7a' : BRASS}
                  stroke-width={offered ? 3 : 2.2}
                />
                <circle cx={x} cy={y} r={CITY_R - 1.6} fill="none" stroke={BRASS_LO} stroke-width=".7" />
                {SOCKETS.map(([dx, dy], k) => {
                  const seat = here[k];
                  return seat === undefined ? (
                    <g key={k}>
                      <circle
                        cx={x + dx}
                        cy={y + dy}
                        r={SOCKET_R}
                        fill="#22344f"
                        stroke={BRASS_LO}
                        stroke-width=".9"
                      />
                      <text
                        x={x + dx}
                        y={y + dy + 2.1}
                        text-anchor="middle"
                        font-family={DECO_FONT}
                        font-weight="700"
                        font-size="5.8"
                        fill={BRASS_HI}
                      >
                        {SLOT_COST[k]}
                      </text>
                    </g>
                  ) : (
                    <SeatDisc key={k} seat={seat} cx={x + dx} cy={y + dy} r={SOCKET_R} />
                  );
                })}
                {offered && (
                  <g class="ca-offer-tag">
                    <rect
                      x={x - (String(cost).length * 8 + 16) / 2}
                      y={tagY}
                      width={String(cost).length * 8 + 16}
                      height="17"
                      rx="8.5"
                      fill="#f39a33"
                      stroke="#5a2c00"
                      stroke-width="1.2"
                    />
                    <text
                      x={x}
                      y={tagY + 12.8}
                      text-anchor="middle"
                      font-family={DECO_FONT}
                      font-weight="700"
                      font-size="12"
                      fill="#2a1400"
                    >
                      {`$${cost}`}
                    </text>
                  </g>
                )}
                {active && <circle cx={x} cy={y} r="27" class="ca-city-hit" />}
              </>
            );
            if (!active)
              return (
                <g key={c} class={cls} data-city={c}>
                  <title>{label}</title>
                  {body}
                </g>
              );
            return (
              // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>; it has a role, a label and keys.
              <g
                key={c}
                class={`${cls} ca-city-active`}
                data-city={c}
                role="button"
                // Preact writes SVG props as attributes, so the lowercase name is the one the browser reads (D081).
                tabindex={0}
                aria-label={label}
                onClick={() => onCity(c)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onCity(c);
                  }
                }}
              >
                <title>{label}</title>
                {body}
              </g>
            );
          })}
        </g>

        {/* The names, above every medallion. */}
        <g class="ca-city-names" font-family={DECO_FONT} font-weight="700" font-size={NAME_SIZE}>
          {Array.from({ length: CITY_COUNT }, (_, c) => {
            const [x, y] = pt(c);
            const spot = spots[c] ?? { x, y: y + 30, anchor: 'middle' as const };
            return (
              <text
                key={c}
                class={live(c) ? 'ca-city-name' : 'ca-city-name ca-city-fog'}
                x={spot.x}
                y={spot.y}
                text-anchor={spot.anchor}
                fill="#14233a"
                stroke="#fbf6ea"
                stroke-width="3.6"
                stroke-linejoin="round"
                paint-order="stroke"
              >
                {names[c] ?? ''}
              </text>
            );
          })}
        </g>

        {/* The chart's furniture: a brass frame, a compass and the title block in the southern sea. */}
        <Compass x={40} y={612} r={20} />
        <g class="ca-cartouche" font-family={DECO_FONT} text-anchor="middle">
          <path
            d="M380 676H620L630 686 620 696H380L370 686Z"
            fill="#14233a"
            stroke={BRASS}
            stroke-width="1.4"
          />
          <text x="500" y="690.5" font-size="12" font-weight="700" letter-spacing="5" fill={BRASS_HI}>
            {CURRENT_THEME.land.replace(/^the /, 'THE ').toUpperCase()}
          </text>
        </g>
        <rect x="3" y="3" width={W - 6} height={H - 6} fill="none" stroke={BRASS} stroke-width="3" rx="4" />
        <rect
          x="9"
          y="9"
          width={W - 18}
          height={H - 18}
          fill="none"
          stroke={BRASS_LO}
          stroke-width="1"
          rx="2"
        />
        <path
          d={`M3 30H20V20H30V3M${W - 3} 30H${W - 20}V20H${W - 30}V3M3 ${H - 30}H20V${H - 20}H30V${H - 3}M${W - 3} ${H - 30}H${W - 20}V${H - 20}H${W - 30}V${H - 3}`}
          fill="none"
          stroke={BRASS}
          stroke-width="1.6"
        />
      </svg>
    </div>
  );
}
