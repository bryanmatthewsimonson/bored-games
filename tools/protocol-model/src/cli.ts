/**
 * pnpm --filter @bored-games/protocol-model explore [options]
 *
 *   --design v1,d039,ack,ack-lock,fs,fgr,fgr2,stop,stop3   designs (default: all; stop3 = candidate (e), round 3)
 *   --mode private,viewers,public,roll     grant modes (default: private, viewers, public)
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
 *   --max-states 5000000                   give up past this many states per run (reported as incomplete)
 *   --traces                               print the first trace of every violation kind
 *
 * The model and what it checks: src/model.ts and docs/proposals/prompt-reveal.md §6.
 */
import { parseArgs } from 'node:util';
import { DESIGNS, type Design, explore, MODES, type Mode, type Result, type Seat } from './model.ts';

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
for (const m of modes) if (![...MODES, 'roll'].includes(m)) throw new Error(`unknown mode ${m}`);

function coalitions(): Seat[][] {
  if (values.honest) return [[]];
  if (values.coalition !== 'all') return [values.coalition.split(',').map((x) => num(x, 'coalition'))];
  const out: Seat[][] = [];
  for (let a = 0; a < seats; a++) {
    out.push([a]);
    for (let b = a + 1; b < seats; b++) out.push([a, b]);
  }
  return out;
}

const started = Date.now();
for (const design of designs) {
  for (const mode of modes) {
    const t = Date.now();
    let states = 0;
    let complete = true;
    const counts: Record<string, number> = {};
    const firsts: Result['violations'] = {};
    for (const coalition of coalitions()) {
      const r = explore({
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
        ...(values.rule9 === undefined ? {} : { rule9: values.rule9 as 'at-or-past' | 'strict' | 'none' }),
      });
      states += r.states;
      complete &&= r.complete;
      for (const [k, v] of Object.entries(r.violations)) {
        if (v === undefined) continue;
        counts[k] = (counts[k] ?? 0) + v.count;
        const key = k as keyof Result['violations'];
        firsts[key] ??= v;
      }
    }
    const found = Object.entries(counts)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    console.info(
      `${design.padEnd(8)} ${mode.padEnd(8)} ${String(states).padStart(9)} states ${complete ? 'complete ' : 'PARTIAL  '}` +
        `${String(Date.now() - t).padStart(7)} ms  ${found === '' ? 'no violation' : found}`,
    );
    if (values.traces) {
      for (const v of Object.values(firsts)) {
        if (v === undefined) continue;
        console.info(`    ${v.first.kind}: ${v.first.detail}`);
        for (const step of v.first.trace) console.info(`      ${step}`);
      }
    }
  }
}
console.info(`total ${Date.now() - started} ms`);
