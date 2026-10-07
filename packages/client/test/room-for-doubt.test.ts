// biome-ignore-all lint/style/noNonNullAssertion: the script's seats, submissions and Verdict positions exist.
/*
 * Room for Doubt through real `GameSession`s (D076–D078): the first module to combine a deck in groups with a second
 * shuffle round, private shows, prompt shares with the first indicter's seal, and dice beside a deck. Three seats and
 * a spectator play from one table, shuffled and dealt once (the shuffle proofs are trusted, as elsewhere; every share,
 * packet, seal and audit is real). A scripted driver reads every hand, as a test may: a submission names a card of
 * the next seat's, so that seat shows one. The cases pin what a live game depends on:
 * 1. a show reaches the shower and the submitter only: not the third seat, the spectator, the wire, a late spectator
 *    or a reloaded seat (which re-learns exactly its own shows); the end audit opens every packet;
 * 2. an indictment waits on the seat whose closed app owes a share of the Verdict, and completes once it sends it;
 * 3. a second indictment, after a dismissed one, reads the Verdict through the first indicter's sealed share, which
 *    names that closed app until it is sent; nobody else reads it.
 * The second case plays 2 and 3 in turn, as one game would.
 */
import {
  getPublicKey,
  KIND,
  type NostrEvent,
  parseMove,
  parseSealed,
  parseShares,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  CORRIDOR,
  cardName,
  cardOf,
  DECK_SIZE,
  DOORS,
  namedCards,
  type RfdAction,
  type RfdState,
  roomForDoubt,
  SCENES,
  squareIndex,
  VERDICT_POSITIONS,
} from '../../games/room-for-doubt/src/index.ts';
import type { GameSession } from '../src/session.ts';
import { catchUp, deliver, makeModuleGame, NOW, newSession, type TestGame, trust } from './helpers.ts';

const SEATS = 3;
/** Every session's answer to one event: the three players', then the spectator's. */
const ACCEPTED = ['accepted', 'accepted', 'accepted', 'accepted'];

type Of<T extends RfdAction['type']> = Extract<RfdAction, { type: T }>;

/** Three seats and a spectator; `closed` seats are apps that are not open, so their duties are not run. */
interface Table {
  readonly game: TestGame;
  readonly players: GameSession[];
  readonly spectator: GameSession;
  readonly all: GameSession[];
  /** Every event published, in order. */
  readonly events: NostrEvent[];
  readonly closed: Set<number>;
}

const stateOf = (s: GameSession): RfdState => s.view().state as RfdState;

/** Sessions for the three seats and a spectator: new, or caught up on `events`, each first seen now. */
function table(game: TestGame, events: readonly NostrEvent[]): Table {
  const session = (seat: number | null): GameSession =>
    events.length === 0 ? newSession(game, seat) : catchUp(game, seat, events, game.modules, NOW);
  const players = [0, 1, 2].map((seat) => session(seat));
  const spectator = session(null);
  return { game, players, spectator, all: [...players, spectator], events: [...events], closed: new Set() };
}

/** Publish `ev`: every session accepts it. */
function send(t: Table, ev: NostrEvent): void {
  t.events.push(ev);
  const results = deliver(t.all, [ev])[0] ?? [];
  expect(results.map((r) => (r.status === 'rejected' ? `rejected: ${r.reason}` : r.status))).toEqual(
    ACCEPTED,
  );
}

/** Run the open apps' automatic duties (shuffle, deal, Shares, seal, dice shares) until none is due. */
function pump(t: Table): void {
  for (let round = 0; round < 500; round++) {
    let progressed = false;
    for (const [seat, s] of t.players.entries()) {
      if (t.closed.has(seat)) continue;
      const duty = s.duties()[0];
      if (duty === undefined || duty.kind === 'decide' || duty.kind === 'secret' || duty.kind === 'attest')
        continue;
      const rnd = t.game.rnd;
      let ev: NostrEvent;
      if (duty.kind === 'shuffle') {
        ev = s.buildShuffle(rnd, NOW);
        // The session's shuffle tests verify these proofs: here no session checks the step again.
        trust(t.all, [ev]);
      } else if (duty.kind === 'deal') ev = s.buildDeal(rnd, NOW);
      else if (duty.kind === 'share') ev = s.buildShares(rnd, NOW);
      else if (duty.kind === 'seal') ev = s.buildSealed(rnd, NOW);
      else ev = s.buildBeacon(rnd, NOW);
      send(t, ev);
      progressed = true;
    }
    if (!progressed) return;
  }
  throw new Error('the automatic duties never settle');
}

/** The seat whose decision the game waits on, or null. */
function pendingSeat(t: Table): number | null {
  const p = t.spectator.view().pending;
  return p.type === 'player' ? p.seat : null;
}

/** `seat` makes `action`; every session accepts the move, then the open apps' duties run. Returns the move. */
function decide(t: Table, seat: number, action: unknown): NostrEvent {
  const s = t.players[seat]!;
  expect(s.duties()[0]?.kind).toBe('decide');
  const ev = s.buildAction(action, t.game.rnd, NOW);
  send(t, ev);
  pump(t);
  return ev;
}

/** `seat`'s own cards, as its own session knows them. */
const handOf = (t: Table, seat: number): number[] =>
  stateOf(t.players[seat]!).players[seat]!.hand.map((h) => h.card!);

const legalOf = (t: Table, seat: number): readonly RfdAction[] =>
  t.players[seat]!.legalActions() as readonly RfdAction[];

const ofType = <T extends RfdAction['type']>(all: readonly RfdAction[], type: T): Of<T>[] =>
  all.filter((a): a is Of<T> => a.type === type);

const isRoom = (place: string): boolean => (SCENES as readonly string[]).includes(place);

/** Steps from each corridor square to the nearest doorstep: the walk heads for a room when none is in reach. */
const TO_DOOR: ReadonlyMap<number, number> = (() => {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const d of DOORS)
    if (!dist.has(d.step)) {
      dist.set(d.step, 0);
      queue.push(d.step);
    }
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const x = at % BOARD_SIZE;
    for (const n of [at - BOARD_SIZE, at + BOARD_SIZE, x > 0 ? at - 1 : -1, x < BOARD_SIZE - 1 ? at + 1 : -1])
      if (CORRIDOR.has(n) && !dist.has(n)) {
        dist.set(n, (dist.get(at) ?? 0) + 1);
        queue.push(n);
      }
  }
  return dist;
})();

/**
 * The script's choice for `seat`, which never indicts: submit naming a Party or an Exhibit the next seat holds (so it
 * shows a card), show the first card it may (a seat's choice), say none, walk into a room or toward the nearest
 * door, roll (or stay when walled in), end the turn, announce the Verdict.
 */
function scripted(t: Table, seat: number): RfdAction {
  const legal = legalOf(t, seat);
  const submits = ofType(legal, 'submit');
  if (submits.length > 0) {
    const next = new Set(handOf(t, (seat + 1) % SEATS));
    return submits.find((a) => next.has(cardOf(a.party)) || next.has(cardOf(a.exhibit))) ?? submits[0]!;
  }
  const moves = ofType(legal, 'move');
  const nearest = [...moves].sort(
    (a, b) => (TO_DOOR.get(squareIndex(a.to) ?? -1) ?? 99) - (TO_DOOR.get(squareIndex(b.to) ?? -1) ?? 99),
  );
  const choice =
    legal.find((a) => a.type === 'show') ??
    ofType(legal, 'none')[0] ??
    moves.find((m) => isRoom(m.to)) ??
    nearest[0] ??
    ofType(legal, 'roll')[0] ??
    ofType(legal, 'stay')[0] ??
    ofType(legal, 'endTurn')[0] ??
    ofType(legal, 'verdict')[0];
  if (choice === undefined) throw new Error(`seat ${seat} has no scripted choice`);
  return choice;
}

/** The script decides for the seat the game waits on: that seat, its action and its move. */
function step(t: Table): { seat: number; action: RfdAction; ev: NostrEvent } {
  const seat = pendingSeat(t);
  if (seat === null) throw new Error(`no seat to decide: ${JSON.stringify(t.spectator.view().pending)}`);
  const action = scripted(t, seat);
  return { seat, action, ev: decide(t, seat, action) };
}

/** Play the script until `done` holds. */
function playUntil(t: Table, done: () => boolean): void {
  for (let n = 0; n < 600 && !done(); n++) step(t);
  if (!done()) throw new Error('the script never got there');
}

/** An indictment by `seat` naming a card of its own hand, so the Verdict surely dismisses it. */
function wrongIndictment(t: Table, seat: number): Of<'indict'> {
  const hand = new Set(handOf(t, seat));
  const wrong = ofType(legalOf(t, seat), 'indict').find((a) => namedCards(a).some((c) => hand.has(c)));
  if (wrong === undefined) throw new Error(`seat ${seat} cannot indict naming its own card`);
  return wrong;
}

/** The pending seat indicts naming its own card, reads the Verdict and announces the dismissal. */
function dismissNext(t: Table): number {
  playUntil(t, () => {
    const seat = pendingSeat(t);
    return seat !== null && ofType(legalOf(t, seat), 'indict').length > 0;
  });
  const seat = pendingSeat(t)!;
  decide(t, seat, wrongIndictment(t, seat));
  decide(t, seat, { type: 'verdict', actor: seat, upheld: false });
  return seat;
}

/** The end: every seat's app reveals its deck secret, and every session audits the whole game. */
function finish(t: Table): void {
  for (const s of t.players) {
    expect(s.duties()[0]?.kind).toBe('secret');
    send(t, s.buildSecret(t.game.rnd, NOW));
  }
  for (const s of t.all) {
    expect(s.view().phase).toBe('done');
    expect(s.view().audit).toBe('pass');
  }
}

/** The deck positions an action move, a Shares event or a Sealed event carries in the clear. */
function positionsIn(ev: NostrEvent): number[] {
  if (ev.kind === KIND.shares) return parseShares(ev).shares.map((x) => x.pos);
  if (ev.kind === KIND.sealed) return parseSealed(ev).sealed.map((x) => x.pos);
  if (ev.kind !== KIND.move) return [];
  const c = parseMove(ev, DECK_SIZE).content;
  return c.type === 'action' ? [...c.reveals, ...c.shares].map((x) => x.pos) : [];
}

/**
 * One table, shuffled in two rounds, dealt, and its Exhibits placed: every case starts from it. `unused` holds the
 * setup's own sessions until a case takes them (`fresh`).
 */
let setup: { game: TestGame; events: readonly NostrEvent[]; unused: Table | null };

beforeAll(() => {
  const game = makeModuleGame(roomForDoubt, SEATS, 'room-for-doubt-session');
  game.modules = new Map([[roomForDoubt.id, roomForDoubt]]);
  const t = table(game, []);
  pump(t);
  for (const s of t.all) {
    expect(s.view().phase).toBe('play');
    expect(stateOf(s)).toMatchObject({ stage: 'start', turn: 0 });
  }
  setup = { game, events: [...t.events], unused: t };
}, 120_000);

/**
 * Sessions at the start of play: the setup's own the first time, then new ones caught up on its events (a catch-up
 * checks every share of the deal again, about a second per session).
 */
function fresh(): Table {
  const t = setup.unused ?? table(setup.game, setup.events);
  setup.unused = null;
  return t;
}

describe('Room for Doubt over real sessions (D076–D078)', () => {
  it('shows a card to the submitter alone, on the wire, after a reload and to a late spectator; the audit passes', () => {
    const t = fresh();
    const dealt = stateOf(t.spectator).dealt;
    /**
     * Each show: its submission's index, the seats it passed between, its move, and where the events from its
     * submission on start. Two shows at least, with different third seats.
     */
    const shows: { id: number; from: number; to: number; ev: NostrEvent; since: number }[] = [];
    const enough = (): boolean =>
      shows.length >= 2 && new Set(shows.map((x) => SEATS - x.from - x.to)).size >= 2;
    let since = 0;
    for (let n = 0; n < 600 && !enough(); n++) {
      const id = stateOf(t.spectator).submissions.length - 1;
      const at = t.events.length;
      const { seat, action, ev } = step(t);
      if (action.type === 'submit') since = at;
      if (action.type === 'show')
        shows.push({ id, from: seat, to: stateOf(t.spectator).submissions[id]!.by, ev, since });
    }
    expect(enough()).toBe(true);
    for (const show of shows) {
      const third = SEATS - show.from - show.to;
      const cardIn = (s: GameSession) => stateOf(s).submissions[show.id]!.card;
      // The shower and the submitter know the card: one of the three named, from the shower's own hand.
      const card = cardIn(t.players[show.from]!);
      expect(card).not.toBeNull();
      expect(cardIn(t.players[show.to]!)).toBe(card);
      const sub = stateOf(t.players[show.to]!).submissions[show.id]!;
      expect(sub.shownBy).toBe(show.from);
      expect(namedCards(sub)).toContain(card);
      expect(handOf(t, show.from)).toContain(card);
      // The third seat and the spectator know only that a card was shown, and by whom.
      for (const s of [t.players[third]!, t.spectator]) {
        expect(stateOf(s).submissions[show.id]).toMatchObject({ shownBy: show.from, card: null });
      }
      // The wire: the show names neither the card nor its position, and nothing from the submission on carries
      // the position in the clear.
      const content = JSON.parse(show.ev.content) as {
        action: Record<string, unknown>;
        reveals: unknown[];
        shares: unknown[];
      };
      expect(Object.keys(content.action).sort()).toEqual(['actor', 'id', 'packet', 'type']);
      expect(content).toMatchObject({ reveals: [], shares: [] });
      const pos = stateOf(t.players[show.from]!).players[show.from]!.hand.find((h) => h.card === card)!.pos;
      for (const ev of t.events.slice(show.since)) expect(positionsIn(ev)).not.toContain(pos);
    }
    // A show deals nothing: no position changes hands.
    expect(stateOf(t.spectator).dealt).toEqual(dealt);

    // A spectator who joins late folds every show and learns none of them.
    const late = catchUp(t.game, null, t.events, t.game.modules, NOW);
    expect(stateOf(late)).toEqual(stateOf(t.spectator));
    for (const show of shows) expect(stateOf(late).submissions[show.id]!.card).toBeNull();
    // A reloaded seat re-learns exactly the shows it took part in, and nothing else. Each third seat took part in
    // the other show, so reloading the two of them checks both.
    for (const seat of new Set(shows.map((x) => SEATS - x.from - x.to))) {
      const reload = catchUp(t.game, seat, t.events, t.game.modules, NOW);
      expect(stateOf(reload)).toEqual(stateOf(t.players[seat]!));
      for (const show of shows) {
        const known = stateOf(reload).submissions[show.id]!.card !== null;
        expect(known, `seat ${seat}, show ${show.id}`).toBe(seat === show.from || seat === show.to);
      }
    }

    // Two wrong indictments leave the last seat standing; at the end the audit opens every packet.
    dismissNext(t);
    dismissNext(t);
    for (const s of t.all) expect(stateOf(s).stage).toBe('over');
    finish(t);
  }, 120_000);

  it('waits on the closed app that owes a Verdict share, then on the first indicter’s seal, which alone opens the Verdict to the second indicter', () => {
    const t = fresh();
    // The first indictment: seat 0 indicts at its first turn, naming a card of its own, while seat 2's app is closed.
    t.closed.add(2);
    decide(t, 0, wrongIndictment(t, 0));
    for (const s of t.all) {
      expect(stateOf(s).stage).toBe('verdict');
      expect(s.waitingFor()).toEqual([2]);
    }
    // Seat 1's shares are in, seat 2's are not: the indicter can neither read the Verdict nor announce it.
    expect(stateOf(t.players[0]!).verdict.some((v) => v.card === null)).toBe(true);
    expect(t.players[0]!.legalActions()).toEqual([]);
    // Seat 2's app opens and sends its shares by itself: the indicter alone reads the three cards and announces.
    t.closed.delete(2);
    pump(t);
    const verdict = stateOf(t.players[0]!).verdict.map((v) => v.card);
    expect(verdict.every((card) => card !== null)).toBe(true);
    for (const s of [t.players[1]!, t.players[2]!, t.spectator])
      expect(stateOf(s).verdict.map((v) => v.card)).toEqual([null, null, null]);
    for (const s of t.all) expect(s.waitingFor()).toEqual([0]);
    expect(t.players[0]!.legalActions()).toEqual([{ type: 'verdict', actor: 0, upheld: false }]);
    decide(t, 0, { type: 'verdict', actor: 0, upheld: false });
    for (const s of t.all) {
      expect(stateOf(s).players[0]!.dismissed).toBe(true);
      expect(stateOf(s)).toMatchObject({ stage: 'start', turn: 1 });
    }

    // The second indictment: seat 1 names the true Verdict while seat 0's app is closed. Every other share of the
    // three positions went out at the first indictment; only seat 0's own is still owed, sealed to seat 1.
    t.closed.add(0);
    const [party, exhibit, scene] = verdict.map((card) => cardName(card!));
    decide(t, 1, { type: 'indict', actor: 1, party, exhibit, scene });
    for (const s of t.all) {
      expect(stateOf(s).stage).toBe('verdict');
      expect(s.waitingFor()).toEqual([0]);
    }
    expect(stateOf(t.players[1]!).verdict.some((v) => v.card === null)).toBe(true);
    expect(t.players[1]!.legalActions()).toEqual([]);
    // Seat 0's app opens and seals its share of the three positions to seat 1, in one Sealed event of its own.
    t.closed.delete(0);
    const before = t.events.length;
    pump(t);
    const sealed = t.events.slice(before).filter((ev) => ev.kind === KIND.sealed);
    expect(sealed).toHaveLength(1);
    expect(sealed[0]!.pubkey).toBe(getPublicKey(t.game.ids[0]!.sessionSk));
    expect(parseSealed(sealed[0]).sealed.map((x) => [x.pos, x.to])).toEqual(
      VERDICT_POSITIONS.map((pos) => [pos, 1]),
    );
    // Seat 1 reads the Verdict; seat 2, the spectator and a late spectator never do.
    expect(stateOf(t.players[1]!).verdict.map((v) => v.card)).toEqual(verdict);
    const late = catchUp(t.game, null, t.events, t.game.modules, NOW);
    for (const s of [t.players[2]!, t.spectator, late])
      expect(stateOf(s).verdict.map((v) => v.card)).toEqual([null, null, null]);
    expect(t.players[1]!.legalActions()).toEqual([{ type: 'verdict', actor: 1, upheld: true }]);
    decide(t, 1, { type: 'verdict', actor: 1, upheld: true });
    for (const s of t.all) expect(stateOf(s).result?.places).toEqual([2, 1, 2]);
    finish(t);
  }, 120_000);
});
