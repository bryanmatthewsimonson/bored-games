/*
 * Holler's cards, inline SVG (D083). A colored card is its color edge to edge, with a white shout burst in the
 * middle holding the number or the action, and the index in two corners. Mark and Levy are ink cards with a
 * four-color wheel. All art is original: the burst, the action marks and the back are drawn for Holler.
 * `CardArt` is one 250 × 350 face as an SVG group, so other art (the cover) can place cards too.
 */
import { faceOf } from '@bored-games/holler';
import type { HollerTheme, SuitIndex } from './model.ts';

const W = 250;
const H = 350;
const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

type Kind = 'number' | 'halt' | 'swing' | 'pull' | 'mark' | 'levy';

/** A jagged shout burst of `points` spikes round (0, 0). */
function burstPath(r: number, inner: number, points: number): string {
  const steps = points * 2;
  const at = (i: number) => {
    const a = (Math.PI * i) / points - Math.PI / 2;
    const rr = i % 2 === 0 ? r : inner;
    return `${(Math.cos(a) * rr).toFixed(1)} ${(Math.sin(a) * rr).toFixed(1)}`;
  };
  return `M${Array.from({ length: steps }, (_, i) => at(i)).join('L')}Z`;
}

const BURST = burstPath(104, 86, 13);

/** Text with an ink outline behind the fill, so white and colored numbers read on any color. */
function Outlined(props: {
  x: number;
  y: number;
  size: number;
  fill: string;
  ink: string;
  stroke: number;
  children: string;
}) {
  return (
    <text
      x={props.x}
      y={props.y}
      text-anchor="middle"
      dominant-baseline="central"
      font-family={FONT}
      font-size={props.size}
      font-weight="800"
      fill={props.fill}
      stroke={props.ink}
      stroke-width={props.stroke}
      stroke-linejoin="round"
      paint-order="stroke"
    >
      {props.children}
    </text>
  );
}

/** A 6 and a 9 are underlined, so a card held upside down still reads. */
function NumberMark(props: { rank: number; x: number; y: number; size: number; fill: string; ink: string }) {
  const text = String(props.rank);
  const under = props.rank === 6 || props.rank === 9;
  const w = props.size * 0.42;
  return (
    <g>
      <Outlined
        x={props.x}
        y={props.y}
        size={props.size}
        fill={props.fill}
        ink={props.ink}
        stroke={props.size / 10}
      >
        {text}
      </Outlined>
      {under && (
        <rect
          x={props.x - w / 2}
          y={props.y + props.size * 0.46}
          width={w}
          height={props.size * 0.08}
          rx={props.size * 0.04}
          fill={props.fill}
          stroke={props.ink}
          stroke-width={props.size / 30}
        />
      )}
    </g>
  );
}

/** Halt: a no-entry sign. */
function HaltMark(props: { color: string; ink: string; s: number }) {
  return (
    <g transform={`scale(${props.s})`}>
      <circle r="46" fill={props.color} stroke={props.ink} stroke-width="5" />
      <rect
        x="-30"
        y="-10"
        width="60"
        height="20"
        rx="4"
        fill="#ffffff"
        stroke={props.ink}
        stroke-width="4"
      />
    </g>
  );
}

/** Swing: two arrows chasing each other round. */
function SwingMark(props: { color: string; ink: string; s: number }) {
  const arc = 'M-34 -14A38 38 0 0 1 26 -30';
  const head = 'M14 -46 36 -30 12 -14Z';
  const arrow = (rot: number) => (
    <g transform={`rotate(${rot})`}>
      <path d={arc} fill="none" stroke={props.ink} stroke-width="22" stroke-linecap="round" />
      <path d={head} fill={props.ink} stroke={props.ink} stroke-width="8" stroke-linejoin="round" />
      <path d={arc} fill="none" stroke={props.color} stroke-width="12" stroke-linecap="round" />
      <path d={head} fill={props.color} />
    </g>
  );
  return (
    <g transform={`scale(${props.s})`}>
      {arrow(0)}
      {arrow(180)}
    </g>
  );
}

/** Pull: two cards, one on the other, and the 2 they make you draw. */
function PullMark(props: { color: string; ink: string; s: number }) {
  const card = (x: number, y: number, rot: number) => (
    <rect
      x={x}
      y={y}
      width="44"
      height="62"
      rx="7"
      transform={`rotate(${rot})`}
      fill={props.color}
      stroke={props.ink}
      stroke-width="5"
    />
  );
  return (
    <g transform={`scale(${props.s})`}>
      {card(-44, -36, -12)}
      {card(-6, -30, 8)}
      <Outlined x={16} y={2} size={40} fill="#ffffff" ink={props.ink} stroke={6}>
        2
      </Outlined>
    </g>
  );
}

/** The four colors as a wheel: what a Mark or a Levy may name. */
function Wheel(props: { theme: HollerTheme; r: number }) {
  const { r } = props;
  const quarters = [
    'M0 0V-R A R R 0 0 1 R 0Z',
    'M0 0H R A R R 0 0 1 0 R Z',
    'M0 0V R A R R 0 0 1 -R 0Z',
    'M0 0H-R A R R 0 0 1 0 -R Z',
  ];
  return (
    <g transform="rotate(-20)">
      {props.theme.colors.map((color, i) => (
        <path key={color.id} d={(quarters[i] ?? '').replaceAll('R', String(r))} fill={color.hue} />
      ))}
      <circle r={r} fill="none" stroke={props.theme.ink} stroke-width={r / 12} />
    </g>
  );
}

/** Levy: the four colors fanned as cards, and the 4 it makes you draw. */
function LevyMark(props: { theme: HollerTheme; s: number }) {
  return (
    <g transform={`scale(${props.s})`}>
      {props.theme.colors.map((color, i) => (
        <rect
          key={color.id}
          x="-20"
          y="-58"
          width="40"
          height="58"
          rx="6"
          transform={`rotate(${-39 + i * 26}) translate(0 10)`}
          fill={color.hue}
          stroke={props.theme.ink}
          stroke-width="4"
        />
      ))}
      <Outlined x={0} y={20} size={58} fill="#ffffff" ink={props.theme.ink} stroke={8}>
        4
      </Outlined>
    </g>
  );
}

/** The big mark in the burst, or the small one in a corner (`corner`: white, on the card's color). */
function Mark(props: { theme: HollerTheme; kind: Kind; rank: number | null; hue: string; corner: boolean }) {
  const { theme, kind } = props;
  const ink = theme.ink;
  const color = props.corner ? '#ffffff' : props.hue;
  if (kind === 'number') {
    return props.corner ? (
      <NumberMark rank={props.rank ?? 0} x={0} y={0} size={46} fill="#ffffff" ink={ink} />
    ) : (
      <NumberMark rank={props.rank ?? 0} x={0} y={4} size={124} fill={props.hue} ink={ink} />
    );
  }
  if (kind === 'halt') return <HaltMark color={color} ink={ink} s={props.corner ? 0.4 : 1} />;
  if (kind === 'swing') return <SwingMark color={color} ink={ink} s={props.corner ? 0.42 : 1.05} />;
  if (kind === 'pull') return <PullMark color={color} ink={ink} s={props.corner ? 0.42 : 1.1} />;
  if (kind === 'mark') return <Wheel theme={theme} r={props.corner ? 19 : 58} />;
  return props.corner ? (
    <Outlined x={0} y={0} size={46} fill="#ffffff" ink={ink} stroke={5}>
      4
    </Outlined>
  ) : (
    <LevyMark theme={theme} s={1.05} />
  );
}

/** One card face as a 250 × 350 group. */
export function CardArt(props: { theme: HollerTheme; card: number }) {
  const { theme } = props;
  const face = faceOf(props.card);
  const look = face.suit === null ? undefined : theme.colors[face.suit];
  const body = look?.hue ?? theme.ink;
  const mark = (corner: boolean) => (
    <Mark theme={theme} kind={face.kind} rank={face.rank} hue={look?.hue ?? theme.ink} corner={corner} />
  );
  return (
    <g>
      <rect width={W} height={H} rx="22" fill={theme.paper} />
      <rect x="11" y="11" width={W - 22} height={H - 22} rx="15" fill={body} />
      <path d="M11 120 239 40V11H130Z" fill="#ffffff" opacity=".1" />
      <g transform="translate(125 176) rotate(-8)">
        <path
          d={BURST}
          fill={look === undefined ? theme.ink : theme.paper}
          stroke={theme.ink}
          stroke-width="5"
        />
        {look === undefined && (
          <path d={burstPath(92, 76, 13)} fill="none" stroke="#ffffff" stroke-width="3" />
        )}
      </g>
      <g transform="translate(125 178)">{mark(false)}</g>
      <g transform="translate(42 52)">{mark(true)}</g>
      <g transform={`translate(${W - 42} ${H - 52}) rotate(180)`}>{mark(true)}</g>
    </g>
  );
}

/** One face, 250×350. A colored card carries `data-suit` (its color id); Mark and Levy do not. */
export function CardFace(props: { theme: HollerTheme; card: number }) {
  const face = faceOf(props.card);
  const look = face.suit === null ? undefined : props.theme.colors[face.suit];
  return (
    <svg
      class="holler-face"
      viewBox={`0 0 ${W} ${H}`}
      data-kind={face.kind}
      aria-hidden="true"
      {...(look === undefined ? {} : { 'data-suit': look.id })}
    >
      <CardArt theme={props.theme} card={props.card} />
    </svg>
  );
}

/** The back as a 250 × 350 group: ink, a red burst and the game's name. */
export function BackArt(props: { theme: HollerTheme }) {
  const { theme } = props;
  const red = theme.colors[0].hue;
  return (
    <g>
      <rect width={W} height={H} rx="22" fill={theme.paper} />
      <rect x="11" y="11" width={W - 22} height={H - 22} rx="15" fill={theme.ink} />
      <g transform="translate(125 175) rotate(-14)">
        <path d={BURST} transform="scale(1.08)" fill={red} stroke="#ffffff" stroke-width="5" />
        <Outlined x={0} y={2} size={42} fill="#ffffff" ink={theme.ink} stroke={7}>
          {theme.title.toUpperCase()}
        </Outlined>
      </g>
      {theme.colors.map((color, i) => (
        <circle key={color.id} cx={89 + i * 24} cy="306" r="8" fill={color.hue} />
      ))}
      {theme.colors.map((color, i) => (
        <circle key={color.id} cx={161 - i * 24} cy="44" r="8" fill={color.hue} />
      ))}
    </g>
  );
}

export function CardBack(props: { theme: HollerTheme }) {
  return (
    <svg class="holler-face holler-back" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <BackArt theme={props.theme} />
    </svg>
  );
}

/** A round chip of one color, for buttons and the discard badge. */
export function ColorChip(props: { theme: HollerTheme; suit: SuitIndex }) {
  const look = props.theme.colors[props.suit];
  return (
    <svg class="holler-chip" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill={look.hue} stroke={props.theme.ink} stroke-width="3" />
      <circle cx="14" cy="13" r="5" fill="#ffffff" opacity=".35" />
    </svg>
  );
}

/** The color in play, as a chip and its name ("Blue"). */
export function ActiveSuit(props: { theme: HollerTheme; suit: SuitIndex; label: string }) {
  const look = props.theme.colors[props.suit];
  return (
    <div
      class="holler-active"
      role="img"
      aria-label={props.label}
      data-testid="holler-active-suit"
      data-suit={look.id}
      style={`--holler-hue:${look.hue}`}
    >
      <ColorChip theme={props.theme} suit={props.suit} />
      <span>{props.label}</span>
    </div>
  );
}

/** A small chip on the discard: the color in play, which a Mark or a Levy named. */
export function SuitBadge(props: { theme: HollerTheme; suit: SuitIndex }) {
  const look = props.theme.colors[props.suit];
  return (
    <span class="holler-badge" data-suit={look.id} aria-hidden="true">
      <ColorChip theme={props.theme} suit={props.suit} />
    </span>
  );
}
