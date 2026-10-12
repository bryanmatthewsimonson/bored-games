/*
 * Sticks & Stones' artwork (D089): the goods, the clan figures, tools, dice, the eight culture symbols and the four
 * figures, the 36 discovery cards, the 28 monument tiles, the board's spot vignettes and the catalog cover. All of it
 * is drawn here as inline SVG for this game, in one earthy palette (ochre, umber, charcoal, bone, sage, birch white,
 * amber and sky) with a cave-painting and carved-stone flavour. Original art, CC0-1.0; no external assets.
 *
 * Every component is pure (props only, no hooks), so the few gradient ids are fixed and prefixed `ss-`: two copies
 * of one picture hold identical definitions. Icons take `title` for an accessible name and are hidden otherwise.
 */
import {
  DISCOVERIES,
  type Effect,
  FIGURES,
  GOODS,
  goodsValue,
  MONUMENTS,
  STICKS_THEME,
  SYMBOLS,
} from '@bored-games/sticks-and-stones';
import type { ComponentChildren } from 'preact';

/* ---------------------------------------------------------------- palette */

const INK = '#2a2117';
const UMBER = '#5b3a24';
const BONE = '#f1e6cf';
const PARCH = '#f4ead3';
const OCHRE = '#c98b3a';
const SAGE = '#a9bd8c';
const SAND = '#e6cb93';
const FLINT = '#5f5a6b';
const SERIF = "Georgia, 'DejaVu Serif', 'Bitstream Charter', serif";
const TITLE_FONT = "Rockwell, 'Roboto Slab', 'Bitstream Charter', Georgia, 'DejaVu Serif', serif";

/** The four clans' colours. Each reads on parchment and on charcoal; the figures' dark outline does the rest. */
export const CLAN_COLORS: readonly { fill: string; name: string }[] = [
  { fill: '#c0502f', name: 'Red Ochre' },
  { fill: '#4a78b8', name: 'Woad Blue' },
  { fill: '#6a8f3c', name: 'Moss' },
  { fill: '#ece3cc', name: 'Chalk' },
];

/* ---------------------------------------------------------------- helpers */

/** A drawing made in a 24 × 24 box, placed with its top left corner at (x, y) and `size` wide. */
export function Place(props: {
  x: number;
  y: number;
  size: number;
  rotate?: number;
  children: ComponentChildren;
}) {
  const k = props.size / 24;
  const turn = props.rotate ? ` rotate(${props.rotate} 12 12)` : '';
  return <g transform={`translate(${props.x} ${props.y}) scale(${k})${turn}`}>{props.children}</g>;
}

/** A number or a short word cut in stone: a dark face with a pale rim, legible on any ground. */
function Carved(props: {
  x: number;
  y: number;
  size: number;
  text: string;
  fill?: string;
  rim?: string;
  rimWidth?: number;
  anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <text
      x={props.x}
      y={props.y}
      text-anchor={props.anchor ?? 'middle'}
      font-family={SERIF}
      font-weight="700"
      font-size={props.size}
      fill={props.fill ?? '#3a2516'}
      stroke={props.rim ?? '#fbf3e0'}
      stroke-width={props.rimWidth ?? props.size / 9}
      stroke-linejoin="round"
      paint-order="stroke"
    >
      {props.text}
    </text>
  );
}

const goodName = (good: number): string => {
  const id = GOODS[good];
  return id ? STICKS_THEME.goods[id].toLowerCase() : 'food';
};

/* ---------------------------------------------------------------- goods */

function FoodShape() {
  return (
    <g stroke-linejoin="round" stroke-linecap="round">
      <path d="M5.6 18.4 11.4 12.6" stroke={INK} stroke-width="5.2" />
      <circle cx="4.3" cy="17.6" r="2.2" fill={BONE} stroke={INK} stroke-width="1.1" />
      <circle cx="6.4" cy="19.7" r="2.2" fill={BONE} stroke={INK} stroke-width="1.1" />
      <path d="M5.6 18.4 11.4 12.6" stroke={BONE} stroke-width="3.1" />
      <path
        d="M10.2 14.8C7.4 11.4 8.6 5 13.6 3.4 18.6 1.8 22.4 5.4 21.4 10.2 20.5 14.4 14.6 17.4 10.2 14.8Z"
        fill="#a8392f"
        stroke={INK}
        stroke-width="1.2"
      />
      <path d="M10.6 13.6C13.8 15 18 13.8 19.8 10.8" fill="none" stroke="#e7a88a" stroke-width="1.3" />
      <path d="M13.2 6.2C14.8 4.8 17.4 4.6 18.8 5.8" fill="none" stroke="#e58a6c" stroke-width="1.4" />
    </g>
  );
}

function WoodShape() {
  return (
    <g stroke-linejoin="round" transform="rotate(-14 12 12)">
      <path d="M5 7.6H18.8V16.4H5A3.2 4.4 0 0 1 5 7.6Z" fill="#f3efe4" stroke={INK} stroke-width="1.2" />
      <path
        d="M5.2 10h2.6M9.6 14.4h3.4M13.6 9.8h2.4M7.4 14.6h1.2M16 13.2h1.6M10.4 9.4h1.2"
        stroke={INK}
        stroke-width="1.15"
        stroke-linecap="round"
      />
      <path d="M8 16.4H18" stroke="#c9c0ab" stroke-width="1.2" />
      <ellipse cx="18.8" cy="12" rx="3.2" ry="4.4" fill="#dcb26b" stroke={INK} stroke-width="1.2" />
      <ellipse cx="18.8" cy="12" rx="1.7" ry="2.4" fill="none" stroke="#a87634" stroke-width=".9" />
      <circle cx="18.8" cy="12" r=".6" fill="#a87634" />
    </g>
  );
}

function ClayShape() {
  return (
    <g stroke={INK} stroke-width="1.15" stroke-linejoin="round">
      <path d="M2.4 10.2 10.2 6.6 21.6 10.4 14 14.2Z" fill="#df8e5d" />
      <path d="M2.4 10.2 14 14.2V19.8L2.4 15.8Z" fill="#b65a32" />
      <path d="M14 14.2 21.6 10.4V16L14 19.8Z" fill="#8a3f22" />
      <ellipse cx="11.6" cy="10.3" rx="2.2" ry="1.1" fill="none" stroke="#a9502b" stroke-width=".9" />
      <path d="M4.6 13.4 7.4 14.4" stroke="#e7a17a" stroke-width=".9" />
    </g>
  );
}

function StoneShape() {
  return (
    <g stroke-linejoin="round">
      <path
        d="M3.2 15.4 5.8 8 11 4.4 17.6 5.4 21.2 11 19.6 18.2 12 20.8 5.2 19Z"
        fill="#99958d"
        stroke={INK}
        stroke-width="1.2"
      />
      <path d="M5.8 8 11 4.4 17.6 5.4 12.8 10Z" fill="#cbc7bd" />
      <path d="M12.8 10 21.2 11 19.6 18.2 12 20.8Z" fill="#6c6862" />
      <path d="M3.2 15.4 5.8 8 12.8 10 8.6 13.4Z" fill="#b2aea5" />
      <path d="M12.8 10 12 20.8M8.6 13.4 12.8 10" fill="none" stroke={INK} stroke-width=".9" />
      <path
        d="M3.2 15.4 5.8 8 11 4.4 17.6 5.4 21.2 11 19.6 18.2 12 20.8 5.2 19Z"
        fill="none"
        stroke={INK}
        stroke-width="1.2"
      />
    </g>
  );
}

function AmberShape() {
  return (
    <g stroke-linejoin="round">
      <circle cx="12.2" cy="12.2" r="11.2" fill="#ffc94a" opacity=".22" />
      <path
        d="M4.6 13.2C3.8 8.4 7.8 3.8 12.6 4.2 17.8 4.6 20.8 9 19.8 13.6 18.8 18.2 14.2 20.8 10 19.8 6.8 19 5.2 16.2 4.6 13.2Z"
        fill="#e39a22"
        stroke="#6b3a10"
        stroke-width="1.2"
      />
      <path
        d="M7.4 12.6C7.2 9.4 9.6 6.8 12.6 7 16.2 7.2 17.8 10.4 17 13.4 16.2 16.4 13 17.6 10.4 16.8 8.6 16.2 7.6 14.6 7.4 12.6Z"
        fill="#ffc957"
      />
      <path
        d="M9.2 10.4C9.6 8.8 11 7.8 12.6 7.8"
        fill="none"
        stroke="#fff4cf"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <circle cx="14.4" cy="13.8" r=".9" fill="#9a5a14" opacity=".7" />
      <path d="M14.4 13.8 15.6 13M14.4 13.8 15.4 14.8" stroke="#9a5a14" stroke-width=".5" opacity=".7" />
    </g>
  );
}

/** A good drawn in a 24 × 24 box: -1 food, 0 wood, 1 clay, 2 stone, 3 amber. */
export function GoodShape(props: { good: number }) {
  switch (props.good) {
    case 0:
      return (
        <g transform="translate(12 12) scale(1.1) translate(-12 -12)">
          <WoodShape />
        </g>
      );
    case 1:
      return (
        <g transform="translate(12 12) scale(1.06) translate(-12 -12)">
          <ClayShape />
        </g>
      );
    case 2:
      return <StoneShape />;
    case 3:
      return <AmberShape />;
    default:
      return <FoodShape />;
  }
}

/** A good of the player's choice: a pale token with a question mark. */
function AnyGoodShape() {
  return (
    <g>
      <circle cx="12" cy="12" r="10" fill={BONE} stroke={INK} stroke-width="1.3" />
      <circle cx="12" cy="12" r="7.6" fill="none" stroke={OCHRE} stroke-width="1" stroke-dasharray="2 1.6" />
      <text
        x="12"
        y="16.6"
        text-anchor="middle"
        font-family={SERIF}
        font-weight="700"
        font-size="13"
        fill={UMBER}
      >
        ?
      </text>
    </g>
  );
}

export function GoodIcon(props: { good: number; size?: number; title?: string }) {
  const size = props.size ?? 20;
  return (
    <svg
      class="ss-good"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={props.title ? 'img' : undefined}
      aria-label={props.title || undefined}
      aria-hidden={props.title ? undefined : 'true'}
    >
      <GoodShape good={props.good} />
    </svg>
  );
}

/* ---------------------------------------------------------------- people */

type Pose = 'stand' | 'raise' | 'lift' | 'reach' | 'staff';

const ARMS: Record<Pose, string> = {
  stand: 'M9 9.4 5.2 14.8M15 9.4 18.8 14.8',
  raise: 'M9 9.4 5.2 14.8M15 9.4 19 4.4',
  lift: 'M9 9.4 6.4 2.6M15 9.4 17.6 2.6',
  reach: 'M9 9.4 5.2 14.8M15 9.4 19.4 13.4',
  staff: 'M9 9.4 5.2 14.8M15 9.4 18.6 11.2',
};
const TORSO = 'M8.4 8.6H15.6L13.3 15.8H10.7Z';
const LEGS = 'M11 15.4 8.2 21.6M13 15.4 15.8 21.6';

/** A clan figure in a 24 × 24 box, painted like the people on a cave wall: a dark outline, then the colour. */
export function CavePerson(props: { fill: string; pose?: Pose; outline?: string }) {
  const limbs = `${ARMS[props.pose ?? 'stand']}${LEGS}`;
  const line = props.outline ?? INK;
  return (
    <g stroke-linecap="round" stroke-linejoin="round">
      <path d={limbs} fill="none" stroke={line} stroke-width="4" />
      <path d={TORSO} fill={line} stroke={line} stroke-width="2.2" />
      <circle cx="12" cy="4.8" r="4.2" fill={line} />
      <path d={limbs} fill="none" stroke={props.fill} stroke-width="2" />
      <path d={TORSO} fill={props.fill} />
      <circle cx="12" cy="4.8" r="3.1" fill={props.fill} />
    </g>
  );
}

export function PersonIcon(props: { color: string; size?: number }) {
  const size = props.size ?? 20;
  return (
    <svg class="ss-person" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <CavePerson fill={props.color} />
    </svg>
  );
}

/* ---------------------------------------------------------------- tools and dice */

/** A knapped hand-axe pointing up, in a 24 × 24 box. */
function AxeShape(props: { grey?: boolean }) {
  const grey = props.grey === true;
  const body =
    'M12 2.2C15.2 4.8 17.8 9.4 18 13.6 18.2 17.8 15.4 20.8 12 20.8 8.6 20.8 5.8 17.8 6 13.6 6.2 9.4 8.8 4.8 12 2.2Z';
  return (
    <g stroke-linejoin="round" stroke-linecap="round">
      <path d={body} fill={grey ? '#9a96a0' : '#4f4a5c'} />
      <path
        d="M12 2.2C8.8 4.8 6.2 9.4 6 13.6 5.8 17.8 8.6 20.8 12 20.8L12.8 12Z"
        fill={grey ? '#b5b1ba' : '#7a7490'}
      />
      <path
        d="M6.6 10.4Q9 10.6 9.8 8.2M6 15Q8.6 15 9.4 12.6M7.8 19.2Q10.2 18.4 10.4 16M17.4 10.4Q15 10.6 14.2 8.2M18 15Q15.4 15 14.6 12.6M16.2 19.2Q13.8 18.4 13.6 16"
        fill="none"
        stroke={grey ? '#83808a' : '#35313f'}
        stroke-width=".85"
      />
      <path d="M10.6 4.4C9.2 5.8 8 7.6 7.4 9.2" fill="none" stroke="#e6e2ee" stroke-width="1" />
      <path d={body} fill="none" stroke={INK} stroke-width="1.2" />
    </g>
  );
}

/** A tool tile: a hand-axe and its value (no value for a step), in a 24 × 24 box. */
export function ToolShape(props: { label: string; used?: boolean }) {
  const used = props.used === true;
  const bare = props.label === '';
  return (
    <g transform={used ? 'rotate(90 12 12)' : undefined} stroke-linejoin="round">
      <rect
        x="1.2"
        y="1.2"
        width="21.6"
        height="21.6"
        rx="4"
        fill={used ? '#d3cdc1' : '#ecdcb6'}
        stroke={INK}
        stroke-width="1.2"
      />
      <path
        d="M3.4 19.2V5.6Q3.4 3.4 5.6 3.4H18.6"
        fill="none"
        stroke="#fbf3df"
        stroke-width="1"
        stroke-linecap="round"
      />
      <g transform={bare ? undefined : 'translate(7.8 12) scale(.84) translate(-12 -11.5)'}>
        <AxeShape grey={used} />
      </g>
      {!bare && (
        <text
          x="16.8"
          y="20.4"
          text-anchor="middle"
          font-family={SERIF}
          font-weight="700"
          font-size="11.5"
          fill={used ? '#4d463e' : '#3a2516'}
          stroke={used ? '#d3cdc1' : '#ecdcb6'}
          stroke-width="2.4"
          stroke-linejoin="round"
          paint-order="stroke"
        >
          {props.label}
        </text>
      )}
    </g>
  );
}

export function ToolIcon(props: { value: number; used?: boolean; size?: number }) {
  const size = props.size ?? 20;
  return (
    <svg
      class="ss-tool"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      opacity={props.used ? 0.75 : undefined}
    >
      <ToolShape label={String(props.value)} used={props.used === true} />
    </svg>
  );
}

/** A one-use tool: a honey-coloured flint point with a bone tag for its value, in a 24 × 24 box. */
export function SpareShape(props: { value: number }) {
  return (
    <g stroke-linejoin="round">
      <g transform="translate(10 10.4) rotate(42) translate(-12 -12)">
        <path
          d="M12 1.2 14.8 5.2 16 10 15.6 15 13.8 19.6 12 22.6 10.2 19.6 8.4 15 8 10 9.2 5.2Z"
          fill="#c48a48"
          stroke={INK}
          stroke-width="1.2"
        />
        <path d="M12 1.2 9.2 5.2 8 10 12 13.6Z" fill="#e2b77a" />
        <path d="M12 13.6 16 10 15.6 15 13.8 19.6 12 22.6Z" fill="#9c6630" />
        <path
          d="M12 1.2 14.8 5.2 16 10 15.6 15 13.8 19.6 12 22.6 10.2 19.6 8.4 15 8 10 9.2 5.2Z"
          fill="none"
          stroke={INK}
          stroke-width="1.2"
        />
        <path
          d="M9.6 8.2 10.8 9M14.4 8.2 13.2 9M9.4 14 10.8 14.6M14.6 14 13.2 14.6"
          stroke="#8a5a2a"
          stroke-width=".7"
          stroke-linecap="round"
        />
      </g>
      <circle cx="17" cy="17.2" r="6" fill={BONE} stroke={INK} stroke-width="1.2" />
      <text
        x="17"
        y="20.8"
        text-anchor="middle"
        font-family={SERIF}
        font-weight="700"
        font-size="10"
        fill="#3a2516"
      >
        {props.value}
      </text>
    </g>
  );
}

export function SpareToolIcon(props: { value: number; size?: number }) {
  const size = props.size ?? 20;
  return (
    <svg class="ss-spare" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <SpareShape value={props.value} />
    </svg>
  );
}

const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[12, 12]],
  2: [
    [7, 7],
    [17, 17],
  ],
  3: [
    [7, 7],
    [12, 12],
    [17, 17],
  ],
  4: [
    [7, 7],
    [17, 7],
    [7, 17],
    [17, 17],
  ],
  5: [
    [7, 7],
    [17, 7],
    [12, 12],
    [7, 17],
    [17, 17],
  ],
  6: [
    [7, 6.6],
    [17, 6.6],
    [7, 12],
    [17, 12],
    [7, 17.4],
    [17, 17.4],
  ],
};

/** A bone die in a 24 × 24 box. */
function DieShape(props: { value: number }) {
  return (
    <g>
      <rect
        x="1.4"
        y="1.4"
        width="21.2"
        height="21.2"
        rx="5"
        fill="#efe3c6"
        stroke={INK}
        stroke-width="1.2"
      />
      <path
        d="M3.6 18.6V7.4Q3.6 3.6 7.4 3.6H17.4"
        fill="none"
        stroke="#fffaf0"
        stroke-width="1.3"
        stroke-linecap="round"
      />
      <path
        d="M20.6 6.6V16.6Q20.6 20.6 16.6 20.6H6.4"
        fill="none"
        stroke="#cdbb95"
        stroke-width="1.3"
        stroke-linecap="round"
      />
      {(PIPS[props.value] ?? []).map(([x, y]) => (
        <circle
          key={`${x},${y}`}
          cx={x}
          cy={y}
          r={props.value === 1 ? 2.8 : 2.1}
          fill={props.value === 1 ? '#8e2f1f' : '#3a2516'}
        />
      ))}
    </g>
  );
}

export function Die(props: { value: number; size?: number }) {
  const size = props.size ?? 20;
  return (
    <svg
      class="ss-die"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={`Die: ${props.value}`}
    >
      <DieShape value={props.value} />
    </svg>
  );
}

/* ---------------------------------------------------------------- culture symbols */

function Weave() {
  const cells: ComponentChildren[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if ((i + j) % 2 === 0)
        cells.push(
          <rect key={`${i}${j}`} x={6 + i * 4.4} y={5.2 + j * 4.6} width="3" height="4.6" fill="#8a5a2b" />,
        );
  return (
    <g stroke-linejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2.4" fill="#e9d29a" stroke={INK} stroke-width="1.2" />
      <path d="M4.6 7.4H19.4M4.6 12H19.4M4.6 16.6H19.4" stroke="#c99a52" stroke-width="2.6" />
      {cells}
      <rect x="4" y="4" width="16" height="16" rx="2.4" fill="none" stroke={INK} stroke-width="1.2" />
    </g>
  );
}

/** One of the eight culture symbols, in a 24 × 24 box. */
function SymbolShape(props: { symbol: number }) {
  switch (props.symbol) {
    case 0: // Glyphs: a clay tablet scratched with signs.
      return (
        <g stroke-linejoin="round" stroke-linecap="round">
          <rect
            x="4.6"
            y="2.6"
            width="14.8"
            height="18.8"
            rx="2.4"
            fill="#d9a873"
            stroke={INK}
            stroke-width="1.2"
          />
          <path
            d="M7.4 6.6 9 5.2 10.6 6.6M12.6 5.4V7.4M14.4 6.4H16.8M7.4 10.6H10M11.8 9.6 13.2 11.6 14.6 9.6 16 11.6M7.4 14.6 9.4 14.6 8.4 16.2ZM11.6 15H16.6M7.6 18.4H13"
            fill="none"
            stroke={INK}
            stroke-width="1.05"
          />
        </g>
      );
    case 1: // Healing Herbs: a sprig with paired leaves and a white flower.
      return (
        <g stroke-linejoin="round">
          <path
            d="M11.6 21.6C11.6 15.6 12.2 9.2 14.6 3.6"
            fill="none"
            stroke="#3d5a29"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          {[
            [11.8, 17.6, -150],
            [11.8, 17.4, -28],
            [12.2, 12.6, -158],
            [12.3, 12.4, -22],
            [13.2, 8, -150],
            [13.4, 7.8, -30],
          ].map(([x, y, r]) => (
            <path
              key={`${x}${y}${r}`}
              d="M0 0C1.8-2.4 5.4-2.4 6.8 0 5.4 2.4 1.8 2.4 0 0Z"
              transform={`translate(${x} ${y}) rotate(${r})`}
              fill="#6f9a4a"
              stroke={INK}
              stroke-width=".8"
            />
          ))}
          <circle cx="14.8" cy="3.4" r="1.9" fill="#fbf6ea" stroke={INK} stroke-width=".8" />
          <circle cx="14.8" cy="3.4" r=".7" fill="#e3b33c" />
        </g>
      );
    case 2: // Pottery: a round pot with a zigzag band.
      return (
        <g stroke-linejoin="round">
          <path
            d="M8.2 3.6H15.8L14.8 6.4C19.4 8.4 20.2 14.6 17.2 18.6 15.8 20.4 8.2 20.4 6.8 18.6 3.8 14.6 4.6 8.4 9.2 6.4Z"
            fill="#b9653b"
            stroke={INK}
            stroke-width="1.2"
          />
          <path d="M9.2 6.4H14.8" stroke={INK} stroke-width="1" />
          <path
            d="M6 12.4 7.8 10.6 9.6 12.4 11.4 10.6 13.2 12.4 15 10.6 16.8 12.4 18.2 11"
            fill="none"
            stroke="#f3e2c2"
            stroke-width="1.2"
            stroke-linejoin="miter"
          />
          <path d="M6.6 15H17.4" stroke="#f3e2c2" stroke-width=".9" />
          <path
            d="M8 8.6C7 10 6.6 11 6.6 12"
            fill="none"
            stroke="#e39a72"
            stroke-width="1"
            stroke-linecap="round"
          />
        </g>
      );
    case 3: // Cave Painting: a hand stencil in red ochre with its spray.
      return (
        <g stroke-linecap="round">
          <circle cx="12" cy="12" r="11" fill="#e8b97c" opacity=".7" />
          <circle cx="12" cy="12" r="9.2" fill="#efc993" opacity=".7" />
          <path
            d="M8.4 14.6 5.2 11.2M9.9 11.6 8.9 4.8M12 11.2V3.6M14.1 11.6 15.1 4.8M15.8 12.8 18.6 7.8"
            stroke="#a63e26"
            stroke-width="2.6"
          />
          <ellipse cx="12" cy="15.2" rx="4.4" ry="4.6" fill="#a63e26" />
          <path d="M10.4 19.2 10 22M13.6 19.2 14 22" stroke="#a63e26" stroke-width="2.6" />
        </g>
      );
    case 4: // Bone Flute: a bone with finger holes, and its notes.
      return (
        <g stroke-linecap="round">
          <path d="M5.4 18.6 17.2 6.8" stroke={INK} stroke-width="5.6" />
          <circle cx="4.2" cy="18.2" r="2.3" fill={BONE} stroke={INK} stroke-width="1.1" />
          <circle cx="5.8" cy="19.8" r="2.3" fill={BONE} stroke={INK} stroke-width="1.1" />
          <circle cx="16.8" cy="5.2" r="2.3" fill={BONE} stroke={INK} stroke-width="1.1" />
          <circle cx="18.8" cy="7.2" r="2.3" fill={BONE} stroke={INK} stroke-width="1.1" />
          <path d="M5.4 18.6 17.2 6.8" stroke={BONE} stroke-width="3.4" />
          <circle cx="9" cy="15" r=".95" fill={INK} />
          <circle cx="11.4" cy="12.6" r=".95" fill={INK} />
          <circle cx="13.8" cy="10.2" r=".95" fill={INK} />
          <path
            d="M15.6 14.6Q18 15 18.8 17.4M17.2 12.6Q20.6 13 21.6 16.6"
            fill="none"
            stroke={UMBER}
            stroke-width="1.1"
          />
        </g>
      );
    case 5:
      return <Weave />;
    case 6: // Star Calendar: a crescent moon with stars and a tally of days.
      return (
        <g stroke-linejoin="round">
          <path
            d="M13.2 2.8A8.6 8.6 0 1 0 20.6 15.4 7 7 0 1 1 13.2 2.8Z"
            fill="#ecc566"
            stroke={INK}
            stroke-width="1.15"
          />
          <path
            d="M18 3.2 18.7 5 20.5 5.7 18.7 6.4 18 8.2 17.3 6.4 15.5 5.7 17.3 5ZM21 9.4 21.5 10.6 22.7 11.1 21.5 11.6 21 12.8 20.5 11.6 19.3 11.1 20.5 10.6Z"
            fill="#fbf1cf"
            stroke={INK}
            stroke-width=".6"
          />
          <path
            d="M5 22V20.2M7.2 22V20.2M9.4 22V20.2M11.6 22V20.2M4.4 21.6 12.2 20.4"
            stroke={UMBER}
            stroke-width=".9"
            stroke-linecap="round"
          />
        </g>
      );
    default: // Sledge: a laden sledge with an upturned runner and a tow rope.
      return (
        <g stroke-linejoin="round" stroke-linecap="round">
          <rect x="5.2" y="7.4" width="11" height="6" rx="2" fill="#b98a4e" stroke={INK} stroke-width="1.1" />
          <path d="M8.6 7.6V13.2M12.6 7.6V13.2" stroke="#7a5428" stroke-width=".9" />
          <path d="M3.4 13.8H17.8" stroke={UMBER} stroke-width="1.6" />
          <path d="M5.4 13.8V16.8M10.6 13.8V16.8M15.6 13.8V16.8" stroke={UMBER} stroke-width="1.3" />
          <path d="M2.6 17.2H17C20 17.2 21.2 15.4 20.6 12.6" fill="none" stroke={INK} stroke-width="1.8" />
          <path d="M20.6 12.6 23 10" stroke={OCHRE} stroke-width="1.1" />
        </g>
      );
  }
}

export function SymbolGlyph(props: { symbol: number; size?: number }) {
  const size = props.size ?? 24;
  const id = SYMBOLS[props.symbol];
  return (
    <svg
      class="ss-symbol"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={id ? STICKS_THEME.symbols[id] : 'Symbol'}
    >
      <SymbolShape symbol={props.symbol} />
    </svg>
  );
}

/* ---------------------------------------------------------------- figures */

const FIGURE_FILL = '#7a4a2a';

/** One of the four figures of the scoring cards, in a 24 × 24 box. */
function FigureShape(props: { figure: number }) {
  switch (props.figure) {
    case 0: // Grower: a digging stick and a sprout.
      return (
        <g>
          <path
            d="M20.2 21.6C20.2 18.6 20 16.4 19 14.6"
            fill="none"
            stroke="#3d5a29"
            stroke-width="1.3"
            stroke-linecap="round"
          />
          <path
            d="M19.4 15.6C17.2 15.6 15.8 14 16 12.4 18 12.4 19.4 13.8 19.4 15.6ZM19.8 17.6C21.8 17.4 23.2 15.8 23 14.2 21.2 14.2 19.8 15.6 19.8 17.6Z"
            fill="#79a64b"
            stroke={INK}
            stroke-width=".7"
          />
          <path d="M17 22H23.6" stroke={UMBER} stroke-width="1.4" stroke-linecap="round" />
          <g transform="translate(-3.2 0)">
            <path d="M18.6 10.4 13.6 22.6" stroke={INK} stroke-width="2.4" stroke-linecap="round" />
            <path d="M18.6 10.4 13.6 22.6" stroke="#b98a4e" stroke-width="1.1" stroke-linecap="round" />
            <CavePerson fill={FIGURE_FILL} pose="reach" />
          </g>
        </g>
      );
    case 1: // Knapper: a raised hammerstone over a flint core.
      return (
        <g>
          <g transform="translate(-3 0)">
            <CavePerson fill={FIGURE_FILL} pose="raise" />
          </g>
          <circle cx="16.6" cy="3.8" r="2.6" fill="#a8a39a" stroke={INK} stroke-width="1" />
          <path
            d="M16.2 22 17.4 17.6 21 16.4 23.4 19.6 22.4 22Z"
            fill={FLINT}
            stroke={INK}
            stroke-width=".9"
            stroke-linejoin="round"
          />
          <path
            d="M18 15.2 17.2 13.8M20.2 14.6 21 13"
            stroke={UMBER}
            stroke-width=".8"
            stroke-linecap="round"
          />
        </g>
      );
    case 2: // Builder: a stone lintel held overhead.
      return (
        <g>
          <g transform="translate(1.4 3.6) scale(.88)">
            <CavePerson fill={FIGURE_FILL} pose="lift" />
          </g>
          <path
            d="M3 1.4H21.4L22.4 4.4H2.2Z"
            fill="#a8a39a"
            stroke={INK}
            stroke-width="1"
            stroke-linejoin="round"
          />
          <path d="M5 2.4H11" stroke="#d6d1c6" stroke-width=".8" />
        </g>
      );
    default: // Elder: a staff and a feather.
      return (
        <g>
          <g transform="translate(-2 0)">
            <path d="M18 1.6 17.2 22.4" stroke={INK} stroke-width="2.4" stroke-linecap="round" />
            <path d="M18 1.6 17.2 22.4" stroke="#b98a4e" stroke-width="1.1" stroke-linecap="round" />
            <path d="M18 1.6C19.4 1.6 19.6 3.4 18.2 3.6" fill="none" stroke={INK} stroke-width="1" />
            <CavePerson fill={FIGURE_FILL} pose="staff" />
            <path
              d="M12.8 1.6C13.6-1 16.4-1.6 17.8-.6 16.6 1 14.6 2 12.8 1.6Z"
              fill="#b4472f"
              stroke={INK}
              stroke-width=".7"
            />
          </g>
        </g>
      );
  }
}

export function FigureGlyph(props: { figure: number; size?: number }) {
  const size = props.size ?? 24;
  const id = FIGURES[props.figure];
  return (
    <svg
      class="ss-figure"
      width={size}
      height={size}
      viewBox="-1.5 -2 27 27"
      role="img"
      aria-label={id ? STICKS_THEME.figures[id] : 'Figure'}
    >
      <circle cx="12" cy="11.5" r="12.8" fill={SAND} stroke={INK} stroke-width="1.1" />
      <FigureShape figure={props.figure} />
    </svg>
  );
}

/* ---------------------------------------------------------------- discovery cards */

/** A sprout on a mound: one step on the harvest track, in a 24 × 24 box. */
function SproutShape() {
  return (
    <g stroke-linejoin="round">
      <path d="M2 21.4C5 16.6 19 16.6 22 21.4Z" fill="#8a5a33" stroke={INK} stroke-width="1.1" />
      <path
        d="M12 18.4C12 13.4 12.2 10 13 7"
        fill="none"
        stroke="#3d5a29"
        stroke-width="1.6"
        stroke-linecap="round"
      />
      <path
        d="M12.4 12.6C8.6 13 5.6 10.4 5.6 6.8 9.4 6.4 12.4 9 12.4 12.6Z"
        fill="#79a64b"
        stroke={INK}
        stroke-width=".9"
      />
      <path
        d="M12.8 9.4C13 5.6 15.8 2.8 19.4 2.8 19.6 6.6 16.8 9.4 12.8 9.4Z"
        fill="#94bf5c"
        stroke={INK}
        stroke-width=".9"
      />
    </g>
  );
}

/** A small round badge with `+1`, for the steps. */
function StepBadge(props: { x: number; y: number }) {
  return (
    <g>
      <circle cx={props.x} cy={props.y} r="13" fill="#8e2f1f" stroke={INK} stroke-width="1.6" />
      <text
        x={props.x}
        y={props.y + 5.4}
        text-anchor="middle"
        font-family={SERIF}
        font-weight="700"
        font-size="15"
        fill="#fbf1dc"
      >
        +1
      </text>
    </g>
  );
}

/** The ring of carved stone and sage leaves around a number of points. */
function PointsRing(props: { cx: number; cy: number; n: number | null; r: number; plain?: boolean }) {
  const { cx, cy, r } = props;
  const leaves: ComponentChildren[] = [];
  for (let i = 0; i < (props.plain ? 0 : 12); i++) {
    const a = -150 + i * 25;
    if (a > 150) break;
    const rad = (a * Math.PI) / 180;
    const x = cx + Math.sin(rad) * (r + 4.6);
    const y = cy - Math.cos(rad) * (r + 4.6);
    leaves.push(
      <ellipse
        key={a}
        cx={x}
        cy={y}
        rx={r * 0.12}
        ry={r * 0.26}
        transform={`rotate(${a + 28} ${x} ${y})`}
        fill="#6f8f4f"
        stroke={INK}
        stroke-width=".7"
      />,
    );
  }
  return (
    <g>
      {leaves}
      <circle cx={cx} cy={cy} r={r} fill="#cdc4b2" stroke={INK} stroke-width="1.8" />
      <circle cx={cx} cy={cy} r={r * 0.78} fill="none" stroke="#8b8272" stroke-width="1.1" />
      <path
        d={`M${cx - r * 0.62} ${cy - r * 0.42}A${r * 0.78} ${r * 0.78} 0 0 1 ${cx + r * 0.2} ${cy - r * 0.76}`}
        fill="none"
        stroke="#efe9dc"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <Carved
        x={cx}
        y={cy + r * 0.38}
        size={r * 1.1}
        text={props.n === null ? '?' : String(props.n)}
        rim="#efe8d8"
      />
    </g>
  );
}

const SPIRAL = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * Math.PI * 2 * 3.1;
    const r = 2 + t * 2.3;
    pts.push(`${(60 + Math.cos(t) * r).toFixed(1)} ${(84 + Math.sin(t) * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}`;
})();

/** The back of a discovery, in the card's 120 × 168 box. */
function CardBackShape() {
  const dots: ComponentChildren[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    dots.push(
      <circle key={i} cx={60 + Math.cos(a) * 40} cy={84 + Math.sin(a) * 40} r="2.2" fill="#d9a24e" />,
    );
  }
  return (
    <g>
      <rect x="1" y="1" width="118" height="166" rx="9" fill="#4b3121" stroke={INK} stroke-width="2" />
      <rect x="7" y="7" width="106" height="154" rx="6" fill="#5a3b27" stroke="#c98b3a" stroke-width="1.6" />
      <path
        d="M12 20 18 14 24 20 30 14 36 20 42 14 48 20 54 14 60 20 66 14 72 20 78 14 84 20 90 14 96 20 102 14 108 20M12 154 18 148 24 154 30 148 36 154 42 148 48 154 54 148 60 154 66 148 72 154 78 148 84 154 90 148 96 154 102 148 108 154"
        fill="none"
        stroke="#a8682a"
        stroke-width="1.6"
      />
      <circle cx="60" cy="84" r="34" fill="#4b3121" />
      {dots}
      <path d={SPIRAL} fill="none" stroke="#e8b45a" stroke-width="3.4" stroke-linecap="round" />
      <path
        d="M22 40C24 34 30 32 34 36M98 128C96 134 90 136 86 132"
        fill="none"
        stroke="#a8682a"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </g>
  );
}

function EffectArt(props: { effect: Effect }) {
  const e = props.effect;
  switch (e.type) {
    case 'food':
      return (
        <g>
          <Place x={10} y={26} size={52}>
            <FoodShape />
          </Place>
          <Carved x={86} y={67} size={40} text={String(e.n)} />
        </g>
      );
    case 'goods':
      return e.n === 1 ? (
        <Place x={29} y={22} size={62}>
          <GoodShape good={e.good} />
        </Place>
      ) : (
        <g>
          <Place x={8} y={30} size={50}>
            <GoodShape good={e.good} />
          </Place>
          <Place x={62} y={22} size={50}>
            <GoodShape good={e.good} />
          </Place>
        </g>
      );
    case 'roll':
      return (
        <g>
          <Place x={12} y={22} size={30} rotate={-14}>
            <DieShape value={3} />
          </Place>
          <Place x={26} y={50} size={30} rotate={12}>
            <DieShape value={5} />
          </Place>
          <path
            d="M60 54H70M66 49 71 54 66 59"
            fill="none"
            stroke="#3a2516"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <Place x={72} y={30} size={44}>
            <GoodShape good={e.good} />
          </Place>
        </g>
      );
    case 'points':
      return <PointsRing cx={60} cy={53} r={27} n={e.n} />;
    case 'oneUse':
      return (
        <Place x={27} y={20} size={66}>
          <SpareShape value={e.n} />
        </Place>
      );
    case 'tool':
      return (
        <g>
          <Place x={22} y={20} size={60}>
            <ToolShape label="" />
          </Place>
          <StepBadge x={84} y={70} />
        </g>
      );
    case 'field':
      return (
        <g>
          <Place x={18} y={18} size={64}>
            <SproutShape />
          </Place>
          <StepBadge x={86} y={70} />
        </g>
      );
    case 'choose':
      return (
        <g>
          <Place x={10} y={30} size={48}>
            <AnyGoodShape />
          </Place>
          <Place x={62} y={30} size={48}>
            <AnyGoodShape />
          </Place>
        </g>
      );
    case 'extra':
      return (
        <g>
          <g transform="translate(30 17) rotate(-10 20 28) scale(.36)">
            <CardBackShape />
          </g>
          <g transform="translate(50 20) rotate(8 20 28) scale(.36)">
            <CardBackShape />
          </g>
        </g>
      );
    default: {
      const dice: ComponentChildren[] = [];
      for (let i = 0; i < 6; i++) {
        const a = -55 + i * 22;
        const rad = (a * Math.PI) / 180;
        const x = 60 + Math.sin(rad) * 52;
        const y = 106 - Math.cos(rad) * 52;
        dice.push(
          <Place key={i} x={x - 12} y={y - 12} size={24} rotate={a}>
            <DieShape value={i + 1} />
          </Place>,
        );
      }
      return <g>{dice}</g>;
    }
  }
}

function effectText(e: Effect): string {
  const W = STICKS_THEME.words;
  switch (e.type) {
    case 'dice':
      return W.gift;
    case 'food':
      return `${e.n} food`;
    case 'goods':
      return `${e.n} ${goodName(e.good)}`;
    case 'roll':
      return `roll 2 dice for ${goodName(e.good)}`;
    case 'points':
      return `${e.n} points`;
    case 'oneUse':
      return `a ${W.spare} of ${e.n}`;
    case 'tool':
      return 'a tool step';
    case 'field':
      return 'a harvest step';
    case 'choose':
      return W.choose;
    case 'extra':
      return W.extra;
  }
}

/** A discovery's name in words, for screen readers: its scoring part, then its effect ("Pottery: 7 food"). */
export function discoveryLabel(card: number): string {
  const d = DISCOVERIES[card];
  if (!d) return STICKS_THEME.words.extra.replace(/^a /, 'A ');
  const b = d.bottom;
  let head: string;
  if (b.kind === 'culture') {
    const id = SYMBOLS[b.symbol];
    head = id ? STICKS_THEME.symbols[id] : 'Culture';
  } else {
    const id = FIGURES[b.figure];
    head = `${id ? STICKS_THEME.figures[id] : 'Figure'} ×${b.count}`;
  }
  return `${head}: ${effectText(d.top)}`;
}

export function DiscoveryCard(props: { card: number | null; small?: boolean }) {
  const w = props.small ? 80 : 120;
  const h = props.small ? 112 : 168;
  const d = props.card === null ? undefined : DISCOVERIES[props.card];
  if (!d)
    return (
      <svg
        class="ss-card ss-card-back"
        width={w}
        height={h}
        viewBox="0 0 120 168"
        role="img"
        aria-label="A face-down discovery"
      >
        <CardBackShape />
      </svg>
    );
  const b = d.bottom;
  const culture = b.kind === 'culture';
  let caption: string;
  let bottom: ComponentChildren;
  if (b.kind === 'culture') {
    const id = SYMBOLS[b.symbol];
    caption = id ? STICKS_THEME.symbols[id] : '';
    bottom = (
      <g>
        <circle
          cx="60"
          cy={props.small ? 132 : 125}
          r={props.small ? 23 : 18}
          fill={PARCH}
          stroke="#4f6b3c"
          stroke-width="2"
        />
        <Place x={props.small ? 41 : 45} y={props.small ? 113 : 110} size={props.small ? 38 : 30}>
          <SymbolShape symbol={b.symbol} />
        </Place>
      </g>
    );
  } else {
    const id = FIGURES[b.figure];
    caption = id ? `${STICKS_THEME.figures[id]} · ${STICKS_THEME.figureCounts[id]}` : '';
    const size = props.small ? (b.count === 3 ? 34 : 42) : b.count === 3 ? 33 : 38;
    const gap = 2;
    const total = b.count * size + (b.count - 1) * gap;
    const y = props.small ? (b.count === 3 ? 116 : 112) : b.count === 3 ? 109 : 106;
    bottom = (
      <g>
        {Array.from({ length: b.count }, (_, i) => (
          <g
            key={i}
            transform={`translate(${60 - total / 2 + i * (size + gap)} ${y}) scale(${size / 24}) translate(0 1.5)`}
          >
            <FigureShape figure={b.figure} />
          </g>
        ))}
      </g>
    );
  }
  return (
    <svg
      class="ss-card"
      width={w}
      height={h}
      viewBox="0 0 120 168"
      role="img"
      aria-label={discoveryLabel(props.card ?? 0)}
    >
      <rect x="1" y="1" width="118" height="166" rx="9" fill={PARCH} stroke="#4a3020" stroke-width="2" />
      <rect x="7" y="7" width="106" height="92" rx="6" fill="#e9d3a6" />
      <path
        d="M14 20C30 14 46 22 62 16S96 12 106 20M10 88C30 84 52 92 76 86S100 84 110 90"
        fill="none"
        stroke="#dcc18c"
        stroke-width="5"
        stroke-linecap="round"
      />
      <ellipse cx="96" cy="34" rx="10" ry="6" fill="#dfc391" opacity=".7" />
      <ellipse cx="22" cy="74" rx="9" ry="5" fill="#dfc391" opacity=".7" />
      <rect x="7" y="7" width="106" height="92" rx="6" fill="none" stroke="#b58d55" stroke-width="1.2" />
      <EffectArt effect={d.top} />
      <path d="M10 102.5H110" stroke="#b58d55" stroke-width="1.2" stroke-dasharray="3 2.4" />
      <rect
        x="7"
        y="106"
        width="106"
        height="55"
        rx="6"
        fill={culture ? SAGE : SAND}
        stroke={culture ? '#6f8a58' : '#b4935a'}
        stroke-width="1.2"
      />
      {culture ? (
        <path
          d="M12 112 18 118 24 112M96 112 102 118 108 112"
          fill="none"
          stroke="#7e9866"
          stroke-width="1.4"
        />
      ) : (
        <path d="M12 113h8M100 113h8" stroke="#c4a46a" stroke-width="1.6" stroke-linecap="round" />
      )}
      {bottom}
      {!props.small && (
        <text
          x="60"
          y="155.5"
          text-anchor="middle"
          font-family={SERIF}
          font-weight="700"
          font-size={caption.length > 18 ? 8.4 : 9.6}
          fill={culture ? '#24331a' : '#4a3020'}
        >
          {caption}
        </text>
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------- monuments */

const TILE = 'M11 2H99L108 11V99L99 108H11L2 99V11Z';

/** The megalith pictured on a monument tile, in the tile's vignette (x 9–101, y 9–56). */
function Megalith(props: { kind: number }) {
  const stone = { fill: '#8f897c', stroke: INK, 'stroke-width': 1.2, 'stroke-linejoin': 'round' as const };
  switch (props.kind) {
    case 0: // dolmen
      return (
        <g>
          <path d="M24 55V33H33V55ZM52 55V32H61V55Z" {...stone} />
          <path d="M17 34 22 25 62 22 70 29 63 35 24 37Z" {...stone} fill="#a39d90" />
          <path d="M23 26 61 23.4" stroke="#d8d3c8" stroke-width="1.2" stroke-linecap="round" />
        </g>
      );
    case 1: // menhirs
      return (
        <g>
          <path d="M37 55 34 31 39 15 47 13 51 27 50 55Z" {...stone} fill="#a39d90" />
          <path d="M57 55 56 40 60 33 65 35 66 55Z" {...stone} />
          <path d="M40 18 46 16M38 30 41 26" stroke="#d8d3c8" stroke-width="1.2" stroke-linecap="round" />
          <path
            d="M44 34C42 36 42 40 45 41 48 42 49 38 47 36"
            fill="none"
            stroke="#5e584e"
            stroke-width="1.1"
          />
        </g>
      );
    case 2: // stone circle
      return (
        <g>
          <ellipse cx="44" cy="49" rx="31" ry="5.6" fill="#93a571" stroke="#7d9160" stroke-width=".8" />
          {[
            [24, 41, 5, 8],
            [35, 39, 5, 9],
            [49, 39, 5, 9],
            [61, 41, 5, 8],
            [14, 46, 7, 12],
            [68, 46, 7, 12],
            [30, 50, 7, 14],
            [52, 50, 7, 14],
          ].map(([x, y, w, h]) => {
            const X = x ?? 0;
            const Y = y ?? 0;
            const W = w ?? 0;
            const H = h ?? 0;
            return (
              <path
                key={`${X}`}
                d={`M${X} ${Y}V${Y - H + W * 0.6}Q${X} ${Y - H} ${X + W / 2} ${Y - H}Q${X + W} ${Y - H} ${X + W} ${Y - H + W * 0.6}V${Y}Z`}
                {...stone}
                fill={H > 10 ? '#a39d90' : '#8f897c'}
              />
            );
          })}
        </g>
      );
    case 3: // cairn
      return (
        <g>
          {[
            [26, 49, 9, 6],
            [44, 50, 10, 6],
            [62, 49, 9, 6],
            [35, 41, 9, 5.6],
            [53, 41, 9, 5.6],
            [44, 33, 8.6, 5.4],
            [44, 25, 7, 4.6],
            [44, 18.6, 5, 3.6],
          ].map(([cx, cy, rx, ry]) => (
            <ellipse
              key={`${cx},${cy}`}
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              {...stone}
              fill={cy && cy < 30 ? '#a39d90' : '#8f897c'}
            />
          ))}
        </g>
      );
    default: // stone hut
      return (
        <g>
          <path d="M20 55V40Q44 12 68 40V55Z" {...stone} fill="#a39d90" />
          <path d="M20 46H68M23 40H65M28 33H60M35 27H53" fill="none" stroke="#6f695e" stroke-width="1" />
          <path d="M38 55V45Q44 38 50 45V55Z" fill="#3a2a1e" stroke={INK} stroke-width="1" />
          <path
            d="M43 16 44 9M46 16 48 10"
            stroke="#8a8478"
            stroke-width="1.2"
            stroke-linecap="round"
            opacity=".7"
          />
        </g>
      );
  }
}

/** A monument's price and points in words ("Monument: 2 wood, 1 clay, 10 points"). */
export function monumentLabel(m: number): string {
  const mo = MONUMENTS[m];
  if (!mo) return 'A face-down monument';
  if (mo.kind === 'fixed') {
    const parts = mo.cost.flatMap((n, i) => (n > 0 ? [`${n} ${goodName(i)}`] : []));
    return `Monument: ${parts.join(', ')}, ${goodsValue(mo.cost)} points`;
  }
  if (mo.kind === 'kinds')
    return `Monument: ${mo.count} goods of exactly ${mo.kinds} ${mo.kinds === 1 ? 'kind' : 'kinds'}`;
  return 'Monument: 1 to 7 goods of any kinds';
}

const KIND_TINTS = ['#f4ead3', '#d4bb8c', '#a7927a', '#73604f'];

function MonumentBack() {
  return (
    <g>
      <path d={TILE} transform="translate(5 5) scale(.9)" fill="#6f665a" stroke={INK} stroke-width="2" />
      <path d={TILE} transform="translate(2.5 2.5) scale(.9)" fill="#857b6d" stroke={INK} stroke-width="2" />
      <path d={TILE} transform="scale(.9)" fill="#9d9383" stroke={INK} stroke-width="2" />
      <path d={TILE} transform="translate(9 9) scale(.74)" fill="none" stroke="#c4b9a5" stroke-width="2.4" />
      <path
        d={SPIRAL}
        transform="translate(50.2 50.6) scale(.68) translate(-60 -84)"
        fill="none"
        stroke="#4b4035"
        stroke-width="4.4"
        stroke-linecap="round"
      />
      <path
        d={SPIRAL}
        transform="translate(49.5 49.5) scale(.68) translate(-60 -84)"
        fill="none"
        stroke="#e2d9c6"
        stroke-width="2"
        stroke-linecap="round"
      />
    </g>
  );
}

export function MonumentTile(props: { monument: number | null; small?: boolean }) {
  const size = props.small ? 72 : 110;
  const mo = props.monument === null ? undefined : MONUMENTS[props.monument];
  if (!mo || props.monument === null)
    return (
      <svg
        class="ss-monument ss-monument-back"
        width={size}
        height={size}
        viewBox="0 0 110 110"
        role="img"
        aria-label="A face-down monument"
      >
        <MonumentBack />
      </svg>
    );
  const m = props.monument;
  let price: ComponentChildren;
  let points: number | null = null;
  if (mo.kind === 'fixed') {
    points = goodsValue(mo.cost);
    const icons = mo.cost.flatMap((n, g) => Array.from({ length: n }, () => g));
    const each = 30;
    const total = icons.length * each + (icons.length - 1) * 2;
    price = (
      <g>
        {icons.map((g, i) => (
          <Place key={`${i}`} x={55 - total / 2 + i * (each + 2)} y={66} size={each}>
            <GoodShape good={g} />
          </Place>
        ))}
      </g>
    );
  } else if (mo.kind === 'kinds') {
    const k = mo.kinds;
    price = (
      <g>
        <Carved x={28} y={100} size={38} text={String(mo.count)} rim="#f1ead9" />
        {Array.from({ length: k }, (_, i) => (
          <circle
            key={i}
            cx={54 + i * 13 + (4 - k) * 6.5}
            cy={74}
            r="5.4"
            fill={KIND_TINTS[i]}
            stroke={INK}
            stroke-width="1.2"
          />
        ))}
        <text
          x="74"
          y="98"
          text-anchor="middle"
          font-family={SERIF}
          font-weight="700"
          font-size="12"
          fill="#3a2516"
        >
          {k === 1 ? '1 kind' : `${k} kinds`}
        </text>
      </g>
    );
  } else {
    price = (
      <g>
        <Carved x={34} y={96} size={27} text="1–7" rim="#f1ead9" />
        {[0, 1, 2, 3].map((g) => (
          <Place key={g} x={66 + (g % 2) * 17} y={64 + Math.floor(g / 2) * 18} size={18}>
            <GoodShape good={g} />
          </Place>
        ))}
      </g>
    );
  }
  return (
    <svg
      class="ss-monument"
      width={size}
      height={size}
      viewBox="0 0 110 110"
      role="img"
      aria-label={monumentLabel(m)}
    >
      <path d={TILE} fill="#d8cdb6" stroke="#4a3a2c" stroke-width="2.2" stroke-linejoin="round" />
      <path d="M13 6H97" stroke="#efe7d6" stroke-width="2" stroke-linecap="round" />
      <rect x="9" y="9" width="92" height="47" rx="4" fill="#cfe0de" />
      <path d="M9 44C26 38 44 40 62 37S90 36 101 40V52Q101 56 97 56H13Q9 56 9 52Z" fill="#a9b98a" />
      <Megalith kind={m % 5} />
      <rect x="9" y="9" width="92" height="47" rx="4" fill="none" stroke="#7d705e" stroke-width="1.2" />
      <PointsRing cx={87} cy={23} r={14} n={points} plain />
      <path d="M12 60H98" stroke="#b9ab92" stroke-width="1.2" />
      {price}
      <circle cx="16" cy="100" r="1.4" fill="#a99b84" />
      <circle cx="94" cy="100" r="1.4" fill="#a99b84" />
    </svg>
  );
}

/* ---------------------------------------------------------------- spot vignettes */

function Birch(props: { x: number; w: number; top: number; base: number }) {
  const { x, w, top, base } = props;
  const marks: string[] = [];
  for (let y = top + 6, i = 0; y < base - 4; y += 7, i++) {
    const left = i % 2 === 0;
    marks.push(`M${left ? x : x + w * 0.45} ${y}h${w * 0.55}`);
  }
  return (
    <g>
      <rect x={x} y={top} width={w} height={base - top} fill="#f4f1e8" stroke="#3a2f26" stroke-width=".9" />
      <path d={marks.join('')} stroke="#2a2117" stroke-width="1.4" stroke-linecap="round" />
    </g>
  );
}

export function SpotScene(props: { spot: string }) {
  switch (props.spot) {
    case 'hunt':
      return (
        <g>
          <rect width="160" height="90" fill="#cfe2e2" />
          <path d="M0 44C30 34 60 40 90 34S140 32 160 38V90H0Z" fill="#a9bf9a" />
          <path d="M0 56C40 50 80 54 120 50S150 50 160 52V90H0Z" fill="#bcc57c" />
          <rect y="62" width="160" height="28" fill="#aab468" />
          <path
            d="M58 40C62 33 74 31 86 32 92 32 97 30 100 27L101 22 104 27 108 23 107 29C111 31 112 35 109 37L104 36C102 40 99 43 97 47L102 55 99 56 92 47 84 48 78 56 75 55 79 47C73 46 68 44 64 46L56 53 53 52 59 44C56 44 55 42 58 40Z"
            fill="#8e3b22"
            stroke="#5b2414"
            stroke-width=".6"
            stroke-linejoin="round"
          />
          <path
            d="M101 22 98 16M101 22 104 15M104 27 110 19M104 27 107 20"
            stroke="#5b2414"
            stroke-width="1.2"
            stroke-linecap="round"
          />
          <path
            d="M14 61 16 52 18 61M20 61 23 54 24 61M130 60 132 51 134 60M137 60 139 53 140 60"
            fill="none"
            stroke="#6c7b3a"
            stroke-width="1.2"
            stroke-linecap="round"
          />
          <path
            d="M28 30 34 26 40 30M118 22 123 19 128 22"
            fill="none"
            stroke="#4d5a5a"
            stroke-width="1"
            stroke-linecap="round"
          />
        </g>
      );
    case 'wood':
      return (
        <g>
          <rect width="160" height="90" fill="#e3ead6" />
          <path d="M0 30C20 18 40 26 60 18S100 14 120 20 150 18 160 22V64H0Z" fill="#a9c07f" />
          <rect y="62" width="160" height="28" fill="#8fa458" />
          <Birch x={14} w={7} top={6} base={66} />
          <Birch x={40} w={9} top={0} base={68} />
          <Birch x={74} w={6} top={14} base={64} />
          <Birch x={104} w={10} top={0} base={69} />
          <Birch x={136} w={7} top={8} base={66} />
          <path
            d="M0 0H160V14C150 22 136 16 126 22 112 12 98 20 86 14 72 24 60 12 46 18 32 10 18 20 0 14Z"
            fill="#c2cf6b"
          />
          <path d="M0 8C14 14 26 6 40 12S70 4 84 10 118 6 130 12 150 4 160 8V0H0Z" fill="#9fb84e" />
          <circle cx="60" cy="24" r="1.2" fill="#c2cf6b" />
          <circle cx="122" cy="26" r="1.4" fill="#c2cf6b" />
        </g>
      );
    case 'brick':
      return (
        <g>
          <rect width="160" height="90" fill="#ece0c8" />
          <path d="M70 62 80 30 96 22 128 18 160 22V62Z" fill="#b5603a" />
          <path
            d="M77 40C96 36 128 32 160 34V40C128 38 98 42 75 46ZM73 52C100 48 130 46 160 48V54C130 52 100 54 72 58Z"
            fill="#d18755"
          />
          <path d="M80 30 96 22 128 18 160 22V26C130 22 104 24 86 32Z" fill="#8e9a5a" />
          <path d="M0 46C20 42 44 46 62 44 76 43 84 50 92 56 100 62 120 62 160 60V66H0Z" fill="#7fa9bd" />
          <path
            d="M10 50H26M40 49H52M100 61H116"
            stroke="#d6ebf1"
            stroke-width="1.2"
            stroke-linecap="round"
          />
          <rect y="64" width="160" height="26" fill="#cfae7e" />
          <path d="M0 40C14 36 30 38 50 36L56 46C40 44 20 46 0 48Z" fill="#b8c28a" />
        </g>
      );
    case 'stone': {
      const rock = { stroke: '#4e4a45', 'stroke-width': 1, 'stroke-linejoin': 'round' as const };
      return (
        <g>
          <rect width="160" height="90" fill="#d9e1e2" />
          <path d="M96 40C110 30 130 34 160 28V64H96Z" fill="#b9bfae" />
          <path d="M0 0H70L78 16 66 30 74 46 60 64H0Z" fill="#8f8a83" />
          <path d="M0 0H70L78 16 66 30 50 22 40 4Z" fill="#a39e95" />
          <path
            d="M22 0 30 20 18 36M48 8 40 26 52 44M8 44 26 50M40 4 50 22"
            fill="none"
            stroke="#6a655f"
            stroke-width="1.2"
          />
          <path d="M70 0 78 16 66 30 74 46" fill="none" stroke="#c4bfb6" stroke-width="2" />
          <rect y="62" width="160" height="28" fill="#b3ab9b" />
          <path d="M56 64 62 50 76 44 88 52 90 64Z" fill="#9b968e" {...rock} />
          <path d="M62 50 76 44 80 52 68 56Z" fill="#c2bdb3" />
          <path d="M84 64 88 52 102 48 112 56 110 64Z" fill="#8a857e" {...rock} />
          <path d="M106 64 112 54 124 54 128 64Z" fill="#a5a098" {...rock} />
          <path d="M70 64 74 58 82 58 84 64Z" fill="#7d7871" {...rock} />
          <path d="M84 36 90 30 98 33 97 40 88 41Z" fill="#a5a098" {...rock} />
          <path d="M106 26 111 23 116 25 115 30 109 31Z" fill="#9b968e" {...rock} />
          <path d="M120 44 124 41 128 43 127 47 122 47Z" fill="#9b968e" {...rock} />
          <path
            d="M80 30 77 25M102 22 99 18M114 38 118 36M92 46 96 44"
            stroke="#6a655f"
            stroke-width="1"
            stroke-linecap="round"
            stroke-dasharray="2 2"
          />
          <path d="M136 64 139 59 146 59 148 64ZM44 64 47 60 52 61 53 64Z" fill="#8a857e" />
        </g>
      );
    }
    case 'gold':
      return (
        <g>
          <rect width="160" height="90" fill="#f1ddb0" />
          <path d="M0 38C30 30 70 36 100 30S150 28 160 32V64H0Z" fill="#c8bd80" />
          <path d="M0 48C30 42 60 50 90 46S140 42 160 46V60C130 58 100 62 70 60S20 58 0 62Z" fill="#5f93a6" />
          <path d="M0 52C30 48 60 54 90 50S140 48 160 50" fill="none" stroke="#86b5c4" stroke-width="1.4" />
          {[
            [24, 54],
            [58, 51],
            [92, 53],
            [128, 50],
            [44, 57],
            [112, 56],
          ].map(([x, y]) => (
            <path
              key={`${x}`}
              d={`M${x} ${(y ?? 0) - 3}L${(x ?? 0) + 1.2} ${y}L${x} ${(y ?? 0) + 3}L${(x ?? 0) - 1.2} ${y}Z`}
              fill="#ffd36b"
            />
          ))}
          <rect y="62" width="160" height="28" fill="#c9b07a" />
          <path
            d="M8 46 10 26M12 46 16 30M140 44 142 22M145 44 148 28"
            stroke="#6c7b3a"
            stroke-width="1.4"
            stroke-linecap="round"
          />
          <ellipse cx="10" cy="25" rx="1.6" ry="4" fill="#8a5a33" />
          <ellipse cx="142" cy="21" rx="1.6" ry="4" fill="#8a5a33" />
          <Place x={68} y={52} size={18}>
            <AmberShape />
          </Place>
        </g>
      );
    case 'tools':
      return (
        <g>
          <rect width="160" height="90" fill="#e5d8bf" />
          <path d="M0 46C40 40 80 44 120 40S150 40 160 42V64H0Z" fill="#c8b48e" />
          <rect y="62" width="160" height="28" fill="#bba886" />
          <path
            d="M34 64C28 46 40 24 66 20 96 16 118 30 120 50L118 64Z"
            fill="#8a8076"
            stroke="#3e3730"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
          <path
            d="M44 34C52 26 66 22 80 23"
            fill="none"
            stroke="#b6ada1"
            stroke-width="2.4"
            stroke-linecap="round"
          />
          <path d="M96 30 104 40 100 52" fill="none" stroke="#6c635a" stroke-width="1.2" />
          <Place x={52} y={3} size={26} rotate={-72}>
            <AxeShape />
          </Place>
          <circle cx="92" cy="14" r="5.4" fill="#b9b2a4" stroke="#3e3730" stroke-width="1.1" />
          <path d="M89 12Q91 10 94 11" fill="none" stroke="#e1dbd0" stroke-width="1" stroke-linecap="round" />
          {[
            [128, 58, 0],
            [136, 60, 40],
            [22, 58, -20],
            [142, 54, 70],
            [14, 60, 10],
          ].map(([x, y, r]) => (
            <path
              key={`${x}`}
              d="M0 0 4-2 5 2Z"
              transform={`translate(${x} ${y}) rotate(${r})`}
              fill={FLINT}
            />
          ))}
        </g>
      );
    case 'hut':
      return (
        <g>
          <rect width="160" height="90" fill="#efc596" />
          <rect y="0" width="160" height="22" fill="#e6a77a" />
          <path d="M0 50C40 44 90 48 160 44V64H0Z" fill="#b28a5c" />
          <rect y="62" width="160" height="28" fill="#9c7a52" />
          <circle cx="118" cy="56" r="24" fill="#ffcf73" opacity=".35" />
          <path d="M70 6 76 16M86 6 80 16M78 4V16" stroke="#3a2516" stroke-width="2" stroke-linecap="round" />
          <path
            d="M44 64 78 14 112 64Z"
            fill="#b6875a"
            stroke="#3a2516"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
          <path d="M78 14 66 64M78 14 90 64M78 14 102 64" stroke="#8c6038" stroke-width="1.1" />
          <path
            d="M57 46 61 44M60 38 64 37M95 44 99 46M92 36 96 38"
            stroke="#efd6b0"
            stroke-width="1"
            stroke-linecap="round"
          />
          <path d="M78 14 112 64H96Z" fill="#3a2516" opacity=".18" />
          <path d="M68 64Q78 42 88 64Z" fill="#2a1a12" />
          <path d="M110 64 126 58M112 58 126 64" stroke="#5b3a24" stroke-width="2.6" stroke-linecap="round" />
          <path d="M118 60C110 54 114 46 117 40 118 46 122 46 121 40 126 46 127 54 118 60Z" fill="#ee7a2a" />
          <path d="M118 60C114 56 116 50 118 47 119 51 122 52 121 48 124 52 123 57 118 60Z" fill="#ffd35a" />
          <circle cx="122" cy="34" r=".9" fill="#ffd35a" />
          <circle cx="114" cy="30" r=".8" fill="#ffd35a" />
        </g>
      );
    default:
      return (
        <g>
          <rect width="160" height="90" fill="#e6eacf" />
          <circle cx="128" cy="18" r="9" fill="#f6d27a" />
          <path d="M0 34C40 28 100 32 160 28V64H0Z" fill="#9d7650" />
          <path
            d="M80 30 0 44M80 30 0 54M80 30 10 64M80 30 40 64M80 30 80 64M80 30 120 64M80 30 150 64M80 30 160 54M80 30 160 44"
            stroke="#7a5534"
            stroke-width="1.6"
          />
          {[
            [24, 47, 4],
            [52, 49, 4.6],
            [80, 50, 5],
            [108, 49, 4.6],
            [136, 47, 4],
            [46, 39, 3],
            [66, 40, 3.2],
            [94, 40, 3.2],
            [114, 39, 3],
          ].map(([x, y, s]) => (
            <g key={`${x},${y}`} transform={`translate(${x} ${y}) scale(${(s ?? 3) / 4})`}>
              <path d="M0 4V-2" stroke="#3d5a29" stroke-width="1.2" stroke-linecap="round" />
              <path
                d="M0 0C-3.4 0-5 -2.2-4.6-4.6-2-4.6 0-3 0 0ZM0-1.6C3.2-1.6 4.8-4 4.4-6.2 1.8-6.2 0-4.4 0-1.6Z"
                fill="#79a64b"
              />
            </g>
          ))}
          <rect y="62" width="160" height="28" fill="#8d6a45" />
          <path d="M0 70H160M0 80H160" stroke="#83613f" stroke-width="1.2" />
        </g>
      );
  }
}

export function SpotArt(props: { spot: string; width?: number; height?: number }) {
  return (
    <svg
      class="ss-spot-art"
      width={props.width ?? 160}
      height={props.height ?? 90}
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <SpotScene spot={props.spot} />
    </svg>
  );
}

/* ---------------------------------------------------------------- cover */

const STARS: readonly (readonly [number, number, number])[] = [
  [140, 30, 1.2],
  [176, 62, 0.9],
  [214, 22, 1.4],
  [252, 74, 0.8],
  [298, 40, 1.1],
  [330, 18, 0.9],
  [362, 66, 1.3],
  [402, 34, 1],
  [446, 70, 0.9],
  [470, 24, 1.2],
  [36, 40, 1.1],
  [84, 18, 0.9],
  [96, 76, 1],
  [560, 98, 1],
  [588, 30, 0.9],
  [520, 120, 0.8],
  [128, 110, 0.8],
  [306, 104, 0.9],
];

export function SticksCover(props: { thumb?: boolean }) {
  return (
    <svg
      class="game-cover ss-cover"
      viewBox="0 0 600 360"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Sticks & Stones artwork: a clan's camp at dusk, a hide hut and a fire, a stone dolmen on the hill, birch logs, clay, stone and amber, and three bone dice"
    >
      <defs>
        <linearGradient id="ss-cover-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2b2847" />
          <stop offset=".34" stop-color="#5d4466" />
          <stop offset=".56" stop-color="#b9604f" />
          <stop offset=".7" stop-color="#ec9a58" />
          <stop offset=".82" stop-color="#f7c57a" />
        </linearGradient>
        <radialGradient id="ss-cover-sun" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fff2c4" stop-opacity=".95" />
          <stop offset=".3" stop-color="#ffd27e" stop-opacity=".6" />
          <stop offset="1" stop-color="#f29a54" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="ss-cover-fire" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#ffd27a" stop-opacity=".85" />
          <stop offset=".45" stop-color="#f08a3a" stop-opacity=".35" />
          <stop offset="1" stop-color="#f08a3a" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="ss-cover-vignette" cx=".5" cy=".5" r=".72">
          <stop offset=".6" stop-color="#140c08" stop-opacity="0" />
          <stop offset="1" stop-color="#140c08" stop-opacity=".5" />
        </radialGradient>
      </defs>
      <rect width="600" height="360" fill="url(#ss-cover-sky)" />
      <g fill="#fbf1d8">
        {STARS.map(([x, y, r]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r={r} opacity={0.5 + r / 3} />
        ))}
      </g>
      <path d="M548 40A18 18 0 1 0 566 66 14 14 0 1 1 548 40Z" fill="#f6e7bf" />
      <path d="M176 50A22 22 0 1 0 198 78 17 17 0 1 1 176 50Z" fill="#f6e7bf" />
      <g fill="none" stroke="#1d1520" stroke-width="2" stroke-linecap="round" opacity=".7">
        <path d="M402 122 408 126 414 121M422 134 427 137 432 133M386 140 390 143 395 139" />
      </g>
      <circle cx="414" cy="212" r="130" fill="url(#ss-cover-sun)" />
      <circle cx="414" cy="212" r="30" fill="#ffe2a0" />
      {/* Far hills, then the dolmen's hill, then the camp's ground. */}
      <path
        d="M0 226C60 204 112 214 160 220 228 190 300 204 352 216 420 198 482 194 540 212 568 220 588 216 600 212V360H0Z"
        fill="#8a5a6c"
      />
      <path
        d="M0 262C40 248 92 232 140 200 170 180 198 168 228 168 262 168 292 188 322 220 362 248 420 252 470 246 520 240 566 246 600 252V360H0Z"
        fill="#4d3346"
      />
      <path
        d="M140 200C170 180 198 168 228 168 262 168 292 188 322 220"
        fill="none"
        stroke="#e79a66"
        stroke-width="2"
        opacity=".55"
      />
      {/* The dolmen, against the afterglow. */}
      <g fill="#2c2030" stroke="#1d1520" stroke-width="1.5" stroke-linejoin="round">
        <path d="M200 172V146H213V172ZM238 172V144H251V172Z" />
        <path d="M190 148 196 134 254 130 266 140 256 150 198 152Z" />
      </g>
      <path
        d="M196 134 254 130 266 140"
        fill="none"
        stroke="#f3b27a"
        stroke-width="2"
        stroke-linecap="round"
      />
      <g transform="translate(262 140) scale(1.15)">
        <CavePerson fill={CLAN_COLORS[2]?.fill ?? '#6a8f3c'} pose="raise" outline="#1d1520" />
      </g>
      <path d="M0 292C120 272 240 262 330 266 430 270 520 280 600 276V360H0Z" fill="#6e4a2e" />
      <circle cx="300" cy="282" r="130" fill="url(#ss-cover-fire)" />
      {/* The hide hut. */}
      <g stroke-linejoin="round">
        <path
          d="M378 186 389 206M396 184 385 206M388 180V204"
          stroke="#2a1a10"
          stroke-width="3.4"
          stroke-linecap="round"
        />
        <path d="M336 284 387 198 438 284Z" fill="#b8814e" stroke="#2a1a10" stroke-width="2.2" />
        <path d="M387 198 360 284M387 198 414 284" stroke="#7d5230" stroke-width="1.6" />
        <path
          d="M352 256 357 252M365 236 370 233M406 236 411 239M416 256 421 259M377 216 381 214M396 214 400 216"
          stroke="#efd1a4"
          stroke-width="1.4"
          stroke-linecap="round"
        />
        <path d="M387 198 438 284H408Z" fill="#2a1a10" opacity=".28" />
        <path d="M387 198 336 284" fill="none" stroke="#ffc27a" stroke-width="2" opacity=".55" />
        <path d="M372 284Q387 246 402 284Z" fill="#24150d" />
      </g>
      <path d="M0 330C150 316 450 316 600 330V360H0Z" fill="#4a3120" />
      <path
        d="M60 300 63 288 66 300M68 300 72 291 73 300M520 296 523 284 526 296M529 296 533 287 534 296M470 288 473 278 475 288"
        fill="none"
        stroke="#3a2a18"
        stroke-width="2"
        stroke-linecap="round"
      />
      <g fill="#5a3c24">
        <ellipse cx="96" cy="320" rx="6" ry="3" />
        <ellipse cx="504" cy="318" rx="7" ry="3" />
        <ellipse cx="560" cy="300" rx="5" ry="2.4" />
      </g>
      {/* The fire. */}
      <g stroke-linecap="round">
        <path d="M276 292 322 278M280 278 322 292" stroke="#4a2c18" stroke-width="7" />
        <path d="M276 292 322 278M280 278 322 292" stroke="#7a4c2a" stroke-width="4" />
      </g>
      <path
        d="M299 286C278 272 286 252 293 238 295 252 302 252 300 236 310 246 318 258 312 270 316 266 318 262 318 258 324 270 318 284 299 286Z"
        fill="#ec6f28"
      />
      <path
        d="M300 286C290 278 292 266 297 258 298 266 303 266 302 256 310 264 312 278 300 286Z"
        fill="#ffc94f"
      />
      <path d="M300 286C297 282 297 276 300 271 302 275 304 280 300 286Z" fill="#fff1b8" />
      <g fill="#ffd36b">
        <circle cx="308" cy="226" r="1.6" />
        <circle cx="290" cy="216" r="1.2" />
        <circle cx="316" cy="206" r="1" />
        <circle cx="298" cy="198" r=".9" />
      </g>
      {/* The clan around the fire. */}
      <g transform="translate(212 230) scale(2.5)">
        <CavePerson fill={CLAN_COLORS[0]?.fill ?? '#c0502f'} pose="raise" />
      </g>
      <g transform="translate(150 246) scale(2.1)">
        <CavePerson fill={CLAN_COLORS[3]?.fill ?? '#ece3cc'} pose="reach" />
      </g>
      <g transform="translate(332 238) scale(2.3) translate(24 0) scale(-1 1)">
        <CavePerson fill={CLAN_COLORS[1]?.fill ?? '#4a78b8'} pose="raise" />
      </g>
      {/* Goods: a stack of birch logs, clay, stone and amber. */}
      <Place x={130} y={302} size={56} rotate={8}>
        <WoodShape />
      </Place>
      <Place x={150} y={290} size={56} rotate={4}>
        <WoodShape />
      </Place>
      <Place x={160} y={314} size={50} rotate={-6}>
        <WoodShape />
      </Place>
      <Place x={208} y={300} size={48}>
        <ClayShape />
      </Place>
      <Place x={222} y={322} size={40} rotate={-8}>
        <ClayShape />
      </Place>
      <Place x={378} y={302} size={46}>
        <StoneShape />
      </Place>
      <Place x={408} y={320} size={34} rotate={30}>
        <StoneShape />
      </Place>
      <Place x={420} y={286} size={44}>
        <AmberShape />
      </Place>
      <Place x={448} y={316} size={28} rotate={40}>
        <AmberShape />
      </Place>
      {/* Three bone dice. */}
      <g opacity=".35" fill="#140c08">
        <ellipse cx="282" cy="346" rx="22" ry="6" />
        <ellipse cx="326" cy="350" rx="20" ry="5" />
        <ellipse cx="362" cy="340" rx="17" ry="5" />
      </g>
      <Place x={262} y={308} size={38} rotate={-14}>
        <DieShape value={5} />
      </Place>
      <Place x={306} y={316} size={36} rotate={10}>
        <DieShape value={3} />
      </Place>
      <Place x={344} y={304} size={32} rotate={26}>
        <DieShape value={6} />
      </Place>
      <rect width="600" height="360" fill="url(#ss-cover-vignette)" />
      {!props.thumb && (
        <g>
          <path
            d="M106 26 142 12 300 6 458 12 494 28 488 74 456 92 300 98 144 92 112 76Z"
            fill="#1d1520"
            opacity=".4"
            transform="translate(4 5)"
          />
          <path
            d="M106 26 142 12 300 6 458 12 494 28 488 74 456 92 300 98 144 92 112 76Z"
            fill="#9d9485"
            stroke="#2a2117"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <path
            d="M112 30 144 17 300 11 456 17 488 31"
            fill="none"
            stroke="#d9d2c2"
            stroke-width="3"
            stroke-linecap="round"
          />
          <path
            d="M118 76 146 88 300 93 454 88 482 72"
            fill="none"
            stroke="#6f6758"
            stroke-width="3"
            stroke-linecap="round"
          />
          <path
            d="M130 40 138 46M462 44 470 38M150 80 160 82M444 80 452 77"
            stroke="#7a7264"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <text
            x="300"
            y="68.5"
            text-anchor="middle"
            font-family={TITLE_FONT}
            font-weight="700"
            font-size="44"
            textLength="340"
            lengthAdjust="spacingAndGlyphs"
            fill="#e6dfd0"
          >
            {STICKS_THEME.title}
          </text>
          <text
            x="300"
            y="67"
            text-anchor="middle"
            font-family={TITLE_FONT}
            font-weight="700"
            font-size="44"
            textLength="340"
            lengthAdjust="spacingAndGlyphs"
            fill="#2e2620"
          >
            {STICKS_THEME.title}
          </text>
          <text
            x="300"
            y="124"
            text-anchor="middle"
            font-family={SERIF}
            font-style="italic"
            font-size="15"
            fill="#fbefd6"
            stroke="#2b2847"
            stroke-width="3.2"
            stroke-linejoin="round"
            paint-order="stroke"
          >
            {STICKS_THEME.tagline}
          </text>
        </g>
      )}
    </svg>
  );
}
