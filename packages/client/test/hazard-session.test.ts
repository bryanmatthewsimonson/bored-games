/*
 * Hazard through real sessions (D087, D088): the dice beacon, a prompt-share charter deck, public cash reveals,
 * play-phase reshuffles and sealed re-deals in one game. Every seat and a spectator fold every event; nothing may be
 * rejected, and every client must agree on the head.
 */
import { makeRollShare, rollSeed } from '@bored-games/deck';
import { faces } from '@bored-games/dice';
import type { NostrEvent } from '@bored-games/protocol';
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

function build(
  s: GameSession,
  game: ReturnType<typeof makeModuleGame>,
  all: GameSession[],
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
      const v = s.view();
      return s.buildAction(
        farm(v.state as HazardState, v.mySeat as number, s.legalActions() as HazardAction[]),
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
  const rejected: string[] = [];
  let state: HazardState | null = null;
  for (let step = 0; step < 20_000; step++) {
    let progressed = false;
    for (const s of players) {
      const before = (spectator.view().state as HazardState | null)?.rolls.length ?? 0;
      const ev = build(s, game, all);
      if (ev === null) continue;
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
  expect(rejected).toEqual([]);
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
