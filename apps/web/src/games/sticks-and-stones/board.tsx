/*
 * The camp board (D089): one illustrated board, as a printed game has. Every place people can go is drawn as an
 * area with its picture, its name, what it gives, how many people it takes, and a ring for each person on it in
 * clan colours; a discovery row with the price of each place under it; the monument sites; and the score track
 * round the edge. The areas a clan can use now are lit and are buttons. Hook-free: a test renders it.
 */
import {
  DISCOVERY_COUNT,
  GROUND_ROOM,
  type Spot,
  STACK_SIZE,
  type SticksState,
} from '@bored-games/sticks-and-stones';
import { STICKS_THEME as THEME } from '@bored-games/sticks-and-stones/theme';
import type { ComponentChildren } from 'preact';
import {
  CavePerson,
  CLAN_COLORS,
  DiscoveryCard,
  GoodShape,
  MonumentTile,
  Place,
  SpotScene,
  ToolShape,
} from './art.tsx';
import type { Choices } from './model.ts';
import { cardSpot, occupants, roomText, stackSpot } from './model.ts';

const W = 1200;
const H = 820;
const INK = '#2a2117';
const PARCH = '#f4ead3';
const SERIF = "Georgia, 'DejaVu Serif', 'Bitstream Charter', serif";
const SANS = "system-ui, 'DejaVu Sans', sans-serif";

const clanColor = (seat: number): string => CLAN_COLORS[seat]?.fill ?? '#888';

interface Zone {
  readonly spot: Spot;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** What the place gives, in two short lines. */
  readonly gives: readonly [string, string];
  /** The good it yields (-1 food), for the icon, or null. */
  readonly good: number | null;
  /** The divisor of a roll there, shown large, or null. */
  readonly per: number | null;
  /** Rings for people: a number, or null for "any number". */
  readonly rings: number | null;
}

const ZONES: readonly Zone[] = [
  {
    spot: 'hunt',
    x: 54,
    y: 54,
    w: 330,
    h: 236,
    gives: ['1 food per 2 on the dice', 'any number of people'],
    good: -1,
    per: 2,
    rings: null,
  },
  {
    spot: 'wood',
    x: 394,
    y: 54,
    w: 248,
    h: 236,
    gives: ['1 wood per 3 on the dice', `${GROUND_ROOM} people in all`],
    good: 0,
    per: 3,
    rings: GROUND_ROOM,
  },
  {
    spot: 'brick',
    x: 652,
    y: 54,
    w: 248,
    h: 236,
    gives: ['1 clay per 4 on the dice', `${GROUND_ROOM} people in all`],
    good: 1,
    per: 4,
    rings: GROUND_ROOM,
  },
  {
    spot: 'stone',
    x: 910,
    y: 54,
    w: 236,
    h: 236,
    gives: ['1 stone per 5 on the dice', `${GROUND_ROOM} people in all`],
    good: 2,
    per: 5,
    rings: GROUND_ROOM,
  },
  {
    spot: 'gold',
    x: 54,
    y: 300,
    w: 248,
    h: 200,
    gives: ['1 amber per 6 on the dice', `${GROUND_ROOM} people in all`],
    good: 3,
    per: 6,
    rings: GROUND_ROOM,
  },
  {
    spot: 'tools',
    x: 312,
    y: 300,
    w: 206,
    h: 200,
    gives: ['+1 tool: a new tile,', 'or raise your lowest'],
    good: null,
    per: null,
    rings: 1,
  },
  {
    spot: 'hut',
    x: 528,
    y: 300,
    w: 206,
    h: 200,
    gives: ['+1 person (up to 10)', 'two of yours go in'],
    good: null,
    per: null,
    rings: 2,
  },
  {
    spot: 'field',
    x: 744,
    y: 300,
    w: 206,
    h: 200,
    gives: ['+1 harvest (up to 10):', '+1 food every feeding'],
    good: null,
    per: null,
    rings: 1,
  },
];

/** A ring for one person, empty (dashed) or holding a clan figure. */
function Ring(props: { x: number; y: number; seat: number | null; r?: number }) {
  const r = props.r ?? 13;
  return (
    <g>
      <circle
        cx={props.x}
        cy={props.y}
        r={r}
        fill={props.seat === null ? 'rgb(255 250 236 / 70%)' : '#fffaf0'}
        stroke={INK}
        stroke-width="1.6"
        stroke-dasharray={props.seat === null ? '3 3' : undefined}
      />
      {props.seat !== null && (
        <Place x={props.x - r * 0.82} y={props.y - r * 0.86} size={r * 1.64}>
          <CavePerson fill={clanColor(props.seat)} />
        </Place>
      )}
    </g>
  );
}

/** The people on a spot as one seat per figure, in placing order of seats. */
const figures = (s: SticksState, spot: Spot): number[] =>
  occupants(s, spot).flatMap(({ seat, count }) => Array.from({ length: count }, () => seat));

/** An area of the board; a button when `onClick` is given. */
function Area(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  spot: Spot;
  open: boolean;
  selected: boolean;
  onClick: (() => void) | undefined;
  children: ComponentChildren;
}) {
  const live = props.onClick !== undefined;
  const cls = `ss-area${props.open ? ' ss-area-open' : ''}${props.selected ? ' ss-area-selected' : ''}`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>; it has a role, a label and keys.
    <g
      class={cls}
      data-spot={props.spot}
      role="button"
      // Preact writes SVG props as attributes, so the lowercase name is the one the browser reads (D081).
      tabindex={live ? 0 : -1}
      aria-label={props.label}
      aria-disabled={!live}
      onClick={props.onClick}
      onKeyDown={
        live
          ? (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                props.onClick?.();
              }
            }
          : undefined
      }
    >
      <title>{props.label}</title>
      <rect
        class="ss-area-frame"
        x={props.x}
        y={props.y}
        width={props.w}
        height={props.h}
        rx="16"
        fill={PARCH}
        stroke={INK}
        stroke-width="2"
      />
      {props.children}
      {props.open && (
        <rect
          class="ss-area-glow"
          x={props.x - 3}
          y={props.y - 3}
          width={props.w + 6}
          height={props.h + 6}
          rx="18"
          fill="none"
          stroke="#e8a33a"
          stroke-width="5"
        />
      )}
    </g>
  );
}

/** A place of the camp: its scene, name plaque, what it gives and its rings. */
function Location(props: {
  z: Zone;
  s: SticksState;
  open: boolean;
  selected: boolean;
  onClick: (() => void) | undefined;
}) {
  const { z, s } = props;
  const sceneH = Math.round(z.h * 0.46);
  const people = figures(s, z.spot);
  const name = THEME.spots[z.spot];
  const ringY = z.y + z.h - 22;
  const rings: ComponentChildren[] = [];
  if (z.rings === null) {
    // The hunting grounds: any number, drawn as small figures in rows.
    const per = 12;
    people.forEach((seat, i) => {
      const row = Math.floor(i / per);
      const col = i % per;
      rings.push(
        <Place
          key={i}
          x={z.x + 14 + col * 25}
          y={z.y + z.h - 46 + row * 24 - Math.floor(people.length / per) * 12}
          size={24}
        >
          <CavePerson fill={clanColor(seat)} />
        </Place>,
      );
    });
    if (people.length === 0)
      rings.push(
        <text
          key="none"
          x={z.x + z.w / 2}
          y={ringY + 5}
          text-anchor="middle"
          font-family={SANS}
          font-size="15"
          fill="#6a5a44"
        >
          No hunters yet
        </text>,
      );
  } else {
    const gap = Math.min(30, (z.w - 30) / z.rings);
    const start = z.x + z.w / 2 - (gap * (z.rings - 1)) / 2;
    for (let i = 0; i < z.rings; i++)
      rings.push(<Ring key={i} x={start + i * gap} y={ringY} seat={people[i] ?? null} />);
  }
  return (
    <Area
      x={z.x}
      y={z.y}
      w={z.w}
      h={z.h}
      label={`${name}: ${z.gives.join(', ')}; ${roomText(s, z.spot)}`}
      spot={z.spot}
      open={props.open}
      selected={props.selected}
      onClick={props.onClick}
    >
      <svg
        x={z.x + 2}
        y={z.y + 2}
        width={z.w - 4}
        height={sceneH}
        viewBox="0 0 160 90"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <SpotScene spot={z.spot} />
      </svg>
      <rect
        x={z.x + 10}
        y={z.y + sceneH - 18}
        width={z.w - 20}
        height="34"
        rx="8"
        fill="#5b3a24"
        stroke={INK}
        stroke-width="1.5"
      />
      <text
        x={z.x + z.w / 2}
        y={z.y + sceneH + 5}
        text-anchor="middle"
        font-family={SERIF}
        font-weight="700"
        font-size={name.length > 12 ? 18 : 21}
        fill="#fff4dd"
      >
        {name}
      </text>
      {z.per !== null && z.good !== null && (
        <g>
          <circle cx={z.x + z.w - 30} cy={z.y + 30} r="22" fill="#fffaf0" stroke={INK} stroke-width="1.6" />
          <Place x={z.x + z.w - 50} y={z.y + 14} size={20}>
            <GoodShape good={z.good} />
          </Place>
          <text
            x={z.x + z.w - 22}
            y={z.y + 40}
            text-anchor="middle"
            font-family={SERIF}
            font-weight="700"
            font-size="17"
            fill={INK}
          >
            ÷{z.per}
          </text>
        </g>
      )}
      {z.spot === 'tools' && (
        <Place x={z.x + z.w - 50} y={z.y + 10} size={38}>
          <ToolShape label="+1" />
        </Place>
      )}
      <text
        x={z.x + z.w / 2}
        y={z.y + sceneH + 36}
        text-anchor="middle"
        font-family={SANS}
        font-size="16"
        font-weight="600"
        fill={INK}
      >
        {z.gives[0]}
      </text>
      <text
        x={z.x + z.w / 2}
        y={z.y + sceneH + 54}
        text-anchor="middle"
        font-family={SANS}
        font-size="14"
        fill="#5a4a36"
      >
        {z.gives[1]}
      </text>
      {rings}
    </Area>
  );
}

/** The score track round the edge: 100 stones, clan markers on their score (mod 100). */
function ScoreTrack(props: { s: SticksState }) {
  const inset = 22;
  const w = W - 2 * inset;
  const h = H - 2 * inset;
  const per = (2 * (w + h)) / 100;
  const at = (n: number): [number, number] => {
    let d = (((n % 100) + 100) % 100) * per;
    if (d < w) return [inset + d, inset];
    d -= w;
    if (d < h) return [inset + w, inset + d];
    d -= h;
    if (d < w) return [inset + w - d, inset + h];
    d -= w;
    return [inset, inset + h - d];
  };
  const cells: ComponentChildren[] = [];
  for (let n = 0; n < 100; n++) {
    const [x, y] = at(n);
    const big = n % 10 === 0;
    cells.push(
      <g key={n}>
        <circle
          cx={x}
          cy={y}
          r={big ? 14 : 11}
          fill={big ? '#e6cb93' : '#d9c7a2'}
          stroke="#7a6446"
          stroke-width="1.2"
        />
        {n % 5 === 0 && (
          <text
            x={x}
            y={y + 4}
            text-anchor="middle"
            font-family={SANS}
            font-size="11"
            font-weight="700"
            fill={INK}
          >
            {n}
          </text>
        )}
      </g>,
    );
  }
  const markers = props.s.clans.map((c, seat) => {
    const [x, y] = at(Math.max(0, c.score));
    const off = (seat - 1.5) * 7;
    return (
      <g key={`m${seat}`} data-score-seat={seat}>
        <circle cx={x + off} cy={y + off} r="9" fill={clanColor(seat)} stroke={INK} stroke-width="2" />
        {c.score >= 100 && (
          <text
            x={x + off}
            y={y + off + 4}
            text-anchor="middle"
            font-family={SANS}
            font-size="9"
            font-weight="700"
            fill="#fff"
          >
            +{Math.floor(c.score / 100) * 100}
          </text>
        )}
      </g>
    );
  });
  return (
    <g class="ss-score-track">
      {cells}
      {markers}
    </g>
  );
}

export interface BoardProps {
  readonly state: SticksState;
  readonly choices: Choices;
  /** The viewer may act now. */
  readonly enabled: boolean;
  readonly selected: Spot | null;
  /** A click on an area the viewer can use. */
  readonly onSpot: ((spot: Spot) => void) | undefined;
}

/** Whether `spot` is open to the viewer now: to place on, or to resolve. */
export const spotOpen = (c: Choices, spot: Spot): boolean =>
  (c.places.get(spot)?.length ?? 0) > 0 || c.uses.includes(spot);

export function Board(props: BoardProps) {
  const { state: s, choices: c } = props;
  const click = (spot: Spot): (() => void) | undefined =>
    props.enabled && props.onSpot !== undefined && spotOpen(c, spot) ? () => props.onSpot?.(spot) : undefined;
  const village = s.seats < 4;
  // The discovery row and the monument sites.
  const row: ComponentChildren[] = [];
  const cardW = 96;
  const rowX = 54;
  const rowY = 506;
  for (const slot of [3, 2, 1, 0]) {
    const i = 3 - slot;
    const x = rowX + 18 + i * 132;
    const d = s.display[slot];
    const spot = cardSpot(slot);
    const seat = figures(s, spot)[0] ?? null;
    row.push(
      <Area
        key={spot}
        x={x - 8}
        y={rowY + 34}
        w={cardW + 16}
        h={196}
        label={`${THEME.spots[spot]}${d ? '' : ', taken'}${seat !== null ? ', a person is on it' : ''}`}
        spot={spot}
        open={spotOpen(c, spot)}
        selected={props.selected === spot}
        onClick={click(spot)}
      >
        {d ? (
          <svg x={x} y={rowY + 40} width={cardW} height={134} viewBox="0 0 120 168" aria-hidden="true">
            <DiscoveryCard card={d.card} />
          </svg>
        ) : (
          <rect
            x={x}
            y={rowY + 40}
            width={cardW}
            height={134}
            rx="8"
            fill="none"
            stroke="#9a8462"
            stroke-width="2"
            stroke-dasharray="6 5"
          />
        )}
        <Ring x={x + 22} y={rowY + 204} seat={seat} r={12} />
        <g>
          {Array.from({ length: slot + 1 }, (_, k) => (
            <rect
              key={k}
              x={x + 44 + k * 13}
              y={rowY + 196}
              width="10"
              height="16"
              rx="3"
              fill="#8a7a62"
              stroke={INK}
              stroke-width="1"
            />
          ))}
        </g>
      </Area>,
    );
  }
  const sites: ComponentChildren[] = [];
  const siteX = 640;
  s.stacks.forEach((st, k) => {
    const x = siteX + 20 + k * 126;
    const spot = stackSpot(k);
    const seat = figures(s, spot)[0] ?? null;
    const left = STACK_SIZE - st.built;
    sites.push(
      <Area
        key={spot}
        x={x - 8}
        y={rowY + 34}
        w={118}
        h={196}
        label={`${THEME.spots[spot]}, ${left} left${seat !== null ? ', a person is on it' : ''}`}
        spot={spot}
        open={spotOpen(c, spot)}
        selected={props.selected === spot}
        onClick={click(spot)}
      >
        {/* The stack underneath: one edge per tile left below the top. */}
        {Array.from({ length: Math.max(0, left - 1) }, (_, j) => (
          <rect
            key={j}
            x={x + 6 + j * 2}
            y={rowY + 48 + j * 2}
            width="96"
            height="96"
            rx="8"
            fill="#b9ad97"
            stroke={INK}
            stroke-width="1"
          />
        ))}
        {st.top !== null ? (
          <svg x={x} y={rowY + 42} width={100} height={100} viewBox="0 0 110 110" aria-hidden="true">
            <MonumentTile monument={st.top - DISCOVERY_COUNT} />
          </svg>
        ) : left > 0 ? (
          <svg x={x} y={rowY + 42} width={100} height={100} viewBox="0 0 110 110" aria-hidden="true">
            <MonumentTile monument={null} />
          </svg>
        ) : (
          <rect
            x={x}
            y={rowY + 42}
            width="100"
            height="100"
            rx="8"
            fill="none"
            stroke="#9a8462"
            stroke-width="2"
            stroke-dasharray="6 5"
          />
        )}
        <text x={x + 50} y={rowY + 172} text-anchor="middle" font-family={SANS} font-size="14" fill={INK}>
          {left} {left === 1 ? 'tile' : 'tiles'} left
        </text>
        <Ring x={x + 50} y={rowY + 204} seat={seat} r={12} />
      </Area>,
    );
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: the board is one SVG drawing; a fieldset cannot hold it.
    <svg class="ss-board" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="The camp">
      <defs>
        <linearGradient id="ss-board-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#dcc79d" />
          <stop offset="1" stop-color="#c9ad7b" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={H} rx="22" fill="#6b4a2f" />
      <rect
        x="40"
        y="40"
        width={W - 80}
        height={H - 80}
        rx="18"
        fill="url(#ss-board-ground)"
        stroke={INK}
        stroke-width="2"
      />
      <ScoreTrack s={s} />
      {ZONES.map((z) => (
        <Location
          key={z.spot}
          z={z}
          s={s}
          open={spotOpen(c, z.spot)}
          selected={props.selected === z.spot}
          onClick={click(z.spot)}
        />
      ))}
      {/* The village note and the round. */}
      <g>
        <rect x="960" y="300" width="186" height="200" rx="16" fill="#5b3a24" stroke={INK} stroke-width="2" />
        <text
          x="1053"
          y="334"
          text-anchor="middle"
          font-family={SERIF}
          font-weight="700"
          font-size="22"
          fill="#fff4dd"
        >
          Round {s.round}
        </text>
        <text x="1053" y="360" text-anchor="middle" font-family={SANS} font-size="14" fill="#f2e2c0">
          {s.stage === 'place'
            ? 'Send people out'
            : s.stage === 'feed'
              ? 'Feeding'
              : s.stage === 'over'
                ? 'Game over'
                : 'Bring people home'}
        </text>
        <text x="1053" y="394" text-anchor="middle" font-family={SANS} font-size="13" fill="#f2e2c0">
          One place per turn;
        </text>
        <text x="1053" y="412" text-anchor="middle" font-family={SANS} font-size="13" fill="#f2e2c0">
          never the same place twice
        </text>
        <text x="1053" y="430" text-anchor="middle" font-family={SANS} font-size="13" fill="#f2e2c0">
          in a round.
        </text>
        {village && (
          <>
            <text
              x="1053"
              y="458"
              text-anchor="middle"
              font-family={SANS}
              font-size="13"
              font-weight="700"
              fill="#ffd27a"
            >
              {s.seats} players: only 2 of
            </text>
            <text
              x="1053"
              y="476"
              text-anchor="middle"
              font-family={SANS}
              font-size="13"
              font-weight="700"
              fill="#ffd27a"
            >
              the 3 village places,
            </text>
            <text
              x="1053"
              y="494"
              text-anchor="middle"
              font-family={SANS}
              font-size="13"
              font-weight="700"
              fill="#ffd27a"
            >
              {s.seats === 2 ? '1 clan per ground' : '2 clans per ground'}
            </text>
          </>
        )}
      </g>
      <text x={rowX + 6} y={rowY + 24} font-family={SERIF} font-weight="700" font-size="22" fill={INK}>
        Discoveries
      </text>
      <text x={600} y={rowY + 24} text-anchor="end" font-family={SANS} font-size="13" fill="#4a3a28">
        pay the goods under it · {DISCOVERY_COUNT - s.next} in the pile
      </text>
      {row}
      <text x={siteX + 12} y={rowY + 24} font-family={SERIF} font-weight="700" font-size="22" fill={INK}>
        Monuments
      </text>
      <text x={1146} y={rowY + 24} text-anchor="end" font-family={SANS} font-size="13" fill="#4a3a28">
        pay its price, score it at once
      </text>
      {sites}
    </svg>
  );
}
