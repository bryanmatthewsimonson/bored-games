import { bank } from '@bored-games/bank';
import { chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import { canonicalJson, createRng, type Rng } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type Hex,
  type NostrEvent,
  resignTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { Identity } from '../../src/types.ts';
import { gameRecord } from '../../src/v2/record.ts';
import type { GameSessionV2 } from '../../src/v2/session.ts';
import { MAX_UNKNOWN_CLAIMS } from '../../src/v2/store.ts';
import { LATE, NOW } from '../helpers.ts';
import {
  type AnyModule,
  act,
  actionAt,
  decider,
  quick,
  runAuto,
  send,
  shuffleAll,
  type V2Table,
  v2Session,
  v2Table,
} from './helpers-v2.ts';

/*
 * The order harness (PROTOCOL-v2 §5, V2-20; build plan T13): for a representative set of scenarios, the events are
 * fed to fresh sessions (every seat and a spectator) in random arrival orders, with duplicates, and then all of them
 * again (a replay). Every fold must equal the incremental one (the sessions that took the events as they were
 * played, their caches warm) and the from-scratch one (fresh sessions fed the log in play order): the views (the
 * result identity, the stop, the places, the audit), the duties, the record (`gameRecord`), the held set, the
 * counted claim or Resign and the rebroadcast set. Claims count by the client's own clock, so scenarios with a claim
 * compare at one fixed clock after delivery (`tick`).
 *
 * The one allowed difference is D069's: a claim or Resign that a waiting cap let go (it arrived before its head,
 * behind lower-id waiting ones) is judged again when it is delivered after its head is held. In the scenario that
 * overflows the waiting pool, every order is compared after the replay pass, which models the §9.1 rebroadcast;
 * every other scenario must also agree before it.
 */

const mv = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });

/** Everything a fold shows, per session of `t`. */
const fold = (t: V2Table): string =>
  canonicalJson({
    views: t.all.map((s) => s.view()),
    duties: t.players.map((s) => s.duties()),
    legal: t.players.map((s) => s.legalActions()),
    waiting: t.all.map((s) => s.waitingFor()),
    held: t.all.map((s) => s.heldSet()),
    counted: t.all.map((s) => s.countedResult()),
    records: t.all.map((s) => gameRecord(s.view())),
    rebroadcast: t.all.map((s) => s.rebroadcast([])),
    steps: t.all.map((s) => s.deckSteps()),
  });

/** A random order of `n` indices with `dups` duplicates spliced in. */
function orderOf(n: number, rng: Rng, dups: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  for (let d = 0; d < dups; d++) order.splice(rng.int(order.length + 1), 0, rng.int(n));
  return order;
}

interface Scenario {
  /** The table the events were played on: its sessions took them in play order (the incremental fold). */
  t: V2Table;
  log: NostrEvent[];
  /** The honest shuffle steps of the log, trusted as `trustSteps` does (their proofs are covered elsewhere). */
  steps?: readonly NostrEvent[];
  /** The local clock every session is ticked to after delivery (claims count by it), or none. */
  clock?: number;
  /** A waiting cap may overflow: orders agree only after the replay pass (D069). */
  overflow?: true;
}

/** The crypto verdicts the fresh sessions of one scenario share, each a function of its key alone (`DeckCaches`). */
type Verdicts = Record<'shuffleOk' | 'sharesOk' | 'moveProofs' | 'moveReveals', Map<string, unknown>> & {
  rolls: { proofs: Map<string, unknown> };
};
const shared = new WeakMap<Scenario, Verdicts>();

/**
 * Fresh sessions (every seat and a spectator) fed `order` (indices into the log), then, with `again`, the whole log
 * once more; then ticked to the scenario's clock. Their folds start from nothing; only the crypto verdicts (shuffle
 * proofs, share, move and roll proofs, by event) are shared between the fresh sessions of one scenario, as the helpers'
 * `replay` shares shuffle verdicts: the first from-scratch fold fills them, cold.
 */
function feed(sc: Scenario, order: readonly number[], again: boolean): V2Table {
  let v = shared.get(sc);
  if (v === undefined) {
    v = {
      shuffleOk: new Map(),
      sharesOk: new Map(),
      moveProofs: new Map(),
      moveReveals: new Map(),
      rolls: { proofs: new Map() },
    };
    for (const ev of sc.steps ?? []) v.shuffleOk.set(ev.id, true);
    shared.set(sc, v);
  }
  const players = sc.t.players.map((_, k) => v2Session(sc.t.game, k));
  const spectator = v2Session(sc.t.game, null);
  const c: V2Table = { game: sc.t.game, players, spectator, all: [...players, spectator], log: [] };
  for (const s of c.all) Object.assign((s as unknown as { caches: Verdicts }).caches, v);
  for (const i of order) send(c, sc.log[i] as NostrEvent);
  if (again) for (const ev of sc.log) send(c, ev);
  if (sc.clock !== undefined) for (const s of c.all) s.tick(sc.clock);
  return c;
}

/**
 * Check `sc` in `orders` random orders: incremental = from scratch = every order (after the replay pass, and before it
 * too unless the scenario may overflow a waiting cap). Returns the incremental table.
 */
function check(sc: Scenario, seed: string, orders: number): V2Table {
  if (sc.clock !== undefined) for (const s of sc.t.all) s.tick(sc.clock);
  const want = fold(sc.t);
  const inPlayOrder = sc.log.map((_, i) => i);
  expect(fold(feed(sc, inPlayOrder, false)), 'from scratch').toBe(want);
  expect(fold(feed(sc, inPlayOrder, true)), 'from scratch, replayed').toBe(want);
  const rng = createRng(seed);
  for (let n = 0; n < orders; n++) {
    const order = orderOf(sc.log.length, rng, Math.max(3, Math.floor(sc.log.length / 10)));
    if (sc.overflow !== true) expect(fold(feed(sc, order, false)), `order ${n}`).toBe(want);
    expect(fold(feed(sc, order, true)), `order ${n}, replayed`).toBe(want);
  }
  return sc.t;
}

const claimOf = (t: V2Table, claimant: number, head: Hex, seat: number, at = NOW): NostrEvent =>
  finalizeEvent(
    timeoutTemplate({ rootId: t.game.rootId, headId: head, seat }, at, '2'),
    (t.game.ids[claimant] as Identity).sessionSk,
    t.game.rnd,
  );

const resignOf = (t: V2Table, seat: number, head: Hex, at = NOW): NostrEvent =>
  finalizeEvent(
    resignTemplate({ rootId: t.game.rootId, headId: head }, at, '2'),
    (t.game.ids[seat] as Identity).sessionSk,
    t.game.rnd,
  );

const randomHex = (rng: Rng): Hex =>
  Array.from({ length: 64 }, () => '0123456789abcdef'[rng.int(16)]).join('') as Hex;

/** `n` events made by `make` at successive dates from `from` whose ids `keep` accepts. */
function grind(n: number, from: number, make: (at: number) => NostrEvent, keep: (id: Hex) => boolean) {
  const out: NostrEvent[] = [];
  for (let at = from; out.length < n; at++) {
    const ev = make(at);
    if (keep(ev.id as Hex)) out.push(ev);
  }
  return out;
}

/** Play `policy` moves on `t` until the game ends or `plies` are played, running `auto` duties after each. */
function playOn(t: V2Table, seed: string, plies: number, auto: Parameters<typeof runAuto>[1] = []): void {
  const rng = createRng(seed);
  for (let i = 0; i < plies; i++) {
    if (auto.length > 0) runAuto(t, auto);
    const k = decider(t);
    if (k === null) break;
    act(t, k, quick((t.players[k] as GameSessionV2).legalActions(), k, rng));
  }
  if (auto.length > 0) runAuto(t, auto);
}

describe('the order harness: incremental, from scratch and in random orders, with duplicates and replays', () => {
  it('V2-20 deckless play (Chess, a random game): views, duties, record, held set and rebroadcast agree in every order', () => {
    const t = v2Table(chess as AnyModule, 2, 'order-chess');
    playOn(t, 'order-chess', 40);
    runAuto(t, ['end']);
    const r = check({ t, log: [...t.log] }, 'order-chess', 6);
    expect(r.spectator.view().head.seq).toBeGreaterThan(10);
  });

  it('V2-20 a deck game with prompt releases (Chain Reaction, 3 seats): the shuffle, the deal and play with every draw released', () => {
    const t = v2Table(chainReaction, 3, 'order-cr');
    const steps = shuffleAll(t);
    runAuto(t);
    playOn(t, 'order-cr', 8, ['release']);
    const releases = t.log.filter((ev) => ev.kind === 7453).length;
    expect(releases).toBeGreaterThan(3);
    check({ t, log: [...t.log], steps }, 'order-cr', 3);
  }, 120_000);

  it('V2-20 dice (Bank 0.2.0, 3 seats): rolls contributed by every seat and derived along the walk', () => {
    const t = v2Table(bank as AnyModule, 3, 'order-bank', { ...bank.defaultRules(), rounds: 5 });
    playOn(t, 'order-bank', 40, ['roll']);
    runAuto(t);
    expect(t.log.filter((ev) => ev.kind === 7453).length).toBeGreaterThan(6);
    check({ t, log: [...t.log] }, 'order-bank', 4);
  }, 60_000);

  it('V2-20 a fork and the stop (Chess): both seats equivocate (M1), with junk at the lower fork; the stop and its places agree', () => {
    const t = v2Table(chess as AnyModule, 2, 'order-stop');
    const [, m2, m3] = [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
      [1, 'b8c6'],
    ].map(([k, u]) => act(t, k as number, mv(k as number, u as string)));
    for (const ev of [
      actionAt(t, 1, (m3 as NostrEvent).id, 4, mv(1, 'd7d6')),
      actionAt(t, 0, (m2 as NostrEvent).id, 3, mv(0, 'd2d4')),
      ...['a7a2', 'b7b2', 'h7h2'].map((u) => actionAt(t, 1, (m3 as NostrEvent).id, 4, mv(1, u))),
    ])
      send(t, ev);
    const r = check({ t, log: [...t.log] }, 'order-stop', 8);
    expect(r.spectator.view()).toMatchObject({ stop: { seat: 0, cancelled: false }, equivocators: [0, 1] });
  });

  it('V2-20 a standing result (Chess): the mate stands against the mater’s later fork, attested by the other seat', () => {
    const t = v2Table(chess as AnyModule, 2, 'order-standing');
    const moves = [
      [0, 'f2f3'],
      [1, 'e7e5'],
      [0, 'g2g4'],
      [1, 'd8h4'],
    ].map(([k, u]) => act(t, k as number, mv(k as number, u as string)));
    runAuto(t, ['end']);
    const rival = actionAt(t, 1, (moves[0] as NostrEvent).id, 2, mv(1, 'c7c5'));
    send(t, rival);
    // The mater's own junk on its rival: E's events never block a result (§5.4 (b)).
    send(t, actionAt(t, 1, rival.id, 3, mv(1, 'a7a2')));
    const r = check({ t, log: [...t.log] }, 'order-standing', 8);
    expect(r.spectator.view()).toMatchObject({ stood: true, result: { kind: 'over' }, stop: null });
  });

  it('V2-20 a claim (Chess) at a fixed clock, with junk claims that overflow the waiting pool: every order agrees after the replay pass (D069)', () => {
    const t = v2Table(chess as AnyModule, 2, 'order-claim');
    const m = [
      [0, 'e2e4'],
      [1, 'e7e5'],
      [0, 'g1f3'],
    ].map(([k, u]) => act(t, k as number, mv(k as number, u as string)));
    const head = (m[2] as NostrEvent).id;
    const deadline = t.spectator.view().deadline;
    const [real] = grind(
      1,
      NOW + deadline,
      (at) => claimOf(t, 0, head, 1, at),
      (id) => id > 'c',
    );
    const rng = createRng('order-claim');
    const junk = grind(
      MAX_UNKNOWN_CLAIMS,
      NOW + 100,
      (at) => claimOf(t, 0, randomHex(rng), 1, at),
      (id) => id < (real as NostrEvent).id,
    );
    for (const ev of [...junk, real as NostrEvent]) send(t, ev);
    for (const s of t.all) s.tick(LATE);
    runAuto(t, ['end']);
    const sc: Scenario = { t, log: [...t.log], clock: LATE, overflow: true };
    const r = check(sc, 'order-claim', 8);
    // The overflow is real: the junk first, then the real claim before its head, delivered once, loses the claim
    // (the waiting cap lets it go, never for good); the replay pass, after its head is held, restores it.
    const first = [...junk.map((ev) => t.log.indexOf(ev)), t.log.indexOf(real as NostrEvent)];
    const order = [...first, ...t.log.map((_, i) => i).filter((i) => !first.includes(i))];
    const once = feed(sc, order, false);
    expect(once.spectator.view()).toMatchObject({ result: null, phase: 'play' });
    expect(fold(feed(sc, order, true))).toBe(fold(r));
    expect(r.spectator.view()).toMatchObject({
      result: { kind: 'claim', head, forfeit: [1] },
      endAttested: [0, 1],
    });
  });

  it('V2-20 a Resign (Chess): counted once its head is held, a move past it linking unscored, a Resign waiting for a head nobody holds', () => {
    const t = v2Table(chess as AnyModule, 2, 'order-resign');
    const [, m2] = [
      [0, 'e2e4'],
      [1, 'e7e5'],
    ].map(([k, u]) => act(t, k as number, mv(k as number, u as string)));
    send(t, resignOf(t, 1, (m2 as NostrEvent).id));
    send(t, resignOf(t, 0, randomHex(createRng('order-resign')), NOW + 1));
    send(t, actionAt(t, 0, (m2 as NostrEvent).id, 3, mv(0, 'g1f3')));
    runAuto(t, ['end']);
    const r = check({ t, log: [...t.log] }, 'order-resign', 8);
    expect(r.spectator.view()).toMatchObject({
      result: { kind: 'resign', forfeit: [1] },
      endAttested: [0, 1],
    });
  });
});
