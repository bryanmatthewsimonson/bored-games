import { type Ciphertext, cardOf, decryptWithSecrets } from '@bored-games/deck';
import { canonicalJson, type GameModule, type Outcome as ModuleOutcome } from '@bored-games/game-kit';
import type { Audit, Outcome } from '@bored-games/protocol';
import { auditShow } from './private-show.ts';
import { auditTransfer } from './private-transfer.ts';

/*
 * The end of a game (PROTOCOL §7, §8.2, §8.3, D030 R5 and R6, D052): the full-mode audit once every deck secret is
 * known, its partial form after a Resign, and the ranking that a forfeit imposes. Both are pure functions of their inputs, so every client that holds the same
 * events computes the same result.
 */

type AnyModule = GameModule<unknown, { readonly type: string }, unknown>;

/** One entry of the interleaved action log: a seat's game action or a derived reveal, in fold order (D030 R6). */
export interface LoggedAction {
  actor: number | 'deck' | 'beacon';
  action: unknown;
  /** The chain `seq` of the move that carried the action, or of the head a derived reveal followed. */
  seq: number;
  /** The move's id and its `prev`, which a private selection's and a private show's audit check (D070, D077). */
  id?: string;
  prev?: string;
}

export interface AuditInput {
  module: AnyModule;
  /** The validated rules the game started with. */
  rules: unknown;
  seats: number;
  /** The module's one deck, or null for a deckless game (D045). */
  deckId: string | null;
  /** The final deck: the packet after the last shuffle step, the second round's when the deck has one (D076); empty for a deckless game. */
  deck: readonly Ciphertext[];
  /** Every seat's deck secret `x_k`, in seat order, each already checked against `X_k`; unused when deckless. */
  secrets: readonly bigint[];
  /** Card points to card indices for the deck (`cardTable`). Epoch outputs use the same points. */
  cards: ReadonlyMap<string, number>;
  /**
   * Completed epoch outputs, epoch 1 first (D073). Omit it on a log that never reshuffles. A hole is an empty
   * list, and a missing or short list fails every seat.
   */
  epochs?: readonly (readonly Ciphertext[])[];
  /** The session's interleaved action log. */
  log: readonly LoggedAction[];
  /** The outcome the session's own (view-mode) state declares. */
  outcome: ModuleOutcome | null;
  rootId?: string;
}

/** The protocol caps an audit reason at 500 code points (PROTOCOL §4.8). */
const MAX_REASON = 500;

/** `reason` cut to the 500 code points an audit reason may hold (PROTOCOL §4.8), with an ellipsis when cut. */
export function clipReason(reason: string): string {
  const points = [...reason];
  return points.length <= MAX_REASON ? reason : `${points.slice(0, MAX_REASON - 1).join('')}…`;
}

const everyone = (seats: number, reason: string): Audit => ({
  fail: Array.from({ length: seats }, (_, k) => k),
  reason: clipReason(reason),
});

/** Everything the audit reads but the declared outcome: what a partial audit (`auditPrefix`) gets. */
export type PrefixInput = Omit<AuditInput, 'outcome'>;

/** An action of type `show`: while a private show is pending, its wire (PROTOCOL §14, D077). */
const isShowAction = (action: unknown): boolean =>
  action !== null && typeof action === 'object' && (action as { type?: unknown }).type === 'show';

/** The seat the latest `dealt` entry of `pos` in deck `deckId` names in `state`: null when public or never dealt. */
function holderIn(module: AnyModule, state: unknown, deckId: string | null, pos: number): number | null {
  let to: number | null = null;
  for (const d of module.dealt(state)) if (d.deck === deckId && d.pos === pos) to = d.to;
  return to;
}

function epochFields(action: unknown): { epoch: number; size: number } | null {
  if (typeof action !== 'object' || action === null) return null;
  const raw = action as { type?: unknown; epoch?: unknown; size?: unknown };
  if (raw.type !== 'epoch' || typeof raw.epoch !== 'number' || typeof raw.size !== 'number') return null;
  return { epoch: raw.epoch, size: raw.size };
}

/**
 * Decrypt one epoch output and store it with `installDeckOrder` before the public epoch action is applied.
 * The order stays out of the action (D073).
 */
function installEpoch(
  input: PrefixInput,
  state: unknown,
  seq: number,
  epoch: number,
  size: number,
): { state: unknown } | { fail: Audit } {
  const list = input.epochs?.[epoch - 1];
  const fail = (why: string): { fail: Audit } => ({
    fail: everyone(input.seats, `the derived epoch after move ${seq} fails: ${why}`),
  });
  if (list === undefined || list.length !== size) return fail('the epoch output is missing');
  const order: number[] = [];
  for (const [i, ct] of list.entries()) {
    const card = cardOf(input.cards, decryptWithSecrets(ct, input.secrets));
    if (card === null) return fail(`epoch position ${i} decrypts to no card`);
    order.push(card);
  }
  const install = input.module.installDeckOrder;
  if (install === undefined) return fail('the module has no epoch order');
  const installed = install(state, epoch, order);
  if (!installed.ok) return fail(`${installed.error.code}: ${installed.error.message}`);
  return { state: installed.state };
}

/**
 * Decrypt the deck, set the module up in full mode and replay the log (PROTOCOL §7 steps 2–3): the full-mode state
 * after the last entry, or the verdict of the first failure. An epoch action installs its decrypted order first.
 */
function replay(input: PrefixInput): { state: unknown } | { fail: Audit } {
  const { module, seats } = input;
  const deckOrders: Record<string, number[]> = {};
  if (input.deckId !== null) {
    const order: number[] = [];
    for (const [pos, ct] of input.deck.entries()) {
      const card = cardOf(input.cards, decryptWithSecrets(ct, input.secrets));
      if (card === null) return { fail: everyone(seats, `deck position ${pos} decrypts to no card`) };
      order.push(card);
    }
    deckOrders[input.deckId] = order;
  }
  const init = module.setup({ rules: input.rules, seats, mode: 'full', deckOrders });
  if (!init.ok)
    return { fail: everyone(seats, `full-mode setup fails: ${init.error.code}: ${init.error.message}`) };
  let state = init.value;
  const origins = new Map<number, string>();
  for (const entry of input.log) {
    const epoch = epochFields(entry.action);
    if (epoch !== null) {
      const installed = installEpoch(input, state, entry.seq, epoch.epoch, epoch.size);
      if ('fail' in installed) return installed;
      state = installed.state;
    }
    const plan = module.privateSelection?.(state);
    if (plan) {
      try {
        const origin = origins.get(plan.id);
        if (!input.rootId || !origin || !entry.prev || entry.actor !== plan.from)
          throw new Error('Private delivery is missing its signed context.');
        const delivery = auditTransfer(entry.action, plan, input.secrets, input.rootId, origin, entry.prev);
        const learned = module.learn(state, delivery);
        if (!learned.ok) throw new Error(learned.error.message);
        state = learned.state;
      } catch (e) {
        return {
          fail: {
            fail: [plan.from],
            reason: clipReason(
              `move ${entry.seq} private delivery fails: ${e instanceof Error ? e.message : 'invalid delivery'}`,
            ),
          },
        };
      }
    }
    const show = module.privateShow?.(state) ?? null;
    const held = state;
    const before = module.rolls?.(state) ?? [];
    const r = module.apply(state, entry.action);
    if (r.ok) {
      for (const roll of module.rolls?.(r.state) ?? [])
        if (!before.some((old) => old.id === roll.id) && entry.id) origins.set(roll.id, entry.id);
      state = r.state;
      if (show !== null && isShowAction(entry.action)) {
        // A private show (PROTOCOL §14, D077): open its packet with the released secrets, and learn the card in
        // full mode, where the module checks that it may be shown and is held.
        try {
          if (!input.rootId || !entry.prev || input.deckId === null)
            throw new Error('The private show is missing its signed context.');
          const learn = auditShow(
            entry.action,
            show,
            input.secrets,
            input.rootId,
            entry.prev,
            input.deck,
            input.cards,
            (pos) => holderIn(module, held, input.deckId, pos),
            input.deckId,
          );
          const learned = module.learn(state, learn);
          if (!learned.ok) throw new Error(learned.error.message);
          state = learned.state;
        } catch (e) {
          return {
            fail: {
              fail: [show.from],
              reason: clipReason(
                `move ${entry.seq} private show fails: ${e instanceof Error ? e.message : 'invalid show'}`,
              ),
            },
          };
        }
      }
      continue;
    }
    const why = `${r.error.code}: ${r.error.message}`;
    if (epoch !== null)
      return { fail: everyone(seats, `the derived epoch after move ${entry.seq} fails: ${why}`) };
    if (entry.actor === 'deck')
      return { fail: everyone(seats, `the derived reveal after move ${entry.seq} fails: ${why}`) };
    if (entry.actor === 'beacon')
      return { fail: everyone(seats, `the derived roll after move ${entry.seq} fails: ${why}`) };
    return {
      fail: {
        fail: [entry.actor],
        reason: clipReason(`move ${entry.seq} by seat ${entry.actor} fails: ${why}`),
      },
    };
  }
  return { state };
}

/**
 * The R6 audit (PROTOCOL §7): decrypt every final-deck position with all the secrets, set the module up in full
 * mode with that order, and replay the interleaved action log. A deckless game (D045) has nothing to decrypt: it
 * is set up in full mode with `deckOrders: {}` and replays its log the same way.
 * - The first action the full-mode engine rejects fails its actor. A rejected derived reveal, a position that
 *   decrypts to no card, or a module that refuses the order fails every seat: no single seat is to blame.
 * - A private show whose packet does not open with the released secrets, or does not show the shower's own share of
 *   a position it holds, or whose card the full-mode module refuses, fails the shower (PROTOCOL §14, D077).
 * - If the replay's outcome differs from the declared one, every seat fails ("outcome mismatch").
 * - Otherwise the audit passes.
 */
export function auditGame(input: AuditInput): Audit {
  const r = replay(input);
  if ('fail' in r) return r.fail;
  const replayed = input.module.outcome(r.state);
  if (replayed === null || canonicalJson(replayed) !== canonicalJson(input.outcome)) {
    return everyone(input.seats, 'outcome mismatch');
  }
  return 'pass';
}

/**
 * The partial audit after a Resign ended a game with a deck (PROTOCOL §8.3, D052): the same decryption, full-mode
 * setup and replay as `auditGame`, over the log of the client's canonical chain (scored there, PROTOCOL §8.3), with the same
 * verdicts for a rejected action (its actor fails), a rejected derived reveal, an undecryptable position or a
 * refused setup (every seat fails). The game did not end by its rules, so there is no outcome to compare: a log
 * that replays is a pass.
 */
export function auditPrefix(input: PrefixInput): Audit {
  const r = replay(input);
  return 'fail' in r ? r.fail : 'pass';
}

/**
 * Rank the seats after forfeits (PROTOCOL §8.2, D030 R5). The forfeiting seats share the last place. The others
 * are ranked by `declaredPlaces` when given (a forfeit found at the end keeps the declared order among them),
 * otherwise by `scores`, descending. Ties share a place (1, 1, 3). Scores are kept as given; the reason is
 * `forfeit`. Seats in `forfeits` that are not seats are ignored.
 */
export function rankWithForfeits(
  scores: readonly number[],
  forfeits: readonly number[],
  declaredPlaces: readonly number[] | null,
): Outcome {
  const n = scores.length;
  const out = new Set(forfeits.filter((k) => Number.isSafeInteger(k) && k >= 0 && k < n));
  // Lower is better.
  const key = (k: number): number =>
    declaredPlaces === null ? -(scores[k] as number) : (declaredPlaces[k] as number);
  const stay = Array.from({ length: n }, (_, k) => k).filter((k) => !out.has(k));
  const places = Array.from({ length: n }, (_, k) =>
    out.has(k) ? stay.length + 1 : 1 + stay.filter((j) => key(j) < key(k)).length,
  );
  return { places, reason: 'forfeit', scores: [...scores] };
}
