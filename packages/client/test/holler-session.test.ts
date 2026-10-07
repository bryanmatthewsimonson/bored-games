import { chess } from '@bored-games/chess';
import {
  type Ciphertext,
  G,
  initialDeck,
  jointKey,
  proveShuffle,
  type RandomBytes,
  randomScalar,
  reEncrypt,
} from '@bored-games/deck';
import { canonicalJson, range } from '@bored-games/game-kit';
import { faceOf, type HollerState, holler } from '@bored-games/holler';
import {
  finalizeEvent,
  moveTemplate,
  type NostrEvent,
  parseMove,
  resignTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClientError } from '../src/errors.ts';
import type { GameSession } from '../src/session.ts';
import {
  catchUp,
  deliver,
  LATE,
  makeModuleGame,
  newSession,
  shuffleAll,
  statuses,
  T0,
  type TestGame,
  trust,
} from './helpers.ts';

/*
 * Epoch shuffle and play-phase shares (D073). One 2-seat deck is proved once. Its order is stacked so the first
 * starter is a set-aside Levy and the draw pile can run out before anyone goes out. Scripts are player actions
 * only: the session derives reveals, and a test calls `buildEpoch` when a shuffle is pending.
 */

const DECK = 108;
const SEATS = 2;
const STARTER = 14;
const NEXT = 15;

type Play = { type?: string; actor?: number; pos?: number; card?: number; holler?: boolean; suit?: number };

const asPlay = (action: unknown): Play => action as Play;

function apply(state: HollerState, action: unknown): HollerState {
  const next = holler.apply(state, action);
  if (!next.ok) throw new Error(`${next.error.code}: ${next.error.message}`);
  return next.state;
}

/** Resolve every public reveal the full-mode order already knows. */
function revealAll(state: HollerState): HollerState {
  let guard = 0;
  while (state.phase.type === 'reveal') {
    if (++guard > 400) throw new Error('reveal loop');
    const pos = [...state.phase.positions].sort((a, b) => a - b)[0] as number;
    const card = state.orders[0]?.[pos] ?? null;
    // Epoch positions are not in this helper: scripts stop before a second round's reveals.
    const known = card ?? cardAtOrder(state, pos);
    if (known === null) throw new Error(`no card at ${pos}`);
    state = apply(state, { type: 'reveal', actor: 'deck', deck: 'pile', pos, card: known });
  }
  return state;
}

function cardAtOrder(state: HollerState, pos: number): number | null {
  const epoch = pos < DECK ? 0 : Math.floor(pos / 128);
  const index = pos < DECK ? pos : pos % 128;
  const order = state.orders[epoch];
  return order?.[index] ?? null;
}

function open(order: readonly number[]): HollerState {
  const init = holler.setup({
    rules: holler.defaultRules(),
    seats: SEATS,
    mode: 'full',
    deckOrders: { pile: [...order] },
  });
  if (!init.ok) throw new Error(init.error.message);
  return revealAll(init.value);
}

function pin(order: number[], index: number, card: number): void {
  const at = order.indexOf(card);
  if (at < 0) throw new Error(`missing card ${card}`);
  if (at === index) return;
  const displaced = order[index] as number;
  order[index] = card;
  order[at] = displaced;
}

/**
 * Seat 0 holds Tide 1–7, seat 1 holds Notch 1–7, the starter is a Levy, and the card under it is Kiln 0.
 * Nothing else in the early draw matches Kiln 0, so the seats draw until the late cards.
 */
function stackedOrder(): number[] {
  const order = range(DECK);
  const seat0 = [20, 22, 24, 26, 28, 30, 32];
  const seat1 = [1, 3, 5, 7, 9, 11, 13];
  for (const [i, card] of seat0.entries()) pin(order, i * SEATS, card);
  for (const [i, card] of seat1.entries()) pin(order, i * SEATS + 1, card);
  pin(order, STARTER, 104);
  pin(order, NEXT, 57);
  const kiln = range(DECK).filter((card) => faceOf(card).suit === 3 && card !== 57);
  // The mark is last so it can be played onto an empty pile and name a suit the saved pull matches.
  const late = [105, 106, 107, 101, 102, 103, 0, 19, 38, ...kiln.filter((card) => card !== 100), 100];
  const used = new Set(order.slice(0, 16));
  const early = range(DECK).filter((card) => !used.has(card) && !late.includes(card));
  const tail = [...early, ...late];
  if (tail.length !== DECK - 16) throw new Error(`tail ${tail.length}`);
  for (const [i, card] of tail.entries()) order[16 + i] = card;
  if (new Set(order).size !== DECK) throw new Error('stacked order is not a permutation');
  return order;
}

type Policy = (state: HollerState, legal: readonly unknown[]) => unknown;

function firstOf(legal: readonly unknown[], type: string): unknown | undefined {
  return legal.find((action) => asPlay(action).type === type);
}

function handOf(state: HollerState, seat: number): readonly { pos: number; card: number | null }[] {
  return state.hands[seat] ?? [];
}

/** Prefer a play that sticks the other seat, spends a penalty, and does not walk into going out. */
function drainPick(state: HollerState, legal: readonly unknown[]): unknown {
  const phase = state.phase;
  if (phase.type === 'catch') {
    const low = state.draw.length < 2 && state.discard.length > 1;
    return firstOf(legal, low ? 'catch' : 'pass') ?? legal[0];
  }
  if (phase.type === 'levy') return firstOf(legal, 'accept') ?? legal[0];
  if (phase.type === 'name') {
    const other = handOf(state, phase.seat === 0 ? 1 : 0);
    const held = new Set(other.map((slot) => (slot.card === null ? null : faceOf(slot.card).suit)));
    const missing = ([0, 1, 2, 3] as const).find((suit) => !held.has(suit));
    return legal.find((action) => asPlay(action).suit === missing) ?? legal[0];
  }
  if (phase.type === 'drawn') {
    const keep = firstOf(legal, 'keep');
    const plays = legal.filter((action) => asPlay(action).type === 'play');
    const hand = handOf(state, phase.seat).length;
    if (hand <= 2 && keep !== undefined) return keep;
    const penalty = plays.find((action) => {
      const kind = faceOf(asPlay(action).card ?? 0).kind;
      return kind === 'pull' || kind === 'levy';
    });
    return penalty ?? keep ?? legal[0];
  }
  if (phase.type !== 'play') return legal[0];
  const plays = legal.filter((action) => asPlay(action).type === 'play');
  const draw = firstOf(legal, 'draw');
  if (plays.length === 0) return draw ?? legal[0];
  const seat = phase.seat;
  const hand = handOf(state, seat);
  if (hand.length === 1) return plays.find((action) => asPlay(action).holler === true) ?? plays[0];
  let best = plays[0] as unknown;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const action of plays) {
    const play = asPlay(action);
    const kind = faceOf(play.card ?? 0).kind;
    let score = 0;
    if (kind === 'levy') score += 80;
    if (kind === 'pull') score += 50;
    if (kind === 'mark') score += 15;
    if (hand.length === 2 && play.holler === true) score -= 250;
    const rest = hand.find((slot) => slot.pos !== play.pos);
    if (hand.length === 2 && rest?.card !== null && rest !== undefined) {
      const next = holler.apply(state, action);
      if (next.ok && next.state.discard.length > 0) {
        const top = next.state.discard[next.state.discard.length - 1] as { card: number };
        const still = placeable(rest.card as number, top.card, next.state.activeSuit);
        if (!still && play.holler !== true) score += 120;
        if (still && play.holler !== true) score -= 400;
      }
    }
    const next = holler.apply(state, action);
    if (next.ok) {
      if (next.state.phase.type === 'epoch') score += 500;
      const pending = holler.pending(next.state);
      if (pending.type === 'player') {
        const opp = holler.legalActions(next.state, pending.seat);
        if (opp.length === 1 && asPlay(opp[0]).type === 'draw') score += 40;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

function placeable(card: number, top: number, active: number | null): boolean {
  const face = faceOf(card);
  if (face.kind === 'mark' || face.kind === 'levy') return true;
  if (active !== null && face.suit === active) return true;
  const above = faceOf(top);
  if (face.kind === 'number' && above.kind === 'number' && face.rank === above.rank) return true;
  return face.action !== null && face.action === above.action;
}

function challengePick(state: HollerState, legal: readonly unknown[]): unknown {
  if (state.phase.type === 'levy') return firstOf(legal, 'challenge') ?? legal[0];
  if (state.phase.type === 'catch') return firstOf(legal, 'pass') ?? legal[0];
  const levy = legal.find((action) => faceOf(asPlay(action).card ?? -1).kind === 'levy');
  if (levy !== undefined) return levy;
  return legal.find((action) => asPlay(action).holler === true) ?? legal[0];
}

/** Leave one card undeclared so the other seat can catch while the pile still has cards. */
function shrinkPick(state: HollerState, legal: readonly unknown[]): unknown {
  if (state.phase.type === 'catch') return firstOf(legal, 'catch') ?? legal[0];
  if (state.phase.type === 'levy') return firstOf(legal, 'accept') ?? legal[0];
  if (state.phase.type === 'drawn') return firstOf(legal, 'play') ?? firstOf(legal, 'keep') ?? legal[0];
  const quiet = legal.find((action) => asPlay(action).type === 'play' && asPlay(action).holler !== true);
  return quiet ?? legal[0];
}

function roundPick(_state: HollerState, legal: readonly unknown[]): unknown {
  return legal.find((action) => asPlay(action).holler === true) ?? legal[0];
}

const SAVED_PULL = 86;

/** Hold one pull, declare the card beside it, and go out on the pull while the pile can pay the draw. */
function savePull(state: HollerState, legal: readonly unknown[]): unknown {
  if (state.phase.type === 'catch') return firstOf(legal, 'pass') ?? legal[0];
  if (state.phase.type === 'levy') return firstOf(legal, 'accept') ?? legal[0];
  if (state.phase.type === 'name') return legal.find((action) => asPlay(action).suit === 1) ?? legal[0];
  const plays = legal.filter((action) => asPlay(action).type === 'play');
  const saved = plays.filter((action) => asPlay(action).card === SAVED_PULL);
  const other = plays.filter((action) => asPlay(action).card !== SAVED_PULL);
  const seat = state.phase.type === 'play' || state.phase.type === 'drawn' ? state.phase.seat : 0;
  const size = handOf(state, seat).length;
  if (size === 1 && saved.length > 0)
    return saved.find((action) => asPlay(action).holler === true) ?? saved[0];
  if (size === 2 && saved.length > 0) {
    const declared = other.find((action) => asPlay(action).holler === true);
    if (declared !== undefined) return declared;
  }
  if (other.length > 0) return other.find((action) => asPlay(action).holler !== true) ?? other[0];
  if (saved.length > 0) return saved.find((action) => asPlay(action).holler !== true) ?? saved[0];
  return firstOf(legal, 'keep') ?? firstOf(legal, 'draw') ?? legal[0];
}

function drive(
  order: readonly number[],
  policy: Policy,
  stop: (state: HollerState, actions: readonly unknown[]) => boolean,
  limit: number,
): { state: HollerState; actions: unknown[] } | null {
  let state = open(order);
  const actions: unknown[] = [];
  for (let step = 0; step < limit; step++) {
    if (stop(state, actions)) return { state, actions };
    if (state.phase.type === 'epoch' || state.phase.type === 'over' || state.phase.type === 'grant')
      return null;
    if (state.phase.type === 'reveal') {
      state = revealAll(state);
      continue;
    }
    const pending = holler.pending(state);
    if (pending.type !== 'player') return null;
    const legal = holler.legalActions(state, pending.seat);
    if (legal.length === 0) return null;
    const action = policy(state, legal);
    if (!legal.some((item) => canonicalJson(item) === canonicalJson(action))) return null;
    actions.push(action);
    state = apply(state, action);
  }
  return null;
}

const lastPlay = (actions: readonly unknown[]): Play | undefined =>
  actions.length === 0 ? undefined : asPlay(actions[actions.length - 1]);

interface Scripts {
  order: number[];
  challenge: unknown[] | null;
  catchLive: unknown[] | null;
  pullLive: unknown[] | null;
  round: unknown[] | null;
  mid: unknown[] | null;
  bestDraw: number;
}

function seek(order: number[]): Scripts {
  const found: Scripts = {
    order,
    challenge: null,
    catchLive: null,
    pullLive: null,
    round: null,
    mid: null,
    bestDraw: DECK,
  };
  const challenge = drive(order, challengePick, (state) => state.phase.type === 'answer', 800);
  found.challenge = challenge?.actions ?? null;
  const liveCatch = drive(
    order,
    shrinkPick,
    (state, actions) => lastPlay(actions)?.type === 'catch' && state.phase.type === 'play',
    2500,
  );
  found.catchLive = liveCatch?.actions ?? null;
  const livePull = drive(
    order,
    savePull,
    (state, actions) => {
      const last = lastPlay(actions);
      return (
        last?.type === 'play' &&
        faceOf(last.card ?? -1).kind === 'pull' &&
        state.phase.type === 'reveal' &&
        state.phase.kind === 'score'
      );
    },
    2500,
  );
  found.pullLive = livePull?.actions ?? null;
  const round = drive(
    order,
    roundPick,
    (state) => state.phase.type === 'epoch' && state.phase.purpose === 'round',
    2500,
  );
  found.round = round?.actions ?? null;
  let bestDraw = DECK;
  const mid = drive(
    order,
    drainPick,
    (state) => {
      bestDraw = Math.min(bestDraw, state.draw.length);
      return state.phase.type === 'epoch' && state.phase.purpose === 'mid';
    },
    4000,
  );
  found.mid = mid?.actions ?? null;
  found.bestDraw = bestDraw;
  return found;
}

function missing(found: Scripts): string[] {
  const gaps: string[] = [];
  if (found.challenge === null) gaps.push('challenge');
  if (found.catchLive === null) gaps.push('catch');
  if (found.pullLive === null) gaps.push('pull');
  if (found.round === null) gaps.push('round');
  if (found.mid === null) gaps.push(`mid(draw ${found.bestDraw})`);
  return gaps;
}

function findScripts(): Scripts {
  const stacked = seek(stackedOrder());
  const gaps = missing(stacked);
  if (gaps.length > 0) throw new Error(`stacked order missed ${gaps.join(', ')}`);
  return stacked;
}

interface Fixture {
  game: TestGame;
  prefix: NostrEvent[];
  scripts: Scripts;
}

let fx: Fixture;

function proveOpening(
  game: TestGame,
  players: readonly GameSession[],
  order: readonly number[],
): NostrEvent[] {
  const secrets = game.ids.map((id) => id.deckSecret);
  const X = jointKey(secrets.map((secret) => G.multiply(secret)));
  let deck = initialDeck('pile', DECK);
  const steps: NostrEvent[] = [];
  let prevId = game.rootId;
  for (let seat = 0; seat < SEATS; seat++) {
    const psi = seat === 0 ? [...order] : range(DECK);
    const rPrime: bigint[] = [];
    const out: Ciphertext[] = [];
    for (let i = 0; i < DECK; i++) {
      const r = randomScalar(game.rnd);
      rPrime.push(r);
      out.push(reEncrypt(deck[psi[i] as number] as Ciphertext, X, r));
    }
    const proof = proveShuffle(
      deck,
      out,
      X,
      psi,
      rPrime,
      { rootId: game.rootId, seat, deckId: 'pile' },
      game.rnd,
    );
    const ev = finalizeEvent(
      moveTemplate(
        {
          rootId: game.rootId,
          prevId,
          seq: seat + 1,
          content: { type: 'shuffle', deck: out, proof },
        },
        T0 + 100 + seat,
      ),
      game.ids[seat]?.sessionSk as Uint8Array,
      game.rnd,
    );
    trust(players, [ev]);
    const results = statuses(deliver(players, [ev]));
    if (results.some((status) => status !== 'accepted'))
      throw new Error(`shuffle ${seat}: ${results.join(', ')}`);
    steps.push(ev);
    prevId = ev.id;
    deck = out;
  }
  return steps;
}

class Table {
  readonly players: GameSession[];
  readonly spectator: GameSession;
  t = LATE + 1;

  constructor(events: readonly NostrEvent[]) {
    this.players = [0, 1].map((seat) => catchUp(fx.game, seat, events));
    this.spectator = catchUp(fx.game, null, events);
  }

  all(): GameSession[] {
    return [...this.players, this.spectator];
  }

  state(seat: number | null): HollerState {
    const session = seat === null ? this.spectator : (this.players[seat] as GameSession);
    return session.view().state as HollerState;
  }

  publish(ev: NostrEvent, allow: readonly string[] = ['accepted']): void {
    const results = statuses(deliver(this.all(), [ev], undefined, ev.created_at));
    if (results.some((status) => !allow.includes(status))) throw new Error(results.join(', '));
  }

  /** Publish every play-phase share until none is due. */
  pump(): void {
    for (let guard = 0; guard < 600; guard++) {
      let sent = false;
      for (const session of this.players) {
        const duty = session.duties().find((item) => item.kind === 'share');
        if (duty?.kind !== 'share') continue;
        this.publish(session.buildShares(fx.game.rnd, this.t++));
        sent = true;
        break;
      }
      if (!sent) return;
    }
    throw new Error('share pump did not finish');
  }

  replay(actions: readonly unknown[]): void {
    for (const action of actions) {
      this.pump();
      const pending = this.spectator.view().pending;
      if (pending.type !== 'player') throw new Error(`expected a player, saw ${pending.type}`);
      const session = this.players[pending.seat] as GameSession;
      const want = canonicalJson(action);
      const legal = session.legalActions().find((item) => canonicalJson(item) === want);
      if (legal === undefined) {
        throw new Error(`not legal for seat ${pending.seat}: ${want}`);
      }
      this.publish(session.buildAction(legal, fx.game.rnd, this.t++));
    }
    this.pump();
  }

  playEpoch(): void {
    for (let seat = 0; seat < SEATS; seat++) {
      const session = this.players[seat] as GameSession;
      if (!session.duties().some((duty) => duty.kind === 'shuffle')) {
        throw new Error(`seat ${seat} owes no epoch step`);
      }
      const ev = session.buildEpoch(fx.game.rnd, this.t++);
      trust(this.all(), [ev]);
      this.publish(ev);
    }
  }
}

describe('holler session (D073)', { timeout: 180_000 }, () => {
  beforeAll(() => {
    const scripts = findScripts();
    const game = makeModuleGame(holler, SEATS, 'holler-session');
    const players = [0, 1].map((seat) => newSession(game, seat));
    const steps = proveOpening(game, players, scripts.order);
    const deals = players.map((session, seat) => session.buildDeal(game.rnd, T0 + 200 + seat));
    if (statuses(deliver(players, deals)).some((status) => status !== 'accepted')) {
      throw new Error('deal rejected');
    }
    fx = { game, prefix: [...steps, ...deals], scripts };
  });

  function table(): Table {
    return new Table(fx.prefix);
  }

  it('collects shares for the card turned after a set-aside Levy', () => {
    const live = table();
    expect(live.spectator.view().pending).toMatchObject({ type: 'reveal', positions: [NEXT] });
    for (const session of live.players) {
      const duty = session.duties().find((item) => item.kind === 'share');
      expect(duty).toMatchObject({ kind: 'share' });
      if (duty?.kind === 'share') expect(duty.positions).toContain(NEXT);
      expect(session.duties().some((item) => item.kind === 'decide')).toBe(false);
    }
    live.pump();
    expect(live.state(null).discard[0]?.card).toBe(57);
    expect(live.state(null).buried).toEqual([STARTER]);
    expect(
      live.spectator.view().events.some((event) => (event as { starter?: string }).starter === 'levy'),
    ).toBe(true);
    expect(live.spectator.view().pending.type).toBe('player');
  });

  it('runs a voluntary cover before the drawer is asked to keep or play', () => {
    const live = table();
    live.pump();
    const seat = (live.spectator.view().pending as { seat: number }).seat;
    const draw = (live.players[seat] as GameSession)
      .legalActions()
      .find((action) => asPlay(action).type === 'draw');
    expect(draw).toBeDefined();
    live.publish((live.players[seat] as GameSession).buildAction(draw, fx.game.rnd, live.t++));
    expect(live.state(null).phase).toMatchObject({ type: 'cover', kind: 'voluntary' });
    const coverSeat = (live.spectator.view().pending as { seat: number }).seat;
    expect(coverSeat).not.toBe(seat);
    const cover = (live.players[coverSeat] as GameSession).legalActions()[0];
    live.publish((live.players[coverSeat] as GameSession).buildAction(cover, fx.game.rnd, live.t++));
    expect(live.state(null).phase.type).toBe('drawn');
    const known = live
      .state(seat)
      .hands[seat]?.find((slot) => slot.fresh === false && slot.pos !== undefined);
    expect(live.state(seat).hands[seat]?.every((slot) => slot.card !== null)).toBe(true);
    expect(known).toBeDefined();
    const keep = (live.players[seat] as GameSession)
      .legalActions()
      .find((action) => asPlay(action).type === 'keep');
    expect(keep).toBeDefined();
    live.publish((live.players[seat] as GameSession).buildAction(keep, fx.game.rnd, live.t++));
    expect(
      live.spectator.view().events.some((event) => (event as { type?: string }).type === 'covered'),
    ).toBe(true);
  });

  it('lets the next seat challenge a Levy', () => {
    const script = fx.scripts.challenge;
    if (script === null) throw new Error('missing challenge script');
    const live = table();
    live.replay(script);
    expect(live.state(null).phase.type).toBe('answer');
    const seat = (live.spectator.view().pending as { seat: number }).seat;
    const answer = (live.players[seat] as GameSession).legalActions()[0];
    live.publish((live.players[seat] as GameSession).buildAction(answer, fx.game.rnd, live.t++));
    const kinds = live.spectator.view().events.map((event) => (event as { type?: string }).type);
    expect(kinds).toContain('challenged');
    expect(kinds).toContain('answered');
  });

  it('learns a two-seat catch before the offender is asked to play', () => {
    const script = fx.scripts.catchLive;
    if (script === null) throw new Error('missing catch script');
    const live = table();
    const catchAction = script[script.length - 1] as Play;
    live.replay(script.slice(0, -1));
    const before = live.state(null).dealt.length;
    live.replay([catchAction]);
    const offender = 1 - (catchAction.actor as number);
    const hand = live.state(offender).hands[offender] ?? [];
    expect(hand.length).toBeGreaterThanOrEqual(3);
    expect(hand.every((slot) => slot.card !== null)).toBe(true);
    expect(live.spectator.view().pending).toMatchObject({ type: 'player', seat: offender });
    expect(live.state(null).dealt.length).toBeGreaterThan(before);
  });

  it('reveals a go-out Pull with no later player move', () => {
    const script = fx.scripts.pullLive;
    if (script === null) throw new Error('missing pull script');
    const live = table();
    live.replay(script.slice(0, -1));
    const dealt = new Set(live.state(null).dealt.map((entry) => entry.pos));
    const chain = live.spectator.view().head.seq;
    live.replay([script[script.length - 1]]);
    const pending = live.spectator.view().pending;
    expect(pending.type === 'reveal' || pending.type === 'shuffle').toBe(true);
    if (pending.type === 'reveal') {
      expect(pending.positions.some((pos) => !dealt.has(pos))).toBe(true);
      expect(live.spectator.view().head.seq).toBe(chain + 1);
    }
  });

  it('reshuffles an empty pile, then grants a second round', () => {
    const mid = fx.scripts.mid;
    const round = fx.scripts.round;
    if (mid === null || round === null) throw new Error('missing epoch script');
    const emptied = table();
    emptied.replay(mid);
    expect(emptied.state(null).phase).toMatchObject({ type: 'epoch', purpose: 'mid' });
    expect(emptied.spectator.view().pending.type).toBe('shuffle');
    expect(emptied.spectator.waitingFor()).toEqual([0]);
    emptied.playEpoch();
    expect(emptied.state(null).epoch).toBe(1);
    expect(emptied.state(null).phase.type).not.toBe('epoch');

    const next = table();
    next.replay(round);
    expect(next.state(null).phase).toMatchObject({ type: 'epoch', purpose: 'round' });
    expect(next.state(null).scores.every((score) => score < 500)).toBe(true);
    next.playEpoch();
    expect(next.state(null).phase.type).toBe('grant');
    next.pump();
    expect(next.state(null).round).toBe(1);
    expect(next.state(null).phase.type).not.toBe('grant');
    expect(next.spectator.view().pending.type).not.toBe('grant');
  });

  it('stalls the seat who publishes two epoch outputs, not the next shuffler', () => {
    const round = fx.scripts.round;
    if (round === null) throw new Error('missing round script');
    const live = table();
    live.replay(round);
    const seat0 = live.players[0] as GameSession;
    const first = seat0.buildEpoch(fx.game.rnd, live.t++);
    const second = seat0.buildEpoch(fx.game.rnd, live.t++);
    trust(live.all(), [first, second]);
    live.publish(first);
    live.publish(second, ['accepted', 'stored']);
    expect(live.spectator.view().equivocators).toContain(0);
    expect(live.spectator.waitingFor()).toEqual([0]);
    expect(live.players[1]?.duties().some((duty) => duty.kind === 'shuffle')).toBe(false);
  });

  it('drops a Pull that omits the share for a card it deals', () => {
    const script = fx.scripts.pullLive;
    if (script === null) throw new Error('missing pull script');
    const live = table();
    live.replay(script.slice(0, -1));
    const pending = live.spectator.view().pending;
    if (pending.type !== 'player') throw new Error(`pull is not pending: ${pending.type}`);
    const dealt = new Set(live.state(null).dealt.map((entry) => entry.pos));
    const session = live.players[pending.seat] as GameSession;
    const action = script[script.length - 1];
    const ev = session.buildAction(action, fx.game.rnd, live.t++);
    const parsed = parseMove(ev, DECK);
    if (parsed.content.type !== 'action') throw new Error('expected an action');
    const extra = parsed.content.shares.filter((share) => !dealt.has(share.pos));
    expect(extra.length).toBeGreaterThan(0);
    const forged = finalizeEvent(
      moveTemplate(
        {
          rootId: parsed.rootId,
          prevId: parsed.prevId,
          seq: parsed.seq,
          content: {
            ...parsed.content,
            shares: parsed.content.shares.filter((share) => dealt.has(share.pos)),
          },
        },
        parsed.createdAt,
      ),
      fx.game.ids[pending.seat]?.sessionSk as Uint8Array,
      fx.game.rnd,
    );
    expect(live.spectator.receive(forged, live.t++)).toEqual({
      status: 'rejected',
      reason: 'the move omits a share for a card it deals',
    });
  });

  it('learns a reshuffled card before the drawer is asked to keep it', () => {
    const script = fx.scripts.mid;
    if (script === null) throw new Error('missing epoch script');
    const live = table();
    live.replay(script);
    expect(live.state(null).phase).toMatchObject({ type: 'epoch', purpose: 'mid' });
    live.playEpoch();
    const phase = live.state(null).phase;
    expect(phase).toMatchObject({ type: 'cover', kind: 'voluntary' });
    if (phase.type !== 'cover') throw new Error('the draw did not resume');
    expect(live.players[phase.drawer]?.legalActions()).toEqual([]);
    const coverSeat = (live.spectator.view().pending as { seat: number }).seat;
    expect(coverSeat).not.toBe(phase.drawer);
    const cover = (live.players[coverSeat] as GameSession).legalActions()[0];
    live.publish((live.players[coverSeat] as GameSession).buildAction(cover, fx.game.rnd, live.t++));
    const hand = live.state(phase.drawer).hands[phase.drawer] ?? [];
    const dealt = hand.filter((slot) => slot.pos >= 128);
    expect(dealt.length).toBeGreaterThan(0);
    expect(dealt.every((slot) => slot.card !== null)).toBe(true);
    expect(live.spectator.view().pending).toMatchObject({ type: 'player', seat: phase.drawer });
  });

  it('adds only the epoch steps between an empty pile and the reshuffled card', () => {
    const script = fx.scripts.mid;
    if (script === null) throw new Error('missing epoch script');
    const live = table();
    live.replay(script);
    const chain = live.spectator.view().head.seq;
    expect(live.spectator.view().pending.type).toBe('shuffle');
    live.playEpoch();
    expect(live.spectator.view().head.seq).toBe(chain + SEATS);
    expect(live.state(null).dealt.some((entry) => entry.pos >= 128)).toBe(true);
    expect(live.spectator.view().pending.type).not.toBe('shuffle');
  });

  it('refuses a resign at two seats', () => {
    const live = table();
    const seat0 = live.players[0] as GameSession;
    expect(seat0.canResign()).toBe(false);
    expect(() => seat0.buildResign(fx.game.rnd, live.t)).toThrow(ClientError);
    expect(() => seat0.buildResign(fx.game.rnd, live.t)).toThrow(/resigning is not allowed in this game/);
    const id = fx.game.ids[0];
    if (id === undefined) throw new Error('missing seat 0');
    const ev = finalizeEvent(
      resignTemplate({ rootId: fx.game.rootId, headId: seat0.view().head.id, secret: id.deckSecret }, live.t),
      id.sessionSk,
      fx.game.rnd,
    );
    expect(seat0.receive(ev, live.t)).toEqual({
      status: 'rejected',
      reason: 'resigning is not allowed in this game',
    });
  });

  it('ends a three-seat resign unrated once the secrets are in', () => {
    const game = makeModuleGame(holler, 3, 'holler-resign');
    const players = [0, 1, 2].map((seat) => newSession(game, seat));
    const spectator = newSession(game, null);
    const all = [...players, spectator];
    const steps = shuffleAll(game, players, [spectator]);
    const deals = players.map((session, seat) => session.buildDeal(game.rnd, T0 + 200 + seat));
    expect(statuses(deliver(all, deals)).every((status) => status === 'accepted')).toBe(true);
    const live = { t: T0 + 1000 };
    const pump = (): void => {
      for (let guard = 0; guard < 400; guard++) {
        let sent = false;
        for (const session of players) {
          if (!session.duties().some((duty) => duty.kind === 'share')) continue;
          const ev = session.buildShares(game.rnd, live.t++);
          expect(statuses(deliver(all, [ev])).every((status) => status === 'accepted')).toBe(true);
          sent = true;
          break;
        }
        if (!sent) return;
      }
      throw new Error('share pump did not finish');
    };
    pump();
    const pending = spectator.view().pending;
    if (pending.type !== 'player') throw new Error(`no opening decision: ${pending.type}`);
    const actor = players[pending.seat] as GameSession;
    const action = actor.legalActions()[0];
    expect(
      statuses(deliver(all, [actor.buildAction(action, game.rnd, live.t++)])).every((s) => s === 'accepted'),
    ).toBe(true);
    const resigner = players[0] as GameSession;
    expect(resigner.canResign()).toBe(true);
    expect(
      statuses(deliver(all, [resigner.buildResign(game.rnd, live.t++)])).every((s) => s === 'accepted'),
    ).toBe(true);
    expect(spectator.view().phase).toBe('end');
    for (const session of players) {
      if (!session.duties().some((duty) => duty.kind === 'secret')) continue;
      const ev = session.buildSecret(game.rnd, live.t++);
      expect(statuses(deliver(all, [ev])).every((status) => status === 'accepted')).toBe(true);
    }
    expect(spectator.view().outcome).toMatchObject({
      reason: 'resign',
      unrated: true,
      endedBy: { type: 'resign', seat: 0 },
    });
    expect(steps.length).toBe(3);
  });

  it('rejects an epoch at a chess table as a game action', () => {
    const game = makeModuleGame(chess, 2, 'holler-chess-epoch');
    const session = newSession(game, 0);
    const secrets = game.ids.map((id) => id.deckSecret);
    const X = jointKey(secrets.map((secret) => G.multiply(secret)));
    const input = initialDeck('pile', 1);
    const r = randomScalar(game.rnd as RandomBytes);
    const out = [reEncrypt(input[0] as Ciphertext, X, r)];
    const proof = proveShuffle(
      input,
      out,
      X,
      [0],
      [r],
      { rootId: game.rootId, seat: 0, deckId: 'pile' },
      game.rnd,
    );
    const ev = finalizeEvent(
      moveTemplate(
        {
          rootId: game.rootId,
          prevId: game.rootId,
          seq: 1,
          content: { type: 'epoch', epoch: 1, deck: out, proof },
        },
        T0 + 50,
      ),
      game.ids[0]?.sessionSk as Uint8Array,
      game.rnd,
    );
    expect(session.receive(ev, LATE)).toEqual({ status: 'rejected', reason: 'move 1 must be a game action' });
  });
});
