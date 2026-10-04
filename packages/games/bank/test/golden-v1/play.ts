import { createHash } from 'node:crypto';
import { canonicalJson, createRng, type GameModule } from '@bored-games/game-kit';
import { type BankEvent, type BankRules, type BankState, DEFAULT_RULES } from '../../src/index.ts';

/** A Bank engine: Bank 0.1.0 is the one these fixtures pin (after T5, its 0.1.0 variant). */
export type BankModule = GameModule<BankState, BankEvent, BankRules>;

/*
 * Bank 0.1.0 golden fixtures (protocol v2 build plan, T1 and D-C): the safety net for the Bank 0.2.0 refactor (T5).
 * `scripts/golden-v1.ts` plays seeded games with the current engine and records, per step, canonical hashes of the
 * state, of everything the session reads from the engine (pending, every seat's legal actions, the roll list, the
 * chosen action's beacon roll, standings, outcome), of the events, and of how the engine answers a fixed set of
 * probe actions (the action parser's whole surface: every seat's bank, stay, roll and contribute, a beacon and a
 * player-sent `rolled`, a wrong roll id, junk). The chosen actions are stored, so `golden-v1.test.ts` replays them
 * without any rng and requires the same hashes from Bank 0.1.0, byte for byte.
 */

/** A truncated SHA-256 of the canonical JSON: 64 bits is plenty to catch a regression, and keeps the file small. */
export const h = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 16);

export interface BankGolden {
  seed: string;
  seats: number;
  rules: BankRules;
  /** The initial state's hash. */
  setup: string;
  /** The actions applied, in order (the dice beacon's `rolled` included). */
  actions: unknown[];
  /** Per step: [reads before the action, state after it, its events, the probes before it]. */
  steps: [string, string, string, string][];
  outcome: unknown;
}

/** What the session reads from the engine at `s`, about to apply `action`. */
export function reads(m: BankModule, s: BankState, action: unknown): unknown {
  return {
    pending: m.pending(s),
    legal: Array.from({ length: s.seats }, (_, seat) => m.legalActions(s, seat)),
    rolls: m.rolls?.(s) ?? null,
    beacon: m.beaconOf?.(s, action) ?? null,
    standings: m.standings(s),
    outcome: m.outcome(s),
  };
}

/** The probe actions at `s`: every seat's bank, stay, roll and contribute, beacons, wrong ids and junk. */
export function probes(s: BankState): unknown[] {
  const open = s.openRoll ?? s.nextRollId;
  const out: unknown[] = [];
  for (let seat = 0; seat < s.seats; seat++) {
    out.push(
      { type: 'bank', actor: seat },
      { type: 'stay', actor: seat },
      { type: 'roll', actor: seat, rollId: s.nextRollId },
      { type: 'contribute', actor: seat, rollId: open },
    );
  }
  out.push(
    { type: 'roll', actor: s.roller, rollId: s.nextRollId + 1 },
    { type: 'roll', actor: s.roller, rollId: s.nextRollId, extra: true },
    { type: 'rolled', actor: 'beacon', id: open, dice: [3, 4] },
    { type: 'rolled', actor: 'beacon', id: open, dice: [7, 1] },
    { type: 'rolled', actor: s.roller, id: open, dice: [3, 4] },
    { type: 'contribute', actor: s.seats, rollId: open },
    { type: 'bank', actor: -1 },
    null,
    'roll',
  );
  return out;
}

/** Each probe's answer: the new state's hash when accepted, else the error code. */
export function probeAnswers(m: BankModule, s: BankState): string[] {
  return probes(s).map((a) => {
    const r = m.apply(s, a);
    return r.ok ? `ok:${h(r.state)}` : r.error.code;
  });
}

export function setupState(m: BankModule, seats: number, rules: BankRules): BankState {
  const r = m.setup({ rules, seats, mode: 'full', deckOrders: {} });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** Replay `actions` from setup, hashing every step. Throws when an action is rejected. */
export function hashGame(m: BankModule, seats: number, rules: BankRules, actions: readonly unknown[]) {
  let s = setupState(m, seats, rules);
  const setup = h(s);
  const steps: [string, string, string, string][] = [];
  for (const [i, action] of actions.entries()) {
    const before = h(reads(m, s, action));
    const answers = h(probeAnswers(m, s));
    const r = m.apply(s, action);
    if (!r.ok) throw new Error(`step ${i}: ${r.error.code} ${r.error.message}`);
    s = r.state;
    steps.push([before, h(s), h(r.events), answers]);
  }
  return { setup, steps, outcome: m.outcome(s), state: s };
}

/** The games of the fixture: `perSeats` seeds for each seat count 2 to 6, the rules varied with the seed. */
export function gameList(perSeats: number): { seed: string; seats: number; rules: BankRules }[] {
  const out: { seed: string; seats: number; rules: BankRules }[] = [];
  for (let seats = 2; seats <= 6; seats++) {
    for (let i = 0; i < perSeats; i++) {
      const rules: BankRules = {
        ...DEFAULT_RULES,
        rounds: i % 3 === 2 ? 10 : 5,
        banking: i % 2 === 0 ? 'table' : 'turn',
      };
      out.push({ seed: `bank-golden-v1-${seats}#${i}`, seats, rules });
    }
  }
  return out;
}

/** Play one game with uniformly random legal actions and fair dice, from the seed. */
export function playGame(m: BankModule, seed: string, seats: number, rules: BankRules): unknown[] {
  const rng = createRng(seed);
  let s = setupState(m, seats, rules);
  const actions: unknown[] = [];
  for (let i = 0; i < 100_000; i++) {
    const p = m.pending(s);
    if (p.type === 'over') return actions;
    let action: unknown;
    if (p.type === 'beacon')
      action = { type: 'rolled', actor: 'beacon', id: p.id, dice: [rng.int(6) + 1, rng.int(6) + 1] };
    else if (p.type === 'player') action = rng.pick(m.legalActions(s, p.seat));
    else throw new Error(`unexpected pending ${p.type}`);
    const r = m.apply(s, action);
    if (!r.ok) throw new Error(`${seed} step ${i}: ${r.error.message}`);
    actions.push(action);
    s = r.state;
  }
  throw new Error(`${seed}: no end`);
}
