/*
 * The atlas of the Meridian (D088): the hex grid of the package drawn as an engraved sea chart. Provinces take their
 * holder's colour and pattern (never colour alone), coasts are inked thick and borders thin, sea lanes are dotted
 * routes, and each held province carries a token with its troops. Provinces the viewer may click are outlined; each
 * is a focusable button with its full label. Original art, CC0-1.0 (packages/games/hazard/ART-LICENSE.md).
 */
import type { HazardState, ProvinceId } from '@bored-games/hazard';
import { PROVINCES } from '@bored-games/hazard';
import { HAZARD_THEME as THEME } from '@bored-games/hazard/theme';
import {
  ATLAS,
  type MapMode,
  provinceLabel,
  REALM_LAND,
  SEAT_LOOKS,
  type Segment,
  seatLook,
} from './model.ts';

const at = (p: ProvinceId): number => PROVINCES.indexOf(p);
const line = (s: Segment) => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`;
const path = (segs: readonly Segment[]): string => segs.map(line).join('');

const COASTS = path(ATLAS.coasts);
const BORDERS = path(ATLAS.borders);
const OUTLINES: Readonly<Record<ProvinceId, string>> = Object.fromEntries(
  PROVINCES.map((p) => [p, path(ATLAS.outlines[p])]),
) as Record<ProvinceId, string>;
const HEXES_OF: Readonly<Record<ProvinceId, readonly (typeof ATLAS.hexes)[number][]>> = Object.fromEntries(
  PROVINCES.map((p) => [p, ATLAS.hexes.filter((h) => h.province === p)]),
) as Record<ProvinceId, (typeof ATLAS.hexes)[number][]>;

/** The seat patterns, light ink over the seat colour. */
export function SeatPatterns(props: { prefix: string }) {
  return (
    <>
      {SEAT_LOOKS.map((look, seat) => (
        <pattern
          key={look.name}
          id={`${props.prefix}-seat-${seat}`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform={
            look.pattern === 'stripe' || look.pattern === 'chevron' ? 'rotate(45)' : undefined
          }
        >
          <rect width="8" height="8" fill={look.fill} />
          {look.pattern === 'stripe' && <rect width="2.4" height="8" fill="#fff" opacity=".22" />}
          {look.pattern === 'dot' && <circle cx="4" cy="4" r="1.4" fill="#fff" opacity=".3" />}
          {look.pattern === 'cross' && (
            <path d="M0 0L8 8M8 0L0 8" stroke="#fff" stroke-width="1" opacity=".25" />
          )}
          {look.pattern === 'chevron' && (
            <path d="M0 6L4 2L8 6" fill="none" stroke="#3a2a10" stroke-width="1.1" opacity=".3" />
          )}
          {look.pattern === 'ring' && (
            <circle cx="4" cy="4" r="2.2" fill="none" stroke="#fff" stroke-width=".9" opacity=".3" />
          )}
        </pattern>
      ))}
    </>
  );
}

/** A compass rose: four long points and four short, with a ring. */
export function Compass(props: { x: number; y: number; r: number }) {
  const { x, y, r } = props;
  const point = (deg: number, len: number, w: number, dark: boolean) => (
    <path
      key={`${deg}-${dark}`}
      d={`M0 ${-len}L${w} 0L0 0Z`}
      transform={`translate(${x} ${y}) rotate(${deg})`}
      fill={dark ? '#3b3226' : '#efe3c4'}
      stroke="#3b3226"
      stroke-width=".6"
    />
  );
  return (
    <g class="hz-compass">
      <circle cx={x} cy={y} r={r * 0.62} fill="none" stroke="#3b3226" stroke-width=".8" opacity=".7" />
      <circle cx={x} cy={y} r={r * 0.7} fill="none" stroke="#3b3226" stroke-width=".4" opacity=".6" />
      {[45, 135, 225, 315].flatMap((d) => [
        point(d, r * 0.55, r * 0.12, true),
        point(d, r * 0.55, -r * 0.12, false),
      ])}
      {[0, 90, 180, 270].flatMap((d) => [point(d, r, r * 0.16, true), point(d, r, -r * 0.16, false)])}
      <text x={x} y={y - r - 4} text-anchor="middle" class="hz-compass-n">
        N
      </text>
    </g>
  );
}

/** The chart's title block, in the open sea between Farshore and Sunscorch. */
export function Cartouche(props: { x: number; y: number }) {
  const { x, y } = props;
  return (
    <g class="hz-cartouche">
      <rect
        x={x - 92}
        y={y - 26}
        width="184"
        height="52"
        rx="4"
        fill="#f3e9d2"
        stroke="#4a3f2f"
        stroke-width="1.4"
      />
      <rect
        x={x - 87}
        y={y - 21}
        width="174"
        height="42"
        rx="2"
        fill="none"
        stroke="#4a3f2f"
        stroke-width=".5"
      />
      <path d={`M${x - 92} ${y}h-10M${x + 92} ${y}h10`} stroke="#4a3f2f" stroke-width="1.2" />
      <circle cx={x - 106} cy={y} r="3" fill="#4a3f2f" />
      <circle cx={x + 106} cy={y} r="3" fill="#4a3f2f" />
      <text x={x} y={y - 2} text-anchor="middle" class="hz-cartouche-title">
        {THEME.world.replace(/^the /, 'The ').toUpperCase()}
      </text>
      <text x={x} y={y + 13} text-anchor="middle" class="hz-cartouche-sub">
        a chart of the six realms
      </text>
    </g>
  );
}

export interface AtlasProps {
  readonly state: HazardState;
  readonly names: readonly string[];
  readonly mode: MapMode;
  readonly selected: ProvinceId | null;
  /** Called for a click or Enter/Space on a clickable province; absent while the viewer may not act. */
  readonly onPick?: ((p: ProvinceId) => void) | undefined;
  /** An id prefix, so two atlases on one page do not share pattern ids. */
  readonly prefix?: string;
}

export function Atlas(props: AtlasProps) {
  const { state: s, mode, selected } = props;
  const prefix = props.prefix ?? 'hz';
  const clickable = new Set<ProvinceId>([...mode.single, ...mode.pick, ...mode.target]);
  const battle = s.battle;
  const fillOf = (p: ProvinceId) => {
    const owner = s.owner[at(p)];
    return owner === null || owner === undefined ? REALM_LAND[p[0] as 'a'] : `url(#${prefix}-seat-${owner})`;
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: the chart is one SVG; a fieldset cannot hold its drawing.
    <svg
      class="hz-atlas"
      viewBox={`0 0 ${ATLAS.width} ${ATLAS.height}`}
      role="group"
      aria-label={`The atlas of ${THEME.world}`}
    >
      <defs>
        <linearGradient id={`${prefix}-sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#cfe0dc" />
          <stop offset="1" stop-color="#b5cdcb" />
        </linearGradient>
        <pattern id={`${prefix}-waves`} width="26" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 9q6.5-6 13 0t13 0" fill="none" stroke="#7fa3a2" stroke-width=".7" opacity=".55" />
        </pattern>
        <SeatPatterns prefix={prefix} />
        <marker
          id={`${prefix}-arrow`}
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 0L10 5L0 10Z" fill="#7a1f1f" />
        </marker>
      </defs>
      <rect width={ATLAS.width} height={ATLAS.height} fill={`url(#${prefix}-sea)`} />
      <rect width={ATLAS.width} height={ATLAS.height} fill={`url(#${prefix}-waves)`} />
      <rect
        x="6"
        y="6"
        width={ATLAS.width - 12}
        height={ATLAS.height - 12}
        fill="none"
        stroke="#4a3f2f"
        stroke-width="1.6"
      />
      <rect
        x="10"
        y="10"
        width={ATLAS.width - 20}
        height={ATLAS.height - 20}
        fill="none"
        stroke="#4a3f2f"
        stroke-width=".6"
      />

      <g class="hz-lanes">
        {ATLAS.lanes.map((lane) => (
          <path
            key={`${lane.a}-${lane.b}`}
            d={lane.d}
            class={lane.edge ? 'hz-lane hz-lane-edge' : 'hz-lane'}
          />
        ))}
      </g>

      <path d={COASTS} class="hz-coast-glow" />
      <g class="hz-land">
        {ATLAS.hexes.map((h) => (
          <polygon
            key={`${h.x},${h.y}`}
            points={h.points}
            fill={fillOf(h.province)}
            stroke={fillOf(h.province)}
            stroke-width=".8"
          />
        ))}
      </g>
      <path d={BORDERS} class="hz-border" />
      <path d={COASTS} class="hz-coast" />

      {ATLAS.realmLabels.map((r) => (
        <text key={r.realm} x={r.x} y={r.y} class="hz-realm" text-anchor="middle">
          {THEME.realms[r.realm].toUpperCase()}
        </text>
      ))}

      <Compass x={ATLAS.width * 0.715} y={ATLAS.height * 0.86} r={30} />
      <Cartouche x={ATLAS.width * 0.335} y={ATLAS.height * 0.885} />

      {/* Clickable provinces: one focusable button each, its hexes as the hit area. */}
      <g class="hz-hits">
        {PROVINCES.map((p) => {
          const active = props.onPick !== undefined && clickable.has(p);
          const state =
            selected === p
              ? 'selected'
              : mode.target.includes(p)
                ? 'target'
                : clickable.has(p)
                  ? 'open'
                  : 'none';
          return (
            // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>; it has a role, a label and keys.
            <g
              key={p}
              class={`hz-prov hz-prov-${state}`}
              data-province={p}
              role="button"
              // Preact writes SVG props as attributes, so the lowercase name is the one the browser reads (D081).
              tabindex={active ? 0 : -1}
              aria-label={provinceLabel(s, p, props.names)}
              aria-disabled={!active}
              aria-pressed={selected === p}
              onClick={active ? () => props.onPick?.(p) : undefined}
              onKeyDown={
                active
                  ? (e: KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        props.onPick?.(p);
                      }
                    }
                  : undefined
              }
            >
              <title>{provinceLabel(s, p, props.names)}</title>
              {HEXES_OF[p].map((h) => (
                <polygon key={`${h.x},${h.y}`} points={h.points} class="hz-hit" />
              ))}
              {state !== 'none' && <path d={OUTLINES[p]} class="hz-outline" />}
            </g>
          );
        })}
      </g>

      {battle !== null && (
        <line
          x1={ATLAS.anchors[battle.from].cx}
          y1={ATLAS.anchors[battle.from].cy}
          x2={ATLAS.anchors[battle.to].cx}
          y2={ATLAS.anchors[battle.to].cy}
          class="hz-battle"
          marker-end={`url(#${prefix}-arrow)`}
        />
      )}

      <g class="hz-tokens">
        {PROVINCES.map((p) => {
          const owner = s.owner[at(p)];
          if (owner === null || owner === undefined) return null;
          const look = seatLook(owner);
          const troops = s.troops[at(p)] ?? 0;
          const { cx, cy } = ATLAS.anchors[p];
          const r = troops >= 100 ? 11 : 9.5;
          return (
            <g key={p} class="hz-token">
              <circle cx={cx} cy={cy + 1.2} r={r} fill="#000" opacity=".25" />
              <circle cx={cx} cy={cy} r={r} fill={look.fill} stroke="#fdf6e3" stroke-width="1.6" />
              <text x={cx} y={cy + 3.4} text-anchor="middle" fill={look.ink} class="hz-token-n">
                {troops}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
