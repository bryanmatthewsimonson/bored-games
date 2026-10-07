import { type DeckSpec, type FuzzPolicy, packetOrder, type Rng } from '@bored-games/game-kit';
import {
  BOARD_SIZE,
  CORRIDOR,
  cardOf,
  DOORS,
  EXHIBITS,
  PARTIES,
  passageTo,
  pawnOf,
  type RfdAction,
  type RfdState,
  roomOf,
  SCENES,
  type SceneId,
  squareIndex,
} from '@bored-games/room-for-doubt';

/**
 * Fuzzing policies for Room for Doubt. Test drivers only, never players. A policy reads only what its seat may know:
 * its own hand, and the cards shown to it (the submissions whose `by` is the seat). In `pnpm fuzz` the state is the
 * full state, in `pnpm sim` the seat's view with other hands `null`, so nothing else is read, and a `null` card is
 * skipped. A turn is counted by the seat's rolls, because a passage, a stay or a summoned submission leaves no mark in
 * the state.
 * - detective: tracks the cards it has seen and walks to rooms it has not yet submitted in, submits naming a Party
 *   and an Exhibit it has not seen, and indicts once the three unseen cards are certain, or on its 15th turn with a
 *   random unseen card of each kind. It ends games by upheld indictments, and by wrong guesses that dismiss it.
 * - hasty: walks and submits at random and indicts at random on its third turn. It exercises dismissals, second
 *   indictments (the first indicter's sealed shares) and the last seat standing.
 * Both answer a rebuttal with a random legal answer.
 */

type Of<T extends RfdAction['type']> = Extract<RfdAction, { type: T }>;

const ofType = <T extends RfdAction['type']>(all: readonly RfdAction[], type: T): Of<T>[] =>
  all.filter((a): a is Of<T> => a.type === type);

/** The turn at which a detective that is still unsure indicts anyway. */
const GUESS_TURN = 15;
/** The turn at which a hasty seat indicts. */
const HASTY_TURN = 3;

/** The seat's current turn number, counted by its rolls: the roll of a turn that is yet to come counts at its start. */
const turnOf = (s: RfdState, seat: number): number =>
  s.rolls.filter((r) => r.last === seat).length + (s.stage === 'start' ? 1 : 0);

const isRoom = (place: string): place is SceneId => (SCENES as readonly string[]).includes(place);

/** The cards `seat` has seen: its own hand, and the cards shown to it. Its own other cards are not read. */
function seenBy(s: RfdState, seat: number): Set<number> {
  const seen = new Set<number>();
  for (const slot of s.players[seat]?.hand ?? []) if (slot.card !== null) seen.add(slot.card);
  for (const sub of s.submissions) if (sub.by === seat && sub.card !== null) seen.add(sub.card);
  return seen;
}

/** What `seat` has not seen, by kind: the Verdict is among these, since nobody holds it. */
function unseenBy(s: RfdState, seat: number) {
  const seen = seenBy(s, seat);
  return {
    parties: PARTIES.filter((id) => !seen.has(cardOf(id))),
    exhibits: EXHIBITS.filter((id) => !seen.has(cardOf(id))),
    scenes: SCENES.filter((id) => !seen.has(cardOf(id))),
  };
}

const submittedIn = (s: RfdState, seat: number, room: SceneId): boolean =>
  s.submissions.some((x) => x.by === seat && x.scene === room);

/* ------------------------------------------------------------------------------------------ the board */

const SQUARES = BOARD_SIZE * BOARD_SIZE;

/** The corridor squares next to each square, by index. */
const NEXT: readonly (readonly number[])[] = Array.from({ length: SQUARES }, (_, i) => {
  if (!CORRIDOR.has(i)) return [];
  const column = i % BOARD_SIZE;
  const near: number[] = [i - BOARD_SIZE, i + BOARD_SIZE];
  if (column > 0) near.push(i - 1);
  if (column < BOARD_SIZE - 1) near.push(i + 1);
  return near.filter((n) => CORRIDOR.has(n));
});

/** Steps from each square to the nearest door of `room` (a doorstep is 1), over the bare corridor: pawns are ignored. */
function doorDistances(room: SceneId): readonly number[] {
  const dist = new Array<number>(SQUARES).fill(Number.POSITIVE_INFINITY);
  const queue: number[] = [];
  for (const d of DOORS) {
    if (d.room !== room) continue;
    dist[d.step] = 1;
    queue.push(d.step);
  }
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as number;
    const next = (dist[at] as number) + 1;
    for (const n of NEXT[at] ?? []) {
      if (next < (dist[n] as number)) {
        dist[n] = next;
        queue.push(n);
      }
    }
  }
  return dist;
}

const DOOR_DISTANCE: ReadonlyMap<SceneId, readonly number[]> = new Map(
  SCENES.map((room) => [room, doorDistances(room)] as const),
);

/** The steps from a square to the nearest door of any of `rooms`. */
function distanceTo(rooms: readonly SceneId[], square: number): number {
  return Math.min(...rooms.map((room) => DOOR_DISTANCE.get(room)?.[square] ?? Number.POSITIVE_INFINITY));
}

/**
 * The detective's walk: a room it has not submitted in; failing that, the square closest by board distance to the
 * nearest door of such a room. Once it has submitted in every room, any room, else the square nearest to any door.
 */
function walk(s: RfdState, seat: number, moves: readonly Of<'move'>[], rng: Rng): RfdAction {
  const fresh = SCENES.filter((room) => !submittedIn(s, seat, room));
  const targets = fresh.length > 0 ? fresh : SCENES;
  const into = moves.filter((m) => isRoom(m.to) && targets.includes(m.to));
  if (into.length > 0) return rng.pick(into);
  const squares = moves.flatMap((m) => {
    const square = squareIndex(m.to);
    return square === null ? [] : [{ move: m, steps: distanceTo(targets, square) }];
  });
  const closest = Math.min(...squares.map((x) => x.steps));
  const nearest = squares.filter((x) => x.steps === closest);
  return nearest.length > 0 ? rng.pick(nearest).move : rng.pick(moves);
}

/* ---------------------------------------------------------------------------------------------- policies */

/** Test driver only: deduces from what it has seen, walks to fresh rooms and indicts when sure, or on its 15th turn. */
const detective: FuzzPolicy<RfdState> = {
  name: 'detective',
  choose(s, seat, legal, rng) {
    const all = legal as readonly RfdAction[];
    // A rebuttal is a random legal answer: a marker for one held named card, or none.
    if (s.stage === 'rebut') return rng.pick(all);
    const left = unseenBy(s, seat);
    const indicts = ofType(all, 'indict');
    if (indicts.length > 0 && (s.stage === 'start' || s.stage === 'answered')) {
      const { parties, exhibits, scenes } = left;
      const sure = parties.length === 1 && exhibits.length === 1 && scenes.length === 1;
      if (
        (sure || turnOf(s, seat) >= GUESS_TURN) &&
        parties.length > 0 &&
        exhibits.length > 0 &&
        scenes.length > 0
      ) {
        const party = rng.pick(parties);
        const exhibit = rng.pick(exhibits);
        const scene = rng.pick(scenes);
        const named = indicts.find((a) => a.party === party && a.exhibit === exhibit && a.scene === scene);
        if (named !== undefined) return named;
      }
    }
    // A submission, on entering a room or at the start of a summoned turn: an unseen Party and an unseen Exhibit.
    const submits = ofType(all, 'submit');
    if (submits.length > 0) {
      const unseen = submits.filter(
        (a) => left.parties.includes(a.party) && left.exhibits.includes(a.exhibit),
      );
      return rng.pick(unseen.length > 0 ? unseen : submits);
    }
    const moves = ofType(all, 'move');
    if (moves.length > 0) return walk(s, seat, moves, rng);
    if (s.stage === 'start') {
      // The passage leads to the opposite corner room: take it from a room that is done to one that is not, so the
      // seat never swaps between two used corners without rolling (its turns would never be counted).
      const passage = ofType(all, 'passage')[0];
      const room = roomOf(pawnOf(s, seat));
      const to = room === null ? null : passageTo(room);
      if (passage !== undefined && room !== null && to !== null) {
        if (submittedIn(s, seat, room) && !submittedIn(s, seat, to)) return passage;
      }
      // Otherwise roll, or stay when walled in.
      return all.find((a) => a.type === 'roll' || a.type === 'stay') ?? rng.pick(all);
    }
    // A share of the dice, the announcement of a Verdict, or the end of the turn.
    return all.find((a) => a.type !== 'indict') ?? rng.pick(all);
  },
};

/** Test driver only: walks and submits at random, and indicts at random on its third turn. */
const hasty: FuzzPolicy<RfdState> = {
  name: 'hasty',
  choose(s, seat, legal, rng) {
    const all = legal as readonly RfdAction[];
    if (s.stage === 'rebut') return rng.pick(all);
    const indicts = ofType(all, 'indict');
    if (indicts.length > 0 && turnOf(s, seat) >= HASTY_TURN) return rng.pick(indicts);
    const rest = all.filter((a) => a.type !== 'indict');
    if (rest.length === 0) return rng.pick(all);
    // A random walk, which enters a room half of the times one can be entered, so that it submits as well.
    const rooms = rest.filter((a) => a.type === 'move' && isRoom(a.to));
    if (rooms.length > 0 && rng.int(2) === 0) return rng.pick(rooms);
    return rng.pick(rest);
  },
};

export const ROOM_FOR_DOUBT_POLICIES: readonly FuzzPolicy<RfdState>[] = [detective, hasty];

/** Tags a long run must actually hit. `end:upheld` and `end:last-standing` are added by the fuzzer. */
export const ROOM_FOR_DOUBT_EXPECTED_COVERAGE: readonly string[] = [
  'move:roll',
  'move:room',
  'submit:entered',
  'submit:summoned',
  'rebut:show',
  'rebut:none',
  'indict:dismissed',
  'indict:again',
];

/**
 * The move deadline `pnpm sim` gives a table of this game: three days, the protocol's default. A game of detectives
 * runs about 350 moves at three seats and 1,100 at six, and the sim wakes one random client per round, so under its
 * own one-day deadline some seat goes a day unscheduled while it owes a move in about a third of the six-seat games.
 * The timeout claim that follows forks the clients (the claim race, ARCHITECTURE "Timeouts"), and the sim reports
 * a failure that has nothing to do with the rules.
 */
export const ROOM_FOR_DOUBT_SIM_DEADLINE = 3 * 86400;

/** A case order that the two shuffle rounds can produce (D076): each group shuffled, then the hands mixed. */
export function roomForDoubtDeckOrder(deck: DeckSpec, rng: Rng): number[] {
  return packetOrder(deck, rng);
}
