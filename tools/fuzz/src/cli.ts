/**
 * pnpm fuzz [--game tilestock] [--games 1000] [--seed fuzz] [--players 3-6]
 *           [--workers 4] [--no-views] [--max-steps 20000] [--json]
 * pnpm fuzz --one "<game seed>" --players <n>     (re-run one game, verbose)
 *
 * Runs seeded random-legal-move games and checks every invariant after every
 * action. Game i of a batch uses seed "<seed>#<i>" and seat count
 * players[i % players.length], so any failure is reproducible on its own.
 */
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { type FuzzFailure, type FuzzGameReport, fuzzGame, gameSeed } from '@bored-games/game-kit';
import { TARGETS } from './index.ts';

interface Job {
  readonly game: string;
  readonly seed: string;
  readonly games: number;
  readonly seatCounts: readonly number[];
  readonly worker: number;
  readonly workers: number;
  readonly checkViews: boolean;
  readonly maxSteps: number;
}

type Msg =
  | {
      kind: 'game';
      index: number;
      steps: number;
      coverage: Record<string, number>;
      failure: FuzzFailure | null;
    }
  | { kind: 'done' };

function runOne(
  job: Pick<Job, 'game' | 'checkViews' | 'maxSteps'>,
  seed: string,
  seats: number,
): FuzzGameReport {
  const target = TARGETS[job.game];
  if (!target) throw new Error(`unknown game ${job.game}`);
  return fuzzGame(target.module, {
    seed,
    seats,
    rules: target.module.defaultRules(),
    policies: target.policies,
    ...(target.deckOrder ? { deckOrder: target.deckOrder } : {}),
    checkViews: job.checkViews,
    maxSteps: job.maxSteps,
  });
}

function workerMain(job: Job): void {
  for (let i = job.worker; i < job.games; i += job.workers) {
    const seats = job.seatCounts[i % job.seatCounts.length] as number;
    const r = runOne(job, gameSeed(job.seed, i), seats);
    const msg: Msg = {
      kind: 'game',
      index: i,
      steps: r.steps,
      coverage: { ...r.coverage },
      failure: r.failure,
    };
    parentPort?.postMessage(msg);
    if (r.failure) break;
  }
  parentPort?.postMessage({ kind: 'done' } satisfies Msg);
}

function parsePlayers(spec: string): number[] {
  const range = /^(\d+)-(\d+)$/.exec(spec);
  if (range) {
    const out: number[] = [];
    for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(n);
    return out;
  }
  return spec.split(',').map((s) => Number(s.trim()));
}

function repro(f: FuzzFailure, game: string): string {
  return `pnpm fuzz --game ${game} --one "${f.seed}" --players ${f.seats}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      game: { type: 'string', default: 'tilestock' },
      games: { type: 'string', default: '1000' },
      seed: { type: 'string', default: 'fuzz' },
      players: { type: 'string' },
      workers: { type: 'string' },
      'no-views': { type: 'boolean', default: false },
      'max-steps': { type: 'string', default: '20000' },
      one: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  const game = values.game as string;
  const target = TARGETS[game];
  if (!target) {
    console.error(`unknown game "${game}"; known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }
  const seatCounts = values.players ? parsePlayers(values.players) : [...target.defaultSeatCounts];
  const checkViews = !values['no-views'];
  const maxSteps = Number(values['max-steps']);

  if (values.one) {
    const r = runOne({ game, checkViews, maxSteps }, values.one, seatCounts[0] as number);
    console.log(`seed ${r.seed}, ${r.seats} seats, policies ${r.policies.join(',')}, ${r.steps} steps`);
    if (r.failure) {
      console.log(`FAILURE at step ${r.failure.step}: ${r.failure.message}`);
      console.log(`action: ${JSON.stringify(r.failure.action)}`);
      console.log(
        `last actions:\n${r.actions
          .slice(-8)
          .map((a) => `  ${JSON.stringify(a)}`)
          .join('\n')}`,
      );
      if (r.failure.stack) console.log(r.failure.stack);
      process.exit(1);
    }
    console.log(`outcome ${JSON.stringify(r.outcome)} hash ${r.finalHash}`);
    return;
  }

  const games = Number(values.games);
  const workers = Math.max(1, Math.min(Number(values.workers ?? availableParallelism()), games));
  const started = performance.now();
  const coverage: Record<string, number> = {};
  const failures: FuzzFailure[] = [];
  let steps = 0;
  let done = 0;
  const pool: Worker[] = [];
  await new Promise<void>((resolve) => {
    let finished = 0;
    for (let w = 0; w < workers; w++) {
      const job: Job = {
        game,
        seed: values.seed as string,
        games,
        seatCounts,
        worker: w,
        workers,
        checkViews,
        maxSteps,
      };
      const worker = new Worker(new URL(import.meta.url), { workerData: job });
      pool.push(worker);
      worker.on('message', (msg: Msg) => {
        if (msg.kind === 'done') {
          if (++finished === workers) resolve();
          return;
        }
        done++;
        steps += msg.steps;
        for (const [k, v] of Object.entries(msg.coverage)) coverage[k] = (coverage[k] ?? 0) + v;
        if (msg.failure) {
          failures.push(msg.failure);
          for (const p of pool) void p.terminate();
          resolve();
        }
        if (!values.json && done % 500 === 0) process.stderr.write(`  ${done}/${games} games\n`);
      });
      worker.on('error', (e) => {
        console.error(e);
        process.exit(1);
      });
    }
  });
  const seconds = (performance.now() - started) / 1000;
  const missing = target.expectedCoverage.filter((t) => !coverage[t]);

  if (values.json) {
    console.log(JSON.stringify({ game, games: done, steps, seconds, failures, coverage, missing }, null, 2));
  } else {
    console.log(`\n${game}: ${done} games, ${steps} actions in ${seconds.toFixed(1)}s (${workers} workers)`);
    console.log(
      `seed "${values.seed}", players ${seatCounts.join(',')}, view checks ${checkViews ? 'on' : 'off'}`,
    );
    console.log('\ncoverage:');
    for (const [k, v] of Object.entries(coverage).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!k.startsWith('event:')) console.log(`  ${k.padEnd(32)} ${v}`);
    }
    if (missing.length > 0) console.log(`\nnever reached: ${missing.join(', ')}`);
    if (failures.length === 0) console.log('\nOK: no invariant failures');
    for (const f of failures) {
      console.log(`\nFAILURE (seed "${f.seed}", ${f.seats} seats, step ${f.step}): ${f.message}`);
      console.log(`  action: ${JSON.stringify(f.action)}`);
      console.log(`  reproduce: ${repro(f, game)}`);
    }
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

if (isMainThread) await main();
else workerMain(workerData as Job);
