import { assertJsonSafe, jsonEqual } from './canonical.ts';
import { stateHash } from './hash.ts';
import { createRng, type Rng, range, shuffle } from './prng.ts';
import { replay } from './replay.ts';
import type {
  DealtPosition,
  DeckSpec,
  GameModule,
  Learn,
  LogEntry,
  Outcome,
  RevealAction,
  Seat,
} from './types.ts';

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
 *  - the protocol hooks agree with the deck and the views: `dealt` only grows
 *    and is the same in every view, private cards and pending reveals sit at
 *    positions dealt to their seat or to the public, `revealsOf` claims match
 *    the deck and the actor's positions, and `standings` is the same in every
 *    view and equals the final scores;
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
  /** Returns a reason when a finished game's outcome must never happen; reported as a failure. */
  readonly checkOutcome?: (outcome: Outcome) => string | null;
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

function posKey(deck: string, pos: number): string {
  return `${deck}:${pos}`;
}

function learnKey(l: Learn): string {
  return posKey(l.deck, l.pos);
}

function who(to: Seat | null | undefined): string {
  if (to === undefined) return 'undealt';
  return to === null ? 'public' : `seat ${to}`;
}

/** Epoch positions sit at `EPOCH_STRIDE * epoch + index`, past the opening deck. */
const EPOCH_STRIDE = 128;

interface InstalledOrder {
  readonly epoch: number;
  readonly order: readonly number[];
}

function isEpochAction(action: unknown): action is { readonly type: 'epoch'; readonly epoch: number } {
  if (action === null || typeof action !== 'object') return false;
  const record = action as { readonly type?: unknown; readonly epoch?: unknown };
  return record.type === 'epoch' && typeof record.epoch === 'number';
}

function pendingTag(type: string): string {
  if (type === 'reveal' || type === 'beacon' || type === 'shuffle' || type === 'grant') return type;
  return 'move';
}

/**
 * Replays a full game that reshuffled. The public epoch action carries no order, so each one is preceded by the
 * order the fuzzer installed. A plaintext permutation is the module invariant on the live zones, not the union
 * of the epoch orders.
 */
function replayWithOrders<S, E extends { readonly type: string }, R>(
  module: GameModule<S, E, R>,
  setup: {
    readonly rules: R;
    readonly seats: number;
    readonly deckOrders: Readonly<Record<string, readonly number[]>>;
  },
  actions: readonly unknown[],
  epochs: readonly InstalledOrder[],
): { ok: true; state: S } | { ok: false; message: string } {
  const init = module.setup({
    rules: setup.rules,
    seats: setup.seats,
    mode: 'full',
    deckOrders: setup.deckOrders,
  });
  if (!init.ok) return { ok: false, message: `replay setup failed: ${init.error.message}` };
  let state = init.value;
  let cursor = 0;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (isEpochAction(action)) {
      const next = epochs[cursor];
      cursor += 1;
      const install = module.installDeckOrder;
      if (!install || !next || next.epoch !== action.epoch) {
        return { ok: false, message: `replay missing the order for epoch ${String(action.epoch)} at ${i}` };
      }
      const installed = install(state, next.epoch, next.order);
      if (!installed.ok) {
        return { ok: false, message: `replay install failed at ${i}: ${installed.error.message}` };
      }
      state = installed.state;
    }
    const res = module.apply(state, action);
    if (!res.ok) return { ok: false, message: `replay failed at ${i}: ${res.error.message}` };
    state = res.state;
  }
  return { ok: true, state };
}

/** Inputs no game parses; `revealsOf` must return [] for each without throwing. */
const JUNK_ACTIONS: readonly unknown[] = [null, 0, 'reveal', [], {}, { type: 'nonsense' }];

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
  const fullLog: LogEntry[] = [];
  const bump = (tag: string): void => {
    coverage[tag] = (coverage[tag] ?? 0) + 1;
  };

  const deckOrders: Record<string, number[]> = {};
  for (const deck of module.decks(opts.rules)) {
    deckOrders[deck.id] = opts.deckOrder ? opts.deckOrder(deck, deckRng) : shuffle(range(deck.size), deckRng);
  }
  // Cards placed by a shuffle epoch. Opening positions stay in `deckOrders`. Card 0 is real, so presence is `Map.has`.
  // A plaintext permutation is the module invariant on the live zones, not the union of the epoch orders.
  const dealtCards = new Map<number, number>();
  const epochOrders: InstalledOrder[] = [];
  const cardAtPos = (deck: string, pos: number): number | undefined => {
    if (dealtCards.has(pos)) return dealtCards.get(pos);
    return deckOrders[deck]?.[pos];
  };

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

    // The protocol hooks (PROTOCOL §6, §8.2), checked after every state change.
    // The live views are checked rather than fresh redactions: syncViews has just shown they are equal.
    let prevDealt: readonly DealtPosition[] = [];
    let owner = new Map<string, Seat | null>();
    const label = (i: number): string => {
      const viewer = viewers[i] ?? null;
      return viewer === null ? 'spectator' : `seat ${viewer}`;
    };
    const checkHooks = (): string | null => {
      const dealt = module.dealt(full);
      if (dealt.length < prevDealt.length || !sameData(dealt.slice(0, prevDealt.length), prevDealt)) {
        return 'dealt: an earlier assignment changed or disappeared';
      }
      prevDealt = dealt;
      owner = new Map();
      // A private position may be dealt again (to another seat, after its holder gave it back, or to the public:
      // PROTOCOL §6.1); a public position never is. `owner` is the latest assignment, `holders` every seat ever.
      const holders = new Map<string, Set<Seat>>();
      for (const d of dealt) {
        const key = posKey(d.deck, d.pos);
        if (owner.has(key) && owner.get(key) === null) return `dealt: public position ${key} assigned again`;
        if (cardAtPos(d.deck, d.pos) === undefined) return `dealt: ${key} is not a deck position`;
        if (d.to !== null && !(Number.isInteger(d.to) && d.to >= 0 && d.to < opts.seats)) {
          return `dealt: ${key} assigned to ${String(d.to)}`;
        }
        owner.set(key, d.to);
        if (d.to !== null) holders.set(key, (holders.get(key) ?? new Set()).add(d.to));
      }
      for (const seat of range(opts.seats)) {
        for (const l of module.knownTo(full, seat)) {
          const key = learnKey(l);
          if (!holders.get(key)?.has(seat))
            return `seat ${seat} knows ${key}, which is dealt to ${who(owner.get(key))}`;
        }
      }
      const pending = module.pending(full);
      if (pending.type === 'reveal') {
        const scoring = module.handsReveal?.(full) === true;
        for (const pos of pending.positions) {
          const key = posKey(pending.deck, pos);
          const ownerSeat = owner.get(key);
          if (scoring) {
            if (typeof ownerSeat !== 'number') {
              return `pending scoring reveal of ${key}, which is dealt to ${who(ownerSeat)}`;
            }
          } else if (ownerSeat !== null) {
            return `pending reveal of ${key}, which is dealt to ${who(ownerSeat)}`;
          }
        }
      }
      const standings = module.standings(full);
      if (standings.length !== opts.seats) return `standings has ${standings.length} entries`;
      if (checkViews) {
        for (let i = 0; i < views.length; i++) {
          const view = views[i] as S;
          if (!sameData(module.dealt(view), dealt)) return `dealt differs in the view of ${label(i)}`;
          if (!sameData(module.standings(view), standings))
            return `standings differ in the view of ${label(i)}`;
        }
      }
      const outcome = module.outcome(full);
      if (outcome && !sameData(standings, outcome.scores)) return 'standings differ from the final scores';
      return null;
    };

    /** `revealsOf(full, action)` must claim the deck's cards at positions dealt to the actor. */
    const checkReveals = (action: unknown, actor: Seat | 'deck'): string | null => {
      const claims = module.revealsOf(full, action);
      for (const c of claims) {
        const key = learnKey(c);
        const card = cardAtPos(c.deck, c.pos);
        if (card !== c.card) return `revealsOf claims ${key}=${c.card}, but the deck holds ${card}`;
        if (owner.get(key) !== actor) {
          return `revealsOf claims ${key} for ${actor === 'deck' ? 'a deck reveal' : `seat ${actor}`}, but it is dealt to ${who(owner.get(key))}`;
        }
      }
      if (checkViews) {
        for (let i = 0; i < views.length; i++) {
          if (!sameData(module.revealsOf(views[i] as S, action), claims)) {
            return `revealsOf differs in the view of ${label(i)}`;
          }
        }
      }
      return null;
    };

    for (const junk of JUNK_ACTIONS) {
      if (module.revealsOf(full, junk).length > 0)
        return fail(`revealsOf claims cards for ${JSON.stringify(junk)}`);
    }
    const initialSync = syncViews() ?? checkHooks();
    if (initialSync) return fail(initialSync);

    while (true) {
      const pending = module.pending(full);
      if (pending.type === 'over') break;
      if (step >= maxSteps) return fail(`no termination within ${maxSteps} steps`);
      step++;

      let action: unknown;
      const selection = module.privateSelection?.(full);
      if (selection) {
        // The pure fuzzer models private delivery; signed sessions separately verify its encryption and audit.
        const card = selection.labels?.[selection.index];
        if (card === undefined) return fail('private selection has no full-information label');
        const learn: Learn = { deck: 'supplies', pos: selection.id, card };
        const learned = module.learn(full, learn);
        if (!learned.ok) return fail(`private learn rejected: ${learned.error.message}`);
        full = deepFreeze(learned.state);
        fullLog.push({ kind: 'learn', learn });
        if (checkViews)
          for (const seat of [selection.from, selection.to]) {
            const vr = module.learn(views[seat] as S, learn);
            if (!vr.ok) return fail(`private view learn rejected: ${vr.error.message}`);
            views[seat] = deepFreeze(vr.state);
            viewLogs[seat]?.push({ kind: 'learn', learn });
          }
        action = {
          type: 'transfer',
          actor: selection.from,
          id: selection.id,
          root: '00'.repeat(32),
          anchor: '00'.repeat(32),
          after: '00'.repeat(32),
          packets: [selection.from, selection.to]
            .sort((a, b) => a - b)
            .map((to) => ({ to, ciphertext: 'fuzz-only' })),
        };
      } else if (pending.type === 'reveal') {
        const pos = pending.positions[0];
        const card = pos === undefined ? undefined : cardAtPos(pending.deck, pos);
        if (pos === undefined || card === undefined) return fail('reveal pending without positions');
        const reveal: RevealAction = { type: 'reveal', actor: 'deck', deck: pending.deck, pos, card };
        action = reveal;
      } else if (pending.type === 'beacon') {
        // The fuzzer does not run the beacon. Faces are uniform and come from the move rng, never a seat policy.
        const shape = module.rollShape?.(full) ?? { count: 2, sides: 6 };
        action = {
          type: 'rolled',
          actor: 'beacon',
          id: pending.id,
          dice: Array.from({ length: shape.count }, () => moveRng.int(shape.sides) + 1),
        };
      } else if (pending.type === 'shuffle') {
        // Full mode only. Views learn the new length when the epoch action is applied, not from this install.
        const plain = module.shufflePlaintexts?.(full) ?? [];
        if (plain.length === 0 || plain.length !== pending.from.length) {
          return fail('shuffle pending without plaintexts');
        }
        const order = shuffle([...plain], moveRng);
        const install = module.installDeckOrder?.(full, pending.epoch, order);
        if (!install) return fail('shuffle pending on a module without installDeckOrder');
        if (!install.ok) {
          return fail(`installDeckOrder rejected: ${install.error.code} ${install.error.message}`);
        }
        if (install.events.length !== 0) return fail('installDeckOrder emitted events');
        full = deepFreeze(install.state);
        for (let i = 0; i < order.length; i++) {
          const card = order[i];
          if (card !== undefined) dealtCards.set(EPOCH_STRIDE * pending.epoch + i, card);
        }
        epochOrders.push({ epoch: pending.epoch, order });
        action = { type: 'epoch', actor: 'deck', epoch: pending.epoch, size: order.length };
      } else if (pending.type === 'grant') {
        action = { type: 'granted', actor: 'deck' };
      } else if (pending.type === 'player') {
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
      } else {
        const leftover: never = pending;
        return fail(`unhandled pending ${JSON.stringify(leftover)}`);
      }

      lastAction = action;
      const revealProblem = checkReveals(action, pending.type === 'player' ? pending.seat : 'deck');
      if (revealProblem) return fail(revealProblem);
      const res = module.apply(full, action);
      if (!res.ok) return fail(`chosen action rejected: ${res.error.code} ${res.error.message}`);
      actions.push(action);
      fullLog.push({ kind: 'action', action });
      full = deepFreeze(res.state);

      const violations = module.invariants(full);
      if (violations.length > 0) return fail(`invariant: ${violations.join('; ')}`);
      // Throws on anything that would not survive a JSON round trip (undefined, NaN, -0, Map...).
      assertJsonSafe(full);

      bump(`event:${pendingTag(pending.type)}`);
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
      const hooks = checkHooks();
      if (hooks) return fail(hooks);
    }

    const outcome = module.outcome(full);
    if (!outcome) return fail('game over without an outcome');
    const forbidden = opts.checkOutcome?.(outcome) ?? null;
    if (forbidden !== null) return fail(`forbidden outcome: ${forbidden}`);
    bump(`end:${outcome.reason}`);

    // Replays from scratch must reproduce the final states exactly.
    // An epoch's order is not a public action. Games that reshuffle reinstall it before the epoch action.
    // Games that learn in private replay `fullLog`, which carries those learns.
    if (epochOrders.length === 0) {
      const rep = replay(module, { rules: opts.rules, seats: opts.seats, mode: 'full', deckOrders }, fullLog);
      if (!rep.ok) return fail(`replay failed at ${rep.index}: ${rep.error.message}`);
      if (!sameData(rep.state, full)) return fail('replay produced a different final state');
    } else {
      const again = replayWithOrders(
        module,
        { rules: opts.rules, seats: opts.seats, deckOrders },
        actions,
        epochOrders,
      );
      if (!again.ok) return fail(again.message);
      if (!sameData(again.state, full)) return fail('replay produced a different final state');
    }
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
