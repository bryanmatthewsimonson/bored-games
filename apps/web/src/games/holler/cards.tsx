/*
 * Inline SVG for Holler. Paper and ink come from the theme. A suited card, including Halt, Swing, and Pull,
 * draws its pattern three times in the left column. Each copy is at least 44 viewBox units tall. Mark and Levy
 * use an ink frame and no suit hue. Seed dots in that column have radius 9.
 */
import { faceOf } from '@bored-games/holler';
import type { HollerTheme, PatternId } from './model.ts';

const COLUMN_X = 16;
const COLUMN_W = 36;
const COLUMN_H = 48;
const COLUMN_Y = [80, 148, 216] as const;
const SEED_COLUMN_R = 9;

const HALT_START = {
  x: Math.sin((40 * Math.PI) / 180),
  y: -Math.cos((40 * Math.PI) / 180),
};
const HALT_END = {
  x: Math.sin((320 * Math.PI) / 180),
  y: -Math.cos((320 * Math.PI) / 180),
};

function Chevron(props: { x: number; y: number; w: number; h: number; fill: string; opacity?: number }) {
  const cx = props.x + props.w / 2;
  const inset = props.w * 0.22;
  const notch = props.h * 0.38;
  const d = `M ${props.x} ${props.y + props.h} L ${cx} ${props.y} L ${props.x + props.w} ${props.y + props.h} L ${props.x + props.w - inset} ${props.y + props.h} L ${cx} ${props.y + notch} L ${props.x + inset} ${props.y + props.h} Z`;
  return <path d={d} fill={props.fill} opacity={props.opacity} />;
}

function Waves(props: { x: number; y: number; w: number; h: number; stroke: string; opacity?: number }) {
  const mid1 = props.y + props.h * 0.22;
  const mid2 = props.y + props.h * 0.78;
  const amp = props.h * 0.2;
  const x0 = props.x + props.w * 0.08;
  const x1 = props.x + props.w * 0.92;
  const c1 = props.x + props.w * 0.35;
  const c2 = props.x + props.w * 0.65;
  const d1 = `M ${x0} ${mid1} C ${c1} ${mid1 - amp} ${c2} ${mid1 + amp} ${x1} ${mid1}`;
  const d2 = `M ${x0} ${mid2} C ${c1} ${mid2 - amp} ${c2} ${mid2 + amp} ${x1} ${mid2}`;
  return (
    <path
      d={`${d1} ${d2}`}
      fill="none"
      stroke={props.stroke}
      stroke-width={Math.max(2, props.h * 0.08)}
      stroke-linecap="round"
      opacity={props.opacity}
    />
  );
}

function Seeds(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  column: boolean;
  opacity?: number;
}) {
  const r = props.column ? SEED_COLUMN_R : Math.max(1.5, Math.min(props.w, props.h) * 0.18);
  const dots = [
    { cx: props.x + props.w / 2, cy: props.y + r },
    { cx: props.x + r, cy: props.y + props.h - r },
    { cx: props.x + props.w - r, cy: props.y + props.h - r },
  ];
  return (
    <g opacity={props.opacity}>
      {dots.map((dot) => (
        <circle key={`${dot.cx}:${dot.cy}`} cx={dot.cx} cy={dot.cy} r={r} fill={props.fill} />
      ))}
    </g>
  );
}

function Diamond(props: { x: number; y: number; w: number; h: number; stroke: string; opacity?: number }) {
  const cx = props.x + props.w / 2;
  const d = `M ${cx} ${props.y} L ${props.x + props.w} ${props.y + props.h / 2} L ${cx} ${props.y + props.h} L ${props.x} ${props.y + props.h / 2} Z`;
  return (
    <path
      d={d}
      fill="none"
      stroke={props.stroke}
      stroke-width={Math.max(2, Math.min(props.w, props.h) * 0.1)}
      opacity={props.opacity}
    />
  );
}

function paint(opacity: number | undefined): { readonly opacity: number } | undefined {
  return opacity === undefined ? undefined : { opacity };
}

function SuitShape(props: {
  pattern: PatternId;
  hue: string;
  x: number;
  y: number;
  w: number;
  h: number;
  column: boolean;
  opacity?: number;
}) {
  const fade = paint(props.opacity);
  if (props.pattern === 'chevron') {
    return <Chevron x={props.x} y={props.y} w={props.w} h={props.h} fill={props.hue} {...fade} />;
  }
  if (props.pattern === 'wave') {
    return <Waves x={props.x} y={props.y} w={props.w} h={props.h} stroke={props.hue} {...fade} />;
  }
  if (props.pattern === 'seed') {
    return (
      <Seeds
        x={props.x}
        y={props.y}
        w={props.w}
        h={props.h}
        fill={props.hue}
        column={props.column}
        {...fade}
      />
    );
  }
  return <Diamond x={props.x} y={props.y} w={props.w} h={props.h} stroke={props.hue} {...fade} />;
}

function LeftColumn(props: { theme: HollerTheme; suit: number }) {
  const look = props.theme.suits[props.suit];
  if (look === undefined) return null;
  return (
    <g>
      {COLUMN_Y.map((y) => (
        <g key={y} class="holler-column" data-copy-h={COLUMN_H}>
          <SuitShape
            pattern={look.pattern}
            hue={look.hue}
            x={COLUMN_X}
            y={y}
            w={COLUMN_W}
            h={COLUMN_H}
            column
          />
        </g>
      ))}
    </g>
  );
}

function HaltGlyph(props: { cx: number; cy: number; r: number; ink: string }) {
  const sw = 8 * (props.r / 36);
  const start = { x: props.cx + props.r * HALT_START.x, y: props.cy + props.r * HALT_START.y };
  const end = { x: props.cx + props.r * HALT_END.x, y: props.cy + props.r * HALT_END.y };
  const arc = `M ${start.x} ${start.y} A ${props.r} ${props.r} 0 1 1 ${end.x} ${end.y}`;
  return (
    <g fill="none" stroke={props.ink} stroke-width={sw} stroke-linecap="round">
      <path d={arc} />
      <path d={`M ${props.cx} ${props.cy - props.r * 0.25} L ${props.cx} ${props.cy - props.r * 1.2}`} />
    </g>
  );
}

function SwingGlyph(props: { cx: number; cy: number; scale: number; ink: string }) {
  const p = (x: number, y: number) => `${props.cx + x * props.scale} ${props.cy + y * props.scale}`;
  const d = `M ${p(-40, -8)} L ${p(28, -8)} Q ${p(46, -8)} ${p(46, 10)} Q ${p(46, 26)} ${p(24, 26)} L ${p(-18, 26)}`;
  const head = `M ${p(-18, 26)} L ${p(-4, 18)} M ${p(-18, 26)} L ${p(-4, 34)}`;
  return (
    <path
      d={`${d} ${head}`}
      fill="none"
      stroke={props.ink}
      stroke-width={6 * props.scale}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  );
}

function PullGlyph(props: { cx: number; cy: number; scale: number; ink: string; paper: string }) {
  const w = 56 * props.scale;
  const h = 72 * props.scale;
  const x = props.cx - w / 2;
  const y = props.cy - h / 2 - 6 * props.scale;
  const off = 8 * props.scale;
  return (
    <g>
      <rect
        x={x + off}
        y={y + off}
        width={w}
        height={h}
        rx={10 * props.scale}
        fill="none"
        stroke={props.ink}
        stroke-width={6 * props.scale}
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10 * props.scale}
        fill={props.paper}
        stroke={props.ink}
        stroke-width={6 * props.scale}
      />
      <text
        x={props.cx + off / 2}
        y={props.cy + off / 2}
        text-anchor="middle"
        dominant-baseline="central"
        font-size={64 * props.scale}
        fill={props.ink}
      >
        2
      </text>
    </g>
  );
}

function MarkCluster(props: {
  theme: HollerTheme;
  cx: number;
  cy: number;
  cell: number;
  opacity?: number;
  ink?: string;
}) {
  const gap = Math.max(4, props.cell * 0.28);
  const total = props.cell * 2 + gap;
  const x0 = props.cx - total / 2;
  const y0 = props.cy - total / 2;
  return (
    <g opacity={props.opacity}>
      {props.theme.suits.map((suit, i) => (
        <SuitShape
          key={suit.id}
          pattern={suit.pattern}
          hue={props.ink ?? suit.hue}
          x={x0 + (i % 2) * (props.cell + gap)}
          y={y0 + Math.floor(i / 2) * (props.cell + gap)}
          w={props.cell}
          h={props.cell}
          column={false}
        />
      ))}
    </g>
  );
}

function LevyGlyph(props: { theme: HollerTheme; cx: number; cy: number; ink: string }) {
  const spots = [
    [props.cx - 62, props.cy - 70],
    [props.cx + 44, props.cy - 70],
    [props.cx - 62, props.cy + 46],
    [props.cx + 44, props.cy + 46],
  ];
  return (
    <g>
      {spots.map(([x, y], i) => {
        const suit = props.theme.suits[i];
        if (suit === undefined || x === undefined || y === undefined) return null;
        return (
          <SuitShape
            key={suit.id}
            pattern={suit.pattern}
            hue={suit.hue}
            x={x}
            y={y}
            w={18}
            h={18}
            column={false}
          />
        );
      })}
      <text
        x={props.cx}
        y={props.cy}
        text-anchor="middle"
        dominant-baseline="central"
        font-size="64"
        fill={props.ink}
      >
        4
      </text>
    </g>
  );
}

function CenterGlyph(props: { theme: HollerTheme; kind: 'halt' | 'swing' | 'pull' | 'mark' | 'levy' }) {
  const { ink, paper } = props.theme;
  if (props.kind === 'halt') return <HaltGlyph cx={125} cy={175} r={36} ink={ink} />;
  if (props.kind === 'swing') return <SwingGlyph cx={125} cy={175} scale={1} ink={ink} />;
  if (props.kind === 'pull') return <PullGlyph cx={125} cy={175} scale={1} ink={ink} paper={paper} />;
  if (props.kind === 'mark') return <MarkCluster theme={props.theme} cx={125} cy={175} cell={28} />;
  return <LevyGlyph theme={props.theme} cx={125} cy={175} ink={ink} />;
}

function CornerGlyph(props: {
  theme: HollerTheme;
  kind: 'halt' | 'swing' | 'pull' | 'mark' | 'levy';
  at: 'start' | 'end';
}) {
  const { ink, paper } = props.theme;
  const origin = props.at === 'start' ? 'translate(40 48)' : 'translate(210 302) rotate(180)';
  const scale = 'scale(0.5)';
  return (
    <g transform={`${origin} ${scale}`}>
      {props.kind === 'halt' && <HaltGlyph cx={0} cy={0} r={36} ink={ink} />}
      {props.kind === 'swing' && <SwingGlyph cx={0} cy={0} scale={1} ink={ink} />}
      {props.kind === 'pull' && <PullGlyph cx={0} cy={0} scale={1} ink={ink} paper={paper} />}
      {props.kind === 'mark' && <MarkCluster theme={props.theme} cx={0} cy={0} cell={28} />}
      {props.kind === 'levy' && <LevyGlyph theme={props.theme} cx={0} cy={0} ink={ink} />}
    </g>
  );
}

function CornerRank(props: { text: string; ink: string }) {
  return (
    <g fill={props.ink}>
      <text x="40" y="48" text-anchor="middle" dominant-baseline="central" font-size="36">
        {props.text}
      </text>
      <g transform="rotate(180 210 302)">
        <text x="210" y="302" text-anchor="middle" dominant-baseline="central" font-size="36">
          {props.text}
        </text>
      </g>
    </g>
  );
}

/** One face, 250×350. Suited cards carry `data-suit` and `data-pattern`. Mark and Levy do not. */
export function CardFace(props: { theme: HollerTheme; card: number }) {
  const face = faceOf(props.card);
  const look = face.suit === null ? undefined : props.theme.suits[face.suit];
  const stroke = look?.hue ?? props.theme.ink;
  const suited =
    face.kind === 'number' || face.kind === 'halt' || face.kind === 'swing' || face.kind === 'pull';
  return (
    <svg
      class="holler-face"
      viewBox="0 0 250 350"
      data-kind={face.kind}
      aria-hidden="true"
      {...(look === undefined ? {} : { 'data-suit': look.id, 'data-pattern': look.pattern })}
    >
      <rect
        x="8"
        y="8"
        width="234"
        height="334"
        rx="18"
        fill={props.theme.paper}
        stroke={stroke}
        stroke-width="8"
      />
      {suited && face.suit !== null && <LeftColumn theme={props.theme} suit={face.suit} />}
      {face.kind === 'number' ? (
        <>
          <CornerRank text={String(face.rank)} ink={props.theme.ink} />
          <text
            x="125"
            y="175"
            text-anchor="middle"
            dominant-baseline="central"
            font-size="64"
            fill={props.theme.ink}
          >
            {face.rank}
          </text>
        </>
      ) : (
        <>
          <CenterGlyph theme={props.theme} kind={face.kind} />
          <CornerGlyph theme={props.theme} kind={face.kind} at="start" />
          <CornerGlyph theme={props.theme} kind={face.kind} at="end" />
        </>
      )}
    </svg>
  );
}

/** The card back: ink fill, accent inset stroke, and the four suit marks at 40% opacity. */
export function CardBack(props: { theme: HollerTheme }) {
  return (
    <svg class="holler-face holler-back" viewBox="0 0 250 350" aria-hidden="true">
      <rect
        x="8"
        y="8"
        width="234"
        height="334"
        rx="18"
        fill={props.theme.ink}
        stroke="var(--accent)"
        stroke-width="6"
      />
      <MarkCluster theme={props.theme} cx={125} cy={175} cell={40} opacity={0.4} ink={props.theme.paper} />
    </svg>
  );
}

/** One suit mark, the same size as a left-column copy. */
export function SuitMark(props: { theme: HollerTheme; suit: 0 | 1 | 2 | 3 }) {
  const look = props.theme.suits[props.suit];
  if (look === undefined) return null;
  return <SuitShape pattern={look.pattern} hue={look.hue} x={0} y={0} w={36} h={48} column />;
}

/** The active suit: the same pattern as a card of that suit, named "Tide, waves". */
export function ActiveSuit(props: { theme: HollerTheme; suit: 0 | 1 | 2 | 3; label: string }) {
  const look = props.theme.suits[props.suit];
  if (look === undefined) return null;
  return (
    <div
      class="holler-active"
      role="img"
      aria-label={props.label}
      data-testid="holler-active-suit"
      data-suit={look.id}
      data-pattern={look.pattern}
    >
      <svg class="holler-active-mark" viewBox="0 0 36 48" aria-hidden="true">
        <SuitShape pattern={look.pattern} hue={look.hue} x={0} y={0} w={36} h={48} column />
      </svg>
      <span>{props.label}</span>
    </div>
  );
}

/** A small suit mark for the discard badge. It repeats the active suit's pattern. */
export function SuitBadge(props: { theme: HollerTheme; suit: 0 | 1 | 2 | 3 }) {
  const look = props.theme.suits[props.suit];
  if (look === undefined) return null;
  return (
    <span class="holler-badge" data-suit={look.id} data-pattern={look.pattern} aria-hidden="true">
      <svg viewBox="0 0 36 48" aria-hidden="true">
        <SuitShape pattern={look.pattern} hue={look.hue} x={0} y={0} w={36} h={48} column />
      </svg>
    </span>
  );
}
