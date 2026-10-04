/**
 * pnpm --filter @bored-games/protocol-model explore [options]
 *
 *   --design v1,d039,ack,ack-lock,fs,fgr,fgr2,stop,stop3   designs (default: all; stop3 = candidate (e), round 3)
 *   --mode private,viewers,public,roll,reveal-block   grant modes (default: private, viewers, public;
 *                                          reveal-block needs stop3)
 *   --over-stands                          stop design: a side that already reached the end stands
 *   --seats 3        --length 4            seats, and moves until the game is over
 *   --moves 3        --acks 1              adversary budgets: moves (rivals included) and acks
 *   --claims 1       --resigns 1           adversary budgets: timeout claims and resigns
 *   --expiries 1     --rivals 2            deadlines that may pass; most adversary moves on one prev
 *   --coalition all|0|0,1                  adversary seats (all = every coalition of 1 or 2 seats)
 *   --honest                               honest-only liveness runs instead (with --lazy <seat>)
 *   --devices 2      --ack-device all|first|checked   two devices per honest seat, and which act on their own
 *   --multi-draw     --absence             moves drawing two positions; humans who leave on a stop
 *   --rule9 at-or-past|strict|none         when a stop overrides a counted claim or resign
 *   --attests 1                            stop3: attestations the adversary may sign
 *   --stale 1        --outbox-rule         honest moves saved offline and published late; the controller rule
 *   --stop-score abort|timeout|last        stop3, 3 or more seats: how a stop scores (default abort)
 *   --own-check                            stop3: a device fetches its seat's own events before signing a move
 *   --cutoff anchor|attest   --exempt-loser   stop3 regressions: no anchor clause; the loser need not attest
 *   protocol v2 (stop3):
 *   --setup 1                              setup steps before play (one per seat, rivals may be well-formed junk)
 *   --cancel-rule played|position          when a stop cancels (position: the H1 regression)
 *   --topmost-only                         only the topmost fork's E is an equivocator (the M1 regression)
 *   --resign-at named|counted              a resign's identity (counted: the round-3 model, for comparison)
 *   --shares 1       --unresolved          adversary Shares events with free anchors; anchors no client holds
 *   --secrets        --cheats 1            the Secret phase and audit; adversary moves that fail the audit
 *   --stop-claims    --no-standing-end     the H2 and N1 regressions
 *   --auto-own-forfeit                     the N2 regression
 *   --scope '<json>'                       one exact Scope (coalition may be "all"); other options are ignored
 *   --max-states 5000000                   give up past this many states per run (reported as incomplete)
 *   --traces                               print the first trace of every violation kind
 *
 * The model and what it checks: src/model.ts and docs/proposals/prompt-reveal.md §6.
 */
import { parseArgs } from 'node:util';
import {
  DESIGNS,
  type Design,
  explore,
  MODES,
  type Mode,
  type Result,
  type Scope,
  type Seat,
} from './model.ts';

const { values } = parseArgs({
  options: {
    design: { type: 'string' },
    mode: { type: 'string' },
    seats: { type: 'string', default: '3' },
    length: { type: 'string', default: '4' },
    moves: { type: 'string', default: '3' },
    acks: { type: 'string', default: '1' },
    claims: { type: 'string', default: '1' },
    resigns: { type: 'string', default: '1' },
    expiries: { type: 'string', default: '1' },
    rivals: { type: 'string', default: '2' },
    coalition: { type: 'string', default: 'all' },
    honest: { type: 'boolean', default: false },
    lazy: { type: 'string' },
    'max-states': { type: 'string', default: '5000000' },
    traces: { type: 'boolean', default: false },
    devices: { type: 'string', default: '1' },
    'ack-device': { type: 'string', default: 'all' },
    'multi-draw': { type: 'boolean', default: false },
    absence: { type: 'boolean', default: false },
    rule9: { type: 'string' },
    'over-stands': { type: 'boolean', default: false },
    attests: { type: 'string', default: '1' },
    stale: { type: 'string', default: '0' },
    'outbox-rule': { type: 'boolean', default: false },
    'stop-score': { type: 'string', default: 'abort' },
    'own-check': { type: 'boolean', default: false },
    cutoff: { type: 'string', default: 'anchor' },
    'exempt-loser': { type: 'boolean', default: false },
    setup: { type: 'string', default: '0' },
    'cancel-rule': { type: 'string', default: 'played' },
    'topmost-only': { type: 'boolean', default: false },
    'resign-at': { type: 'string', default: 'named' },
    shares: { type: 'string', default: '0' },
    unresolved: { type: 'boolean', default: false },
    secrets: { type: 'boolean', default: false },
    cheats: { type: 'string', default: '0' },
    'stop-claims': { type: 'boolean', default: false },
    'no-standing-end': { type: 'boolean', default: false },
    'auto-own-forfeit': { type: 'boolean', default: false },
    scope: { type: 'string' },
  },
});

const num = (s: string | undefined, name: string): number => {
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
};
const seats = num(values.seats, 'seats');
const designs = (values.design?.split(',') ?? DESIGNS) as Design[];
const modes = (values.mode?.split(',') ?? MODES) as Mode[];
for (const d of designs) if (!DESIGNS.includes(d)) throw new Error(`unknown design ${d}`);
for (const m of modes)
  if (![...MODES, 'roll', 'reveal-block'].includes(m)) throw new Error(`unknown mode ${m}`);

function coalitions(n: number = seats): Seat[][] {
  if (values.honest) return [[]];
  if (values.coalition !== 'all') return [values.coalition.split(',').map((x) => num(x, 'coalition'))];
  const out: Seat[][] = [];
  for (let a = 0; a < n; a++) {
    out.push([a]);
    for (let b = a + 1; b < n; b++) out.push([a, b]);
  }
  return out;
}

const started = Date.now();

/** Prints one run line (the coalitions summed) and, with --traces, the first trace of each kind. */
function report(label: string, runs: () => Iterable<Result>): void {
  const t = Date.now();
  let states = 0;
  let complete = true;
  const counts: Record<string, number> = {};
  const firsts: Result['violations'] = {};
  for (const r of runs()) {
    states += r.states;
    complete &&= r.complete;
    for (const [k, v] of Object.entries(r.violations)) {
      if (v === undefined) continue;
      counts[k] = (counts[k] ?? 0) + v.count;
      firsts[k as keyof Result['violations']] ??= v;
    }
  }
  const found = Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
  console.info(
    `${label} ${String(states).padStart(9)} states ${complete ? 'complete ' : 'PARTIAL  '}` +
      `${String(Date.now() - t).padStart(7)} ms  ${found === '' ? 'no violation' : found}`,
  );
  if (values.traces)
    for (const v of Object.values(firsts)) {
      if (v === undefined) continue;
      console.info(`    ${v.first.kind}: ${v.first.detail}`);
      for (const step of v.first.trace) console.info(`      ${step}`);
    }
}

if (values.scope !== undefined) {
  // One exact scope, as the report and the docs list them (T0c): every coalition of 1 or 2 seats with "all".
  const raw = JSON.parse(values.scope) as Omit<Scope, 'coalition'> & { coalition: Seat[] | 'all' };
  const list = raw.coalition === 'all' ? coalitions(raw.seats) : [raw.coalition];
  for (const coalition of list)
    report(`${raw.design} ${raw.mode} {${coalition.join(',')}}`, () => [
      explore({ maxStates: num(values['max-states'], 'max-states'), ...raw, coalition }),
    ]);
  console.info(`total ${Date.now() - started} ms`);
  process.exit(0);
}

for (const design of designs) {
  for (const mode of modes)
    report(`${design.padEnd(8)} ${mode.padEnd(8)}`, () =>
      coalitions().map((coalition) =>
        explore({
          design,
          mode,
          seats,
          length: num(values.length, 'length'),
          coalition,
          advMoves: num(values.moves, 'moves'),
          advAcks: num(values.acks, 'acks'),
          advClaims: num(values.claims, 'claims'),
          advResigns: num(values.resigns, 'resigns'),
          expiries: num(values.expiries, 'expiries'),
          rivalsPerPrev: num(values.rivals, 'rivals'),
          lazy: values.lazy === undefined ? null : num(values.lazy, 'lazy'),
          maxStates: num(values['max-states'], 'max-states'),
          devices: num(values.devices, 'devices'),
          ackDevice: values['ack-device'] as 'all' | 'first' | 'checked',
          multiDraw: values['multi-draw'],
          absence: values.absence,
          overStands: values['over-stands'],
          advAttests: num(values.attests, 'attests'),
          stale: num(values.stale, 'stale'),
          outboxRule: values['outbox-rule'],
          stopScore: values['stop-score'] as 'abort' | 'timeout' | 'last',
          ownCheck: values['own-check'],
          cutoff: values.cutoff as 'anchor' | 'attest',
          exemptLoser: values['exempt-loser'],
          setup: num(values.setup, 'setup'),
          cancelRule: values['cancel-rule'] as 'played' | 'position',
          topmostOnly: values['topmost-only'],
          resignAt: values['resign-at'] as 'named' | 'counted',
          advShares: num(values.shares, 'shares'),
          unresolved: values.unresolved,
          secrets: values.secrets,
          advCheats: num(values.cheats, 'cheats'),
          stopClaims: values['stop-claims'],
          noStandingEnd: values['no-standing-end'],
          autoOwnForfeit: values['auto-own-forfeit'],
          ...(values.rule9 === undefined ? {} : { rule9: values.rule9 as 'at-or-past' | 'strict' | 'none' }),
        }),
      ),
    );
}
console.info(`total ${Date.now() - started} ms`);
