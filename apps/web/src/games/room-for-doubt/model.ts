/*
 * Room for Doubt presentation (D078): pure functions of the module state, for the game screen and its tests. A line
 * that names players is a list of parts, so the screen can set each name in <bdi>; `plain` joins the parts.
 *
 * Privacy (Review Focus 1): a shown card is named only in the view of the seat that showed it and of the seat it was
 * shown to. A third seat's view, a spectator's and the full state all read "showed a card", whatever they hold.
 */
import {
  EXHIBITS,
  type ExhibitId,
  handKnown,
  holds,
  kindOf,
  namedCards,
  PARTIES,
  type PartyId,
  type Place,
  pawnOf,
  type RfdAction,
  type RfdState,
  roomOf,
  SCENES,
  type SceneId,
  verdictMatch,
} from '@bored-games/room-for-doubt';
import { EMBLEMS, EXHIBIT_GLYPHS, SCENE_GLYPHS } from '@bored-games/room-for-doubt/art';
import { ROOM_FOR_DOUBT_THEME as THEME } from '@bored-games/room-for-doubt/theme';

/* ---------------------------------------------------------------------------------------------- colours */

/** The art's palette (RULES.md "Art direction"). Tints are made with opacity, never with new colours. */
export const PALETTE = {
  ink: '#241f2b',
  parchment: '#f0e6d0',
  oxblood: '#7a1f2b',
  brass: '#b08d3a',
  slate: '#4a5a6a',
  teal: '#2f6f73',
  ochre: '#c58a1f',
  umber: '#6b4a32',
  ivory: '#f6f1e4',
} as const;
export type PaletteName = keyof typeof PALETTE;

/** A Party's accent: a palette colour its pawn and its card band take. */
export type Accent = (typeof THEME.parties)[number]['accent'];

/** The text colour on each accent, the one that reads at WCAG AA (the art's data test holds each to 4.5). */
export const ON_ACCENT: Readonly<Record<Accent, 'ink' | 'ivory'>> = {
  oxblood: 'ivory',
  umber: 'ivory',
  ivory: 'ink',
  slate: 'ivory',
  ochre: 'ink',
  teal: 'ivory',
};

/** Each room's tint on the board, as the board art (docs/games/room-for-doubt/art/board.svg) draws it. */
export const ROOM_TINT: Readonly<Record<SceneId, PaletteName>> = {
  courtroom: 'oxblood',
  chambers: 'umber',
  jury: 'slate',
  robing: 'teal',
  registry: 'ochre',
  store: 'oxblood',
  cells: 'slate',
  belfry: 'teal',
  gallery: 'umber',
};

/* ------------------------------------------------------------------------------------------------ names */

/** The 21 cards of play: Parties 0–5, Exhibits 6–11, Scenes 12–20 (the room cards, 21–29, only place Exhibits). */
export const CASE_CARDS = PARTIES.length + EXHIBITS.length + SCENES.length;
const FIRST_EXHIBIT = PARTIES.length;
const FIRST_SCENE = FIRST_EXHIBIT + EXHIBITS.length;
const MAX_SEATS = 6;

export type CardKind = 'party' | 'exhibit' | 'scene';

export const partyName = (party: number): string => THEME.parties[party]?.name ?? `Party ${party + 1}`;
export const exhibitName = (id: ExhibitId): string => THEME.exhibits[EXHIBITS.indexOf(id)] ?? id;
export const sceneName = (id: SceneId): string => THEME.scenes[SCENES.indexOf(id)] ?? id;
const partyNamed = (id: PartyId): string => partyName(PARTIES.indexOf(id));

/** A seat's display name, or "Player n" while it has none. */
export const seatName = (names: readonly string[], seat: number): string =>
  names[seat] ?? `Player ${seat + 1}`;

/** The kind of a card of play, or null for anything else (never throws). */
export function cardKind(card: number): CardKind | null {
  if (!Number.isInteger(card) || card < 0 || card >= CASE_CARDS) return null;
  const kind = kindOf(card);
  return kind === 'room' ? null : kind;
}

export interface CardLook {
  readonly kind: CardKind;
  /** "Lucian Faulk", "Gavel", "Courtroom". */
  readonly name: string;
  /** "Party", "Exhibit" or "Scene". */
  readonly kindName: string;
  /** A Party's monogram, else null. */
  readonly monogram: string | null;
  /** The card's glyph: SVG markup for a 64-unit box, drawn in `currentColor`. */
  readonly glyph: string;
  /** The band's colour and the colour of what is set on it (the art's card sheet). */
  readonly band: string;
  readonly onBand: string;
}

/** How a card of play looks: its names, glyph and colours; null for anything else. */
export function cardLook(card: number): CardLook | null {
  const kind = cardKind(card);
  if (kind === 'party') {
    const p = THEME.parties[card];
    if (p === undefined) return null;
    return {
      kind,
      name: p.name,
      kindName: 'Party',
      monogram: p.monogram,
      glyph: EMBLEMS[p.emblem],
      band: PALETTE[p.accent],
      onBand: PALETTE[ON_ACCENT[p.accent]],
    };
  }
  if (kind === 'exhibit') {
    const id = EXHIBITS[card - FIRST_EXHIBIT];
    if (id === undefined) return null;
    const look = { band: PALETTE.brass, onBand: PALETTE.ink };
    return {
      kind,
      name: exhibitName(id),
      kindName: 'Exhibit',
      monogram: null,
      glyph: EXHIBIT_GLYPHS[id],
      ...look,
    };
  }
  if (kind === 'scene') {
    const id = SCENES[card - FIRST_SCENE];
    if (id === undefined) return null;
    const look = { band: PALETTE.slate, onBand: PALETTE.ivory };
    return { kind, name: sceneName(id), kindName: 'Scene', monogram: null, glyph: SCENE_GLYPHS[id], ...look };
  }
  return null;
}

/** A shown card as the record names it: "the Gavel", "the Courtroom", "the Lucian Faulk card". */
export function shownName(card: number): string {
  const look = cardLook(card);
  if (look === null) return 'a card';
  return look.kind === 'party' ? `the ${look.name} card` : `the ${look.name}`;
}

/** "the Courtroom" for a room, the square's name ("H3") for a square. */
export function placeLabel(place: Place): string {
  const room = roomOf(place);
  return room === null ? place : `the ${sceneName(room)}`;
}

/** A board target's label: "Move to the Courtroom", "Move to H3". */
export const moveLabel = (to: Place): string => `Move to ${placeLabel(to)}`;

/* ------------------------------------------------------------------------------------------------ lines */

/** A piece of a line: text, or a player's name, which the screen isolates in <bdi>. */
export type Part = string | { readonly name: string };
export type Line = readonly Part[];

export const plain = (line: Line): string => line.map((p) => (typeof p === 'string' ? p : p.name)).join('');

const named = (names: readonly string[], seat: number): Part => ({ name: seatName(names, seat) });

/** "a", "a and b", "a, b and c". */
function list(parts: readonly Part[]): Part[] {
  const last = parts[parts.length - 1];
  if (parts.length <= 1 || last === undefined) return [...parts];
  return [...parts.slice(0, -1).flatMap((p, i) => (i === 0 ? [p] : [', ', p])), ' and ', last];
}

/** The total of this turn's dice, or 0 before they are rolled. */
export const rollTotal = (s: RfdState): number => (s.dice ?? []).reduce((n, d) => n + d, 0);

/**
 * The status line: whose decision it is and what it is (Review Focus 3: it names the deciding seat, and, while the
 * dice roll, the seat whose app adds the next share, which no other line names). `me` is the viewer's seat.
 */
export function statusLine(s: RfdState, names: readonly string[], me: number | null): Line {
  const turn = (what: string): Line =>
    s.turn === me ? [`Your turn: ${what}`] : [named(names, s.turn), `'s turn: ${what}`];
  switch (s.stage) {
    case 'reveal':
      return ['Placing the Exhibits in their rooms…'];
    case 'start':
      return turn('roll the dice or take an action.');
    case 'roll': {
      const line = 'Rolling the dice: waiting for every player’s app to add its share.';
      const next = s.contributors[0];
      return next === undefined || next === me ? [line] : [line, ' ', named(names, next), '’s app is next.'];
    }
    case 'walk':
      return turn(`move the pawn (a roll of ${rollTotal(s)}).`);
    case 'moved': {
      const room = roomOf(pawnOf(s, s.turn));
      if (!s.entered || room === null) return turn('end the turn or indict.');
      const here = `submit in the ${sceneName(room)}`;
      return turn(s.rules.submit === 'required' ? `${here}.` : `${here} or end the turn.`);
    }
    case 'answered':
      return turn('end the turn or indict.');
    case 'rebut': {
      const sub = s.submissions.at(-1);
      const by = sub?.by ?? s.turn;
      const asked = s.asking ?? s.turn;
      if (asked === me) {
        // The asked seat knows its own hand: one named card or more is a show to choose, by a click; none is the
        // app's to send (ruling 7, amended). Until the hand is learned, the line names both answers.
        const answer =
          sub === undefined || !handKnown(s, me)
            ? 'show a card or say you have none.'
            : holds(s, me, namedCards(sub))
              ? 'show a card.'
              : 'you hold none of the three cards, so your app answers for you.';
        return ['Your answer to ', named(names, by), `'s submission: ${answer}`];
      }
      const whose: Part[] = by === me ? ['your'] : [named(names, by), "'s"];
      return ['Waiting for ', named(names, asked), ' to answer ', ...whose, ' submission.'];
    }
    case 'verdict': {
      const by = s.indictments.at(-1)?.by ?? s.turn;
      if (by !== me) return ['Waiting for ', named(names, by), ' to open the Verdict and announce it.'];
      return [
        verdictMatch(s) === null
          ? 'Opening the Verdict: waiting for the other players’ shares.'
          : 'The Verdict is open: announce it.',
      ];
    }
    case 'over': {
      const winner = s.result?.places.indexOf(1) ?? -1;
      if (winner < 0) return ['The game is over.'];
      const why = s.result?.reason === 'upheld' ? 'the indictment is upheld.' : 'the last player standing.';
      return winner === me ? [`You win: ${why}`] : [named(names, winner), ` wins: ${why}`];
    }
  }
}

export const statusText = (s: RfdState, names: readonly string[], me: number | null): string =>
  plain(statusLine(s, names, me));

/** What a submission or an indictment names: "Lucian Faulk with the Gavel in the Courtroom." */
export const charge = (x: { party: PartyId; exhibit: ExhibitId; scene: SceneId }): string =>
  `${partyNamed(x.party)} with the ${exhibitName(x.exhibit)} in the ${sceneName(x.scene)}.`;

/**
 * The public record (RULES.md "Interface notes"): one line per submission, saying who had none and who showed a
 * card, then one per indictment. The state keeps the two lists apart, so the indictments follow the submissions.
 * Only the state's own viewer is "you"; a shown card is named to the submitter and the shower alone.
 */
export function recordItems(s: RfdState, names: readonly string[]): Line[] {
  const viewer = s.mode === 'view' ? s.viewer : null;
  const subject = (seat: number): Part => (seat === viewer ? 'You' : named(names, seat));
  const object = (seat: number): Part => (seat === viewer ? 'you' : named(names, seat));
  const submissions = s.submissions.map((sub): Line => {
    const line: Part[] = [subject(sub.by), ` submitted ${charge(sub)}`];
    if (sub.passed.length > 0)
      line.push(
        ' ',
        ...list(sub.passed.map((seat, i) => (i === 0 ? subject(seat) : object(seat)))),
        ' had none.',
      );
    if (sub.shownBy !== null) {
      const card = sub.card;
      if (viewer === sub.by)
        line.push(
          ' ',
          named(names, sub.shownBy),
          card === null ? ' showed you a card.' : ` showed you ${shownName(card)}.`,
        );
      else if (viewer === sub.shownBy)
        line.push(
          ...(card === null
            ? [' You showed a card.']
            : [' You showed ', named(names, sub.by), ` ${shownName(card)}.`]),
        );
      else line.push(' ', subject(sub.shownBy), ' showed a card.');
    } else if (sub.passed.length === s.seats - 1) {
      line.push(' Nobody could rebut.');
    }
    return line;
  });
  const indictments = s.indictments.map(
    (x): Line => [
      subject(x.by),
      ` indicted ${charge(x)}`,
      x.upheld === null
        ? ' The Verdict is being opened.'
        : x.upheld
          ? ' The indictment was upheld.'
          : ' The indictment was dismissed.',
    ],
  );
  return [...submissions, ...indictments];
}

export const recordLines = (s: RfdState, names: readonly string[]): string[] =>
  recordItems(s, names).map(plain);

/* ----------------------------------------------------------------------------------------------- docket */

/** What the Docket marks by itself: a card in my hand, or a card shown to me (in the shower's column). */
export type AutoMark = 'held' | 'shown';

export interface DocketRow {
  readonly card: number;
  readonly kind: CardKind;
  readonly name: string;
  /** The automatic mark in each seat's column, by seat. */
  readonly marks: readonly (AutoMark | null)[];
}

/** The Docket's 21 rows, Parties, Exhibits, then Scenes, with what `me` has seen marked; nothing for a spectator. */
export function docketRows(s: RfdState, me: number | null): DocketRow[] {
  const mine = new Set<number>();
  const shown = new Map<number, number>();
  if (me !== null) {
    for (const h of s.players[me]?.hand ?? []) if (h.card !== null) mine.add(h.card);
    for (const sub of s.submissions)
      if (sub.by === me && sub.shownBy !== null && sub.card !== null) shown.set(sub.card, sub.shownBy);
  }
  return Array.from({ length: CASE_CARDS }, (_, card): DocketRow => {
    const look = cardLook(card);
    return {
      card,
      kind: look?.kind ?? 'scene',
      name: look?.name ?? `Card ${card}`,
      marks: s.players.map((_p, seat) =>
        seat === me && mine.has(card) ? 'held' : shown.get(card) === seat ? 'shown' : null,
      ),
    };
  });
}

/** A mark the player sets: ✗ (does not hold it) or ? (may hold it). */
export type ManualMark = 'x' | '?';

/** A tap cycles a cell: blank, ✗, ?, blank. */
export const nextMark = (m: ManualMark | null): ManualMark | null =>
  m === null ? 'x' : m === 'x' ? '?' : null;

export const markKey = (card: number, seat: number): string => `${card}:${seat}`;

const MARK_KEY = /^(0|[1-9]\d?):([0-5])$/;

/** Saved marks, keeping only a card of play and a seat for a key and ✗ or ? for a value. Never throws. */
export function parseMarks(raw: unknown): Record<string, ManualMark> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ManualMark> = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = MARK_KEY.exec(k);
    if (m === null || (v !== 'x' && v !== '?')) continue;
    if (Number(m[1]) >= CASE_CARDS || Number(m[2]) >= MAX_SEATS) continue;
    out[k] = v;
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- actions */

type Of<T extends RfdAction['type']> = Extract<RfdAction, { type: T }>;
export type MoveAction = Of<'move'>;
export type SubmitAction = Of<'submit'>;
export type IndictAction = Of<'indict'>;
export type NoneAction = Of<'none'>;
export type VerdictAction = Of<'verdict'>;
/** The show marker (D077): listed for the shower only; the session turns it into the sealed wire. */
export type ShowMarker = Extract<RfdAction, { type: 'show'; pos: number }>;

export const isMarker = (a: RfdAction): a is ShowMarker => a.type === 'show' && 'pos' in a;

/** The viewer's legal actions, sorted by what the screen draws for them. */
export interface Choices {
  readonly roll: Of<'roll'> | null;
  readonly stay: Of<'stay'> | null;
  readonly passage: Of<'passage'> | null;
  readonly endTurn: Of<'endTurn'> | null;
  readonly moves: readonly MoveAction[];
  readonly submits: readonly SubmitAction[];
  readonly indicts: readonly IndictAction[];
  readonly shows: readonly ShowMarker[];
  readonly none: NoneAction | null;
  readonly verdict: VerdictAction | null;
}

export function choicesOf(legal: readonly RfdAction[]): Choices {
  const of = <T extends RfdAction['type']>(type: T): Of<T>[] =>
    legal.filter((a): a is Of<T> => a.type === type);
  return {
    roll: of('roll')[0] ?? null,
    stay: of('stay')[0] ?? null,
    passage: of('passage')[0] ?? null,
    endTurn: of('endTurn')[0] ?? null,
    moves: of('move'),
    submits: of('submit'),
    indicts: of('indict'),
    shows: legal.filter(isMarker),
    none: of('none')[0] ?? null,
    verdict: of('verdict')[0] ?? null,
  };
}

/**
 * The rebuttal the app sends without a click (ruling 7, amended in the final review): a lone `none`, which is public
 * and hides nothing whenever it is sent. A show always waits for its player, even of the only card the seat can
 * show: sent at once, it would tell every seat that the shower holds exactly one of the three cards. The game
 * controller sends it (the registry's `autoMove`), and tries again on its next tick if the send fails.
 */
export function automaticAnswer(legal: readonly RfdAction[]): NoneAction | null {
  const only = legal.length === 1 ? legal[0] : undefined;
  return only?.type === 'none' ? only : null;
}

/* -------------------------------------------------------------------------------------------- the table */

/** `me`'s known cards in card order (Parties, Exhibits, Scenes), and how many it has not learned yet. */
export function handOf(s: RfdState, me: number | null): { cards: number[]; hidden: number } {
  const hand = me === null ? [] : (s.players[me]?.hand ?? []);
  const cards = hand.flatMap((h) => (h.card === null ? [] : [h.card])).sort((a, b) => a - b);
  return { cards, hidden: hand.length - cards.length };
}

/** For each card `me` has shown, the seats it showed it to, in the order shown. */
export function shownByMe(s: RfdState, me: number | null): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const sub of s.submissions)
    if (me !== null && sub.shownBy === me && sub.card !== null)
      out.set(sub.card, [...(out.get(sub.card) ?? []), sub.by]);
  return out;
}

/** The card `me` holds at deck position `pos`, or null. */
export const cardAt = (s: RfdState, me: number, pos: number): number | null =>
  s.players[me]?.hand.find((h) => h.pos === pos)?.card ?? null;

/** The Verdict's three cards once `me` has indicted and read them all, else null. */
export function verdictRead(s: RfdState, me: number | null): number[] | null {
  if (me === null || s.players[me]?.indicted !== true) return null;
  const cards = s.verdict.map((v) => v.card);
  return cards.every((c): c is number => c !== null) ? cards : null;
}

/**
 * How `me`'s submission was answered, while its turn goes on after it: the card shown to it and by whom (only `me`'s
 * own view knows the card), or that nobody could rebut. Null at any other moment.
 */
export function answerTo(
  s: RfdState,
  me: number | null,
): { readonly by: number; readonly card: number } | 'unrebutted' | null {
  const sub = s.submissions.at(-1);
  if (me === null || s.stage !== 'answered' || s.turn !== me || sub === undefined || sub.by !== me)
    return null;
  if (sub.shownBy === null) return 'unrebutted';
  return sub.card === null ? null : { by: sub.shownBy, card: sub.card };
}

/** The room another seat's submission moved `me`'s pawn into, while `me` may submit there without moving. */
export function summonedTo(s: RfdState, me: number | null): SceneId | null {
  if (me === null || s.stage !== 'start' || s.turn !== me || s.players[me]?.summoned !== true) return null;
  return roomOf(pawnOf(s, me));
}
