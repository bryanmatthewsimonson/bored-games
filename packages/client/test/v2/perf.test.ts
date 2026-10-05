import { appendFileSync } from 'node:fs';
import { chainReaction } from '@bored-games/chain-reaction';
import type { RandomBytes } from '@bored-games/deck';
import { createRng } from '@bored-games/game-kit';
import { luster } from '@bored-games/luster';
import {
  finalizeEvent,
  getPublicKey,
  type Hex,
  moveTemplate,
  type NostrEvent,
  type Proto,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { deckPartitions, parsePartitionMove } from '../../src/partitioned-deck.ts';
import { openSession, type Session, v1Session } from '../../src/session-api.ts';
import type { Duty, Identity } from '../../src/types.ts';
import type { GameSessionV2 } from '../../src/v2/session.ts';
import { MODULES, makeModuleGame, NOW, ROOT_SEEN, type TestGame } from '../helpers.ts';
import { type AnyModule, quick } from './helpers-v2.ts';

/*
 * The performance gate (build plan T13, risk 4): a 6-seat Chain Reaction game and a 2-seat Luster game, played
 * through the session as the sims play them (one session per seat and a spectator, every event delivered to every
 * session, the automatic duties run at once, decisions by the sims' quick policy), must fold under protocol 2 within
 * twice the time protocol 1 takes on the same seeds.
 *
 * What is timed: play from the end of the shuffle (the deal, every decision and every share, roll or attestation
 * it brings) until the game ends or `actions` decisions are made. The shuffle is the same code in both versions (the
 * deck package), so it is built once, untimed, and trusted in every session (as the helpers' `trustSteps`): the v2
 * steps carry the v1 steps' decks and proofs (the seats' keys are the same on one seed), re-signed at proto 2.
 *
 * Robust to CI noise: v1 and v2 runs are interleaved, the gate compares their medians over the runs, and passes
 * when the v2 median is within 2× the v1 median plus a floor (`FLOOR_MS`, against noise on small absolute times).
 * The measured headroom is wide (T13, D071: v2 took 0.81× v1 on the whole 6-seat Chain Reaction game, 0.68× on the
 * whole Luster game), so one run each is enough by default. By default the Luster game plays to its end and the
 * 6-seat Chain Reaction game plays the deal and its first decisions (a whole one costs minutes of CPU per version);
 * `PERF=1` plays both to their end, Luster three times, and writes the times to `PERF_LOG` if set.
 */

const FULL = process.env.PERF !== undefined && process.env.PERF !== '';
const FLOOR_MS = 1500;
const RATIO = 2;

/** A byte source drawing from a seeded rng. */
function bytes(seed: string): RandomBytes {
  const rng = createRng(seed);
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}

/** A game of `module` at `proto` with its shuffle steps (each seat's, in order), built once and trusted later. */
interface Built {
  game: TestGame;
  proto: Proto;
  steps: NostrEvent[];
}

function sessionsOf(b: Built): Session[] {
  const make = (me: Identity | null): Session =>
    openSession({
      modules: b.game.modules,
      table: b.game.table,
      joins: b.game.joins,
      root: b.game.root,
      me,
      rootSeenAt: ROOT_SEEN,
    });
  return [...b.game.ids.map(make), make(null)];
}

/** Mark `steps` as verified in `s` (a test-only shortcut through a private cache, as `trust` and `trustSteps`). */
function trust(s: Session, steps: readonly NostrEvent[]): void {
  const cache =
    s.proto === 1
      ? (v1Session(s) as unknown as { shuffleChecked: Map<Hex, boolean> }).shuffleChecked
      : (s as unknown as { caches: { shuffleOk: Map<Hex, boolean> } }).caches.shuffleOk;
  for (const ev of steps) cache.set(ev.id, true);
}

/** The v1 game and its shuffle, each step built by its seat's session and proved. */
function buildV1(module: AnyModule, seats: number, seed: string, modules: TestGame['modules']): Built {
  const game = { ...makeModuleGame(module, seats, seed, module.defaultRules(), '1'), modules };
  const b: Built = { game, proto: '1', steps: [] };
  const sessions = sessionsOf(b);
  const rnd = bytes(`${seed}:shuffle`);
  for (;;) {
    const k = sessions.findIndex((s) => s.duties().some((d) => d.kind === 'shuffle'));
    if (k < 0) return b;
    const ev = (sessions[k] as Session).buildShuffle(rnd, NOW);
    for (const s of sessions) {
      trust(s, [ev]);
      s.receive(ev, NOW);
    }
    b.steps.push(ev);
  }
}

/** The v2 game on the same seed, its shuffle steps carrying the v1 steps' decks and proofs, signed at proto 2. */
function buildV2(v1: Built, module: AnyModule, seats: number, seed: string): Built {
  const game = {
    ...makeModuleGame(module, seats, seed, module.defaultRules(), '2'),
    modules: v1.game.modules,
  };
  const deck = module.decks(module.defaultRules())[0] ?? null;
  const partitions = deckPartitions(deck);
  const steps: NostrEvent[] = [];
  let prev = game.rootId;
  for (const [i, step] of v1.steps.entries()) {
    const m = parsePartitionMove(step, deck?.size ?? 0, partitions, '1');
    // The same seed gives the same identities in both versions: the step's signer re-signs it.
    const sk = (game.ids.find((id) => getPublicKey(id.sessionSk) === m.pubkey) as Identity).sessionSk;
    const ev = finalizeEvent(
      moveTemplate({ rootId: game.rootId, prevId: prev, seq: i + 1, content: m.content }, NOW, '2'),
      sk,
      bytes(`${seed}:v2-step-${i}`),
    );
    steps.push(ev);
    prev = ev.id;
  }
  return { game, proto: '2', steps };
}

/** What a timed run did. */
interface Run {
  ms: number;
  actions: number;
  events: number;
  phase: string;
}

/** The automatic duties a run performs (the stats attestation, signed by the npub, is left out in both versions). */
const AUTO = new Set<Duty['kind']>(['deal', 'share', 'beacon', 'release', 'roll', 'end', 'secret']);

function build(s: Session, d: Duty, seat: number, rnd: RandomBytes, pick: () => unknown): NostrEvent {
  switch (d.kind) {
    case 'deal':
      return s.buildDeal(rnd, NOW);
    case 'share':
      return v1Session(s).buildShares(rnd, NOW);
    case 'beacon':
      return v1Session(s).buildBeacon(rnd, NOW);
    case 'release':
      return (s as GameSessionV2).buildRelease(rnd, NOW);
    case 'roll':
      return (s as GameSessionV2).buildRoll(d.move, rnd, NOW);
    case 'end':
      return (s as GameSessionV2).buildEndAttest(rnd, NOW);
    case 'secret':
      return s.buildSecret(rnd, NOW);
    case 'decide':
      return s.buildAction(pick(), rnd, NOW);
    default:
      throw new Error(`seat ${seat}: not performed: ${d.kind}`);
  }
}

/**
 * Play `b` from the end of its shuffle: fresh sessions, the steps fed untimed, then the timed play until no seat has
 * a duty left (but the stats attestation) or `actions` decisions are made.
 */
function run(b: Built, seed: string, actions: number): Run {
  const sessions = sessionsOf(b);
  for (const s of sessions) {
    trust(s, b.steps);
    for (const ev of b.steps) s.receive(ev, NOW);
  }
  const players = sessions.slice(0, -1);
  const policy = createRng(`${seed}:policy`);
  const rnd = bytes(`${seed}:play:${b.proto}`);
  let decided = 0;
  let events = 0;
  const t0 = performance.now();
  for (let guard = 0; guard < 100_000 && decided < actions; guard++) {
    let did = false;
    for (const [k, s] of players.entries()) {
      const d = s.duties().find((x) => AUTO.has(x.kind) || x.kind === 'decide');
      if (d === undefined) continue;
      const ev = build(s, d, k, rnd, () => quick(s.legalActions(), k, policy));
      for (const x of sessions) x.receive(ev, NOW);
      if (d.kind === 'decide') decided++;
      events++;
      did = true;
      if (decided >= actions) break;
    }
    if (!did) break;
  }
  const ms = performance.now() - t0;
  return { ms, actions: decided, events, phase: (sessions.at(-1) as Session).view().phase };
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
};

function log(line: string): void {
  const path = process.env.PERF_LOG;
  if (path !== undefined && path !== '') appendFileSync(path, `${line}\n`);
}

/**
 * Time `runs` interleaved runs of each version (v1, v2, v1, v2, …) and return the medians, with the decisions each
 * made (the same on one seed when both versions play the same game).
 */
function gate(module: AnyModule, seats: number, seed: string, actions: number, runs: number) {
  const modules = new Map([...MODULES, [module.id, module]]) as TestGame['modules'];
  const v1 = buildV1(module, seats, seed, modules);
  const v2 = buildV2(v1, module, seats, seed);
  const t1: Run[] = [];
  const t2: Run[] = [];
  for (let i = 0; i < runs; i++) {
    t1.push(run(v1, seed, actions));
    t2.push(run(v2, seed, actions));
  }
  const out = {
    v1: median(t1.map((r) => r.ms)),
    v2: median(t2.map((r) => r.ms)),
    runs: { v1: t1, v2: t2 },
  };
  log(`${module.id} ${seats} seats ${seed}: ${JSON.stringify(out)}`);
  return out;
}

describe('the performance gate: protocol 2 within twice protocol 1 on the same seeds', () => {
  it(
    'a 6-seat Chain Reaction game',
    () => {
      const g = gate(chainReaction as AnyModule, 6, 'perf-cr6', FULL ? 100_000 : 6, 1);
      const [a, b] = [g.runs.v1[0] as Run, g.runs.v2[0] as Run];
      // The same game in both versions: the same decisions (the shuffle fixes the deck, the policy its picks).
      expect(b.actions).toBe(a.actions);
      if (FULL) expect([a.phase, b.phase]).toEqual(['done', 'done']);
      expect(g.v2).toBeLessThanOrEqual(RATIO * g.v1 + FLOOR_MS);
    },
    FULL ? 3_600_000 : 300_000,
  );

  it(
    'a 2-seat Luster game',
    () => {
      const g = gate(luster as AnyModule, 2, 'perf-luster', 100_000, FULL ? 3 : 1);
      const [a, b] = [g.runs.v1[0] as Run, g.runs.v2[0] as Run];
      expect(b.actions).toBe(a.actions);
      expect([a.phase, b.phase]).toEqual(['done', 'done']);
      expect(g.v2).toBeLessThanOrEqual(RATIO * g.v1 + FLOOR_MS);
    },
    FULL ? 3_600_000 : 300_000,
  );
});
