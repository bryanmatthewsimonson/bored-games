/*
 * The board of Ferrovia (art/board.svg's layout): towns and route sides as an SVG. Claimable sides are buttons;
 * laid track shows its owner's colour. Every route side carries its cargo symbol, so colour is never the only cue.
 */
import { ROUTE_COLORS, ROUTES, type RowState, TOWNS } from '@bored-games/right-of-way';
import { CARGO_FILL, GLYPH_INK, Glyph, GRAY_FILL, INK, PAPER } from './art.tsx';
import { PLAYER_COLORS, routeName, townName } from './model.ts';

const OX = 50;
const OY = 40;
const P = (t: number): { x: number; y: number } => {
  const town = TOWNS[t];
  return { x: (town?.x ?? 0) + OX, y: (town?.y ?? 0) + OY };
};
/** The coastline of art/board.svg. */
const COAST =
  'M70 90C93.7 63.7 141.7 65 200 62C258.3 59 346.7 75 420 72C493.3 69 560 48 640 44C720 40 810 49.3 900 48C990 46.7 1096.7 35.3 1180 36C1263.3 36.7 1356.3 34.7 1400 52C1443.7 69.3 1441.2 108.7 1442 140C1442.8 171.3 1405.3 208.3 1405 240C1404.7 271.7 1440.5 298.3 1440 330C1439.5 361.7 1401 396.7 1402 430C1403 463.3 1443 495 1446 530C1449 565 1427.3 601.7 1420 640C1412.7 678.3 1417 728 1402 760C1387 792 1363.7 813.3 1330 832C1296.3 850.7 1241.7 860.3 1200 872C1158.3 883.7 1130 896.3 1080 902C1030 907.7 963.3 903.3 900 906C836.7 908.7 763.3 918 700 918C636.7 918 573.3 908.7 520 906C466.7 903.3 425 909.3 380 902C335 894.7 290 873.7 250 862C210 850.3 167 849 140 832C113 815 101.7 792 88 760C74.3 728 58.7 680 58 640C57.3 600 84 556.7 84 520C84 483.3 57.3 451.7 58 420C58.7 388.3 88 363.3 88 330C88 296.7 61 260 58 220C55 180 46.3 116.3 70 90Z';

export interface BoardProps {
  state: RowState;
  /** Claimable sides (`route:side`) for the viewer now. */
  claimable: ReadonlySet<string>;
  /** The side picked for the claim panel, if any. */
  picked: string | null;
  onPick: ((key: string) => void) | undefined;
  /** Towns to ring: the viewer's charter ends. */
  marked: ReadonlySet<number>;
  /** Display name per seat, for laid track labels. */
  names: readonly string[];
}

const R = 15;
const W = 15;

function Side(props: {
  ri: number;
  side: number;
  state: RowState;
  claimable: boolean;
  picked: boolean;
  onPick: (() => void) | undefined;
  names: readonly string[];
}) {
  const r = ROUTES[props.ri];
  if (r === undefined) return null;
  const a = P(r.a);
  const b = P(r.b);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const ux = dx / d;
  const uy = dy / d;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const offset = r.sides.length === 2 ? (props.side === 0 ? -9.5 : 9.5) : 0;
  const gap = 4;
  const sl = (d - 2 * R - gap * (r.length - 1)) / r.length;
  const colorName = r.sides[props.side] ?? 'gray';
  const colorIndex = ROUTE_COLORS.indexOf(colorName);
  const owner = props.state.routes[props.ri]?.[props.side] ?? null;
  const fill =
    owner !== null
      ? (PLAYER_COLORS[owner] ?? INK)
      : colorName === 'gray'
        ? GRAY_FILL
        : (CARGO_FILL[colorIndex] ?? INK);
  const spaces = Array.from({ length: r.length }, (_, k) => {
    const t = R + k * (sl + gap) + sl / 2;
    const cx = a.x + ux * t - uy * offset;
    const cy = a.y + uy * t + ux * offset;
    return (
      <g key={k} transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${ang.toFixed(1)})`}>
        <rect
          x={(-sl / 2).toFixed(1)}
          y={-W / 2}
          width={sl.toFixed(1)}
          height={W}
          rx="3"
          fill={fill}
          stroke={props.picked ? '#e0218a' : INK}
          stroke-width={props.picked ? 3 : owner !== null ? 2.2 : 1.3}
        />
        {owner === null && colorName !== 'gray' && (
          <g transform={`rotate(${(-ang).toFixed(1)}) scale(0.55)`}>
            <Glyph color={colorIndex} ink={GLYPH_INK[colorIndex] ?? INK} />
          </g>
        )}
        {owner !== null && <circle r="2.6" fill={PAPER} />}
      </g>
    );
  });
  const label = `${routeName(props.ri)}, ${r.length} long, ${colorName === 'gray' ? 'unmarked' : colorName}${
    owner !== null ? `, laid by ${props.names[owner] ?? `player ${owner + 1}`}` : ''
  }`;
  if (!props.claimable || props.onPick === undefined)
    return (
      <g class="row-side" data-route={props.ri} data-side={props.side} data-owner={owner ?? ''}>
        <title>{label}</title>
        {spaces}
      </g>
    );
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>; it has role, label and keys.
    <g
      class="row-side row-side-claimable"
      role="button"
      tabIndex={0}
      aria-label={`Lay track: ${label}`}
      data-route={props.ri}
      data-side={props.side}
      onClick={props.onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onPick?.();
        }
      }}
    >
      <title>{label}</title>
      {spaces}
    </g>
  );
}

export function Board(props: BoardProps) {
  return (
    <div class="row-board-wrap">
      <svg class="row-board" viewBox="20 20 1460 920" aria-label="The board of Ferrovia">
        <title>The board of Ferrovia</title>
        <rect x="0" y="0" width="1500" height="1000" fill="#b9d3d0" />
        <path d={COAST} fill="#eadcb8" stroke={INK} stroke-width="2.5" />
        {ROUTES.flatMap((r, ri) =>
          r.sides.map((_, side) => {
            const key = `${ri}:${side}`;
            return (
              <Side
                key={key}
                ri={ri}
                side={side}
                state={props.state}
                claimable={props.claimable.has(key)}
                picked={props.picked === key}
                onPick={props.onPick === undefined ? undefined : () => props.onPick?.(key)}
                names={props.names}
              />
            );
          }),
        )}
        {TOWNS.map((_, t) => {
          const p = P(t);
          return (
            <g key={t} class="row-town" data-town={t}>
              {props.marked.has(t) && (
                <circle cx={p.x} cy={p.y} r="19" fill="none" stroke="#9a2f2a" stroke-width="4" />
              )}
              <circle cx={p.x} cy={p.y} r="11" fill={PAPER} stroke={INK} stroke-width="3" />
              <circle cx={p.x} cy={p.y} r="4" fill={INK} />
              <text
                x={p.x}
                y={p.y - 18}
                text-anchor="middle"
                font-size="17"
                font-weight="700"
                fill={INK}
                stroke={PAPER}
                stroke-width="4"
                paint-order="stroke"
                font-family="Georgia, serif"
              >
                {townName(t)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
