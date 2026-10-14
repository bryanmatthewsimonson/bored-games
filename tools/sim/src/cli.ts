/**
 * pnpm sim [--game chain-reaction|chess] [--games 4] [--seats 3-6] [--seed sim] [--adversary name]
 *          [--adversary-seat 1] [--vanish-at n] [--resign-when any|reveal|beacon|shuffle|grant|other|share|seal|show]
 *          [--policy quick|<fuzz policy>] [--deadline <seconds>] [--max-rounds 20000] [--full-sync]
 *          [--shuffle-order any|seat] [--race] [--workers n] [--json]
 *
 * Plays whole games between independent clients over an in-memory relay (`simulateGame` in @bored-games/client):
 * the lobby, the shuffle, the deal, play, the audit and attestations, with events delivered out of order and
 * twice, a simulated clock and timeout claims. Game i uses seed "<seed>#<i>", seat count seats[i % n] and, unless
 * --policy names one, the fuzz policy i % (policy count). With --adversary one seat cheats, and each game is also
 * checked for that adversary's expected result. --game picks the game (any fuzz target); --seats defaults to its
 * seat counts (3-6 for Chain Reaction, 2 for Chess). Prints one line per game and the totals; exits 1 on any
 * failure. `--vanish-at n` is also the chain length at which `--adversary resign` resigns (on its own decision), and
 * from which `--adversary resignAny` resigns at its first turn where the game is at a `--resign-when` point (any turn
 * by default; a pending public reveal, dice beacon, reshuffle epoch or grant, another seat's decision, a share or
 * sealed share the seat owes, or a pending private show; D090). --deadline is the move
 * deadline in seconds: the game's own (`simDeadline` in its fuzz target, for a game long enough that the random
 * scheduler leaves some seat unscheduled for a day), else one day. --shuffle-order is the root's setup order (D093):
 * by default `any`, or `seat` for a game that reshuffles in play, as the web app starts games; such a game refuses
 * `any`. In an any-order setup a waiting seat holds back its rank's stagger, and --race instead makes every honest
 * seat due a setup step on one head sign it at once.
 */
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import {
  type Adversary,
  reshufflesInPlay,
  type SimOptions,
  type SimPolicy,
  type SimReport,
  simulateGame,
} from '@bored-games/client';
import { TARGETS } from '@bored-games/fuzz';
import { gameSeed } from '@bored-games/game-kit';
// Cheating seats are test tooling; they live with the client's tests, never in its src.
import {
  ADVERSARIES,
  type AdversaryName,
  adversary as makeAdversary,
  quickPolicy,
  RESIGN_WHEN,
  type ResignWhen,
  unexpected,
} from '../../../packages/client/test/adversaries.ts';

const DEFAULT_GAME = 'chain-reaction';
/** The move deadline when neither --deadline nor the game's fuzz target names one: one day, the protocol's shortest. */
const DEFAULT_DEADLINE = 86400;

interface Job {
  game: string;
  seed: string;
  games: number;
  seatCounts: number[];
  adversary: AdversaryName | null;
  adversarySeat: number;
  vanishAt: number | null;
  resignWhen: ResignWhen;
  policy: string | null;
  deadline: number;
  maxRounds: number;
  fullSync: boolean;
  shuffleOrder: NonNullable<SimOptions['shuffleOrder']>;
  race: boolean;
  worker: number;
  workers: number;
}

interface Result {
  index: number;
  policy: string;
  report: SimReport;
  /** Departures from the adversary's (or an honest game's) expected result. */
  unexpected: string[];
  seconds: number;
}

type Msg = { kind: 'game'; result: Result } | { kind: 'done' };

function policyFor(job: Job, index: number): { name: string; choose: SimPolicy } {
  const target = TARGETS[job.game];
  if (target === undefined) throw new Error(`unknown game ${job.game}`);
  if (job.policy === 'quick') return { name: 'quick', choose: quickPolicy };
  const policies = target.policies;
  const p =
    job.policy === null ? policies[index % policies.length] : policies.find((x) => x.name === job.policy);
  if (p === undefined) throw new Error(`unknown policy ${job.policy}`);
  return { name: p.name, choose: (state, seat, legal, rng) => p.choose(state, seat, legal, rng) };
}

function runOne(job: Job, index: number): Result {
  const target = TARGETS[job.game];
  if (target === undefined) throw new Error(`unknown game ${job.game}`);
  const seats = job.seatCounts[index % job.seatCounts.length] as number;
  const policy = policyFor(job, index);
  let adv: Adversary | undefined;
  if (job.adversary !== null)
    adv = makeAdversary(job.adversary, job.adversarySeat, seats, job.vanishAt ?? seats, job.resignWhen);
  const started = performance.now();
  const report = simulateGame({
    seats,
    seed: gameSeed(job.seed, index),
    modules: new Map([[target.module.id, target.module]]),
    game: target.module.id,
    policy: policy.choose,
    deadline: job.deadline,
    maxRounds: job.maxRounds,
    fullSync: job.fullSync,
    shuffleOrder: job.shuffleOrder,
    shuffleRace: job.race,
    ...(adv === undefined ? {} : { adversary: adv }),
  });
  return {
    index,
    policy: policy.name,
    report,
    unexpected: unexpected(report, job.adversarySeat),
    seconds: (performance.now() - started) / 1000,
  };
}

function workerMain(job: Job): void {
  for (let i = job.worker; i < job.games; i += job.workers) {
    parentPort?.postMessage({ kind: 'game', result: runOne(job, i) } satisfies Msg);
  }
  parentPort?.postMessage({ kind: 'done' } satisfies Msg);
}

function parseSeats(spec: string): number[] {
  const range = /^(\d+)-(\d+)$/.exec(spec);
  if (range) {
    const out: number[] = [];
    for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(n);
    return out;
  }
  return spec.split(',').map((s) => Number(s.trim()));
}

const days = (s: number): string => `${(s / 86400).toFixed(1)}d`;

function line(r: Result): string {
  const { report: g } = r;
  const audit = typeof g.audit === 'string' ? g.audit : `fail ${g.audit.fail.join(',')} (${g.audit.reason})`;
  const places = g.outcome === null ? '-' : g.outcome.places.join(',');
  const problems = [...g.failures, ...r.unexpected];
  return [
    g.seed.padEnd(10),
    `${g.seats} seats`,
    r.policy.padEnd(12),
    (g.adversary ?? '-').padEnd(10),
    g.phase.padEnd(9),
    `audit ${audit}`,
    `places ${places}`,
    `forfeits ${g.forfeits.join(',') || '-'}`,
    `actions ${g.actions}`,
    `events ${g.events}`,
    `sealed ${g.kinds[7458] ?? 0}`,
    `rounds ${g.rounds}`,
    `sim ${days(g.duration)}`,
    `claims ${g.claims}`,
    `${r.seconds.toFixed(1)}s`,
    problems.length === 0 ? 'ok' : `FAIL: ${problems.join('; ')}`,
  ].join('  ');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      game: { type: 'string', default: DEFAULT_GAME },
      games: { type: 'string', default: '4' },
      seats: { type: 'string' },
      seed: { type: 'string', default: 'sim' },
      adversary: { type: 'string' },
      'adversary-seat': { type: 'string', default: '1' },
      'vanish-at': { type: 'string' },
      'resign-when': { type: 'string', default: 'any' },
      policy: { type: 'string' },
      deadline: { type: 'string' },
      'max-rounds': { type: 'string', default: '20000' },
      'full-sync': { type: 'boolean', default: false },
      'shuffle-order': { type: 'string' },
      race: { type: 'boolean', default: false },
      workers: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  const name = values.adversary ?? null;
  if (name !== null && !(ADVERSARIES as readonly string[]).includes(name)) {
    console.error(`unknown adversary "${name}"; known: ${ADVERSARIES.join(', ')}`);
    process.exit(2);
  }
  const when = values['resign-when'] as string;
  if (!(RESIGN_WHEN as readonly string[]).includes(when)) {
    console.error(`unknown --resign-when "${when}"; known: ${RESIGN_WHEN.join(', ')}`);
    process.exit(2);
  }
  const game = values.game as string;
  const target = TARGETS[game];
  if (target === undefined) {
    console.error(`unknown game "${game}"; known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }
  // A game that reshuffles in play takes its setup in seat order, as the web app starts it (D093, ruling 12).
  const reshuffles = reshufflesInPlay(target.module, target.module.defaultRules());
  const order = values['shuffle-order'] ?? (reshuffles ? 'seat' : 'any');
  if (order !== 'any' && order !== 'seat') {
    console.error(`unknown --shuffle-order "${order}"; known: any, seat`);
    process.exit(2);
  }
  if (order === 'any' && reshuffles) {
    console.error(`--shuffle-order any: ${game} reshuffles in play, so its setup runs in seat order`);
    process.exit(2);
  }
  if (values.race && order !== 'any') {
    console.error('--race needs --shuffle-order any: in seat order only one seat may sign each step');
    process.exit(2);
  }
  const games = Number(values.games);
  const workers = Math.max(1, Math.min(Number(values.workers ?? availableParallelism()), games));
  const base: Omit<Job, 'worker' | 'workers'> = {
    game,
    seed: values.seed as string,
    games,
    seatCounts: values.seats === undefined ? [...target.defaultSeatCounts] : parseSeats(values.seats),
    adversary: name as AdversaryName | null,
    adversarySeat: Number(values['adversary-seat']),
    vanishAt: values['vanish-at'] === undefined ? null : Number(values['vanish-at']),
    resignWhen: when as ResignWhen,
    policy: values.policy ?? null,
    deadline: Number(values.deadline ?? target.simDeadline ?? DEFAULT_DEADLINE),
    maxRounds: Number(values['max-rounds']),
    fullSync: values['full-sync'] as boolean,
    shuffleOrder: order,
    race: values.race as boolean,
  };
  const started = performance.now();
  const results: Result[] = [];
  await new Promise<void>((resolve) => {
    let finished = 0;
    for (let w = 0; w < workers; w++) {
      const worker = new Worker(new URL(import.meta.url), { workerData: { ...base, worker: w, workers } });
      worker.on('message', (msg: Msg) => {
        if (msg.kind === 'done') {
          if (++finished === workers) resolve();
          return;
        }
        results.push(msg.result);
        if (!values.json) console.log(line(msg.result));
      });
      worker.on('error', (e) => {
        console.error(e);
        process.exit(1);
      });
    }
  });
  results.sort((a, b) => a.index - b.index);
  const seconds = (performance.now() - started) / 1000;
  const failed = results.filter((r) => r.report.failures.length + r.unexpected.length > 0);
  const count = (phase: string): number => results.filter((r) => r.report.phase === phase).length;
  const actions = results.reduce((n, r) => n + r.report.actions, 0);
  const events = results.reduce((n, r) => n + r.report.events, 0);
  if (values.json) {
    console.log(JSON.stringify({ games: results.length, seconds, results }, null, 2));
  } else {
    console.log(
      `\n${results.length} ${game} games (seed "${base.seed}", seats ${base.seatCounts.join(',')}, shuffle order ${order}${base.race ? ' with races' : ''}, adversary ${name ?? 'none'}${name === 'resignAny' ? ` when ${when}` : ''}): ` +
        `${results.length - failed.length} ok, ${failed.length} failed; ${count('done')} done, ${count('cancelled')} cancelled; ` +
        `${actions} actions, ${events} events in ${seconds.toFixed(1)}s (${workers} workers)`,
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

if (isMainThread) await main();
else workerMain(workerData as Job);
