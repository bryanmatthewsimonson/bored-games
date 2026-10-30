/*
 * The chart of the Wide World (D096): an original drawing on the reference board's graph, mirrored and redrawn. The
 * sea, the shelves and landmasses grown around the cities, the 93 links (three wrap across the map's edge), and each
 * city with its strain mark, its cases, a clinic and the pawns standing there. Cities the current move can reach are
 * buttons.
 */
import { CITY_COUNT, LINKS, type SpreadState, strainOf } from '@bored-games/spread-thin';
import { ATLAS_HEIGHT, ATLAS_WIDTH, CITY_POINTS, EDGE_LINKS } from '@bored-games/spread-thin/atlas';
import { SPREAD_THEME as THEME } from '@bored-games/spread-thin/theme';
import {
  clinicGlyph,
  INK,
  LandFilter,
  landShapes,
  PAPER,
  pawnGlyph,
  SEA,
  STRAIN_COLORS,
  strainGlyph,
} from './art.tsx';

const isEdge = (a: number, b: number): boolean =>
  EDGE_LINKS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const point = (c: number): readonly [number, number] => CITY_POINTS[c] ?? [0, 0];

/** A wrapping link: two stubs, each running off its own edge toward the other city. */
function edgeLink(a: number, b: number) {
  const [ax, ay] = point(a);
  const [bx, by] = point(b);
  const left = ax < bx ? [ax, ay] : [bx, by];
  const right = ax < bx ? [bx, by] : [ax, ay];
  const span = (left[0] as number) + (ATLAS_WIDTH - (right[0] as number));
  const mid =
    (left[1] as number) + (((right[1] as number) - (left[1] as number)) * (left[0] as number)) / span;
  return (
    <g>
      <path d={`M${left[0]} ${left[1]} L0 ${mid}`} />
      <path d={`M${right[0]} ${right[1]} L${ATLAS_WIDTH} ${mid}`} />
    </g>
  );
}

export interface MapProps {
  readonly state: SpreadState;
  /** Cities the current move can reach, if any. */
  readonly targets?: ReadonlySet<number>;
  readonly selected?: number | null;
  /** Cities to mark as just touched (a recap or the last spread). */
  readonly marks?: ReadonlySet<number>;
  readonly onPick?: (city: number) => void;
  readonly names?: readonly string[];
}

export function WorldMap(props: MapProps) {
  const s = props.state;
  const { shelf, land } = landShapes();
  const targets = props.targets ?? new Set<number>();
  return (
    // biome-ignore lint/a11y/useSemanticElements: the map is one SVG; a fieldset cannot hold its drawing.
    <svg
      class="st-map"
      viewBox={`0 0 ${ATLAS_WIDTH} ${ATLAS_HEIGHT}`}
      role="group"
      aria-label={`Map of ${THEME.world}`}
      data-testid="st-map"
    >
      <defs>
        <LandFilter id="st-map-goo" blur={10} />
      </defs>
      <rect width={ATLAS_WIDTH} height={ATLAS_HEIGHT} fill={SEA} />
      <g stroke="#2c5476" stroke-width="1" fill="none" opacity=".55">
        {[80, 160, 240, 320, 400, 480].map((y) => (
          <path key={`h${y}`} d={`M0 ${y} H${ATLAS_WIDTH}`} stroke-dasharray="2 6" />
        ))}
        {[130, 265, 400, 530, 660, 795, 930].map((x) => (
          <path key={`v${x}`} d={`M${x} 0 V${ATLAS_HEIGHT}`} stroke-dasharray="2 6" />
        ))}
      </g>
      <g fill="#1f4466" filter="url(#st-map-goo)">
        {shelf}
      </g>
      <g fill="#d8cca4" filter="url(#st-map-goo)">
        {land}
      </g>
      <g stroke={PAPER} stroke-opacity=".75" stroke-width="2" fill="none" stroke-linecap="round">
        {LINKS.map(([a, b]) =>
          isEdge(a, b) ? (
            <g key={`${a}-${b}`} stroke-dasharray="6 5">
              {edgeLink(a, b)}
            </g>
          ) : (
            <path key={`${a}-${b}`} d={`M${point(a)[0]} ${point(a)[1]} L${point(b)[0]} ${point(b)[1]}`} />
          ),
        )}
      </g>
      {Array.from({ length: CITY_COUNT }, (_, c) => {
        const [x, y] = point(c);
        const strain = strainOf(c);
        const cases = s.cases[c] ?? [0, 0, 0, 0];
        const pips = cases.flatMap((n, k) => Array.from({ length: n }, () => k));
        const pawns = s.at.flatMap((at, seat) => (at === c ? [seat] : []));
        const reach = targets.has(c);
        const hot = pips.length > 0;
        const label = `${THEME.cities[c]} (${THEME.strains[strain]})${
          hot
            ? `, ${cases
                .map((n, k) => (n > 0 ? `${n} ${THEME.strains[k]}` : ''))
                .filter(Boolean)
                .join(', ')}`
            : ''
        }${s.clinics.includes(c) ? ', clinic' : ''}`;
        const body = (
          <g transform={`translate(${x} ${y})`}>
            {reach && <circle r="17" fill="none" stroke="#ffe08a" stroke-width="3" class="st-reach" />}
            {props.selected === c && <circle r="19" fill="none" stroke="#fff" stroke-width="3" />}
            {props.marks?.has(c) && (
              <circle r="15" fill="none" stroke="#ff6b6b" stroke-width="2" class="st-pulse" />
            )}
            <circle r="11" fill={STRAIN_COLORS[strain]} stroke={INK} stroke-width="1.5" />
            {strainGlyph(strain, 6.5, PAPER)}
            <text y="25" text-anchor="middle" class="st-city-name">
              {THEME.cities[c]}
            </text>
            {pips.map((k, i) => (
              <rect
                key={i}
                x={-15 + (i % 6) * 6}
                y={-24 - Math.floor(i / 6) * 7}
                width="5.5"
                height="5.5"
                rx="1.2"
                fill={STRAIN_COLORS[k]}
                stroke={INK}
                stroke-width=".8"
              />
            ))}
            {s.clinics.includes(c) && <g transform="translate(-17 6)">{clinicGlyph(6.5)}</g>}
            {pawns.map((seat, i) => (
              <g key={seat} transform={`translate(${15 + i * 9} ${-4 + i * 3})`}>
                {pawnGlyph(seat, 7)}
              </g>
            ))}
          </g>
        );
        if (!reach || props.onPick === undefined)
          return (
            <g key={c} class="st-city" data-city={c}>
              <title>{label}</title>
              {body}
            </g>
          );
        const pick = props.onPick;
        return (
          // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>; it has a role, a label and keys.
          <g
            key={c}
            class="st-city st-city-target"
            data-city={c}
            role="button"
            // Preact writes SVG props as attributes, so the lowercase name is the one the browser reads (D081).
            tabindex={0}
            aria-label={`Choose ${label}`}
            onClick={() => pick(c)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick(c);
              }
            }}
          >
            <title>{label}</title>
            {body}
          </g>
        );
      })}
    </svg>
  );
}
