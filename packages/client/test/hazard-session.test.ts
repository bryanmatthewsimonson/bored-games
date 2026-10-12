/*
 * Hazard through real sessions (D087, D088): the dice beacon, a prompt-share charter deck, public cash reveals,
 * play-phase reshuffles and sealed re-deals in one game. Every seat and a spectator fold every event; nothing may be
 * rejected, and every client must agree on the head.
 */
import { makeRollShare, rollSeed } from '@bored-games/deck';
import { faces } from '@bored-games/dice';
import { KIND, type NostrEvent, parseMove, parseShares } from '@bored-games/protocol';
import { expect, it } from 'vitest';
import {
  EPOCH_STRIDE,
  type HazardAction,
  type HazardState,
  hazard,
  neighbors,
  PROVINCES,
  type ProvinceId,
} from '../../games/hazard/src/index.ts';
import type { GameSession } from '../src/index.ts';
import { beaconDomain } from '../src/mixed-beacon.ts';
import { deliver, makeModuleGame, NOW, newSession, seededRandom, trust } from './helpers.ts';

type Of<T extends HazardAction['type']> = Extract<HazardAction, { type: T }>;
const ofType = <T extends HazardAction['type']>(all: readonly HazardAction[], type: T): Of<T>[] =>
  all.filter((a): a is Of<T> => a.type === type);

/**
 * A charter farmer: it masses its muster on its biggest border stack, takes one province a turn with it and stops,
 * so a charter is drawn nearly every turn and the pile runs out; it cashes whenever it may, which feeds the discard.
 */
function farm(s: HazardState, seat: number, legal: readonly HazardAction[]): HazardAction {
  const troops = (p: ProvinceId) => s.troops[PROVINCES.indexOf(p)] ?? 0;
  const border = (p: ProvinceId) => neighbors(p).some((n) => s.owner[PROVINCES.indexOf(n)] !== seat);
  const pick =
    ofType(legal, 'cash')[0] ??
    ofType(legal, 'muster')
      .filter((a) => a.count === s.pool && border(a.province))
      .sort((x, y) => troops(y.province) - troops(x.province))[0] ??
    (s.captured
      ? undefined
      : ofType(legal, 'attack')
          .filter((a) => a.dice === Math.min(3, troops(a.from) - 1) && troops(a.from) > troops(a.to))
          .sort((x, y) => troops(y.from) - troops(x.from) || troops(x.to) - troops(y.to))[0]) ??
    ofType(legal, 'advance').at(-1) ??
    ofType(legal, 'defend').at(-1) ??
    legal.find((a) => a.type === 'endAttack' || a.type === 'endTurn') ??
    legal[0];
  if (pick === undefined) throw new Error('no move');
  return pick;
}

type Chooser = (s: HazardState, seat: number, legal: readonly HazardAction[]) => HazardAction;

/** No decisions: only the automatic duties (shares, seals, rolls) go out. */
const settle: Chooser = () => {
  throw new Error('settling makes no decision');
};

/** A seat that keeps its charters (it cashes only when it must) and never attacks. */
function hoard(_s: HazardState, _seat: number, legal: readonly HazardAction[]): HazardAction {
  const musters = ofType(legal, 'muster');
  const pick =
    ofType(legal, 'cash')[0] ??
    musters.find((a) => a.count === Math.max(...musters.map((m) => m.count))) ??
    ofType(legal, 'defend').at(-1) ??
    legal.find((a) => a.type === 'endAttack' || a.type === 'endTurn') ??
    legal[0];
  if (pick === undefined) throw new Error('no move');
  return pick;
}

/** A seat that hunts `prey`: everything goes at its provinces, from the biggest stack. */
const hunt =
  (prey: number): Chooser =>
  (s, seat, legal) => {
    const troops = (p: ProvinceId) => s.troops[PROVINCES.indexOf(p)] ?? 0;
    const near = (p: ProvinceId) => neighbors(p).some((n) => s.owner[PROVINCES.indexOf(n)] === prey);
    const pick =
      ofType(legal, 'cash')[0] ??
      ofType(legal, 'muster')
        .filter((a) => near(a.province))
        .sort((x, y) => y.count - x.count || troops(y.province) - troops(x.province))[0] ??
      ofType(legal, 'attack')
        .filter(
          (a) => s.owner[PROVINCES.indexOf(a.to)] === prey && a.dice === Math.min(3, troops(a.from) - 1),
        )
        .sort((x, y) => troops(y.from) - troops(x.from))[0];
    return pick ?? farm(s, seat, legal);
  };

function build(
  s: GameSession,
  game: ReturnType<typeof makeModuleGame>,
  all: GameSession[],
  choose: Chooser = farm,
): NostrEvent | null {
  const duty = s.duties()[0];
  if (!duty) return null;
  switch (duty.kind) {
    case 'shuffle': {
      const ev = s.view().phase === 'shuffle' ? s.buildShuffle(game.rnd, NOW) : s.buildEpoch(game.rnd, NOW);
      trust(all, [ev]);
      return ev;
    }
    case 'deal':
      return s.buildDeal(game.rnd, NOW);
    case 'share':
      return s.buildShares(game.rnd, NOW);
    case 'seal':
      return s.buildSealed(game.rnd, NOW);
    case 'beacon':
      return s.buildBeacon(game.rnd, NOW);
    case 'decide': {
      if (choose === settle) return null;
      const v = s.view();
      return s.buildAction(
        choose(v.state as HazardState, v.mySeat as number, s.legalActions() as HazardAction[]),
        game.rnd,
        NOW,
      );
    }
    default:
      return null;
  }
}

it('plays past a reshuffle with roll ids beyond the first epoch slot, every client agreeing', {
  timeout: 600_000,
}, () => {
  const game = makeModuleGame(hazard, 3, 'hazard-session', { defense: 'auto' });
  // Every roll the clients apply, by id: the dice they derived.
  const applied = new Map<number, readonly number[]>();
  const recording: typeof hazard = {
    ...hazard,
    apply(state, action) {
      const r = hazard.apply(state, action);
      const a = action as { type?: string; id?: number; dice?: number[] };
      if (r.ok && a.type === 'rolled') applied.set(a.id as number, a.dice as number[]);
      return r;
    },
  };
  game.modules = new Map([[hazard.id, recording]]);
  // The move that opened each roll: its id binds the roll's shares (D070).
  const requests = new Map<number, string>();
  const players = [0, 1, 2].map((seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  // A spectator that gets every move a round late, and everything else at once: Shares of a reshuffled position
  // reach it before the move that completes the reshuffle.
  const late = newSession(game, null);
  const held: NostrEvent[] = [];
  const toLate = (ev: NostrEvent) => {
    const r = late.receive(ev, NOW);
    if (r.status === 'rejected') rejected.push(`late: ${r.reason}`);
  };
  const rejected: string[] = [];
  let state: HazardState | null = null;
  for (let step = 0; step < 20_000; step++) {
    let progressed = false;
    for (const ev of held.splice(0)) toLate(ev);
    for (const s of players) {
      const before = (spectator.view().state as HazardState | null)?.rolls.length ?? 0;
      const ev = build(s, game, [...all, late]);
      if (ev === null) continue;
      if (ev.kind === KIND.move) held.push(ev);
      else toLate(ev);
      for (const r of deliver(all, [ev], undefined, NOW)[0] ?? [])
        if (r.status === 'rejected') rejected.push(r.reason);
      const after = (spectator.view().state as HazardState | null)?.rolls.length ?? 0;
      for (let id = before; id < after; id++) requests.set(id, ev.id);
      progressed = true;
    }
    state = spectator.view().state as HazardState | null;
    const drewAfter = state?.hands.some((h) => h.some((x) => x.pos >= EPOCH_STRIDE)) ?? false;
    if (state !== null && (state.stage === 'over' || (drewAfter && state.rolls.length > 90))) break;
    if (!progressed) break;
  }
  for (const ev of held.splice(0)) toLate(ev);
  expect(rejected).toEqual([]);
  expect(late.view().head).toEqual(spectator.view().head);
  expect(late.view().state).toEqual(spectator.view().state);
  expect(state).not.toBeNull();
  const s = state as HazardState;
  expect(s.epoch).toBeGreaterThanOrEqual(1);
  expect(s.rolls.length).toBeGreaterThan(84);
  // Every roll's dice are the beacon's: the hash of each seat's share of that roll, not of anything else.
  const rnd = seededRandom('roll-shares');
  for (const [id, dice] of applied) {
    const domain = beaconDomain(game.rootId, requests.get(id) as string);
    const shares = game.ids.map((me) => makeRollShare(me.deckSecret, domain, id, rnd));
    expect(faces(rollSeed(shares), dice.length, 6), `roll ${id}`).toEqual(dice);
  }
  expect(applied.size).toBeGreaterThan(84);
  for (const p of players) {
    expect(p.view().head).toEqual(spectator.view().head);
    expect(hazard.invariants(p.view().state as HazardState)).toEqual([]);
  }
  // Each seat knows its own charters, epoch ones included, and no one else's.
  for (const [seat, p] of players.entries()) {
    const v = p.view().state as HazardState;
    for (const [holder, hand] of v.hands.entries())
      for (const x of hand)
        expect(x.card !== null, `seat ${seat} sees ${holder}'s ${x.pos}`).toBe(x.holders.includes(seat));
  }
});

it('re-deals a charter drawn after a reshuffle to the seat that wipes out its holder', {
  timeout: 900_000,
}, () => {
  const game = makeModuleGame(hazard, 3, 'hazard-sealed-epoch', { defense: 'auto' });
  game.modules = new Map([[hazard.id, hazard]]);
  const players = [0, 1, 2].map((seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  const rejected: string[] = [];
  let hunting = false;
  let settling = false;
  let state: HazardState | null = null;
  for (let step = 0; step < 40_000; step++) {
    let progressed = false;
    for (const [seat, s] of players.entries()) {
      const choose = settling ? settle : !hunting ? farm : seat === 1 ? hoard : hunt(1);
      const ev = build(s, game, all, choose);
      if (ev === null) continue;
      for (const r of deliver(all, [ev], undefined, NOW)[0] ?? [])
        if (r.status === 'rejected') rejected.push(r.reason);
      progressed = true;
    }
    state = spectator.view().state as HazardState | null;
    if (state === null) continue;
    // Hunt once seat 1 holds a charter dealt after a reshuffle.
    if (!hunting && state.hands[1]?.some((x) => x.pos >= EPOCH_STRIDE)) hunting = true;
    // Once seat 1 is out, let its sealed shares and the other duties go out, with no more decisions.
    if (state.out.includes(1) || state.stage === 'over') settling = true;
    if (!progressed) break;
  }
  expect(rejected).toEqual([]);
  const s = state as HazardState;
  expect(s.out).toContain(1);
  // The charters seat 1 held went to its conqueror, and at least one was dealt after a reshuffle.
  const taken = s.hands.flatMap((h, holder) =>
    h.filter((x) => x.holders.includes(1)).map((x) => ({ ...x, holder })),
  );
  expect(taken.some((x) => x.pos >= EPOCH_STRIDE)).toBe(true);
  for (const x of taken) {
    const conqueror = players[x.holder] as GameSession;
    const seen = (conqueror.view().state as HazardState).hands[x.holder]?.find((y) => y.pos === x.pos);
    expect(seen?.card, `charter ${x.pos}`).not.toBeNull();
  }
  for (const p of players) expect(p.view().head).toEqual(spectator.view().head);
});

it('folds a Shares event of a reshuffled charter that arrives before the reshuffle completes', {
  timeout: 600_000,
}, () => {
  const game = makeModuleGame(hazard, 3, 'hazard-early-shares', { defense: 'auto' });
  game.modules = new Map([[hazard.id, hazard]]);
  const players = [0, 1, 2].map((seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  const log: NostrEvent[] = [];
  let early: number | null = null;
  for (let step = 0; step < 20_000 && early === null; step++) {
    let progressed = false;
    for (const s of players) {
      const ev = build(s, game, all);
      if (ev === null) continue;
      deliver(all, [ev], undefined, NOW);
      log.push(ev);
      progressed = true;
      if (ev.kind === KIND.shares && parseShares(ev).shares.some((x) => x.pos >= EPOCH_STRIDE)) {
        early = log.length - 1;
        break;
      }
    }
    if (!progressed) break;
  }
  expect(early).not.toBeNull();
  const at = early as number;
  // The last reshuffle step before it: a client that has not seen it yet does not know the new positions.
  const lastStep = log.findLastIndex((ev, i) => {
    if (i >= at || ev.kind !== KIND.move) return false;
    return parseMove(ev, 44).content.type === 'epoch';
  });
  expect(lastStep).toBeGreaterThanOrEqual(0);
  const order = [...log.keys()].filter((i) => i !== at);
  order.splice(order.indexOf(lastStep), 0, at);
  const late = newSession(game, null);
  trust(
    [late],
    log.filter((ev) => ev.kind === KIND.move),
  );
  const statuses = order.map((i) => late.receive(log[i], NOW));
  expect(statuses.filter((r) => r.status === 'rejected')).toEqual([]);
  expect(late.view().head).toEqual(spectator.view().head);
  expect(late.view().state).toEqual(spectator.view().state);
});
