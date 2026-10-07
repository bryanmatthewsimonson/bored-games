/*
 * The Room for Doubt rules engine (docs/games/room-for-doubt/RULES.md, D078). Pure: `apply` and `learn` never throw
 * or mutate, and every move has one accepted encoding. Cards and positions are numbers of the case deck (ids.ts);
 * untrusted numbers are range-checked before `kindOf` or `squareName`, which throw outside their domain.
 *
 * The online form of a turn (the plan's rulings): a seat starts by rolling, by taking a passage from a corner room,
 * by staying when its pawn has no free first step (P5), by submitting when another seat's submission moved it
 * (the moved Party), or by indicting. A roll is committed by the roller and every seat adds a beacon share in turn
 * (D058); the session derives the faces. A submission asks the other seats in turn; a seat that holds a named card
 * shows one through a private show (D077) that only it and the submitter can open, so no position or card goes on
 * the wire. An indictment deals the Verdict's three positions to the indicter, who announces what it reads: upheld
 * or dismissed. The full state checks every claim, which is what the end audit replays.
 */
import {
  type ApplyResult,
  type DealtPosition,
  type DeckSpec,
  type Learn,
  type Outcome,
  type Pending,
  type PrivateShow,
  packetOrderFits,
  type Result,
  type SetupInput,
  SHOW_DECK,
} from '@bored-games/game-kit';
import { doorRoomAt, ENTRANCES, type Place, passageTo, squareIndex } from './board.ts';
import {
  type CardKind,
  DECK_ID,
  DECK_SIZE,
  EXHIBITS,
  type ExhibitId,
  HAND_POSITIONS,
  kindOf,
  PARTIES,
  type PartyId,
  ROOM_POSITIONS,
  SCENES,
  type SceneId,
  SEAT_PARTIES,
  VERDICT_POSITIONS,
} from './ids.ts';
import { canMove, destinations } from './movement.ts';
import type {
  Indictment,
  RfdAction,
  RfdEvent,
  RfdPlayer,
  RfdRules,
  RfdState,
  Slot,
  Stage,
  Submission,
} from './types.ts';

export const DEFAULT_RULES: RfdRules = { submit: 'optional' };

/**
 * The case deck: Parties, Exhibits, Scenes and room cards, each group shuffled within itself; then a second round
 * (D076) mixes the 18 hand positions, so a hand's mix of kinds is hidden while the Verdict (the first position of
 * each case group) keeps one card of each kind. `promptShares` (D075): every other seat's open app releases its
 * shares of a dealt card at once, and the first indicter seals its Verdict shares to a later indicter.
 */
export const CASE_DECK: DeckSpec = {
  id: DECK_ID,
  size: DECK_SIZE,
  partitions: [
    { id: 'parties', size: PARTIES.length },
    { id: 'exhibits', size: EXHIBITS.length },
    { id: 'scenes', size: SCENES.length },
    { id: 'rooms', size: SCENES.length },
  ],
  secondRound: [{ id: 'mix', positions: HAND_POSITIONS }],
  promptShares: true,
};

const MIN_SEATS = 3;
const MAX_SEATS = 6;
const FACES = 6;
/** The longest packet a show's wire may carry: one NIP-44 payload of a short plaintext (PROTOCOL §14). */
const MAX_PACKET = 4096;
const FIRST_EXHIBIT = PARTIES.length;
const FIRST_SCENE = FIRST_EXHIBIT + EXHIBITS.length;
const FIRST_ROOM = FIRST_SCENE + SCENES.length;
/** The kind of card each Verdict position holds: positions outside the second round keep their own group's card. */
const VERDICT_KINDS: readonly CardKind[] = VERDICT_POSITIONS.map(kindOf);
/** The stages of its own turn at which a seat may indict (RULES "3. Indict"; ruling 5: also between roll and move). */
const INDICT_STAGES: readonly Stage[] = ['start', 'walk', 'moved', 'answered'];

const failure = (message: string) => ({ ok: false as const, error: { code: 'invalid', message } });
const int = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0);
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x: Record<string, unknown>, ks: readonly string[]): boolean =>
  Object.keys(x).sort().join(',') === [...ks].sort().join(',');
const oneOf = <T extends string>(xs: readonly T[], x: unknown): x is T =>
  typeof x === 'string' && (xs as readonly string[]).includes(x);
const isScene = (x: unknown): x is SceneId => oneOf(SCENES, x);
/** A pawn place as the wire spells it: a square name (`H3`, never `h3` or `H03`) or a room's Scene id. */
const isPlace = (x: unknown): x is Place => typeof x === 'string' && (squareIndex(x) !== null || isScene(x));
const isFace = (x: unknown): boolean => int(x) && x >= 1 && x <= FACES;

/* ---------------------------------------------------------------------------------------------- cards */

/** The card number of a Party, Exhibit or Scene card, by its engine id (never a room card), or -1. */
export function cardOf(id: PartyId | ExhibitId | SceneId): number {
  const party = (PARTIES as readonly string[]).indexOf(id);
  if (party >= 0) return party;
  const exhibit = (EXHIBITS as readonly string[]).indexOf(id);
  if (exhibit >= 0) return FIRST_EXHIBIT + exhibit;
  const scene = (SCENES as readonly string[]).indexOf(id);
  return scene >= 0 ? FIRST_SCENE + scene : -1;
}

/** The three cards a submission or an indictment names: its Party, its Exhibit and its Scene, in that order. */
export const namedCards = (x: {
  readonly party: PartyId;
  readonly exhibit: ExhibitId;
  readonly scene: SceneId;
}): number[] => [cardOf(x.party), cardOf(x.exhibit), cardOf(x.scene)];

/** Whether this state knows every card of `seat`'s hand: always in full mode, and in that seat's own view. */
export const handKnown = (s: RfdState, seat: number): boolean =>
  s.players[seat]?.hand.every((h) => h.card !== null) === true;

/** Whether `seat`'s hand, as this state knows it, holds any of `cards`. */
export const holds = (s: RfdState, seat: number, cards: readonly number[]): boolean =>
  (s.players[seat]?.hand ?? []).some((h) => h.card !== null && cards.includes(h.card));

/** Whether the last indictment matches the Verdict, or null while this state does not know all three cards. */
export function verdictMatch(s: RfdState): boolean | null {
  const last = s.indictments.at(-1);
  if (last === undefined || s.verdict.some((v) => v.card === null)) return null;
  const named = namedCards(last);
  return s.verdict.every((v, i) => v.card === named[i]);
}

/* ---------------------------------------------------------------------------------------------- board */

/** The squares that pawns stand on, by index: every Party's, played, unplayed or dismissed. Rooms hold no square. */
export function occupiedSquares(s: RfdState): Set<number> {
  const out = new Set<number>();
  for (const p of s.pawns) {
    const i = squareIndex(p);
    if (i !== null) out.add(i);
  }
  return out;
}

/** Where `seat`'s pawn stands. */
export const pawnOf = (s: RfdState, seat: number): Place => s.pawns[s.players[seat]?.party ?? -1] ?? '';

/** The room a place is, or null for a square. */
export const roomOf = (place: Place): SceneId | null => (isScene(place) ? place : null);

/** The roll total of this turn, or 0 before the faces are derived. */
const rollTotal = (s: RfdState): number => (s.dice ?? []).reduce((n, d) => n + d, 0);

/** Where the turn seat may walk with this turn's roll (P4 applied). */
export const walkOf = (s: RfdState) => destinations(pawnOf(s, s.turn), rollTotal(s), occupiedSquares(s));

/* ---------------------------------------------------------------------------------------------- rules */

export function validateRules(raw: unknown): Result<RfdRules> {
  try {
    if (obj(raw) && keys(raw, ['submit'])) {
      const submit = raw.submit;
      if (submit === 'optional' || submit === 'required') return { ok: true, value: { submit } };
    }
    return failure("Rules must be { submit: 'optional' } or { submit: 'required' }.");
  } catch {
    return failure('Invalid rules.');
  }
}

/* ---------------------------------------------------------------------------------------------- setup */

export function setupGame(input: SetupInput<RfdRules>): Result<RfdState> {
  try {
    const rules = validateRules(input.rules);
    if (!rules.ok) return rules;
    const seats = input.seats;
    if (!int(seats) || seats < MIN_SEATS || seats > MAX_SEATS) return failure('Choose 3–6 players.');
    if (input.mode !== 'full' && input.mode !== 'view') return failure('Invalid mode.');
    if (input.mode === 'view' && input.viewer !== null && (!int(input.viewer) || input.viewer >= seats))
      return failure('Invalid viewer.');
    let order: number[] | null = null;
    if (input.mode === 'full') {
      const raw = input.deckOrders[DECK_ID];
      if (raw === undefined || !packetOrderFits(CASE_DECK, raw))
        return failure('The case order is not one the two shuffle rounds can produce.');
      order = Array.from(raw);
    }
    const known = (pos: number): number | null => (order === null ? null : (order[pos] ?? null));
    const parties = SEAT_PARTIES[seats as 3 | 4 | 5 | 6];
    // The deal (P2): hand position k goes to seat k mod n, from the first seat.
    const players: RfdPlayer[] = parties.map((party, seat) => ({
      party,
      hand: HAND_POSITIONS.filter((_, k) => k % seats === seat).map((pos) => ({ pos, card: known(pos) })),
      dismissed: false,
      indicted: false,
      summoned: false,
    }));
    const dealt: DealtPosition[] = [
      ...HAND_POSITIONS.map((pos, k) => ({ deck: DECK_ID, pos, to: k % seats })),
      ...ROOM_POSITIONS.map((pos) => ({ deck: DECK_ID, pos, to: null })),
    ];
    return {
      ok: true,
      value: {
        game: 'room-for-doubt',
        rules: rules.value,
        seats,
        mode: input.mode,
        viewer: input.mode === 'view' ? input.viewer : null,
        order,
        dealt,
        players,
        pawns: [...ENTRANCES],
        exhibits: EXHIBITS.map(() => null),
        roomCards: ROOM_POSITIONS.map((pos) => ({ pos, card: null })),
        verdict: VERDICT_POSITIONS.map((pos) => ({ pos, card: known(pos) })),
        turn: 0,
        stage: 'reveal',
        dice: null,
        entered: false,
        asking: null,
        submissions: [],
        indictments: [],
        rolls: [],
        roll: null,
        contributors: [],
        result: null,
        seq: 0,
      },
    };
  } catch {
    return failure('Invalid setup.');
  }
}

/* -------------------------------------------------------------------------------------------- pending */

export function pendingOf(s: RfdState): Pending {
  switch (s.stage) {
    case 'reveal':
      return {
        type: 'reveal',
        deck: DECK_ID,
        positions: s.roomCards.filter((r) => r.card === null).map((r) => r.pos),
      };
    case 'roll': {
      const next = s.contributors[0];
      if (next !== undefined) return { type: 'player', seat: next, decision: 'contribute' };
      return { type: 'beacon', id: s.roll ?? 0 };
    }
    case 'rebut':
      return { type: 'player', seat: s.asking ?? s.turn, decision: 'rebut' };
    case 'over':
      return { type: 'over' };
    default:
      return { type: 'player', seat: s.turn, decision: s.stage };
  }
}

/** The private show while a seat decides how to rebut (D077): public data only, so every view agrees. */
export function showOf(s: RfdState): PrivateShow | null {
  const sub = s.submissions.at(-1);
  if (s.stage !== 'rebut' || s.asking === null || sub === undefined) return null;
  return { id: s.submissions.length - 1, from: s.asking, to: sub.by };
}

/** The roll a `contribute` carries a beacon share for: the open one (D058). Never throws. */
export function beaconFor(s: RfdState, raw: unknown): number | null {
  try {
    return obj(raw) && raw.type === 'contribute' ? s.roll : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------------------- legal actions */

const submitsFor = (seat: number): RfdAction[] =>
  PARTIES.flatMap((party) =>
    EXHIBITS.map((exhibit) => ({ type: 'submit' as const, actor: seat, party, exhibit })),
  );

const indictsFor = (seat: number): RfdAction[] =>
  PARTIES.flatMap((party) =>
    EXHIBITS.flatMap((exhibit) =>
      SCENES.map((scene) => ({ type: 'indict' as const, actor: seat, party, exhibit, scene })),
    ),
  );

/** The asked seat's answers: a marker for each named card it holds, by position, else none. */
function answersOf(s: RfdState, seat: number): RfdAction[] {
  const sub = s.submissions.at(-1);
  const hand = s.players[seat]?.hand ?? [];
  // Which answer is legal depends on the hand: offer nothing until the seat has learned all of it (D030).
  if (sub === undefined || hand.some((h) => h.card === null)) return [];
  const named = namedCards(sub);
  const held = hand.filter((h) => h.card !== null && named.includes(h.card));
  if (held.length === 0) return [{ type: 'none', actor: seat }];
  return held.map((h) => ({ type: 'show', actor: seat, pos: h.pos }));
}

export function legalActions(s: RfdState, seat: number): RfdAction[] {
  const pending = pendingOf(s);
  if (pending.type !== 'player' || pending.seat !== seat) return [];
  const p = s.players[seat];
  if (p === undefined) return [];
  const indicts = (): RfdAction[] => (p.indicted || p.dismissed ? [] : indictsFor(seat));
  switch (s.stage) {
    case 'start': {
      const place = pawnOf(s, seat);
      const room = roomOf(place);
      const out: RfdAction[] = [
        canMove(place, occupiedSquares(s)) ? { type: 'roll', actor: seat } : { type: 'stay', actor: seat },
      ];
      if (room !== null && passageTo(room) !== null) out.push({ type: 'passage', actor: seat });
      if (p.summoned && room !== null) out.push(...submitsFor(seat));
      return [...out, ...indicts()];
    }
    case 'roll':
      return s.roll === null ? [] : [{ type: 'contribute', actor: seat, id: s.roll }];
    case 'walk':
      return [...walkOf(s).places.map((to): RfdAction => ({ type: 'move', actor: seat, to })), ...indicts()];
    case 'moved': {
      const out: RfdAction[] = s.entered ? submitsFor(seat) : [];
      if (!(s.entered && s.rules.submit === 'required')) out.push({ type: 'endTurn', actor: seat });
      return [...out, ...indicts()];
    }
    case 'rebut':
      return answersOf(s, seat);
    case 'answered':
      return [...indicts(), { type: 'endTurn', actor: seat }];
    case 'verdict': {
      // The indicter announces once it has read all three cards; until then there is nothing to choose.
      const upheld = verdictMatch(s);
      return upheld === null ? [] : [{ type: 'verdict', actor: seat, upheld }];
    }
    default:
      return [];
  }
}

/* -------------------------------------------------------------------------------------------- parsing */

/** The action `raw` encodes, or null. Each field is read once, so the result is a fresh, plain object. */
export function parseAction(raw: unknown): RfdAction | null {
  try {
    if (!obj(raw)) return null;
    const type = raw.type;
    if (type === 'reveal') {
      const { actor, deck, pos, card } = raw;
      return keys(raw, ['type', 'actor', 'deck', 'pos', 'card']) &&
        actor === 'deck' &&
        deck === DECK_ID &&
        int(pos) &&
        int(card)
        ? { type, actor, deck, pos, card }
        : null;
    }
    if (type === 'rolled') {
      const { actor, id, dice } = raw;
      if (!keys(raw, ['type', 'actor', 'id', 'dice']) || actor !== 'beacon' || !int(id)) return null;
      if (!Array.isArray(dice) || Object.keys(dice).length !== dice.length || dice.length !== 2) return null;
      const faces = [dice[0], dice[1]];
      return faces.every(isFace) ? { type, actor, id, dice: faces as number[] } : null;
    }
    const actor = raw.actor;
    if (!int(actor)) return null;
    switch (type) {
      case 'roll':
      case 'passage':
      case 'stay':
      case 'none':
      case 'endTurn':
        return keys(raw, ['type', 'actor']) ? { type, actor } : null;
      case 'contribute': {
        const id = raw.id;
        return keys(raw, ['type', 'actor', 'id']) && int(id) ? { type, actor, id } : null;
      }
      case 'move': {
        const to = raw.to;
        return keys(raw, ['type', 'actor', 'to']) && isPlace(to) ? { type, actor, to } : null;
      }
      case 'submit': {
        const { party, exhibit } = raw;
        return keys(raw, ['type', 'actor', 'party', 'exhibit']) &&
          oneOf(PARTIES, party) &&
          oneOf(EXHIBITS, exhibit)
          ? { type, actor, party, exhibit }
          : null;
      }
      case 'show': {
        // Only the wire: a marker ({type, actor, pos}) names a deck position and never reaches apply (D077).
        const { id, packet } = raw;
        return keys(raw, ['type', 'actor', 'id', 'packet']) &&
          int(id) &&
          typeof packet === 'string' &&
          packet.length >= 1 &&
          packet.length <= MAX_PACKET
          ? { type, actor, id, packet }
          : null;
      }
      case 'indict': {
        const { party, exhibit, scene } = raw;
        return keys(raw, ['type', 'actor', 'party', 'exhibit', 'scene']) &&
          oneOf(PARTIES, party) &&
          oneOf(EXHIBITS, exhibit) &&
          isScene(scene)
          ? { type, actor, party, exhibit, scene }
          : null;
      }
      case 'verdict': {
        const upheld = raw.upheld;
        return keys(raw, ['type', 'actor', 'upheld']) && typeof upheld === 'boolean'
          ? { type, actor, upheld }
          : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------ the turn */

type Applied = { readonly state: RfdState; readonly events: RfdEvent[] };
type PlayerAction = Exclude<RfdAction, { type: 'reveal' } | { type: 'rolled' }>;

const withPlayer = (s: RfdState, seat: number, change: Partial<RfdPlayer>): RfdPlayer[] =>
  s.players.map((p, i) => (i === seat ? { ...p, ...change } : p));

const withPawn = (s: RfdState, party: number, to: Place): Place[] =>
  s.pawns.map((p, i) => (i === party ? to : p));

const withLast = <T>(xs: readonly T[], last: T): T[] => [...xs.slice(0, -1), last];

/** The winner is place 1 with score 1; every other seat shares place 2 with score 0 (P7). */
const winner = (s: RfdState, seat: number, reason: 'upheld' | 'last-standing'): Outcome => ({
  places: s.players.map((_, i) => (i === seat ? 1 : 2)),
  scores: s.players.map((_, i) => (i === seat ? 1 : 0)),
  reason,
});

/** The next undismissed seat after the turn seat starts its turn. */
function nextTurn(s: RfdState): Applied {
  let seat = s.turn;
  for (let k = 0; k < s.seats; k++) {
    seat = (seat + 1) % s.seats;
    if (s.players[seat]?.dismissed === false) break;
  }
  const state: RfdState = {
    ...s,
    turn: seat,
    stage: 'start',
    dice: null,
    entered: false,
    asking: null,
    roll: null,
    contributors: [],
  };
  return { state, events: [{ type: 'turn', seat }] };
}

function applyReveal(s: RfdState, a: Extract<RfdAction, { type: 'reveal' }>): Applied | string {
  const pending = pendingOf(s);
  if (pending.type !== 'reveal' || !pending.positions.includes(a.pos)) return 'Unexpected public reveal.';
  if (a.card < FIRST_ROOM || a.card >= DECK_SIZE) return 'Only a room card is revealed here.';
  if (s.order !== null && s.order[a.pos] !== a.card) return 'The reveal does not match the shuffled deck.';
  if (s.roomCards.some((r) => r.card === a.card)) return 'That room card is already revealed.';
  const exhibit = ROOM_POSITIONS.indexOf(a.pos);
  const room = SCENES[a.card - FIRST_ROOM] as SceneId;
  const state: RfdState = {
    ...s,
    roomCards: s.roomCards.map((r) => (r.pos === a.pos ? { pos: a.pos, card: a.card } : r)),
    exhibits: s.exhibits.map((x, e) => (e === exhibit ? room : x)),
  };
  const events: RfdEvent[] = [{ type: 'revealed', exhibit: EXHIBITS[exhibit] as ExhibitId, room }];
  if (state.roomCards.some((r) => r.card === null)) return { state, events };
  // The Exhibits are placed: the first seat's turn begins.
  return { state: { ...state, stage: 'start' }, events: [...events, { type: 'turn', seat: state.turn }] };
}

function applyRolled(s: RfdState, a: Extract<RfdAction, { type: 'rolled' }>): Applied | string {
  const pending = pendingOf(s);
  if (pending.type !== 'beacon' || pending.id !== a.id) return 'No roll is awaited.';
  return {
    state: { ...s, dice: [...a.dice], roll: null, stage: 'walk' },
    events: [{ type: 'rolled', seat: s.turn, dice: [...a.dice] }],
  };
}

function applySubmit(s: RfdState, a: Extract<RfdAction, { type: 'submit' }>): Applied | string {
  const seat = a.actor;
  const p = s.players[seat];
  const room = roomOf(pawnOf(s, seat));
  if (p === undefined || room === null) return 'Submit in a room.';
  const summoned = s.stage === 'start' && p.summoned;
  if (!summoned && !(s.stage === 'moved' && s.entered)) return 'You may submit only on entering a room.';
  const party = PARTIES.indexOf(a.party);
  // The named pawn comes into the room unless it is there; a seat whose pawn moved may submit there next (C22).
  // A dismissed seat's pawn moves too (C40), but that seat takes no more turns.
  const moved = s.pawns[party] !== room;
  const players = s.players.map((q, i) => {
    if (i === seat) return { ...q, summoned: false };
    return moved && q.party === party && !q.dismissed ? { ...q, summoned: true } : q;
  });
  const exhibit = EXHIBITS.indexOf(a.exhibit);
  const submission: Submission = {
    by: seat,
    party: a.party,
    exhibit: a.exhibit,
    scene: room,
    passed: [],
    shownBy: null,
    card: null,
  };
  return {
    state: {
      ...s,
      players,
      pawns: withPawn(s, party, room),
      exhibits: s.exhibits.map((x, e) => (e === exhibit ? room : x)),
      submissions: [...s.submissions, submission],
      entered: false,
      stage: 'rebut',
      asking: (seat + 1) % s.seats,
    },
    events: [{ type: 'submitted', seat, party: a.party, exhibit: a.exhibit, scene: room, summoned }],
  };
}

/** The asked seat's answer: the show wire, or none. */
function applyAnswer(s: RfdState, a: Extract<RfdAction, { type: 'show' | 'none' }>): Applied | string {
  const seat = a.actor;
  const sub = s.submissions.at(-1);
  if (s.stage !== 'rebut' || sub === undefined) return 'Nobody is asked to rebut.';
  const named = namedCards(sub);
  if (a.type === 'show') {
    if (!('id' in a) || a.id !== s.submissions.length - 1) return 'That show is not for this submission.';
    // Where this state knows the hand, the shower must hold a named card; otherwise the end audit checks it.
    if (handKnown(s, seat) && !holds(s, seat, named)) return 'You hold none of the named cards.';
    return {
      state: {
        ...s,
        stage: 'answered',
        asking: null,
        submissions: withLast(s.submissions, { ...sub, shownBy: seat }),
      },
      events: [{ type: 'shown', seat, to: sub.by }],
    };
  }
  if (handKnown(s, seat) && holds(s, seat, named)) return 'You hold a named card: show one.';
  const submissions = withLast(s.submissions, { ...sub, passed: [...sub.passed, seat] });
  const next = (seat + 1) % s.seats;
  if (next !== sub.by)
    return { state: { ...s, submissions, asking: next }, events: [{ type: 'passed', seat }] };
  return {
    state: { ...s, submissions, asking: null, stage: 'answered' },
    events: [
      { type: 'passed', seat },
      { type: 'unrebutted', seat: sub.by },
    ],
  };
}

function applyVerdict(s: RfdState, a: Extract<RfdAction, { type: 'verdict' }>): Applied | string {
  const seat = a.actor;
  const last = s.indictments.at(-1);
  const p = s.players[seat];
  if (s.stage !== 'verdict' || last === undefined || last.by !== seat || p === undefined)
    return 'There is no Verdict for you to announce.';
  // The full state, and the indicter's own view once it has read the cards, know the answer (C44).
  const match = verdictMatch(s);
  if ((s.mode === 'full' || s.viewer === seat) && match !== null && match !== a.upheld)
    return 'That is not what the Verdict says.';
  const indictments = withLast<Indictment>(s.indictments, { ...last, upheld: a.upheld });
  const events: RfdEvent[] = [{ type: 'verdict', seat, upheld: a.upheld }];
  if (a.upheld)
    return { state: { ...s, indictments, stage: 'over', result: winner(s, seat, 'upheld') }, events };
  // Dismissed: the pawn stays, unless it stands on a doorstep, which it leaves for that door's room (C38).
  const square = squareIndex(pawnOf(s, seat));
  const into = square === null ? null : doorRoomAt(square);
  const state: RfdState = {
    ...s,
    indictments,
    players: withPlayer(s, seat, { dismissed: true }),
    pawns: into === null ? s.pawns : withPawn(s, p.party, into),
  };
  // The last seat standing wins at once (P6).
  const standing = state.players.flatMap((q, i) => (q.dismissed ? [] : [i]));
  const survivor = standing[0];
  if (standing.length === 1 && survivor !== undefined)
    return { state: { ...state, stage: 'over', result: winner(state, survivor, 'last-standing') }, events };
  const next = nextTurn(state);
  return { state: next.state, events: [...events, ...next.events] };
}

function applyPlayer(s: RfdState, a: PlayerAction): Applied | string {
  const seat = a.actor;
  const p = s.players[seat];
  if (p === undefined) return 'No such seat.';
  switch (a.type) {
    case 'roll': {
      if (s.stage !== 'start') return 'Roll at the start of your turn.';
      if (!canMove(pawnOf(s, seat), occupiedSquares(s))) return 'Your pawn cannot move: stay.';
      const id = s.rolls.length;
      // Every seat adds a share, from the seat after the roller round to the roller itself (D058).
      const contributors = Array.from({ length: s.seats }, (_, k) => (seat + 1 + k) % s.seats);
      return {
        state: {
          ...s,
          stage: 'roll',
          roll: id,
          rolls: [...s.rolls, { id, last: seat }],
          contributors,
          players: withPlayer(s, seat, { summoned: false }),
        },
        events: [],
      };
    }
    case 'contribute':
      if (s.stage !== 'roll' || s.roll === null || a.id !== s.roll) return 'No share of that roll is owed.';
      return { state: { ...s, contributors: s.contributors.slice(1) }, events: [] };
    case 'move': {
      if (s.stage !== 'walk') return 'Move after the roll.';
      const walk = walkOf(s);
      if (!walk.places.includes(a.to)) return 'Your pawn cannot end its walk there.';
      return {
        state: { ...s, stage: 'moved', entered: roomOf(a.to) !== null, pawns: withPawn(s, p.party, a.to) },
        events: [{ type: 'moved', seat, to: a.to, how: walk.shortfall ? 'shortfall' : 'walk' }],
      };
    }
    case 'passage': {
      if (s.stage !== 'start') return 'Take a passage at the start of your turn.';
      const room = roomOf(pawnOf(s, seat));
      const to = room === null ? null : passageTo(room);
      if (to === null) return 'There is no passage here.';
      return {
        state: {
          ...s,
          stage: 'moved',
          entered: true,
          pawns: withPawn(s, p.party, to),
          players: withPlayer(s, seat, { summoned: false }),
        },
        events: [{ type: 'moved', seat, to, how: 'passage' }],
      };
    }
    case 'stay': {
      if (s.stage !== 'start') return 'Stay at the start of your turn.';
      const place = pawnOf(s, seat);
      if (canMove(place, occupiedSquares(s))) return 'Your pawn can move.';
      return {
        state: { ...s, stage: 'moved', players: withPlayer(s, seat, { summoned: false }) },
        events: [{ type: 'moved', seat, to: place, how: 'stay' }],
      };
    }
    case 'submit':
      return applySubmit(s, a);
    case 'show':
    case 'none':
      return applyAnswer(s, a);
    case 'indict': {
      if (!INDICT_STAGES.includes(s.stage)) return 'Indict on your own turn.';
      if (p.indicted || p.dismissed) return 'A seat indicts once per game.';
      const indictment: Indictment = {
        by: seat,
        party: a.party,
        exhibit: a.exhibit,
        scene: a.scene,
        upheld: null,
      };
      // The Verdict's positions are dealt to the indicter alone; after a wrong indictment they are dealt again,
      // and the first indicter seals its shares to the new one (PROTOCOL §4.10).
      return {
        state: {
          ...s,
          stage: 'verdict',
          indictments: [...s.indictments, indictment],
          players: withPlayer(s, seat, { indicted: true, summoned: false }),
          dealt: [...s.dealt, ...VERDICT_POSITIONS.map((pos) => ({ deck: DECK_ID, pos, to: seat }))],
        },
        events: [
          {
            type: 'indicted',
            seat,
            party: a.party,
            exhibit: a.exhibit,
            scene: a.scene,
            again: s.indictments.length > 0,
          },
        ],
      };
    }
    case 'verdict':
      return applyVerdict(s, a);
    case 'endTurn': {
      if (s.stage !== 'moved' && s.stage !== 'answered') return 'You may not end your turn now.';
      if (s.stage === 'moved' && s.entered && s.rules.submit === 'required')
        return 'You must submit in the room you entered.';
      return nextTurn(s);
    }
  }
}

export function applyAction(s: RfdState, raw: unknown): ApplyResult<RfdState, RfdEvent> {
  try {
    const a = parseAction(raw);
    if (a === null) return failure('Malformed action.');
    let next: Applied | string;
    if (a.type === 'reveal') next = applyReveal(s, a);
    else if (a.type === 'rolled') next = applyRolled(s, a);
    else {
      const pending = pendingOf(s);
      if (pending.type !== 'player' || pending.seat !== a.actor) return failure('It is not your decision.');
      next = applyPlayer(s, a);
    }
    if (typeof next === 'string') return failure(next);
    return { ok: true, state: { ...next.state, seq: s.seq + 1 }, events: next.events };
  } catch {
    return failure('Invalid action.');
  }
}

/* ------------------------------------------------------------------------------------------ knowledge */

const accepted = (state: RfdState): ApplyResult<RfdState, RfdEvent> => ({ ok: true, state, events: [] });

/** A shown card (D077): learned by the shower's and the submitter's views, and by the full state in the audit. */
function learnShown(s: RfdState, pos: unknown, card: unknown): ApplyResult<RfdState, RfdEvent> {
  if (!int(pos) || !int(card)) return failure('Invalid shown card.');
  const sub = s.submissions[pos];
  if (sub === undefined || sub.shownBy === null) return failure('No card was shown in that submission.');
  if (s.mode === 'view' && s.viewer !== sub.by && s.viewer !== sub.shownBy)
    return failure('That card was not shown to this seat.');
  if (!namedCards(sub).includes(card)) return failure('The shown card is not one the submission named.');
  // The full state and the shower's own view know its hand: the card must be one it holds.
  if (handKnown(s, sub.shownBy) && !holds(s, sub.shownBy, [card]))
    return failure('The shower does not hold that card.');
  if (sub.card !== null) return sub.card === card ? accepted(s) : failure('Another card was shown.');
  return accepted({ ...s, submissions: s.submissions.map((x, i) => (i === pos ? { ...x, card } : x)) });
}

export function learnCard(s: RfdState, l: Learn): ApplyResult<RfdState, RfdEvent> {
  try {
    if (!obj(l)) return failure('Invalid private card.');
    const { deck, pos, card } = l as unknown as Record<string, unknown>;
    if (deck === SHOW_DECK) return learnShown(s, pos, card);
    if (
      deck !== DECK_ID ||
      s.mode !== 'view' ||
      s.viewer === null ||
      !int(pos) ||
      !int(card) ||
      card >= DECK_SIZE
    )
      return failure('Invalid private card.');
    const seat = s.viewer;
    const p = s.players[seat];
    if (p === undefined) return failure('Invalid private card.');
    const kind = kindOf(card);
    const verdictAt = p.indicted ? s.verdict.findIndex((v) => v.pos === pos) : -1;
    const inHand = p.hand.some((h) => h.pos === pos);
    if (!inHand && verdictAt < 0) return failure('The card is not privately assigned to this viewer.');
    // A hand holds Parties, Exhibits and Scenes; each Verdict position holds its own group's kind.
    if (inHand ? kind === 'room' : kind !== VERDICT_KINDS[verdictAt])
      return failure('The card is of the wrong kind.');
    const slots: readonly Slot[] = [...p.hand, ...(p.indicted ? s.verdict : [])];
    const slot = slots.find((x) => x.pos === pos);
    if (slot?.card === card) return accepted(s);
    if (slot?.card !== null) return failure('Another card is known at that position.');
    if (slots.some((x) => x.card === card)) return failure('That card is already known at another position.');
    const fill = (x: Slot): Slot => (x.pos === pos ? { pos, card } : x);
    if (inHand) return accepted({ ...s, players: withPlayer(s, seat, { hand: p.hand.map(fill) }) });
    return accepted({ ...s, verdict: s.verdict.map(fill) });
  } catch {
    return failure('Invalid private card.');
  }
}

/** Everything `seat` privately knows in a full state: its hand, and the Verdict once it has indicted. */
export function knownTo(s: RfdState, seat: number): Learn[] {
  const p = s.players[seat];
  if (p === undefined) return [];
  return [...p.hand, ...(p.indicted ? s.verdict : [])].flatMap((x) =>
    x.card === null ? [] : [{ deck: DECK_ID, pos: x.pos, card: x.card }],
  );
}

/** What `viewer` (null: a spectator) may know: its own hand, the cards shown to or by it, the Verdict it read. */
export function viewOf(s: RfdState, viewer: number | null): RfdState {
  const hide = (x: Slot): Slot => ({ pos: x.pos, card: null });
  const sees = (seat: number | null): boolean => viewer !== null && seat === viewer;
  return {
    ...s,
    mode: 'view',
    viewer,
    order: null,
    players: s.players.map((p, seat) => (sees(seat) ? p : { ...p, hand: p.hand.map(hide) })),
    submissions: s.submissions.map((x) => (sees(x.by) || sees(x.shownBy) ? x : { ...x, card: null })),
    verdict: viewer !== null && s.players[viewer]?.indicted === true ? s.verdict : s.verdict.map(hide),
  };
}

/** Public: every standing is 0 until a winner is declared, then the final scores (P7). */
export const standingsOf = (s: RfdState): number[] => s.result?.scores.slice() ?? s.players.map(() => 0);

/** The rare events the fuzzer counts. */
export function coverageOf(_s: RfdState, events: readonly RfdEvent[]): string[] {
  const tags: string[] = [];
  for (const e of events) {
    if (e.type === 'rolled') tags.push('move:roll');
    else if (e.type === 'moved') {
      if (e.how === 'walk') {
        if (roomOf(e.to) !== null) tags.push('move:room');
      } else tags.push(`move:${e.how}`);
    } else if (e.type === 'submitted') tags.push(e.summoned ? 'submit:summoned' : 'submit:entered');
    else if (e.type === 'shown') tags.push('rebut:show');
    else if (e.type === 'passed') tags.push('rebut:none');
    else if (e.type === 'unrebutted') tags.push('rebut:unrebutted');
    else if (e.type === 'indicted' && e.again) tags.push('indict:again');
    else if (e.type === 'verdict') tags.push(e.upheld ? 'indict:upheld' : 'indict:dismissed');
  }
  return tags;
}
