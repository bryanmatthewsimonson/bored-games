import { assertJsonSafe, jsonEqual } from './canonical.ts';
import { stateHash } from './hash.ts';
import { createRng, type Rng, range, shuffle } from './prng.ts';
import { replay } from './replay.ts';
import type { DeckSpec, GameModule, Learn, LogEntry, Outcome, RevealAction, Seat } from './types.ts';

/**
 * Generic random-playout fuzzer. It drives any GameModule in full mode with
 * weighted random legal moves and checks, after every action:
 *  - the module's invariants;
 *  - input states are not mutated (they are deep-frozen);
 *  - states survive a JSON round trip;
 *  - the pending player has a legal action, and sampled legal actions apply;
 *  - an action re-attributed to another seat is rejected;
 *  - every seat's view (public log + its own learned cards) equals the
 *    redaction of the full state, as does the spectator view;
 * and at the end that replaying the public log reproduces the final state.
 * It is a test tool only; it is never a player.
 */

export interface FuzzPolicy<S> {
  readonly name: string;
  choose(state: S, seat: Seat, legal: readonly unknown[], rng: Rng): unknown;
}

export const uniformPolicy: FuzzPolicy<unknown> = {
  name: 'uniform',
  choose: (_state, _seat, legal, rng) => rng.pick(legal),
};

export interface FuzzGameOptions<S, R> {
  readonly seed: string;
  readonly seats: number;
  readonly rules: R;
  /** One policy per seat, drawn from this pool by the game's rng. */
  readonly policies?: readonly FuzzPolicy<S>[];
  readonly deckOrder?: (deck: DeckSpec, rng: Rng) => number[];
  readonly maxSteps?: number;
  readonly checkViews?: boolean;
  /** Extra legal actions test-applied per step (0 disables). */
  readonly legalitySample?: number;
}

export interface FuzzFailure {
  readonly seed: string;
  readonly seats: number;
  readonly step: number;
  readonly message: string;
  readonly action: unknown;
  readonly stack: string | null;
}

export interface FuzzGameReport {
  readonly seed: string;
  readonly seats: number;
  readonly policies: readonly string[];
  readonly steps: number;
  readonly outcome: Outcome | null;
  readonly finalHash: string | null;
  readonly coverage: Readonly<Record<string, number>>;
  readonly failure: FuzzFailure | null;
  readonly actions: readonly unknown[];
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

const sameData = jsonEqual;

function learnKey(l: Learn): string {
  return `${l.deck}:${l.pos}`;
}

export function fuzzGame<S, E extends { readonly type: string }, R>(
  module: GameModule<S, E, R>,
  opts: FuzzGameOptions<S, R>,
): FuzzGameReport {
  const rng = createRng(opts.seed);
  const deckRng = rng.fork('deck');
  const moveRng = rng.fork('moves');
  const pool = opts.policies && opts.policies.length > 0 ? opts.policies : [uniformPolicy as FuzzPolicy<S>];
  const seatPolicies = range(opts.seats).map(() => rng.pick(pool));
  const maxSteps = opts.maxSteps ?? 20_000;
  const checkViews = opts.checkViews ?? true;
  const sample = opts.legalitySample ?? 3;
  const coverage: Record<string, number> = {};
  const actions: unknown[] = [];
  const bump = (tag: string): void => {
    coverage[tag] = (coverage[tag] ?? 0) + 1;
  };

  const deckOrders: Record<string, number[]> = {};
  for (const deck of module.decks(opts.rules)) {
    deckOrders[deck.id] = opts.deckOrder ? opts.deckOrder(deck, deckRng) : shuffle(range(deck.size), deckRng);
  }

  let step = 0;
  let lastAction: unknown = null;
  const fail = (message: string, stack: string | null = null): FuzzGameReport => ({
    seed: opts.seed,
    seats: opts.seats,
    policies: seatPolicies.map((p) => p.name),
    steps: step,
    outcome: null,
    finalHash: null,
    coverage,
    failure: { seed: opts.seed, seats: opts.seats, step, message, action: lastAction, stack },
    actions,
  });

  try {
    const fullInit = module.setup({ rules: opts.rules, seats: opts.seats, mode: 'full', deckOrders });
    if (!fullInit.ok) return fail(`setup failed: ${fullInit.error.code} ${fullInit.error.message}`);
    let full = deepFreeze(fullInit.value);

    // Viewers: one per seat plus a spectator (index = seats).
    const viewers: (Seat | null)[] = [...range(opts.seats), null];
    const views: S[] = [];
    const viewLogs: LogEntry[][] = viewers.map(() => []);
    const delivered: Set<string>[] = viewers.map(() => new Set());
    if (checkViews) {
      for (const viewer of viewers) {
        const v = module.setup({ rules: opts.rules, seats: opts.seats, mode: 'view', viewer });
        if (!v.ok) return fail(`view setup failed: ${v.error.message}`);
        views.push(v.value);
      }
    }

    const syncViews = (): string | null => {
      if (!checkViews) return null;
      for (let i = 0; i < viewers.length; i++) {
        const viewer = viewers[i] ?? null;
        if (viewer !== null) {
          for (const l of module.knownTo(full, viewer)) {
            const key = learnKey(l);
            if (delivered[i]?.has(key)) continue;
            const res = module.learn(views[i] as S, l);
            if (!res.ok) return `learn rejected for seat ${viewer}: ${res.error.message}`;
            views[i] = deepFreeze(res.state);
            delivered[i]?.add(key);
            viewLogs[i]?.push({ kind: 'learn', learn: l });
          }
        }
        if (!sameData(views[i], module.view(full, viewer))) {
          return `view mismatch for viewer ${viewer === null ? 'spectator' : `seat ${viewer}`}`;
        }
      }
      return null;
    };

    const initialSync = syncViews();
    if (initialSync) return fail(initialSync);

    while (true) {
      const pending = module.pending(full);
      if (pending.type === 'over') break;
      if (step >= maxSteps) return fail(`no termination within ${maxSteps} steps`);
      step++;

      let action: unknown;
      if (pending.type === 'reveal') {
        const pos = pending.positions[0];
        const order = deckOrders[pending.deck];
        if (pos === undefined || !order) return fail('reveal pending without positions');
        const reveal: RevealAction = {
          type: 'reveal',
          actor: 'deck',
          deck: pending.deck,
          pos,
          card: order[pos] as number,
        };
        action = reveal;
      } else {
        const legal = module.legalActions(full, pending.seat);
        if (legal.length === 0) return fail(`seat ${pending.seat} has no legal action (${pending.decision})`);
        for (let k = 0; k < sample; k++) {
          const probe = moveRng.pick(legal);
          const res = module.apply(full, probe);
          if (!res.ok) {
            lastAction = probe;
            return fail(`legal action rejected: ${res.error.code} ${res.error.message}`);
          }
        }
        const policy = seatPolicies[pending.seat] ?? (uniformPolicy as FuzzPolicy<S>);
        action = policy.choose(full, pending.seat, legal, moveRng);
        if (opts.seats > 1 && action !== null && typeof action === 'object' && 'actor' in action) {
          const impostor = { ...(action as object), actor: (pending.seat + 1) % opts.seats };
          if (module.apply(full, impostor).ok) {
            lastAction = impostor;
            return fail('action accepted from a seat that is not pending');
          }
        }
      }

      lastAction = action;
      const res = module.apply(full, action);
      if (!res.ok) return fail(`chosen action rejected: ${res.error.code} ${res.error.message}`);
      actions.push(action);
      full = deepFreeze(res.state);

      const violations = module.invariants(full);
      if (violations.length > 0) return fail(`invariant: ${violations.join('; ')}`);
      // Throws on anything that would not survive a JSON round trip (undefined, NaN, -0, Map...).
      assertJsonSafe(full);

      bump(`event:${pending.type === 'reveal' ? 'reveal' : 'move'}`);
      for (const ev of res.events) bump(`event:${ev.type}`);
      for (const tag of module.coverage?.(full, res.events) ?? []) bump(tag);

      if (checkViews) {
        for (let i = 0; i < views.length; i++) {
          const vr = module.apply(views[i] as S, action);
          if (!vr.ok) {
            const who = viewers[i] === null ? 'spectator' : `seat ${viewers[i]}`;
            return fail(`view (${who}) rejected action: ${vr.error.code} ${vr.error.message}`);
          }
          views[i] = deepFreeze(vr.state);
          viewLogs[i]?.push({ kind: 'action', action });
        }
        const sync = syncViews();
        if (sync) return fail(sync);
      }
    }

    const outcome = module.outcome(full);
    if (!outcome) return fail('game over without an outcome');
    bump(`end:${outcome.reason}`);

    // Replays from scratch must reproduce the final states exactly.
    const entries: LogEntry[] = actions.map((a) => ({ kind: 'action', action: a }));
    const rep = replay(module, { rules: opts.rules, seats: opts.seats, mode: 'full', deckOrders }, entries);
    if (!rep.ok) return fail(`replay failed at ${rep.index}: ${rep.error.message}`);
    if (!sameData(rep.state, full)) return fail('replay produced a different final state');
    if (checkViews) {
      for (let i = 0; i < viewers.length; i++) {
        const viewer = viewers[i] ?? null;
        const vr = replay(
          module,
          { rules: opts.rules, seats: opts.seats, mode: 'view', viewer },
          viewLogs[i] ?? [],
        );
        if (!vr.ok) return fail(`view replay failed at ${vr.index}: ${vr.error.message}`);
        if (!sameData(vr.state, module.view(full, viewer))) {
          return fail(`view replay mismatch for ${viewer === null ? 'spectator' : `seat ${viewer}`}`);
        }
      }
    }

    return {
      seed: opts.seed,
      seats: opts.seats,
      policies: seatPolicies.map((p) => p.name),
      steps: step,
      outcome,
      finalHash: stateHash(full),
      coverage,
      failure: null,
      actions,
    };
  } catch (err) {
    if (err instanceof Error) return fail(`threw: ${err.name}: ${err.message}`, err.stack ?? null);
    return fail(`threw: ${String(err)}`);
  }
}

export interface FuzzBatchOptions<S, R> extends Omit<FuzzGameOptions<S, R>, 'seed' | 'seats'> {
  readonly seed: string;
  readonly games: number;
  readonly seatCounts: readonly number[];
  readonly stopOnFailure?: boolean;
  readonly onGame?: (report: FuzzGameReport, index: number) => void;
}

export interface FuzzBatchReport {
  readonly games: number;
  readonly steps: number;
  readonly failures: readonly FuzzFailure[];
  readonly coverage: Readonly<Record<string, number>>;
}

/** Game i uses seed `${seed}#${i}`, so any failure reproduces alone. */
export function gameSeed(seed: string, index: number): string {
  return `${seed}#${index}`;
}

export function fuzzBatch<S, E extends { readonly type: string }, R>(
  module: GameModule<S, E, R>,
  opts: FuzzBatchOptions<S, R>,
): FuzzBatchReport {
  const failures: FuzzFailure[] = [];
  const coverage: Record<string, number> = {};
  let steps = 0;
  let games = 0;
  for (let i = 0; i < opts.games; i++) {
    const seed = gameSeed(opts.seed, i);
    const seats = opts.seatCounts[i % opts.seatCounts.length] ?? 3;
    const report = fuzzGame(module, { ...opts, seed, seats });
    games++;
    steps += report.steps;
    for (const [tag, n] of Object.entries(report.coverage)) coverage[tag] = (coverage[tag] ?? 0) + n;
    opts.onGame?.(report, i);
    if (report.failure) {
      failures.push(report.failure);
      if (opts.stopOnFailure ?? true) break;
    }
  }
  return { games, steps, failures, coverage };
}
