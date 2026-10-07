/*
 * The board of the Aldermoor Assize Courts (D078), drawn from the engine's grid (board.ts) in square units: one SVG
 * unit per square, `viewBox="0 0 24 24"`. Corridor tiles; the nine rooms, tinted, named and marked with their scene
 * glyph; the doors as brass notches in the walls; the Rotunda; the numbered Entrances; the Old Gaol Passages; the
 * pawns, accent discs with a monogram (in a room they stand in a row inside it); the Exhibit tokens, small brass
 * squares. Each destination of the viewer's walk is a focusable button. Hook-free: the screen keeps the enlarge
 * toggle's state.
 */
import {
  BOARD_SIZE,
  CORRIDOR,
  DOORS,
  ENTRANCES,
  EXHIBITS,
  type ExhibitId,
  PARTIES,
  type Place,
  passageTo,
  type Rect,
  type RfdState,
  ROOM_RECTS,
  ROTUNDA,
  roomOf,
  SCENES,
  type SceneId,
  squareIndex,
} from '@bored-games/room-for-doubt';
import { EXHIBIT_GLYPHS, SCENE_GLYPHS } from '@bored-games/room-for-doubt/art';
import { ROOM_FOR_DOUBT_THEME as THEME } from '@bored-games/room-for-doubt/theme';
import { glyphUri } from './glyph-image.ts';
import {
  exhibitName,
  type MoveAction,
  moveLabel,
  ON_ACCENT,
  PALETTE,
  partyName,
  placeLabel,
  ROOM_TINT,
  sceneName,
  seatName,
} from './model.ts';

export interface BoardProps {
  readonly state: RfdState;
  /** The viewer's legal moves, each drawn as a target; empty when the viewer is not walking. */
  readonly targets: readonly MoveAction[];
  /** Takes a chosen target's move; undefined while the viewer may not act (the targets then show disabled). */
  readonly onMove: ((a: MoveAction) => void) | undefined;
  /** The enlarged board: `rfd-board-expanded`, at least 720 px wide inside its scrolling frame. */
  readonly expanded: boolean;
  /** Display name per seat, for the pawns' labels. */
  readonly names: readonly string[];
}

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "system-ui, 'Segoe UI', Arial, sans-serif";

const at = (i: number): { x: number; y: number } => ({ x: i % BOARD_SIZE, y: Math.floor(i / BOARD_SIZE) });
const wide = (r: Rect): number => r.x1 - r.x0 + 1;
const tall = (r: Rect): number => r.y1 - r.y0 + 1;
const centre = (r: Rect): { x: number; y: number } => ({ x: r.x0 + wide(r) / 2, y: r.y0 + tall(r) / 2 });
/** A number rounded to hundredths, so attributes stay short. */
const n2 = (v: number): number => Math.round(v * 100) / 100;

/** Every corridor square as one path of unit tiles. */
const TILES = [...CORRIDOR]
  .sort((a, b) => a - b)
  .map((i) => {
    const { x, y } = at(i);
    return `M${x} ${y}h1v1h-1z`;
  })
  .join('');

/** A door as a brass notch across the wall between its door square and its doorstep. */
const NOTCHES = DOORS.map((d) => {
  const a = at(d.door);
  const b = at(d.step);
  return a.x === b.x
    ? { key: d.door, x: a.x + 0.15, y: Math.max(a.y, b.y) - 0.12, w: 0.7, h: 0.24 }
    : { key: d.door, x: Math.max(a.x, b.x) - 0.12, y: a.y + 0.15, w: 0.24, h: 0.7 };
});

/** The two passages, each once: the corner rooms they join. */
const PASSAGES = SCENES.flatMap((room) => {
  const to = passageTo(room);
  return to !== null && SCENES.indexOf(room) < SCENES.indexOf(to) ? [[room, to] as const] : [];
});

/** Text `size` board units high. It is set 20 times larger and scaled down: browsers set tiny font sizes badly. */
function Label(props: {
  x: number;
  y: number;
  size: number;
  text: string;
  fill: string;
  family: string;
  spacing?: number;
}) {
  return (
    <text
      transform={`translate(${n2(props.x)} ${n2(props.y)}) scale(0.05)`}
      font-size={n2(props.size * 20)}
      font-family={props.family}
      font-weight={700}
      letter-spacing={props.spacing}
      text-anchor="middle"
      fill={props.fill}
    >
      {props.text}
    </text>
  );
}

/** The mouth of an Old Gaol Passage: a trapdoor one square in from the room's corner of the board. */
function Hatch(props: { rect: Rect; to: SceneId }) {
  const r = props.rect;
  const x = (r.x0 === 0 ? r.x0 + 1 : r.x1 - 1) + 0.5;
  const y = (r.y0 === 0 ? r.y0 + 1 : r.y1 - 1) + 0.5;
  return (
    <g class="rfd-hatch" transform={`translate(${x} ${y})`}>
      <title>{`${THEME.passage} to the ${sceneName(props.to)}`}</title>
      <rect
        x={-0.32}
        y={-0.32}
        width={0.64}
        height={0.64}
        rx={0.06}
        fill={PALETTE.parchment}
        stroke={PALETTE.ink}
        stroke-width={0.07}
      />
      <path d="M-0.1 -0.32V0.32M0.1 -0.32V0.32" fill="none" stroke={PALETTE.ink} stroke-width={0.04} />
      <circle cy={0.12} r={0.08} fill={PALETTE.parchment} stroke={PALETTE.ink} stroke-width={0.05} />
    </g>
  );
}

function Room(props: { room: SceneId }) {
  const r = ROOM_RECTS[props.room];
  const w = wide(r);
  const h = tall(r);
  const c = centre(r);
  const name = sceneName(props.room);
  // The name fits across the room in a serif face (about 0.56 of its size per letter, bold).
  const size = Math.min(0.62, (w - 0.7) / (name.length * 0.56));
  const mark = Math.min(w, h) * 0.6;
  const to = passageTo(props.room);
  return (
    <g class="rfd-room" data-room={props.room}>
      <rect x={r.x0} y={r.y0} width={w} height={h} fill={PALETTE.parchment} />
      <rect
        x={r.x0}
        y={r.y0}
        width={w}
        height={h}
        fill={PALETTE[ROOM_TINT[props.room]]}
        fill-opacity={0.3}
        stroke={PALETTE.ink}
        stroke-width={0.08}
      />
      <image
        href={glyphUri(SCENE_GLYPHS[props.room], PALETTE.ink)}
        x={n2(c.x - mark / 2)}
        y={n2(c.y - mark / 2 + 0.35)}
        width={n2(mark)}
        height={n2(mark)}
        opacity={0.2}
      />
      <Label x={c.x} y={r.y0 + 0.85} size={size} text={name} fill={PALETTE.ink} family={SERIF} />
      {to !== null && <Hatch rect={r} to={to} />}
    </g>
  );
}

function Rotunda() {
  const r = ROTUNDA;
  const c = centre(r);
  const outer = Math.min(wide(r), tall(r)) / 2 - 0.3;
  return (
    <g class="rfd-rotunda">
      <title>The Rotunda, where the Verdict is sealed: no pawn may enter</title>
      <rect x={r.x0} y={r.y0} width={wide(r)} height={tall(r)} fill={PALETTE.ink} />
      <circle
        cx={c.x}
        cy={c.y}
        r={outer}
        fill={PALETTE.slate}
        fill-opacity={0.35}
        stroke={PALETTE.brass}
        stroke-width={0.12}
      />
      <circle cx={c.x} cy={c.y} r={outer - 0.6} fill="none" stroke={PALETTE.brass} stroke-width={0.05} />
      <Label
        x={c.x}
        y={c.y + 0.2}
        size={0.5}
        text="VERDICT"
        fill={PALETTE.parchment}
        family={SERIF}
        spacing={2}
      />
    </g>
  );
}

/** `n` places in a row across room `r`, at most `step` apart. */
function row(r: Rect, n: number, step: number): { xs: number[]; gap: number } {
  const gap = Math.min(step, (wide(r) - 0.5) / Math.max(n, 1));
  const cx = r.x0 + wide(r) / 2;
  return { xs: Array.from({ length: n }, (_, i) => cx + (i - (n - 1) / 2) * gap), gap };
}

interface Spot {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Where each pawn (by Party) and each Exhibit token (by Exhibit) is drawn; a pawn's size is its radius. */
function spots(s: RfdState): { pawns: (Spot | null)[]; tokens: (Spot | null)[] } {
  const pawns: (Spot | null)[] = s.pawns.map((place) => {
    const i = squareIndex(place);
    if (i === null) return null;
    const { x, y } = at(i);
    return { x: x + 0.5, y: y + 0.5, size: 0.42 };
  });
  const tokens: (Spot | null)[] = s.exhibits.map(() => null);
  for (const room of SCENES) {
    const r = ROOM_RECTS[room];
    const here = s.pawns.flatMap((place, party) => (place === room ? [party] : []));
    const people = row(r, here.length, 0.95);
    here.forEach((party, k) => {
      pawns[party] = {
        x: people.xs[k] ?? 0,
        y: r.y0 + tall(r) * 0.55,
        size: Math.min(0.42, people.gap * 0.46),
      };
    });
    const things = s.exhibits.flatMap((place, e) => (place === room ? [e] : []));
    const shelf = row(r, things.length, 0.75);
    things.forEach((e, k) => {
      tokens[e] = { x: shelf.xs[k] ?? 0, y: r.y1 + 1 - 0.62, size: Math.min(0.56, shelf.gap * 0.8) };
    });
  }
  return { pawns, tokens };
}

function Pawn(props: { party: number; spot: Spot; label: string; turn: boolean }) {
  const p = THEME.parties[props.party];
  if (p === undefined) return null;
  const r = props.spot.size;
  return (
    <g
      class="rfd-pawn"
      data-party={PARTIES[props.party]}
      transform={`translate(${n2(props.spot.x)} ${n2(props.spot.y)})`}
    >
      <title>{props.label}</title>
      {props.turn && (
        <circle
          class="rfd-pawn-turn"
          r={n2(r + 0.13)}
          fill="none"
          stroke={PALETTE.brass}
          stroke-width={0.1}
        />
      )}
      <circle r={n2(r)} fill={PALETTE[p.accent]} stroke={PALETTE.ink} stroke-width={0.06} />
      <Label
        x={0}
        y={r * 0.3}
        size={r * 0.82}
        text={p.monogram}
        fill={PALETTE[ON_ACCENT[p.accent]]}
        family={SANS}
      />
    </g>
  );
}

function Token(props: { exhibit: ExhibitId; room: SceneId; spot: Spot }) {
  const size = props.spot.size;
  const art = size * 0.82;
  return (
    <g
      class="rfd-token"
      data-exhibit={props.exhibit}
      transform={`translate(${n2(props.spot.x)} ${n2(props.spot.y)})`}
    >
      <title>{`${exhibitName(props.exhibit)}, in the ${sceneName(props.room)}`}</title>
      <rect
        x={n2(-size / 2)}
        y={n2(-size / 2)}
        width={n2(size)}
        height={n2(size)}
        rx={n2(size * 0.18)}
        fill={PALETTE.brass}
        stroke={PALETTE.ink}
        stroke-width={0.04}
      />
      <image
        href={glyphUri(EXHIBIT_GLYPHS[props.exhibit], PALETTE.ink)}
        x={n2(-art / 2)}
        y={n2(-art / 2)}
        width={n2(art)}
        height={n2(art)}
      />
    </g>
  );
}

/** A destination of the viewer's walk: the whole room, or one square. */
function Target(props: { action: MoveAction; onMove: ((a: MoveAction) => void) | undefined }) {
  const active = props.onMove !== undefined;
  const choose = () => props.onMove?.(props.action);
  const room = roomOf(props.action.to);
  const i = squareIndex(props.action.to);
  let shape = null;
  if (room !== null) {
    const r = ROOM_RECTS[room];
    shape = (
      <rect
        class="rfd-target-shape"
        x={r.x0 + 0.1}
        y={r.y0 + 0.1}
        width={wide(r) - 0.2}
        height={tall(r) - 0.2}
        rx={0.2}
        fill={PALETTE.oxblood}
        fill-opacity={0.12}
        stroke={PALETTE.oxblood}
        stroke-width={0.16}
      />
    );
  } else if (i !== null) {
    const { x, y } = at(i);
    shape = (
      <>
        <rect
          class="rfd-target-shape"
          x={x + 0.06}
          y={y + 0.06}
          width={0.88}
          height={0.88}
          rx={0.12}
          fill={PALETTE.oxblood}
          fill-opacity={0.22}
          stroke={PALETTE.oxblood}
          stroke-width={0.08}
        />
        <circle cx={x + 0.5} cy={y + 0.5} r={0.14} fill={PALETTE.oxblood} />
      </>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>; it has a role, a label and keys.
    <g
      class="rfd-target"
      role="button"
      // Lowercase on purpose: Preact sets this as an attribute, and on an SVG element a camel-case `tabIndex`
      // attribute is not the `tabindex` the browser reads, so the target would never take focus.
      tabindex={active ? 0 : -1}
      aria-label={moveLabel(props.action.to)}
      aria-disabled={!active}
      data-action={JSON.stringify(props.action)}
      onClick={choose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      }}
    >
      {shape}
    </g>
  );
}

/** Who stands where, for a pawn's label: "Rosalind Ashdown, Ann, at H3"; "Delphine Quarrel, not played, …". */
function pawnLabel(s: RfdState, party: number, place: Place, names: readonly string[]): string {
  const seat = s.players.findIndex((p) => p.party === party);
  const who = seat < 0 ? 'not played' : seatName(names, seat);
  const out = seat >= 0 && s.players[seat]?.dismissed === true ? ', dismissed' : '';
  const where = roomOf(place) === null ? `at ${place}` : `in ${placeLabel(place)}`;
  return `${partyName(party)}, ${who}${out}, ${where}`;
}

export function Board(props: BoardProps) {
  const s = props.state;
  const { pawns, tokens } = spots(s);
  const turnParty = s.stage === 'over' ? null : (s.players[s.turn]?.party ?? null);
  return (
    <svg
      class={`rfd-board${props.expanded ? ' rfd-board-expanded' : ''}`}
      viewBox="0 0 24 24"
      aria-label="The board: the Aldermoor Assize Courts"
    >
      <title>The board: the Aldermoor Assize Courts</title>
      <rect width={BOARD_SIZE} height={BOARD_SIZE} fill={PALETTE.parchment} />
      <path d={TILES} fill={PALETTE.ivory} stroke={PALETTE.brass} stroke-width={0.03} stroke-opacity={0.6} />
      {PASSAGES.map(([a, b]) => {
        const p = centre(ROOM_RECTS[a]);
        const q = centre(ROOM_RECTS[b]);
        return (
          <line
            key={a}
            class="rfd-passage"
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            stroke={PALETTE.ink}
            stroke-opacity={0.45}
            stroke-width={0.12}
            stroke-dasharray="0.4 0.3"
          />
        );
      })}
      {SCENES.map((room) => (
        <Room key={room} room={room} />
      ))}
      {NOTCHES.map((d) => (
        <rect
          key={d.key}
          class="rfd-door"
          x={n2(d.x)}
          y={n2(d.y)}
          width={d.w}
          height={d.h}
          fill={PALETTE.brass}
          stroke={PALETTE.ink}
          stroke-width={0.03}
        />
      ))}
      <Rotunda />
      {ENTRANCES.map((square, p) => {
        const i = squareIndex(square);
        if (i === null) return null;
        const { x, y } = at(i);
        return (
          <g key={square} class="rfd-entrance">
            <title>{`Entrance ${p + 1}: ${THEME.parties[p]?.door ?? ''}`}</title>
            <circle
              cx={x + 0.5}
              cy={y + 0.5}
              r={0.4}
              fill={PALETTE.brass}
              fill-opacity={0.35}
              stroke={PALETTE.brass}
              stroke-width={0.06}
            />
            <Label
              x={x + 0.5}
              y={y + 0.68}
              size={0.5}
              text={String(p + 1)}
              fill={PALETTE.ink}
              family={SERIF}
            />
          </g>
        );
      })}
      {s.exhibits.map((room, e) => {
        const spot = tokens[e];
        const exhibit = EXHIBITS[e];
        if (room === null || spot === null || spot === undefined || exhibit === undefined) return null;
        return <Token key={exhibit} exhibit={exhibit} room={room} spot={spot} />;
      })}
      {s.pawns.map((place, party) => {
        const spot = pawns[party];
        if (spot === null || spot === undefined) return null;
        return (
          <Pawn
            key={PARTIES[party]}
            party={party}
            spot={spot}
            label={pawnLabel(s, party, place, props.names)}
            turn={party === turnParty}
          />
        );
      })}
      {props.targets.map((a) => (
        <Target key={a.to} action={a} onMove={props.onMove} />
      ))}
      <rect
        width={BOARD_SIZE}
        height={BOARD_SIZE}
        fill="none"
        stroke={PALETTE.ink}
        stroke-width={0.12}
        pointer-events="none"
      />
    </svg>
  );
}
