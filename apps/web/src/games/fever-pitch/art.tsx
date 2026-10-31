/*
 * Fever Pitch's original artwork (D096, CC0-1.0, packages/games/fever-pitch/ART-LICENSE.md): the strain marks, the
 * case tokens, the clinic, the role badges, the field cards (city, relief, surge), and the cover. A field-station
 * look: deep ink blue, chart paper, and four strain colours chosen for the game (teal Tide, amber Ember, violet Dusk,
 * moss-green Moss), each with its own mark so colour is never the only signal. Every drawing carries its own
 * ground, so it reads the same on a light or a dark page.
 */
import { LINKS, RELIEFS, type Relief, type Role, SURGE_BASE } from '@bored-games/fever-pitch';
import { CITY_POINTS } from '@bored-games/fever-pitch/atlas';
import { FEVER_THEME as THEME } from '@bored-games/fever-pitch/theme';
import type { JSX } from 'preact';

export const INK = '#13233a';
export const PAPER = '#f3ecd9';
export const PAPER_DARK = '#e2d6b6';
export const SEA = '#16304d';
/** The strain colours, by strain index: teal, amber, violet, moss. */
export const STRAIN_COLORS: readonly string[] = ['#1b9aa0', '#e39a2b', '#8a5cc8', '#6f9a35'];
/** A darker shade of each, for text and outlines on paper. */
export const STRAIN_INKS: readonly string[] = ['#0d6267', '#9a5c0b', '#5a3593', '#455f1d'];
/** Pawn colours by seat, with a letter each. */
export const SEAT_COLORS: readonly string[] = ['#e8eef7', '#ffd166', '#ff8fa3', '#9be7c4'];
export const SEAT_MARKS: readonly string[] = ['A', 'B', 'C', 'D'];

/** A strain's mark, centred on (0, 0) with radius about `r`: a wave, a flame, a crescent, a leaf. */
export function strainGlyph(strain: number, r: number, fill: string): JSX.Element {
  const k = r / 10;
  switch (strain) {
    case 0:
      return (
        <path
          d={`M${-8 * k} ${2 * k} q${4 * k} ${-7 * k} ${8 * k} 0 t${8 * k} 0 M${-8 * k} ${7 * k} q${4 * k} ${-7 * k} ${8 * k} 0 t${8 * k} 0`}
          fill="none"
          stroke={fill}
          stroke-width={2.4 * k}
          stroke-linecap="round"
        />
      );
    case 1:
      return (
        <path
          d={`M0 ${-9 * k} C${6 * k} ${-3 * k} ${8 * k} ${2 * k} ${5 * k} ${7 * k} C${3 * k} ${10 * k} ${-3 * k} ${10 * k} ${-5 * k} ${7 * k} C${-8 * k} ${2 * k} ${-4 * k} ${-2 * k} ${-2 * k} ${-5 * k} C${-1 * k} ${-1 * k} ${1 * k} 0 ${1 * k} ${2 * k} C${3 * k} ${-2 * k} ${2 * k} ${-6 * k} 0 ${-9 * k}Z`}
          fill={fill}
        />
      );
    case 2:
      return (
        <path
          d={`M${0.38 * k} ${-8.49 * k} A${8.5 * k} ${8.5 * k} 0 1 0 ${7.8 * k} ${3.38 * k} A${7 * k} ${7 * k} 0 1 1 ${0.38 * k} ${-8.49 * k}Z`}
          fill={fill}
        />
      );
    default:
      return (
        <g>
          <path
            d={`M${-7 * k} ${7 * k} C${-8 * k} ${-4 * k} ${0} ${-9 * k} ${8 * k} ${-8 * k} C${8 * k} ${1 * k} ${3 * k} ${8 * k} ${-7 * k} ${7 * k}Z`}
            fill={fill}
          />
          <path d={`M${-7 * k} ${7 * k} L${4 * k} ${-4 * k}`} stroke={PAPER} stroke-width={1.2 * k} />
        </g>
      );
  }
}

/** A strain's mark as an inline icon. */
export function StrainMark(props: { strain: number; size?: number; title?: string }) {
  const size = props.size ?? 18;
  const name = THEME.strains[props.strain] ?? '';
  return (
    <svg
      class="fp-mark"
      width={size}
      height={size}
      viewBox="-12 -12 24 24"
      role="img"
      aria-label={props.title ?? `${name} strain`}
    >
      <circle r="11.5" fill={STRAIN_COLORS[props.strain]} />
      {strainGlyph(props.strain, 7.5, PAPER)}
    </svg>
  );
}

/** A case token: a rounded square in the strain colour with its mark. */
export function CaseToken(props: { strain: number; size?: number }) {
  const size = props.size ?? 16;
  return (
    <svg class="fp-case" width={size} height={size} viewBox="-10 -10 20 20" aria-hidden="true">
      <rect
        x="-9"
        y="-9"
        width="18"
        height="18"
        rx="4"
        fill={STRAIN_COLORS[props.strain]}
        stroke={INK}
        stroke-width="1.2"
      />
      {strainGlyph(props.strain, 5.5, PAPER)}
    </svg>
  );
}

/** The clinic: a tent-roofed field station with a lantern-green plus. */
export function clinicGlyph(r: number): JSX.Element {
  const k = r / 10;
  return (
    <g>
      <path
        d={`M${-9 * k} ${8 * k} V${-1 * k} L0 ${-9 * k} L${9 * k} ${-1 * k} V${8 * k}Z`}
        fill={PAPER}
        stroke={INK}
        stroke-width={1.4 * k}
        stroke-linejoin="round"
      />
      <path
        d={`M0 ${-3 * k} V${5 * k} M${-4 * k} ${1 * k} H${4 * k}`}
        stroke="#2f8f5b"
        stroke-width={2.6 * k}
        stroke-linecap="round"
      />
    </g>
  );
}

export function ClinicMark(props: { size?: number }) {
  const size = props.size ?? 18;
  return (
    <svg class="fp-mark" width={size} height={size} viewBox="-11 -11 22 22" role="img" aria-label="Clinic">
      {clinicGlyph(10)}
    </svg>
  );
}

/** A role's badge glyph, centred on (0, 0), about 10 units across. */
function roleGlyph(role: Role): JSX.Element {
  const line = {
    fill: 'none',
    stroke: PAPER,
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  } as const;
  switch (role) {
    case 'archivist':
      // A box file with a card standing in it.
      return (
        <g>
          <path d="M-7 -2 H7 V7 H-7Z" {...line} />
          <path d="M-4 -2 V-8 H4 V-2" {...line} />
          <path d="M-2 -5 H2" {...line} />
        </g>
      );
    case 'coordinator':
      // A compass rose.
      return (
        <g>
          <circle r="7.5" {...line} />
          <path d="M0 -6 L2 0 L0 6 L-2 0Z" fill={PAPER} />
          <path d="M-6 0 H6" {...line} stroke-width="1.2" />
        </g>
      );
    case 'paramedic':
      // A heart with a pulse line.
      return (
        <g>
          <path
            d="M0 7 C-9 0 -8 -7 -3.5 -7 C-1.5 -7 0 -5 0 -4 C0 -5 1.5 -7 3.5 -7 C8 -7 9 0 0 7Z"
            {...line}
          />
          <path d="M-7 0 H-3 L-1.5 -3 L1 3 L2.5 0 H7" {...line} stroke-width="1.4" />
        </g>
      );
    case 'engineer':
      // A spanner.
      return (
        <g>
          <path d="M-6 6 L2 -2" {...line} stroke-width="3" />
          <path d="M1 -6 A4.5 4.5 0 1 0 6 -1 L3.5 -1.5 L1.5 -3.5Z" fill={PAPER} />
        </g>
      );
    case 'warden':
      // A shield with a ring of dots: the city and its neighbours.
      return (
        <g>
          <path d="M0 -8 L7 -5 V1 C7 5 3.5 7.5 0 8.5 C-3.5 7.5 -7 5 -7 1 V-5Z" {...line} />
          <circle r="1.8" fill={PAPER} />
        </g>
      );
    case 'courier':
      // A satchel with a flap.
      return (
        <g>
          <path d="M-7 -2 H7 V7 H-7Z" {...line} />
          <path d="M-7 -2 L0 3 L7 -2" {...line} />
          <path d="M-4 -2 C-4 -8 4 -8 4 -2" {...line} />
        </g>
      );
    case 'virologist':
      // A flask with a bubble.
      return (
        <g>
          <path d="M-2.5 -8 V-2 L-7 6 C-7.5 7.5 -6.5 8 -5 8 H5 C6.5 8 7.5 7.5 7 6 L2.5 -2 V-8" {...line} />
          <path d="M-4 -8 H4" {...line} />
          <circle cx="0" cy="4" r="1.6" fill={PAPER} />
        </g>
      );
  }
}

/** The badge colour of each role. */
export const ROLE_COLORS: Readonly<Record<Role, string>> = {
  archivist: '#7a5c3e',
  coordinator: '#c0567c',
  paramedic: '#c7463f',
  engineer: '#5f6f7f',
  warden: '#2f7d5b',
  courier: '#b5832a',
  virologist: '#3f6fb5',
};

export function RoleBadge(props: { role: Role; size?: number }) {
  const size = props.size ?? 28;
  return (
    <svg
      class="fp-role"
      width={size}
      height={size}
      viewBox="-12 -12 24 24"
      role="img"
      aria-label={THEME.roles[props.role]}
    >
      <circle r="11.5" fill={ROLE_COLORS[props.role]} stroke={INK} stroke-width="1" />
      {roleGlyph(props.role)}
    </svg>
  );
}

/** A relief card's glyph, centred on (0, 0). */
function reliefGlyph(relief: Relief): JSX.Element {
  const line = {
    fill: 'none',
    stroke: INK,
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  } as const;
  switch (relief) {
    case 'medevac':
      // A rotor craft from above.
      return (
        <g>
          <ellipse rx="5" ry="8" fill={INK} />
          <path d="M-12 -4 L12 4 M-12 4 L12 -4" {...line} stroke-width="1.6" />
          <path d="M0 8 V14 M-3 14 H3" {...line} />
        </g>
      );
    case 'warning':
      // A beacon with rays.
      return (
        <g>
          <path d="M-5 10 L-3 -4 H3 L5 10Z" fill={INK} />
          <path d="M-9 -8 L-5 -5 M9 -8 L5 -5 M0 -13 V-8" {...line} />
        </g>
      );
    case 'permit':
      // A stamped paper.
      return (
        <g>
          <path d="M-8 -11 H6 L9 -8 V11 H-8Z" {...line} />
          <circle cx="1" cy="3" r="4.5" {...line} />
          <path d="M-5 -6 H4" {...line} />
        </g>
      );
    case 'lull':
      // A crescent and stars: a quiet night.
      return (
        <g>
          <path d="M3 -10 A10 10 0 1 0 3 10 A7.5 7.5 0 1 1 3 -10Z" fill={INK} />
          <circle cx="8" cy="-6" r="1.4" fill={INK} />
          <circle cx="10" cy="2" r="1" fill={INK} />
        </g>
      );
    case 'immunity':
      // A ring of linked figures.
      return (
        <g>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
            return <circle key={i} cx={Math.cos(a) * 8} cy={Math.sin(a) * 8} r="2.6" fill={INK} />;
          })}
          <circle r="8" {...line} stroke-width="1.2" />
        </g>
      );
  }
}

/**
 * A field card, 60 × 84 units: a city card (strain band, name, population), a relief card, or a surge. `card` is a
 * field id (0–52), or `SURGE_BASE` for a surge.
 */
export function FieldCard(props: { card: number; width?: number; selected?: boolean; dim?: boolean }) {
  const w = props.width ?? 72;
  const h = (w * 84) / 60;
  const { card } = props;
  const cls = `fp-card${props.selected ? ' fp-card-selected' : ''}${props.dim ? ' fp-card-dim' : ''}`;
  if (card >= SURGE_BASE) {
    return (
      <svg class={cls} width={w} height={h} viewBox="0 0 60 84" role="img" aria-label="Surge card">
        <rect x="1" y="1" width="58" height="82" rx="6" fill="#4a1630" stroke={INK} stroke-width="1.5" />
        <path d="M30 14 L44 44 H16Z" fill="none" stroke="#ffcf6a" stroke-width="3" stroke-linejoin="round" />
        <path d="M30 24 V34 M30 38 V40" stroke="#ffcf6a" stroke-width="3" stroke-linecap="round" />
        <text x="30" y="64" text-anchor="middle" class="fp-card-title" fill="#ffcf6a">
          SURGE
        </text>
      </svg>
    );
  }
  if (card >= 48) {
    const relief = RELIEFS[card - 48] as Relief;
    const name = THEME.reliefs[relief];
    return (
      <svg class={cls} width={w} height={h} viewBox="0 0 60 84" role="img" aria-label={`${name} relief card`}>
        <rect x="1" y="1" width="58" height="82" rx="6" fill="#f7e3a8" stroke={INK} stroke-width="1.5" />
        <rect x="5" y="5" width="50" height="10" rx="2" fill={INK} />
        <text x="30" y="12.6" text-anchor="middle" class="fp-card-band" fill={PAPER}>
          RELIEF
        </text>
        <g transform="translate(30 40)">{reliefGlyph(relief)}</g>
        <text x="30" y="70" text-anchor="middle" class="fp-card-title" fill={INK}>
          {name.length > 12 ? name.split(' ')[0] : name}
        </text>
        {name.length > 12 && (
          <text x="30" y="78" text-anchor="middle" class="fp-card-title" fill={INK}>
            {name.split(' ').slice(1).join(' ')}
          </text>
        )}
      </svg>
    );
  }
  const strain = Math.floor(card / 12);
  const name = THEME.cities[card] ?? '';
  const words = name.split(' ');
  return (
    <svg class={cls} width={w} height={h} viewBox="0 0 60 84" role="img" aria-label={`${name} city card`}>
      <rect x="1" y="1" width="58" height="82" rx="6" fill={PAPER} stroke={INK} stroke-width="1.5" />
      <rect x="5" y="5" width="50" height="34" rx="3" fill={STRAIN_COLORS[strain]} />
      <g transform="translate(30 22)">{strainGlyph(strain, 11, PAPER)}</g>
      <text
        x="30"
        y={words.length > 1 ? 52 : 56}
        text-anchor="middle"
        class="fp-card-title"
        fill={STRAIN_INKS[strain]}
      >
        {words[0]}
      </text>
      {words.length > 1 && (
        <text x="30" y="61" text-anchor="middle" class="fp-card-title" fill={STRAIN_INKS[strain]}>
          {words.slice(1).join(' ')}
        </text>
      )}
      <path d="M10 70 H50" stroke={PAPER_DARK} stroke-width="1" />
      <text x="30" y="78" text-anchor="middle" class="fp-card-small" fill={INK}>
        {THEME.strains[strain]}
      </text>
    </svg>
  );
}

/** A pawn: a rounded marker in the seat's colour with its letter. */
export function pawnGlyph(seat: number, r: number): JSX.Element {
  return (
    <g>
      <path
        d={`M0 ${r} C${-r * 0.9} ${r * 0.1} ${-r * 0.9} ${-r} 0 ${-r} C${r * 0.9} ${-r} ${r * 0.9} ${r * 0.1} 0 ${r}Z`}
        fill={SEAT_COLORS[seat] ?? '#ccc'}
        stroke={INK}
        stroke-width={r / 6}
      />
      <text
        y={r * 0.05}
        text-anchor="middle"
        font-size={r * 0.95}
        font-weight="700"
        fill={INK}
        font-family="system-ui, sans-serif"
      >
        {SEAT_MARKS[seat]}
      </text>
    </g>
  );
}

export function Pawn(props: { seat: number; size?: number }) {
  const size = props.size ?? 18;
  return (
    <svg
      class="fp-mark"
      width={size}
      height={size}
      viewBox="-10 -10 20 20"
      role="img"
      aria-label={`Pawn ${SEAT_MARKS[props.seat]}`}
    >
      {pawnGlyph(props.seat, 9)}
    </svg>
  );
}

/**
 * Land: a shelf and a landmass grown around the cities and their short links (a new drawing, D096). Drawn as discs
 * and melted together by `LandFilter`, so the coasts come out soft and organic.
 */
export function landShapes(scale = 1): { shelf: JSX.Element[]; land: JSX.Element[] } {
  const shelf: JSX.Element[] = [];
  const land: JSX.Element[] = [];
  const spots: [number, number, number][] = CITY_POINTS.map(([x, y]) => [x, y, 1]);
  for (const [a, b] of LINKS) {
    const [ax, ay] = CITY_POINTS[a] ?? [0, 0];
    const [bx, by] = CITY_POINTS[b] ?? [0, 0];
    // Short links run over land; long ones cross the sea.
    if (Math.hypot(ax - bx, ay - by) < 105) spots.push([(ax + bx) / 2, (ay + by) / 2, 0.8]);
  }
  spots.forEach(([x, y, k], i) => {
    shelf.push(<circle key={`s${i}`} cx={x * scale} cy={y * scale} r={48 * k * scale} />);
    land.push(<circle key={`l${i}`} cx={x * scale} cy={y * scale} r={34 * k * scale} />);
  });
  return { shelf, land };
}

/** The filter that melts the land discs into coastlines: blur, then a hard alpha edge. */
export function LandFilter(props: { id: string; blur: number }) {
  return (
    <filter id={props.id} x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceGraphic" stdDeviation={props.blur} />
      <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" />
    </filter>
  );
}

/**
 * The cover: a night chart of the Wide World with four strains flaring from their cities and a ring of specialists'
 * lanterns closing in. `thumb` crops to a square tile.
 */
export function FeverCover(props: { thumb?: boolean }) {
  const s = 600 / 1060;
  const { shelf, land } = landShapes(s);
  const flares: [number, number][] = [
    [8, 0],
    [19, 1],
    [32, 2],
    [40, 3],
    [27, 2],
    [14, 1],
  ];
  return (
    <svg
      class="game-cover fp-cover"
      viewBox="0 0 600 360"
      preserveAspectRatio={props.thumb ? 'xMidYMid slice' : 'xMidYMid meet'}
      role="img"
      aria-label="Fever Pitch artwork: a night chart of an invented world, four coloured strains flaring out from their cities along the routes, and the lanterns of a small team closing in"
    >
      <defs>
        <radialGradient id="fp-cover-sea" cx=".5" cy=".45" r=".7">
          <stop offset="0" stop-color="#1f4466" />
          <stop offset="1" stop-color="#0a1626" />
        </radialGradient>
        <radialGradient id="fp-cover-glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fff" stop-opacity=".9" />
          <stop offset=".25" stop-color="#fff" stop-opacity=".35" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
        <LandFilter id="fp-cover-goo" blur={6} />
        {STRAIN_COLORS.map((c, i) => (
          <radialGradient key={i} id={`fp-cover-flare${i}`} cx=".5" cy=".5" r=".5">
            <stop offset="0" stop-color={c} stop-opacity=".95" />
            <stop offset=".45" stop-color={c} stop-opacity=".4" />
            <stop offset="1" stop-color={c} stop-opacity="0" />
          </radialGradient>
        ))}
      </defs>
      <rect width="600" height="360" fill="url(#fp-cover-sea)" />
      {/* graticule */}
      <g stroke="#3a6a90" stroke-opacity=".35" stroke-width=".8" fill="none">
        {[60, 120, 180, 240, 300].map((y) => (
          <path key={`h${y}`} d={`M0 ${y} Q300 ${y + (y - 180) * 0.12} 600 ${y}`} />
        ))}
        {[75, 150, 225, 300, 375, 450, 525].map((x) => (
          <path key={`v${x}`} d={`M${x} 0 Q${x + (x - 300) * 0.08} 180 ${x} 360`} />
        ))}
      </g>
      <g transform="translate(0 30)">
        <g fill="#1d3a55" filter="url(#fp-cover-goo)">
          {shelf}
        </g>
        <g fill="#2a4a3d" filter="url(#fp-cover-goo)">
          {land}
        </g>
        <g stroke={PAPER} stroke-opacity=".22" stroke-width="1">
          {LINKS.filter(
            ([a, b]) => Math.abs((CITY_POINTS[a]?.[0] ?? 0) - (CITY_POINTS[b]?.[0] ?? 0)) < 400,
          ).map(([a, b]) => (
            <path
              key={`${a}-${b}`}
              d={`M${(CITY_POINTS[a]?.[0] ?? 0) * s} ${(CITY_POINTS[a]?.[1] ?? 0) * s} L${(CITY_POINTS[b]?.[0] ?? 0) * s} ${(CITY_POINTS[b]?.[1] ?? 0) * s}`}
            />
          ))}
        </g>
        {flares.map(([c, k]) => (
          <g key={`r${c}`} stroke={STRAIN_COLORS[k]} stroke-width="2.2" stroke-linecap="round" opacity=".85">
            {LINKS.filter(
              ([a, b]) =>
                (a === c || b === c) &&
                Math.abs((CITY_POINTS[a]?.[0] ?? 0) - (CITY_POINTS[b]?.[0] ?? 0)) < 400,
            ).map(([a, b]) => {
              const o = a === c ? b : a;
              const [x1, y1] = CITY_POINTS[c] ?? [0, 0];
              const [x2, y2] = CITY_POINTS[o] ?? [0, 0];
              return (
                <g key={o}>
                  <path
                    d={`M${x1 * s} ${y1 * s} L${(x1 + (x2 - x1) * 0.75) * s} ${(y1 + (y2 - y1) * 0.75) * s}`}
                  />
                  <rect
                    x={(x1 + (x2 - x1) * 0.75) * s - 3}
                    y={(y1 + (y2 - y1) * 0.75) * s - 3}
                    width="6"
                    height="6"
                    rx="1.4"
                    fill={STRAIN_COLORS[k]}
                    stroke={INK}
                    stroke-width=".8"
                  />
                </g>
              );
            })}
          </g>
        ))}
        {flares.map(([c, k]) => {
          const p = CITY_POINTS[c] as readonly [number, number];
          return (
            <g key={c}>
              <circle cx={p[0] * s} cy={p[1] * s} r="44" fill={`url(#fp-cover-flare${k})`} />
              <circle
                cx={p[0] * s}
                cy={p[1] * s}
                r="5"
                fill={STRAIN_COLORS[k]}
                stroke={PAPER}
                stroke-width="1.2"
              />
            </g>
          );
        })}
        {CITY_POINTS.map(([x, y], c) => (
          <circle key={c} cx={x * s} cy={y * s} r="2" fill={PAPER} opacity=".75" />
        ))}
        {[
          [4, 0],
          [26, 1],
          [43, 2],
        ].map(([c, seat]) => {
          const p = CITY_POINTS[c as number] as readonly [number, number];
          return (
            <g key={c} transform={`translate(${p[0] * s + 14} ${p[1] * s - 12})`}>
              <circle r="16" fill="url(#fp-cover-glow)" />
              {pawnGlyph(seat as number, 8)}
            </g>
          );
        })}
      </g>
      {!props.thumb && (
        <g>
          <rect x="150" y="300" width="300" height="44" rx="8" fill={PAPER} stroke={INK} stroke-width="2" />
          <text x="300" y="331" text-anchor="middle" class="fp-cover-title" fill={INK}>
            FEVER PITCH
          </text>
          {[0, 1].map((k) => (
            <g key={k} transform={`translate(${170 + k * 22} 322)`}>
              <circle r="9.5" fill={STRAIN_COLORS[k]} />
              {strainGlyph(k, 6, PAPER)}
            </g>
          ))}
          {[2, 3].map((k) => (
            <g key={k} transform={`translate(${408 + (k - 2) * 22} 322)`}>
              <circle r="9.5" fill={STRAIN_COLORS[k]} />
              {strainGlyph(k, 6, PAPER)}
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
