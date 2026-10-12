/*
 * Charter faces (D088): each province charter shows its design (Spear, Horse or Cannon), the province's own outline
 * taken from the atlas, its name and its realm; a Crown shows the crown alone; a hidden charter shows the back, a
 * compass on dark blue. Original art, CC0-1.0.
 */
import { type CharterKind, kindOf, provinceOfCard } from '@bored-games/hazard';
import { HAZARD_THEME as THEME } from '@bored-games/hazard/theme';
import { ATLAS, cardName, provinceName, realmName } from './model.ts';

/** The design glyphs, drawn in a 24 × 24 box. */
export const KIND_GLYPHS: Readonly<Record<CharterKind, string>> = {
  spear: 'M12 1.5L14.6 7L12 9.2L9.4 7ZM11.3 9.2h1.4V22.5h-1.4ZM12.7 10.2L18.5 12.3L12.7 14.4Z',
  horse:
    'M6.5 22c.2-4.6 1-7.6 2.8-10.2L7.6 7.3l2.9 1L12.2 4l1.4 3.1c3.4.5 5.9 3.1 5.6 6.9l-2.9-.8-1.6 2c-.2 2.7.5 4.9 1.6 6.8Z',
  cannon:
    'M2.8 13.6L16.9 7.4L18.6 10.9L4.6 16.9ZM18.2 7.2l1.3 3.1M8 16.5a4 4 0 1 0 .01 0ZM8 18.6a1.9 1.9 0 1 1-.01 0Z',
  crown: 'M3 18.5L4 7l4.6 4.3L12 4.5l3.4 6.8L20 7l1 11.5ZM3.2 19.8h17.6v2H3.2Z',
};

export const KIND_COLORS: Readonly<Record<CharterKind, string>> = {
  spear: '#7a2e24',
  horse: '#2f4f74',
  cannon: '#3c4a2a',
  crown: '#a87a12',
};

/** A province's outline, scaled into a w × h box at (x, y). */
function Silhouette(props: { card: number; x: number; y: number; w: number; h: number; fill: string }) {
  const p = provinceOfCard(props.card);
  if (p === null) return null;
  const hexes = ATLAS.hexes.filter((h) => h.province === p);
  const xs = hexes.map((h) => h.cx);
  const ys = hexes.map((h) => h.cy);
  const minX = Math.min(...xs) - 14;
  const maxX = Math.max(...xs) + 14;
  const minY = Math.min(...ys) - 16;
  const maxY = Math.max(...ys) + 16;
  const k = Math.min(props.w / (maxX - minX), props.h / (maxY - minY));
  const ox = props.x + (props.w - (maxX - minX) * k) / 2;
  const oy = props.y + (props.h - (maxY - minY) * k) / 2;
  return (
    <g transform={`translate(${ox} ${oy}) scale(${k}) translate(${-minX} ${-minY})`}>
      {hexes.map((h) => (
        <polygon
          key={`${h.x},${h.y}`}
          points={h.points}
          fill={props.fill}
          stroke={props.fill}
          stroke-width="1"
        />
      ))}
    </g>
  );
}

/** One charter, 64 × 92. `card` null draws the back. */
export function CharterArt(props: { card: number | null }) {
  const { card } = props;
  if (card === null)
    return (
      <g>
        <rect x="1" y="1" width="62" height="90" rx="6" fill="#1f2f45" stroke="#c9a85a" stroke-width="1.5" />
        <rect x="6" y="6" width="52" height="80" rx="3" fill="none" stroke="#c9a85a" stroke-width=".6" />
        <g transform="translate(32 46)">
          {[0, 90, 180, 270].map((d) => (
            <path
              key={d}
              d="M0 -18L4 0L0 0Z M0 -18L-4 0L0 0Z"
              transform={`rotate(${d})`}
              fill="#c9a85a"
              opacity=".85"
            />
          ))}
          <circle r="7" fill="none" stroke="#c9a85a" stroke-width=".8" />
        </g>
      </g>
    );
  const kind = kindOf(card);
  const color = KIND_COLORS[kind];
  const p = provinceOfCard(card);
  return (
    <g>
      <rect x="1" y="1" width="62" height="90" rx="6" fill="#f6eedb" stroke={color} stroke-width="1.5" />
      <rect x="1" y="1" width="62" height="20" rx="6" fill={color} />
      <rect x="1" y="14" width="62" height="7" fill={color} />
      <g transform="translate(23 2.5) scale(.75)">
        <path d={KIND_GLYPHS[kind]} fill="#f6eedb" fill-rule="evenodd" />
      </g>
      {p === null ? (
        <g transform="translate(12 30) scale(1.65)">
          <path d={KIND_GLYPHS.crown} fill={color} />
        </g>
      ) : (
        <Silhouette card={card} x={8} y={26} w={48} h={36} fill={color} />
      )}
      <text x="32" y="74" text-anchor="middle" class="hz-card-name">
        {p === null ? THEME.kinds.crown : provinceName(p)}
      </text>
      <text x="32" y="84" text-anchor="middle" class="hz-card-realm">
        {p === null ? 'any design' : realmName(p[0] as 'a')}
      </text>
    </g>
  );
}

/** A charter as an image, with its name for screen readers. */
export function CharterFace(props: { card: number | null; small?: boolean }) {
  return (
    <svg
      class={`hz-card${props.small ? ' hz-card-small' : ''}`}
      viewBox="0 0 64 92"
      role="img"
      aria-label={props.card === null ? 'A hidden charter' : `${cardName(props.card)} charter`}
    >
      <CharterArt card={props.card} />
    </svg>
  );
}
