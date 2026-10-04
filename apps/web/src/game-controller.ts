/*
 * The game controller: binds the relay pool to a game `Session` (`openSession`) for one game (PROTOCOL §6–§9).
 *
 * - It loads the root, the table and the Joins, builds the session for this player's seat (from the saved game
 *   secrets) or as a spectator, and folds in every game event from the relays.
 * - It performs this seat's automatic duties one at a time (shuffle, deal, share, beacon, secret, attest). Only
 *   `decide` waits for the player, through `act`. A beacon duty publishes this seat's share of a public dice roll.
 * - Every event it builds is saved to an outbox in storage before it is published. A duty whose event is already
 *   in the outbox reuses it: nothing is signed twice. A move is kept under the head it was built on, and one the
 *   session no longer accepts (an orphan, after the chain moved on) is never republished.
 * - A saved event that could conflict with what the seat did on another device (a move, the deal, a Resign) is
 *   republished only after every relay has answered a query for what this seat already published (D056, the stale
 *   outbox): a move only on the current head with no other move of this seat on its parent (one whose parent the
 *   chain has passed is discarded and logged in `log`; one whose parent is not held yet waits), a Resign only if no
 *   other Resign of this seat is out. The deal is never discarded (below).
 * - The deal is built at most once per game (D056, review F7): a deal this seat signed is never discarded and never
 *   built again, even when the session refuses it (it is on a rival deck of a shuffle fork) or another deal of this
 *   seat is out; it is kept as an orphan. The shuffle steps it deals on are republished before its deal.
 * - Timeouts run on local receipt time (D030 Ruling 10): the controller saves when it first saw each event
 *   (`bg:<profile>:seen:<rootId>`) and passes that time to `receive`, so a reopened tab keeps the deadlines. On
 *   load it feeds what it holds in first-seen order, which reproduces the session, a timeout's finality included.
 */
import {
  ClientError,
  type Duty,
  type Identity,
  openSession,
  type Session,
  type SessionView,
  seatForGameKeys,
  v1Session,
} from '@bored-games/client';
import { moduleFor } from '@bored-games/game-kit';
import {
  type EventTemplate,
  type Hex,
  KIND,
  type NostrEvent,
  type ParsedRoot,
  type ParsedTable,
  parseRoot,
  parseTable,
  verifyEvent,
} from '@bored-games/protocol';
import type { EoseInfo, Filter } from '@bored-games/relay';
import { type Signal, signal } from '@preact/signals';
import { deterministicRandom, seatStreamKey } from './det-random.ts';
import { bytesToHex } from './hex.ts';
import { type ControllerDeps, unionRelays } from './net.ts';
import type { RandomBytes } from './random.ts';
import { ownCardReason, sharePositions, shareVerdict } from './share-vet.ts';
import {
  type GameStatusName,
  loadSecrets,
  type RevealCache,
  readJson,
  removeItem,
  saveGameStatus,
  saveRootId,
  storageKey,
  writeJson,
} from './storage.ts';
import { type OwedReveal, owedReveal } from './waiting-model.ts';

/**
 * - `syncing`: loading from the relays
 * - `working`: performing an automatic duty (shuffle, deal, share, beacon, secret, attest)
 * - `stuck`: an automatic duty failed at this head and is not retried until the game moves on
 * - `your-turn`: this seat's decision, with no move of its own already waiting at this head
 */
export type GameStatus = 'syncing' | 'working' | 'stuck' | 'waiting' | 'your-turn' | 'done' | 'cancelled';

/** How often `tick` runs while the controller is started, in ms. */
export const TICK_MS = 30_000;

/** The game event kinds a game subscription asks for (PROTOCOL §9). */
export const GAME_KINDS = [KIND.move, KIND.shares, KIND.timeout, KIND.reveal, KIND.attest, KIND.resign];

/** The game event kinds signed by a seat's session key; attestations (`KIND.attest`) are signed by its npub. */
const SESSION_KINDS: readonly number[] = [KIND.move, KIND.shares, KIND.timeout, KIND.reveal, KIND.resign];

/**
 * Stored game events asked for per page. A page that brings any event not seen before is followed by an older
 * page (`until` its oldest date), so a relay that caps its answers below this still yields every event.
 */
export const GAME_PAGE = 500;

/** Automatic duties, in the order they are performed. */
const AUTO: readonly Duty['kind'][] = ['shuffle', 'deal', 'share', 'beacon', 'secret', 'attest'];

/** One built event, whether a relay has confirmed it, and whether the session has refused it (an orphan). */
export interface OutboxEntry {
  event: NostrEvent;
  confirmed: boolean;
  orphan: boolean;
}

/**
 * Outbox slots whose saved events can conflict with what this seat did elsewhere, or no longer fit the game, so
 * they are vetted (D056): moves, the deal, Resigns, and Luster's prompt shares (`share:<positions>`), which carry no
 * head and could otherwise reveal a card that is this seat's own on the branch fork choice settled on.
 */
const vetted = (slot: string): boolean =>
  slot.startsWith('move:') || slot.startsWith('share:') || slot === 'deal' || slot === 'resign';

/**
 * The longest wait (ms) for a check-before-signing query's answer (D059 item 2), beyond the pool's own EOSE
 * timeout, so a check never blocks for ever.
 */
export const CHECK_TIMEOUT_MS = 15_000;

/**
 * Dating a deterministic build (D063): it is signed once the local clock is within `SIGN_AHEAD_S` of its date, and
 * waits at most `MAX_WAIT_S` (and at most a quarter of the table's deadline) for that; a head dated further ahead
 * falls back to now and fresh randomness.
 */
const SIGN_AHEAD_S = 60;
const MAX_WAIT_S = 86_400;

/** Why `act` refuses a move this seat already made on another device (D059 item 2). */
export const ALREADY_MOVED = 'you already played this turn on another device';

/**
 * How long (s) a saved event or the Secret reveal may be held back waiting for every counted relay, or for the
 * session to catch up, before the player is offered "Send anyway" (`canSendAnyway`); the Secret reveal then goes
 * on its own (D056, fix round 2).
 */
export const HOLD_CAP_S = 600;

/** The most entries `GameController.log` keeps. */
const MAX_LOG = 20;

/** The outbox slot of a move: its seq and the head (`prev`) it was built on. */
export const moveSlot = (seq: number, prevId: string): string => `move:${seq}:${prevId}`;

export const outboxKey = (profile: string, rootId: string): string => storageKey(profile, `outbox:${rootId}`);

export const seenKey = (profile: string, rootId: string): string => storageKey(profile, `seen:${rootId}`);

export const tableKey = (profile: string, rootId: string): string => storageKey(profile, `table:${rootId}`);

/**
 * The Table event this profile validated the game's root against, saved on the first successful load, or null
 * when none is saved or it is not a valid Table at `address`.
 */
export function loadTable(
  store: ControllerDeps['storage'],
  profile: string,
  rootId: string,
  address: string,
): NostrEvent | null {
  const v = readJson(store, tableKey(profile, rootId));
  if (!verifyEvent(v)) return null;
  try {
    return parseTable(v).address === address ? v : null;
  } catch {
    return null;
  }
}

/** The most first-seen times saved per game; the oldest go first (never the root's). */
export const MAX_SEEN = 5_000;

const EVENT_ID = /^[0-9a-f]{64}$/;

/** The saved first-seen times of a game's events (Unix seconds), by event id. */
export function loadSeen(
  store: ControllerDeps['storage'],
  profile: string,
  rootId: string,
): Map<string, number> {
  const out = new Map<string, number>();
  const v = readJson(store, seenKey(profile, rootId));
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [id, at] of Object.entries(v as Record<string, unknown>)) {
    if (EVENT_ID.test(id) && typeof at === 'number' && Number.isFinite(at)) out.set(id, at);
  }
  return out;
}

/**
 * The saved outbox of a game, by slot: `move:<seq>:<prev>`, `deal`, `secret`, `attest`, `resign` and
 * `timeout:<seat>:<head>`.
 */
export function loadOutbox(
  store: ControllerDeps['storage'],
  profile: string,
  rootId: string,
): Map<string, OutboxEntry> {
  const out = new Map<string, OutboxEntry>();
  const v = readJson(store, outboxKey(profile, rootId));
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [slot, entry] of Object.entries(v as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { event, confirmed, orphan } = entry as Record<string, unknown>;
    if (verifyEvent(event)) out.set(slot, { event, confirmed: confirmed === true, orphan: orphan === true });
  }
  return out;
}

/** The move's `prev` event id. */
const prevOf = (ev: NostrEvent): string | null =>
  ev.tags.find((t) => t[0] === 'e' && t[3] === 'prev')?.[1] ?? null;

/**
 * The session's attestation builder, typed as optional: `attestTemplate(createdAt)` (Phase 2d Task 4) returns
 * the unsigned attestation, which the npub signer signs. Until the session has it, this seat does not attest.
 */
interface AttestApi {
  attestTemplate?(createdAt: number): EventTemplate;
}

const canAttest = (s: Session): boolean => typeof (s as unknown as AttestApi).attestTemplate === 'function';

/** While nothing changes, the Home status entry is rewritten this often (s), so it stays fresh while the game is open. */
export const STATUS_REFRESH_S = 300;

/** The most seated game events kept while the session is still loading; past it, loading stops with an error. */
const MAX_BUFFER = 100_000;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class GameController {
  readonly rootId: string;
  /** The session's view after the latest batch of events; null while loading. */
  readonly view: Signal<SessionView | null> = signal(null);
  readonly status: Signal<GameStatus> = signal('syncing');
  /** True while `act` or `claimTimeout` is building and sending this player's event. */
  readonly busy: Signal<boolean> = signal(false);
  /** The last problem worth showing: loading, an automatic duty or a submitted move failed. */
  readonly error: Signal<string | null> = signal(null);
  /** Delivery state: set while one of this player's events has reached no relay yet, or after one was discarded. */
  readonly notice: Signal<string | null> = signal(null);
  /**
   * Saved events this controller discarded instead of publishing (D056): a move, deal or Resign saved on this
   * device that the game no longer fits, newest last, at most `MAX_LOG`.
   */
  readonly log: Signal<readonly string[]> = signal([]);
  /** This seat's legal actions now (empty unless it is this player's decision). */
  readonly legal: Signal<readonly unknown[]> = signal([]);
  /** A seat this player may claim a timeout against now, or null. */
  readonly timeoutTarget: Signal<number | null> = signal(null);
  /**
   * Whether a saved event or the Secret reveal has been held back for `HOLD_CAP_S` (a relay that never answers, or a
   * session that never catches up): the screen then offers "Send anyway" (`sendAnyway`).
   */
  readonly canSendAnyway: Signal<boolean> = signal(false);
  /** Whether this player may resign now (PROTOCOL §4.9): seated, synced, and the game is live. */
  readonly canResign: Signal<boolean> = signal(false);
  /** The game's module id, from the root, once it is known. */
  readonly game: Signal<string | null> = signal(null);
  /** The seats' identity pubkeys, in seat order. */
  readonly seats: Signal<readonly Hex[]> = signal([]);
  readonly table: Signal<ParsedTable | null> = signal(null);
  /** The table's address, from the root, once it is known. */
  readonly tableAddress: Signal<string | null> = signal(null);
  /** The seats the game waits on at the head (`Session.waitingFor`, D057), ascending. */
  readonly waiting: Signal<readonly number[]> = signal([]);
  /**
   * The card reveal the game waits on (D060): the seats that owe their share and when their deadline passes, or
   * null. This seat counts as owing while a reveal it built has reached no relay yet.
   */
  readonly owed: Signal<OwedReveal | null> = signal(null);
  /**
   * Set when this player holds a seat through the game keys saved in this browser, not the key in use (D057): the
   * seat, and the npub it joined with. That npub signs the Result attestation, which this browser then cannot send.
   */
  readonly recovered: Signal<{ seat: number; npub: Hex } | null> = signal(null);
  /** The time of the latest refresh (Unix seconds), so deadline displays follow `tick`. */
  readonly clock: Signal<number>;

  readonly #d: ControllerDeps;
  #session: Session | null = null;
  #rootEv: NostrEvent | null = null;
  #root: ParsedRoot | null = null;
  /**
   * Every Table version at the root's address that the relays sent, by id. The Table is addressable, so its
   * creator can replace it after the start; the game is loaded from a version the root validates against.
   */
  readonly #tables = new Map<string, NostrEvent>();
  /** The Table this profile validated the root against on an earlier load; preferred over the relays' copies. */
  #storedTable: NostrEvent | null = null;
  readonly #joins = new Map<string, NostrEvent>();
  /** Game events that arrived before the session existed and the relays sent all they hold. */
  #buffer: NostrEvent[] = [];
  /** The seats' session keys and npubs, once the root is known: only their game events are taken. */
  #sessionKeys = new Set<string>();
  #npubs = new Set<string>();
  /** Resign events received, by id, so a counted one can be republished (D052, review M-b). */
  readonly #resigns = new Map<string, NostrEvent>();
  /** Counted Resigns this controller has republished. */
  readonly #echoed = new Set<string>();
  /** Ids of the game events received, for paging. */
  readonly #got = new Set<string>();
  /** The seated game events the relays sent, by id, so the session can be rebuilt without a discarded event. */
  readonly #events = new Map<string, NostrEvent>();
  /**
   * Every seated game event's `created_at`, by id, kept past `MAX_BUFFER` (unlike `#events`), so a deterministic build
   * dates its event at the head's date on every device (`#buildDate`).
   */
  readonly #dates = new Map<string, number>();
  /** This seat's own moves the session was fed, with their `created_at`: the floor of a deterministic date. */
  readonly #ownMoves = new Map<string, number>();
  /** This player's session key in the game, or null for a spectator. */
  #mySession: string | null = null;
  /** This player's seat and game secrets once the session holds a seat, for deterministic builds (`#buildRnd`). */
  #me: Identity | null = null;
  /**
   * When the check before signing (D059 item 2) first got an answer that not every live counted relay gave, by slot
   * (`kind@headId`); removed after a full one. Past `HOLD_CAP_S` that slot's check stops waiting, so it never blocks
   * for ever, and each slot gets its own bound.
   */
  readonly #checkSince = new Map<string, number>();
  /** Automatic duties (`kind@headId`) held back by the check before signing until the next tick. */
  readonly #heldDuties = new Set<string>();
  /** Automatic duties (`kind@headId`) waiting for their deterministic date (`#buildDate`), with their wake time. */
  readonly #waits = new Map<string, number>();
  /**
   * This seat's own events the relays sent (D056), by what they could conflict with: `move:<prev>` for its moves
   * on a parent, `shares` for its Shares events, `resign` for its Resigns.
   */
  readonly #mine = new Map<string, Set<string>>();
  /** This seat's own events the session refused outright (`#receive`): never counted as rivals (`#otherMine`). */
  readonly #refused = new Set<string>();
  /**
   * Outbox slots loaded from storage with an unconfirmed move, deal or Resign: held back, neither folded in nor
   * published, until the relays have shown what this seat already published (`#vetSaved`).
   */
  readonly #unvetted = new Set<string>();
  /** Outbox events folded into the current session. */
  readonly #fed = new Set<string>();
  /**
   * Whether every counted relay (`#fullAnswer`) answered every page of the initial sync, or a later whole-game
   * query (D056): only then is a saved event vetted against it, or the Secret reveal sent. Otherwise each tick asks
   * again (`#startVet`).
   */
  #viewFull = false;
  /**
   * Parents that pooled moves above the head descend from, asked for by id and not sent by any counted relay that
   * answered (D056, fix round 2): junk, or on no relay this client uses, so they no longer hold anything back.
   */
  readonly #ignoredParents = new Set<string>();
  /** Missing parents asked for by id (`#resolveMissing`), so each is asked once per load. */
  readonly #askedParents = new Set<string>();
  /** When the current hold of a saved event began (Unix s), or null while none is held (`HOLD_CAP_S`). */
  #holdSince: number | null = null;
  /** When the Secret reveal began to be held back (Unix s), or null; its own cap, apart from saved events'. */
  #secretSince: number | null = null;
  /** Set by `sendAnyway`: vetting goes ahead on the answers held, and the Secret reveal is no longer held. */
  #forced = false;
  /** A vetting query is in flight. */
  #vetting = false;
  /** Shuffle steps republished with this seat's deal (D056). */
  readonly #echoedSteps = new Set<string>();
  /** When this profile first saw each event of this game (Unix seconds), saved in storage. */
  #seen = new Map<string, number>();
  /** First-seen times not saved yet. */
  #seenDirty = false;
  #outbox = new Map<string, OutboxEntry>();
  readonly #inFlight = new Set<string>();
  #gameEose = false;
  #lobbyEose = false;
  #synced = false;
  #working = false;
  #running = false;
  #dutyQueued = false;
  #refreshQueued = false;
  /** The last status entry saved for Home, so it is written only on a change (or when it is getting old). */
  #savedStatus: { status: GameStatusName; seq: number; at: number; reveal: string } | null = null;
  /** Automatic duties that failed at a head (`kind@headId`), not retried until the head moves. */
  readonly #failed = new Set<string>();
  readonly #stops: (() => void)[] = [];
  #started = false;
  #disposed = false;

  /** Stored game events asked for per page (`GAME_PAGE`; tests make it small to exercise paging). */
  readonly #page: number;

  constructor(rootId: string, deps: ControllerDeps, opts: { gamePage?: number } = {}) {
    this.rootId = rootId;
    this.#d = deps;
    this.clock = signal(deps.now());
    this.#page = opts.gamePage ?? GAME_PAGE;
  }

  /** Load the game, follow its events, and tick every 30 s. */
  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#outbox = loadOutbox(this.#d.storage, this.#d.profile, this.rootId);
    // Saved events that could conflict with what this seat did on another device wait for the relays (D056).
    for (const [slot, e] of this.#outbox)
      if (vetted(slot) && !e.confirmed && !e.orphan) this.#unvetted.add(slot);
    this.#seen = loadSeen(this.#d.storage, this.#d.profile, this.rootId);
    // The root first; the game's events are asked for once the root names the seats (`#subscribeGame`).
    this.#stops.push(this.#d.pool.subscribe([{ ids: [this.rootId] }], (ev) => this.#onEvent(ev)));
    this.#stops.push(this.#d.timers.every(TICK_MS, () => this.tick()));
  }

  dispose(): void {
    this.#disposed = true;
    for (const stop of this.#stops.splice(0)) stop();
  }

  /** Re-check deadlines and stored timeout claims, retry undelivered events, and resume duties. */
  tick(): void {
    if (this.#disposed) return;
    // A duty the check before signing held back is tried again (D059 item 2).
    this.#heldDuties.clear();
    this.#session?.tick(this.#d.now());
    if (this.#synced) this.#retryUndelivered();
    this.#refresh();
    this.#queueDuties();
  }

  /**
   * Submit this player's decision. Resolves once the move is signed, saved and folded in locally (it is
   * published in the background and retried until a relay confirms it). Rejects while another submission is
   * in flight, when the session refuses the action, or when the game is not ready.
   */
  async act(action: unknown): Promise<void> {
    if (this.busy.value) throw new Error('A move is already being sent.');
    const session = this.#session;
    if (session === null || !this.#synced) throw new Error('The game is still loading.');
    this.busy.value = true;
    try {
      await this.#yield();
      if (this.#disposed) throw new Error('The game screen was closed.');
      const head = session.view().head;
      const slot = moveSlot(head.seq + 1, head.id);
      if (this.#unvetted.has(slot)) throw new Error('a move saved on this device is still being checked');
      // Never build twice for one decision: fresh randomness would make a rival move (equivocation).
      let ev = this.#reusable(slot, head.id);
      if (ev === null) {
        // The check before signing (D059 item 2): another device of this seat may have played this turn already.
        if (this.#otherMine(`move:${head.id}`, null)) throw new Error(ALREADY_MOVED);
        const check = await this.#checkBeforeSign(session, `move@${head.id}`);
        if (this.#disposed) throw new Error('The game screen was closed.');
        if (session.view().head.id !== head.id || this.#otherMine(`move:${head.id}`, null))
          throw new Error(ALREADY_MOVED);
        if (check === 'hold')
          throw new Error(
            'checking that you have not already played this turn on another device: not every relay has answered yet. Try again in a moment',
          );
        ev = this.#reusable(slot, head.id) ?? session.buildAction(action, this.#d.rnd, this.#d.now());
      }
      this.#commit(slot, ev);
      this.error.value = null;
    } catch (e) {
      this.error.value = `Your move was not sent: ${errorText(e)}`;
      throw e;
    } finally {
      this.busy.value = false;
      this.#refresh();
      this.#queueDuties();
    }
  }

  /** Claim a timeout against the seat `timeoutTarget` names, if any. */
  async claimTimeout(): Promise<void> {
    const session = this.#session;
    if (session === null || this.busy.value) return;
    const seat = session.timeoutTarget(this.#d.now());
    if (seat === null) return;
    this.busy.value = true;
    try {
      await this.#yield();
      if (this.#disposed) throw new Error('The game screen was closed.');
      const head = session.view().head;
      const slot = `timeout:${seat}:${head.id}`;
      const ev = this.#outbox.get(slot)?.event ?? session.buildTimeout(seat, this.#d.rnd, this.#d.now());
      this.#commit(slot, ev);
      this.error.value = null;
    } catch (e) {
      this.error.value = `The timeout claim was not sent: ${errorText(e)}`;
    } finally {
      this.busy.value = false;
      this.#refresh();
      this.#queueDuties();
    }
  }

  /**
   * Resign (PROTOCOL §4.9, D045): build the Resign once (the `resign` slot keeps it, so a reload re-sends the same
   * event), fold it in and publish it. The game ends with this seat last.
   */
  async resign(): Promise<void> {
    const session = this.#session;
    if (session === null || this.busy.value || !this.#synced) return;
    this.busy.value = true;
    try {
      await this.#yield();
      if (this.#disposed) throw new Error('The game screen was closed.');
      if (this.#unvetted.has('resign'))
        throw new Error('a resignation saved on this device is still being checked');
      let saved = this.#live('resign');
      if (saved === null && !session.canResign()) throw new Error('the game is no longer live');
      if (saved === null) {
        // The check before signing (D059 item 2): a Resign this seat sent from another device is adopted instead.
        if (this.#otherMine('resign', null)) throw new Error('you already resigned on another device');
        const check = await this.#checkBeforeSign(session, `resign@${session.view().head.id}`);
        if (this.#disposed) throw new Error('The game screen was closed.');
        if (this.#otherMine('resign', null)) throw new Error('you already resigned on another device');
        if (!session.canResign()) throw new Error('the game is no longer live');
        if (check === 'hold')
          throw new Error(
            'not every relay has answered yet, so it is not known whether you resigned elsewhere',
          );
        saved = this.#live('resign');
      }
      this.#commit('resign', saved ?? session.buildResign(this.#d.rnd, this.#d.now()));
      this.error.value = null;
    } catch (e) {
      this.error.value = `Your resignation was not sent: ${errorText(e)}`;
    } finally {
      this.busy.value = false;
      this.#refresh();
      this.#queueDuties();
    }
  }

  /**
   * Stop waiting for every relay (D056, fix round 2): vet the held saved events on what the relays have sent, and
   * let the Secret reveal go. Offered once something has been held for `HOLD_CAP_S` (`canSendAnyway`). A saved
   * event that does not fit what is held is still discarded, and a deal is still never sent twice.
   */
  sendAnyway(): void {
    if (this.#disposed || !this.#synced) return;
    this.#forced = true;
    this.#vetSaved(true);
    this.#refresh();
    this.#queueDuties();
  }

  /* --------------------------------------------------------------------------------------------- loading */

  #onEvent(ev: NostrEvent): void {
    if (this.#disposed) return;
    if (ev.kind === KIND.root && ev.id === this.rootId) {
      this.#onRoot(ev);
      return;
    }
    // Relays are not trusted to filter: only seated keys' game events are taken (PROTOCOL §11).
    if (!this.#seated(ev)) return;
    this.#got.add(ev.id);
    this.#dates.set(ev.id, ev.created_at);
    if (this.#events.size < MAX_BUFFER) this.#events.set(ev.id, ev);
    if (ev.kind === KIND.resign) this.#resigns.set(ev.id, ev);
    if (ev.pubkey === this.#mySession) this.#noteMine(ev);
    const entry = [...this.#outbox.entries()].find(([, e]) => e.event.id === ev.id);
    if (entry !== undefined) this.#confirm(entry[0]);
    // Until the relays have sent what they hold, events wait, so they can be fed in first-seen order.
    if (this.#session === null || !this.#gameEose) {
      if (this.#buffer.length < MAX_BUFFER) this.#buffer.push(ev);
      else this.error.value = 'This game has too many events to load.';
      return;
    }
    this.#receive(this.#session, ev);
    this.#queueRefresh();
  }

  /**
   * Fold `ev` in at the time this profile first saw it (now, the first time), and record that time unless the
   * session rejects the event.
   */
  #receive(session: Session, ev: NostrEvent): ReturnType<Session['receive']> {
    const first = this.#seen.get(ev.id);
    const now = this.#d.now();
    // Own events from the outbox too: the head may be this seat's own move, not yet back from a relay.
    this.#dates.set(ev.id, ev.created_at);
    if (ev.kind === KIND.move && ev.pubkey === this.#mySession) this.#ownMoves.set(ev.id, ev.created_at);
    const r = session.receive(ev, first ?? now);
    // An own event the session refuses (built by a bug or an outdated client) can never link: it must not lock the
    // seat out of the slot (`#otherMine`). One it accepts later (after a rebuild) counts again.
    if (ev.pubkey === this.#mySession) {
      if (r.status === 'rejected') this.#refused.add(ev.id);
      else this.#refused.delete(ev.id);
    }
    if (first === undefined && r.status !== 'rejected') this.#noteSeen(ev.id, now);
    return r;
  }

  /**
   * Record one of this seat's own events the relays sent, by what it could conflict with (D056): `move:<prev>`,
   * `shares` (and `share:<pos>` for each position a Shares event carries), `resign`.
   */
  #noteMine(ev: NostrEvent): void {
    const keys =
      ev.kind === KIND.move
        ? [`move:${prevOf(ev)}`]
        : ev.kind === KIND.shares
          ? ['shares', ...(sharePositions(ev) ?? []).map((pos) => `share:${pos}`)]
          : ev.kind === KIND.resign
            ? ['resign']
            : [];
    for (const key of keys) {
      let ids = this.#mine.get(key);
      if (ids === undefined) {
        ids = new Set();
        this.#mine.set(key, ids);
      }
      ids.add(ev.id);
    }
  }

  /**
   * Whether the relays sent an event of this seat's other than `ev` under `key` (`#noteMine`). For moves only, those
   * the session refused (`#refused`) are left out: an invalid own move is not a rival anyone can link. A refused Shares
   * event still counts: a deal on a rival deck is refused, and it must keep this seat from publishing another deal
   * (D056, F7: never deal on two decks).
   */
  #otherMine(key: string, ev: NostrEvent | null): boolean {
    const move = key.startsWith('move:');
    for (const id of this.#mine.get(key) ?? [])
      if (id !== ev?.id && !(move && this.#refused.has(id))) return true;
    return false;
  }

  #noteSeen(id: string, at: number): void {
    if (this.#seen.has(id)) return;
    this.#seen.set(id, at);
    this.#seenDirty = true;
  }

  /**
   * Save the first-seen times, merged with what another tab of this profile saved (the earlier time wins), and
   * keep at most `MAX_SEEN` besides the root's, dropping the oldest.
   */
  #saveSeen(): void {
    if (!this.#seenDirty || this.#disposed) return;
    for (const [id, at] of loadSeen(this.#d.storage, this.#d.profile, this.rootId)) {
      const mine = this.#seen.get(id);
      if (mine === undefined || at < mine) this.#seen.set(id, at);
    }
    const others = [...this.#seen].filter(([id]) => id !== this.rootId);
    if (others.length > MAX_SEEN) {
      others.sort((a, b) => a[1] - b[1]);
      for (const [id] of others.slice(0, others.length - MAX_SEEN)) this.#seen.delete(id);
    }
    if (writeJson(this.#d.storage, seenKey(this.#d.profile, this.rootId), Object.fromEntries(this.#seen)))
      this.#seenDirty = false;
  }

  /**
   * Feed this seat's saved events and the events held back while loading, in first-seen order (events never seen
   * before last). A saved event the session refuses is an orphan: it is kept (so its slot is never signed again)
   * but never republished. A refused event a relay confirmed is public anyway, so it is still fed: a deal on a
   * rival deck must count as this seat's deal (D056). An unconfirmed move, deal or Resign loaded from storage is
   * held back: once the relays have answered, `#vetSaved` folds it in and republishes it, or discards it (D056).
   */
  #feedHeld(): void {
    const session = this.#session;
    if (session === null) return;
    const held: { ev: NostrEvent; slot: string | null }[] = [];
    for (const [slot, entry] of this.#outbox) {
      // A deal of this seat's is fed even when refused and never sent: the session must know the seat dealt, so it
      // owes no second deal (D056, review F7).
      if (this.#unvetted.has(slot) || (entry.orphan && !entry.confirmed && !this.#ownDeal(slot, entry)))
        continue;
      held.push({ ev: entry.event, slot });
    }
    for (const ev of this.#buffer.splice(0)) held.push({ ev, slot: null });
    const at = (ev: NostrEvent): number => this.#seen.get(ev.id) ?? Number.POSITIVE_INFINITY;
    // Among events seen at the same time (or never, on a fresh load) a resign goes last. The session would wait for
    // its head anyway (PROTOCOL §8.3), but a resign whose head is already on the chain counts at once, outside the
    // per-seat cap on waiting resigns, so junk resigns the same seat flooded cannot crowd it out on a fresh device.
    const rank = (ev: NostrEvent): number => (ev.kind === KIND.resign ? 1 : 0);
    held.sort((a, b) => at(a.ev) - at(b.ev) || rank(a.ev) - rank(b.ev));
    for (const { ev, slot } of held) {
      if (slot !== null) this.#fed.add(ev.id);
      if (this.#receive(session, ev).status !== 'rejected' || slot === null) continue;
      const entry = this.#outbox.get(slot);
      if (entry === undefined || entry.orphan) continue;
      entry.orphan = true;
      this.#persist(slot);
    }
    if (this.#viewFull) this.#vetSaved(false);
  }

  /** Whether `slot` holds a deal signed by this seat's session key (not a stray event in storage). */
  #ownDeal(slot: string, entry: OutboxEntry): boolean {
    return slot === 'deal' && this.#mySession !== null && entry.event.pubkey === this.#mySession;
  }

  /**
   * The saved events `#vetSaved` decides: unconfirmed moves, deal and Resign, plus, while the deal is still being
   * dealt, this seat's own refused deal that no relay confirmed (it is published if the session accepts it again,
   * after fork choice came back to its deck, and no other deal of this seat is out).
   */
  #toVet(): string[] {
    const dealing = this.#session?.view().phase === 'deal';
    return [...this.#outbox]
      .filter(
        ([slot, e]) => vetted(slot) && !e.confirmed && (!e.orphan || (dealing && this.#ownDeal(slot, e))),
      )
      .map(([slot]) => slot);
  }

  /**
   * Vet this seat's unconfirmed saved moves, deal and Resign against what the relays sent (D056, the stale outbox),
   * moves in seq order first, so a run of this seat's own moves is vetted one on top of the other. It runs only once
   * every counted relay has answered (the initial sync, or a query of `#startVet`), or when `forced`
   * (`sendAnyway`), and it holds everything while the session is visibly behind (`#behind`) unless `forced`.
   * - A move is discarded if another move of this seat on its parent is at the relays, or, when it is not folded in
   *   yet (it was loaded from storage), if its parent is on the chain below the head (the game has moved on). It is
   *   republished if its parent is the head; otherwise (its parent is not held yet) it waits.
   * - A Resign is discarded if another Resign of this seat is at the relays, or, when not folded in yet, if the game
   *   is no longer live. It need not name the current head (§8.3: it counts once its head is held).
   * - The deal is never discarded (D056, review F7): if another deal of this seat is at the relays, or the session
   *   refuses it, it is kept as an orphan, never published and never built again. Only a stray deal in storage,
   *   signed by another key, is discarded.
   * An event not folded in yet must be accepted by the session. A discarded event the session had already folded
   * in (built in this tab while offline) leaves the session holding an event nobody else will, so the session is
   * rebuilt without it. An event the session now refuses outright is an orphan, as in `#retryUndelivered`.
   */
  #vetSaved(forced: boolean): void {
    const session = this.#session;
    if (session === null || this.#disposed) return;
    if (!forced && this.#behind(session)) {
      this.#holding('the game on this device is behind the relays');
      this.#resolveMissing(session);
      return;
    }
    // Shares after moves and the deal: a saved move vetted first may change the head the shares are judged on.
    const rank = (slot: string): number =>
      slot.startsWith('move:')
        ? Number(slot.split(':')[1])
        : slot === 'deal'
          ? 1e12
          : slot.startsWith('share:')
            ? 1.5e12
            : 2e12;
    const slots = this.#toVet().sort((a, b) => rank(a) - rank(b));
    let rebuild = false;
    // Moves discarded in this pass: a saved move built on one of them is discarded with it (fix round 2), rather
    // than waiting for ever on a parent that will never come.
    const dropped = new Set<string>();
    for (const slot of slots) {
      const entry = this.#outbox.get(slot);
      if (entry === undefined) continue;
      const ev = entry.event;
      const fed = this.#fed.has(ev.id);
      const parent = ev.kind === KIND.move ? prevOf(ev) : null;
      if (parent !== null && dropped.has(parent)) {
        if (fed) rebuild = true;
        dropped.add(ev.id);
        this.#discard(slot, 'it follows a saved move that was discarded');
        continue;
      }
      if (slot === 'deal' && this.#ownDeal(slot, entry)) {
        this.#vetDeal(session, entry, fed);
        continue;
      }
      if (fed && this.#receive(session, ev).status === 'rejected') {
        this.#unvetted.delete(slot);
        if (ev.kind === KIND.move) dropped.add(ev.id);
        entry.orphan = true;
        this.#persist(slot);
        continue;
      }
      let verdict = this.#verdict(session, slot, ev, fed);
      if (verdict === 'wait') continue;
      if (verdict === 'send' && !fed) {
        this.#fed.add(ev.id);
        const r = this.#receive(session, ev);
        if (r.status === 'rejected') verdict = `the game refuses it (${r.reason})`;
      }
      this.#unvetted.delete(slot);
      if (verdict === 'send') {
        void this.#publish(slot);
        continue;
      }
      if (fed) rebuild = true;
      if (ev.kind === KIND.move) dropped.add(ev.id);
      this.#discard(slot, verdict);
    }
    if (rebuild) this.#rebuild();
  }

  /**
   * What to do with a saved move or Resign (`#vetSaved`): `send` it, let it `wait` (a move whose parent this client
   * does not hold on its chain yet), or the reason to discard it.
   */
  #verdict(session: Session, slot: string, ev: NostrEvent, fed: boolean): 'send' | 'wait' | string {
    if (slot === 'deal') return 'it is not signed by your key in this game';
    if (slot.startsWith('share:')) return this.#shareVerdict(session, ev, fed);
    if (slot.startsWith('move:')) {
      const prev = prevOf(ev);
      if (prev === null) return 'it names no parent';
      if (this.#otherMine(`move:${prev}`, ev)) return 'another move of yours at that point is on the relays';
      if (fed) return 'send';
      const head = session.view().head;
      const at = session.chainSeq(prev);
      if (at === head.seq && Number(slot.split(':')[1]) === head.seq + 1) return 'send';
      // Its parent is on the chain below the head: the game moved on without it. A parent on a branch that lost
      // fork choice: the game went another way (fix round 2). A parent not held yet, or one that extends the head
      // and waits for something, may still come, so the move waits.
      if (at !== null) return 'the game has moved on';
      return session.branchOf(prev) === 'side' ? 'the game went another way' : 'wait';
    }
    if (this.#otherMine('resign', ev)) return 'another resignation of yours is on the relays';
    if (!fed && !session.canResign()) return 'the game is over';
    return 'send';
  }

  /**
   * What to do with a saved Shares event of Luster's prompt shares (D056, audit-luster F3): `send` it only if every
   * position it carries is drawn on the current head, is not this seat's own private card, and is still owed by
   * this seat (for one not folded in yet: the session's `share` duty lists it; for one folded in: no other Shares
   * event of this seat carrying it is at the relays). Otherwise the reason to discard it (`shareVerdict`).
   */
  #shareVerdict(session: Session, ev: NostrEvent, fed: boolean): 'send' | string {
    const positions = sharePositions(ev);
    if (positions === null) return 'it is not a valid card reveal';
    const duty = fed ? undefined : session.duties().find((d) => d.kind === 'share');
    return shareVerdict({
      positions,
      mySeat: session.view().mySeat,
      dealt: this.#dealt(session),
      owed: fed ? null : duty?.kind === 'share' ? duty.positions : [],
      sentElsewhere: (pos) => this.#otherMine(`share:${pos}`, ev),
    });
  }

  /** Every deck position the module has dealt on the session's head (`GameModule.dealt`); empty before setup. */
  #dealt(session: Session): readonly { pos: number; to: number | null }[] {
    const v = session.view();
    // The root's own engine version (`moduleFor`): a v1 Bank game is Bank 0.1.0 even though `bank` is 0.2.0.
    const root = this.#root;
    const module = root === null ? undefined : moduleFor(this.#d.modules, root.game, root.version);
    if (module === undefined || v.state === null) return [];
    try {
      return module.dealt(v.state);
    } catch {
      return [];
    }
  }

  /**
   * Vet this seat's own unconfirmed deal (D056, review F7). It is published only if no other deal of this seat is at
   * the relays and the session accepts it; otherwise it is kept as an orphan: never discarded, never published,
   * never built again (`#blocked`, `#single`), and still fed to the session so it owes no deal.
   */
  #vetDeal(session: Session, entry: OutboxEntry, fed: boolean): void {
    const ev = entry.event;
    this.#unvetted.delete('deal');
    let why: string | null = this.#otherMine('shares', ev) ? 'another deal of yours is on the relays' : null;
    if (why === null) {
      this.#fed.add(ev.id);
      const r = this.#receive(session, ev);
      if (r.status === 'rejected') why = `the game refuses it (${r.reason})`;
    } else if (!fed) {
      // Fed all the same, so the session knows this seat dealt.
      this.#fed.add(ev.id);
      this.#receive(session, ev);
    }
    if (why === null) {
      if (entry.orphan) {
        entry.orphan = false;
        this.#persist('deal');
      }
      void this.#publish('deal');
      return;
    }
    // The rival steps of the fork go out again, so a client that never saw the deck this deal is on holds the fork
    // and stalls the equivocator, not this seat (fix round 2).
    this.#echoFork(session);
    if (entry.orphan) return;
    entry.orphan = true;
    this.#persist('deal');
    this.#note(
      `Your deal saved on this device was kept but not sent: ${why}. A seat deals once per game, so no other deal will be built.`,
    );
  }

  /** Add a line to `log` and show it as the notice. */
  #note(line: string): void {
    this.log.value = [...this.log.value, line].slice(-MAX_LOG);
    this.notice.value = line;
  }

  /** Show that a saved event waits to be vetted, unless a log line is showing. */
  #holding(why: string): void {
    if (this.notice.value !== null && this.log.value.includes(this.notice.value)) return;
    this.notice.value = `An event saved on this device is not sent yet: ${why}. Retrying.`;
  }

  /** Remove a saved event from the outbox and storage without publishing it, and log why (D056). */
  #discard(slot: string, why: string): void {
    const entry = this.#outbox.get(slot);
    this.#outbox.delete(slot);
    this.#unvetted.delete(slot);
    if (entry === undefined) return;
    const key = outboxKey(this.#d.profile, this.rootId);
    const stored = readJson(this.#d.storage, key);
    if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
      const all = { ...(stored as Record<string, unknown>) };
      const there = all[slot] as { event?: { id?: unknown } } | undefined;
      if (there?.event?.id === entry.event.id) {
        delete all[slot];
        writeJson(this.#d.storage, key, all);
      }
    }
    const what =
      slot === 'deal'
        ? 'deal'
        : slot === 'resign'
          ? 'resignation'
          : slot.startsWith('share:')
            ? 'card reveal'
            : 'move';
    this.#note(`A ${what} saved on this device was never sent, and it was discarded: ${why}.`);
  }

  /** Build the session again from the relays' events and the outbox, after a folded-in event was discarded. */
  #rebuild(): void {
    if (this.#session === null || this.#disposed) return;
    this.#session = null;
    this.#fed.clear();
    this.#buffer = [...this.#events.values()];
    this.#tryCreate();
  }

  /**
   * Whether `info` answers for every relay that counts (D056, fix round 2): every root relay, and this player's own
   * relays less those the pool reports dead (not open for `deadAfterMs`). Other relays the shared pool holds
   * (another game's) do not count.
   */
  #fullAnswer(info: EoseInfo): boolean {
    if (info.eosedUrls === undefined) return info.eose === info.relays;
    const dead = new Set(info.deadUrls ?? []);
    const eosed = new Set(info.eosedUrls);
    // The root's relays always count, dead or not: the other device's move may be on one of them only, so a dead
    // root relay leads to the hold cap and Send anyway, never to vetting without it. Only the player's own relays
    // are left out once dead.
    const rootRelays = this.#root?.relays ?? [];
    const own = this.#d.relays().filter((u) => !rootRelays.includes(u) && !dead.has(u));
    const counted = unionRelays(rootRelays, own);
    return counted.length > 0 && counted.every((u) => eosed.has(u));
  }

  /**
   * Whether the session is visibly behind the relays (D056): it pools a move above its head that extends the head,
   * or one that descends from a parent it does not hold and that the relays have not been found to lack
   * (`#ignoredParents`).
   */
  #behind(session: Session): boolean {
    return session.aheadOfHead() || session.missingParents().some((id) => !this.#ignoredParents.has(id));
  }

  /**
   * Ask every relay by id for the parents the session misses (D056, fix round 2). Once every counted relay has
   * answered, those none sent are ignored from then on: a seat's junk move naming a random parent cannot hold
   * saved events or the Secret reveal back. Each parent is asked once per load.
   */
  #resolveMissing(session: Session): void {
    const ids = session
      .missingParents()
      .filter((id) => !this.#ignoredParents.has(id) && !this.#askedParents.has(id));
    if (ids.length === 0 || this.#disposed) return;
    for (const id of ids) this.#askedParents.add(id);
    const sent = new Set<string>();
    let stop = (): void => {};
    stop = this.#d.pool.subscribe(
      [{ ids }],
      (ev) => {
        sent.add(ev.id);
        this.#onEvent(ev);
      },
      (info) => {
        stop();
        if (this.#disposed) return;
        if (this.#fullAnswer(info)) {
          for (const id of ids) if (!sent.has(id)) this.#ignoredParents.add(id);
        } else for (const id of ids) this.#askedParents.delete(id);
        if (this.#viewFull) this.#vetSaved(false);
        this.#refresh();
        this.#queueDuties();
      },
    );
    this.#stops.push(stop);
  }

  /**
   * Whether this seat's Secret reveal is due but held back (D056, fix round 2): until the client's view is full
   * (every counted relay answered) and it is not visibly behind, a reveal could lock in an ending branch that a
   * partial view alone shows. Released by `sendAnyway`, or once held for `HOLD_CAP_S`.
   */
  #secretHeld(): boolean {
    const session = this.#session;
    if (session === null || this.#forced || !session.duties().some((d) => d.kind === 'secret')) return false;
    if (this.#viewFull && !this.#behind(session)) return false;
    return this.#secretSince === null || this.#d.now() - this.#secretSince < HOLD_CAP_S;
  }

  /** Republish the rival shuffle steps of a held shuffle fork (`Session.forkSteps`), once each per load. */
  #echoFork(session: Session): void {
    const root = this.#root;
    if (root === null) return;
    for (const id of session.forkSteps()) {
      if (this.#echoedSteps.has(id)) continue;
      const ev = this.#events.get(id);
      if (ev === undefined) continue;
      this.#echoedSteps.add(id);
      void this.#d.pool.publish(ev, unionRelays(root.relays, this.#d.relays())).catch(() => {
        // Best effort.
      });
    }
  }

  /**
   * Ask the relays again for this seat's own events before republishing an unconfirmed move, deal or Resign (D056):
   * its moves on the parents those moves name, its Shares events and Resigns, and, while a saved event is not folded
   * in yet, the whole game. Only once every relay has answered does `#vetSaved` decide; otherwise nothing is
   * published or discarded, and the next tick asks again.
   */
  #startVet(): void {
    const root = this.#root;
    const me = this.#mySession;
    if (this.#vetting || this.#disposed || !this.#synced || root === null || me === null) return;
    const saved = this.#toVet();
    const secret = this.#secretHeld();
    if (saved.length === 0 && !secret) return;
    this.#vetting = true;
    const prevs = new Set<string>();
    for (const slot of saved) {
      const ev = this.#outbox.get(slot)?.event;
      const prev = ev?.kind === KIND.move ? prevOf(ev) : null;
      if (prev !== null) prevs.add(prev);
    }
    const filters: Filter[] = [{ kinds: [KIND.shares, KIND.resign], authors: [me], '#e': [this.rootId] }];
    if (prevs.size > 0) filters.push({ kinds: [KIND.move], authors: [me], '#e': [...prevs] });
    const whole = secret || saved.some((slot) => this.#unvetted.has(slot));
    if (whole)
      filters.push({
        kinds: [...SESSION_KINDS],
        authors: [...this.#sessionKeys],
        '#e': [this.rootId],
        limit: this.#page,
      });
    let stop = (): void => {};
    stop = this.#d.pool.subscribe(
      filters,
      (ev) => this.#onEvent(ev),
      (info) => {
        stop();
        this.#vetting = false;
        if (this.#disposed) return;
        if (this.#fullAnswer(info)) {
          if (whole) this.#viewFull = true;
          this.#vetSaved(false);
          const session = this.#session;
          if (session !== null && this.#behind(session)) this.#resolveMissing(session);
        } else this.#holding('not every relay has answered');
        this.#refresh();
        this.#queueDuties();
      },
    );
    this.#stops.push(stop);
  }

  /** Whether `ev` is a game event of this game signed by the key its kind needs: a seat's session key or npub. */
  #seated(ev: NostrEvent): boolean {
    if (!ev.tags.some((t) => t[0] === 'e' && t[1] === this.rootId)) return false;
    if (SESSION_KINDS.includes(ev.kind)) return this.#sessionKeys.has(ev.pubkey);
    return ev.kind === KIND.attest && this.#npubs.has(ev.pubkey);
  }

  /**
   * Follow the game's events from the seated keys only, so strangers' events cannot crowd a relay's answer. The
   * first page stays open for new events; while a page brings events not seen before, an older page follows, up
   * to the oldest date among those new events. Loading is complete when a page brings nothing new. The pool
   * merges relays, so one `until` serves them all (D036: a gap across relays).
   */
  #subscribeGame(root: ParsedRoot): void {
    this.#sessionKeys = new Set(root.seats.map((s) => s.session));
    this.#npubs = new Set(root.seats.map((s) => s.npub));
    const filters = (until: number | null): Filter[] => {
      const page = { '#e': [this.rootId], limit: this.#page, ...(until === null ? {} : { until }) };
      return [
        { kinds: [...SESSION_KINDS], authors: [...this.#sessionKeys], ...page },
        { kinds: [KIND.attest], authors: [...this.#npubs], ...page },
      ];
    };
    // Whether every relay answered every page so far: one page answered by every relay and the next by some only
    // leaves the sync partial (D056).
    let full = true;
    const page = (until: number | null): void => {
      let fresh = 0;
      let oldest = Number.POSITIVE_INFINITY;
      let stop = (): void => {};
      const onEvent = (ev: NostrEvent): void => {
        if (this.#disposed) return;
        // Only seated events this client had not seen move the page: a stranger's event, or an old one dated far
        // back, must not steer `until`.
        if (this.#seated(ev) && !this.#got.has(ev.id)) {
          fresh++;
          if (ev.created_at < oldest) oldest = ev.created_at;
        }
        this.#onEvent(ev);
      };
      const onEose = (info: EoseInfo): void => {
        if (this.#disposed) return;
        full &&= this.#fullAnswer(info);
        if (until !== null) stop();
        if (fresh > 0 && Number.isFinite(oldest)) {
          page(oldest);
          return;
        }
        this.#gameEose = true;
        this.#viewFull = full;
        if (this.#session !== null) this.#feedHeld();
        this.#maybeSynced();
      };
      stop = this.#d.pool.subscribe(filters(until), onEvent, onEose);
      this.#stops.push(stop);
    };
    page(null);
  }

  #onRoot(ev: NostrEvent): void {
    if (this.#rootEv !== null) return;
    let root: ParsedRoot;
    try {
      root = parseRoot(ev);
    } catch (e) {
      this.error.value = `This game's start event is invalid: ${errorText(e)}`;
      return;
    }
    this.#rootEv = ev;
    this.#root = root;
    this.game.value = root.game;
    this.tableAddress.value = root.tableAddress;
    this.#noteSeen(ev.id, this.#d.now());
    this.#storedTable = loadTable(this.#d.storage, this.#d.profile, this.rootId, root.tableAddress);
    if (this.#storedTable !== null) this.table.value = parseTable(this.#storedTable);
    this.#mySession = root.seats.find((s) => s.npub === this.#d.signer.pubkey)?.session ?? null;
    this.#subscribeGame(root);
    const seats = root.seats.map((s) => s.npub);
    this.seats.value = seats;
    // The relays that count for a full answer (`#fullAnswer`) must all be asked: the root's and this player's.
    this.#d.pool.addRelays?.(unionRelays(root.relays, this.#d.relays()));
    const [, creator, tableId] = root.tableAddress.split(':');
    this.#stops.push(
      this.#d.pool.subscribe(
        [
          { kinds: [KIND.table], authors: [creator as string], '#d': [tableId as string] },
          // Only the Joins the root seats, by id: anyone can tag the public table address with Joins.
          { kinds: [KIND.join], ids: [...root.joinIds] },
        ],
        (lobbyEv) => this.#onLobby(lobbyEv),
        () => {
          this.#lobbyEose = true;
          this.#tryCreate();
        },
      ),
    );
  }

  /**
   * Take a Table or Join for this game's lobby. Relays are not trusted to filter: a Table counts only at the
   * root's address (same creator and `d` tag), and a Join only if the root seats it and it names that address.
   */
  #onLobby(ev: NostrEvent): void {
    const root = this.#root;
    if (this.#disposed || root === null) return;
    if (ev.kind === KIND.table) {
      let t: ParsedTable;
      try {
        t = parseTable(ev);
      } catch {
        return;
      }
      if (t.address !== root.tableAddress || this.#tables.has(ev.id)) return;
      this.#tables.set(ev.id, ev);
      // Until the game loads, show the saved Table, else the newest from the relays.
      if (this.#session === null && this.#storedTable === null && this.#relayTables()[0] === ev)
        this.table.value = t;
    } else if (ev.kind === KIND.join) {
      const a = ev.tags.find((tag) => tag[0] === 'a')?.[1];
      if (a !== root.tableAddress || !root.joinIds.includes(ev.id)) return;
      this.#joins.set(ev.id, ev);
    } else return;
    this.#tryCreate();
  }

  /** The relays' Table versions, newest first (ties: lowest id). */
  #relayTables(): NostrEvent[] {
    return [...this.#tables.values()].sort((a, b) =>
      a.created_at !== b.created_at ? b.created_at - a.created_at : a.id < b.id ? -1 : 1,
    );
  }

  /**
   * Build the session once a Table the root validates against and every seat's Join are known. The saved Table
   * comes first; without one, every Table version the relays sent is tried, newest first. The one that works is
   * saved, so a creator who republishes the Table later cannot stop this profile from loading the game.
   */
  #tryCreate(): void {
    const root = this.#root;
    const rootEv = this.#rootEv;
    if (this.#session !== null || root === null || rootEv === null || this.#disposed) return;
    const stored = this.#storedTable;
    const tables = [
      ...(stored === null ? [] : [stored]),
      ...this.#relayTables().filter((t) => t.id !== stored?.id),
    ];
    const missing = tables.length === 0 || root.joinIds.some((id) => !this.#joins.has(id));
    if (missing) {
      if (this.#lobbyEose)
        this.error.value = "Still looking for this game's table and players on the relays…";
      return;
    }
    const base = {
      modules: this.#d.modules,
      joins: [...this.#joins.values()],
      root: rootEv,
      rootSeenAt: this.#seen.get(root.id) ?? this.#d.now(),
    };
    // The Table the root validates against: validation does not depend on the seat.
    let table: NostrEvent | null = null;
    let problem = '';
    for (const t of tables) {
      try {
        openSession({ ...base, table: t, me: null });
        table = t;
        break;
      } catch (e) {
        problem ||= errorText(e);
      }
    }
    if (table === null) {
      // Another relay may still send an older version that fits.
      if (this.#lobbyEose) this.error.value = `This game cannot be loaded: ${problem}`;
      return;
    }
    const input = { ...base, table };
    const me = this.#identity(root);
    let session: Session;
    try {
      session = openSession({ ...input, me });
    } catch (e) {
      if (me === null) {
        this.error.value = `This game cannot be loaded: ${errorText(e)}`;
        return;
      }
      this.recovered.value = null;
      try {
        session = openSession({ ...input, me: null });
        this.error.value = 'Your saved keys do not match your seat in this game, so you are watching it.';
      } catch (e2) {
        this.error.value = `This game cannot be loaded: ${errorText(e2)}`;
        return;
      }
    }
    if (this.error.value?.startsWith('Still looking') || this.error.value?.startsWith('This game cannot'))
      this.error.value = null;
    this.#session = session;
    this.#me = session.view().mySeat === null ? null : me;
    // A seat recovered from saved game keys (D057) has no npub match: its own events are known by its session key.
    if (this.#mySession === null && this.#me !== null) {
      this.#mySession = root.seats[this.#me.seat]?.session ?? null;
      for (const ev of this.#events.values()) if (ev.pubkey === this.#mySession) this.#noteMine(ev);
    }
    if (table.id !== stored?.id && writeJson(this.#d.storage, tableKey(this.#d.profile, this.rootId), table))
      this.#storedTable = table;
    this.table.value = parseTable(table);
    if (me !== null) saveRootId(this.#d.profile, this.#d.storage, root.tableAddress, root.id);
    // Own events (they may never have reached a relay) and whatever arrived meanwhile, once the relays sent all.
    if (this.#gameEose) this.#feedHeld();
    this.#refresh();
    this.#maybeSynced();
  }

  /**
   * This player's seat and secrets, or null to watch as a spectator. The seat is the one the key in use joined
   * with; failing that (D057), the seat whose session key and deck key both match the game keys this browser saved
   * for the table, for a player whose key was lost or replaced after joining. Only keys already in this browser's
   * storage are tried, and `openSession` checks them against the seat again.
   */
  #identity(root: ParsedRoot): Identity | null {
    const seat = root.seats.findIndex((s) => s.npub === this.#d.signer.pubkey);
    const secrets = loadSecrets(this.#d.profile, this.#d.storage, root.tableAddress);
    if (seat < 0) {
      if (secrets === null) return null;
      const deckSecret = BigInt(`0x${bytesToHex(secrets.deckSecret)}`);
      const saved = seatForGameKeys(root, secrets.sessionSk, deckSecret);
      if (saved === null) return null;
      this.recovered.value = { seat: saved, npub: root.seats[saved]?.npub as Hex };
      return { seat: saved, sessionSk: secrets.sessionSk, deckSecret };
    }
    if (secrets === null) {
      this.error.value = 'This browser does not hold your keys for this game, so you are watching it.';
      return null;
    }
    return { seat, sessionSk: secrets.sessionSk, deckSecret: BigInt(`0x${bytesToHex(secrets.deckSecret)}`) };
  }

  #maybeSynced(): void {
    if (this.#synced || this.#session === null || !this.#gameEose) return;
    this.#synced = true;
    this.#retryUndelivered();
    this.#refresh();
    this.#queueDuties();
  }

  /* ------------------------------------------------------------------------------------------- refresh */

  #queueRefresh(): void {
    if (this.#refreshQueued) return;
    this.#refreshQueued = true;
    queueMicrotask(() => {
      this.#refreshQueued = false;
      this.#refresh();
      this.#queueDuties();
    });
  }

  #refresh(): void {
    const session = this.#session;
    const now = this.#d.now();
    this.clock.value = now;
    this.#saveSeen();
    if (session === null) return;
    const v = session.view();
    const duties = session.duties();
    this.view.value = v;
    const waiting = session.waitingFor();
    if (waiting.join() !== this.waiting.value.join()) this.waiting.value = waiting;
    const owed = this.#owedNow(v, waiting);
    if (JSON.stringify(owed) !== JSON.stringify(this.owed.value)) this.owed.value = owed;
    this.legal.value = this.#synced && !this.#ownMovePending(v) ? session.legalActions() : [];
    this.timeoutTarget.value = this.#synced ? session.timeoutTarget(now) : null;
    this.canResign.value = this.#synced && session.canResign();
    this.#trackHold(now);
    this.status.value = this.#statusOf(v, duties);
    this.#echoResign(v);
    this.#cacheStatus(v.head.seq, this.status.value, now, owed);
    this.#maybePrune(v, duties);
  }

  /**
   * Keep `#holdSince` and `canSendAnyway` current (D056, fix round 2): something is held while a saved event loaded
   * from storage waits to be vetted, or the Secret reveal is due but held back for a full view.
   */
  #trackHold(now: number): void {
    const session = this.#session;
    const secretDue = session?.duties().some((d) => d.kind === 'secret') === true;
    const secretWaits =
      secretDue && !this.#forced && !(this.#viewFull && session !== null && !this.#behind(session));
    if (this.#synced && secretWaits) this.#secretSince ??= now;
    else this.#secretSince = null;
    const held = this.#synced && this.#unvetted.size > 0;
    if (held) this.#holdSince ??= now;
    else this.#holdSince = null;
    const capped = (since: number | null): boolean => since !== null && now - since >= HOLD_CAP_S;
    this.canSendAnyway.value = capped(this.#holdSince) || (secretWaits && capped(this.#secretSince));
  }

  /**
   * Republish the Resign that counted on this client to the root's relays and this player's (D052, review M-b),
   * once per load, as other final evidence: a resigner that sent its Resign to only some relays cannot leave the
   * players who never saw it to be timed out while the game looks live to them.
   */
  #echoResign(v: SessionView): void {
    const id = v.resignId;
    const root = this.#root;
    if (!this.#synced || id === null || root === null || this.#echoed.has(id) || this.#disposed) return;
    const ev = this.#resigns.get(id);
    if (ev === undefined) return;
    this.#echoed.add(id);
    void this.#d.pool.publish(ev, unionRelays(root.relays, this.#d.relays())).catch(() => {
      // Best effort: the resign is held here either way.
    });
  }

  /**
   * Save the status for the Home screen (`bg:<profile>:gamestatus:<rootId>`) when it or the head changed, or the
   * saved entry is older than `STATUS_REFRESH_S`. Not while loading: `syncing` says nothing.
   */
  #cacheStatus(seq: number, status: GameStatus, now: number, owed: OwedReveal | null): void {
    if (status === 'syncing' || this.#disposed) return;
    const seats = this.seats.value;
    const mySeat = this.view.value?.mySeat ?? null;
    const reveal: RevealCache | undefined =
      owed === null
        ? undefined
        : {
            npubs: owed.seats.filter((k) => k !== mySeat).map((k) => seats[k] as string),
            mine: mySeat !== null && owed.seats.includes(mySeat),
            until: owed.until,
          };
    const key = JSON.stringify(reveal ?? null);
    const last = this.#savedStatus;
    if (
      last?.status === status &&
      last.seq === seq &&
      last.reveal === key &&
      now - last.at < STATUS_REFRESH_S
    )
      return;
    const entry = { status, seq, updatedAt: now, ...(reveal === undefined ? {} : { reveal }) };
    if (saveGameStatus(this.#d.profile, this.#d.storage, this.rootId, entry))
      this.#savedStatus = { status, seq, at: now, reveal: key };
  }

  /**
   * The card reveal the game waits on now (D060, `owedReveal`), with this seat added while a Shares event of its
   * own prompt shares (`share:*`) has reached no relay: the other clients still wait for it.
   */
  #owedNow(v: SessionView, waiting: readonly number[]): OwedReveal | null {
    const owed = owedReveal({
      phase: v.phase,
      pending: v.pending,
      waiting,
      pendingSince: v.pendingSince,
      deadline: v.deadline,
    });
    const me = v.mySeat;
    const undelivered = [...this.#outbox].some(
      ([slot, e]) => slot.startsWith('share:') && !e.confirmed && !e.orphan,
    );
    if (me === null || !undelivered || v.phase !== 'play' || owed?.seats.includes(me)) return owed;
    return {
      seats: [...(owed?.seats ?? []), me].sort((a, b) => a - b),
      until: owed?.until ?? v.pendingSince + v.deadline,
    };
  }

  #statusOf(v: SessionView, duties: readonly Duty[]): GameStatus {
    if (!this.#synced) return 'syncing';
    if (v.phase === 'cancelled') return 'cancelled';
    if (this.#working || this.#nextAuto(duties, v) !== null) return 'working';
    if (this.#stuck(duties, v)) return 'stuck';
    if (v.phase === 'done') return 'done';
    if (duties.some((d) => d.kind === 'decide') && !this.#ownMovePending(v)) return 'your-turn';
    return 'waiting';
  }

  /** An automatic duty is due but failed at this head. */
  #stuck(duties: readonly Duty[], v: SessionView): boolean {
    return duties.some((d) => AUTO.includes(d.kind) && this.#failed.has(`${d.kind}@${v.head.id}`));
  }

  /** A move of mine on the current head is saved but not folded in (it waits for something): do not decide again. */
  #ownMovePending(v: SessionView): boolean {
    const e = this.#outbox.get(moveSlot(v.head.seq + 1, v.head.id));
    return e !== undefined && !e.orphan;
  }

  /** Once the game is over and every saved event is delivered (or refused), the outbox is no longer needed. */
  #maybePrune(v: SessionView, duties: readonly Duty[]): void {
    if (this.#disposed || this.#outbox.size === 0) return;
    if (v.phase !== 'done' && v.phase !== 'cancelled') return;
    if (this.#working || this.#nextAuto(duties, v) !== null) return;
    if (![...this.#outbox.values()].every((e) => e.confirmed || e.orphan)) return;
    this.#outbox.clear();
    removeItem(this.#d.storage, outboxKey(this.#d.profile, this.rootId));
  }

  /* -------------------------------------------------------------------------------------------- duties */

  #nextAuto(duties: readonly Duty[], v: SessionView): Duty['kind'] | null {
    for (const kind of AUTO) {
      if (kind === 'attest' && (this.#session === null || !canAttest(this.#session))) continue;
      // The attestation is signed by the seat's npub, which a recovered seat does not hold (D057).
      if (kind === 'attest' && this.recovered.value !== null) continue;
      if (this.#blocked(kind, v) || this.#heldDuties.has(`${kind}@${v.head.id}`)) continue;
      // Waiting for its date (`#buildDate`) until the wake timer fires (or its time has come, should it be late).
      const wake = this.#waits.get(`${kind}@${v.head.id}`);
      if (wake !== undefined && this.#d.now() < wake) continue;
      if (duties.some((d) => d.kind === kind) && !this.#failed.has(`${kind}@${v.head.id}`)) return kind;
    }
    return null;
  }

  /**
   * Whether an automatic duty must not be built now (D056): its saved event is still being vetted, or, for the deal,
   * this seat holds a deal it signed that the session refuses (it is on a rival deck of a shuffle fork, or another
   * deal of this seat is out), whether or not a relay confirmed it: a seat never deals twice.
   */
  #blocked(kind: Duty['kind'], v: SessionView): boolean {
    if (kind === 'shuffle' || kind === 'beacon') {
      return this.#unvetted.has(moveSlot(v.head.seq + 1, v.head.id));
    }
    if (kind === 'secret') return this.#secretHeld();
    // A saved Shares event still being vetted may carry positions the duty lists (audit-luster F3): only those
    // duties wait, so a silent relay does not hold back reveals of other cards.
    if (kind === 'share') {
      const duty = this.#session?.duties().find((d) => d.kind === 'share');
      const due = new Set(duty?.kind === 'share' ? duty.positions : []);
      return [...this.#unvetted].some(
        (slot) =>
          slot.startsWith('share:') &&
          slot
            .slice('share:'.length)
            .split(',')
            .some((pos) => due.has(Number(pos))),
      );
    }
    if (kind !== 'deal') return false;
    if (this.#unvetted.has('deal')) return true;
    const held = this.#outbox.get('deal');
    return held?.orphan === true && this.#ownDeal('deal', held);
  }

  #queueDuties(): void {
    if (this.#dutyQueued || this.#running || !this.#synced || this.#disposed) return;
    this.#dutyQueued = true;
    this.#d.timers.later(0, () => {
      this.#dutyQueued = false;
      void this.#runDuties();
    });
  }

  /** Perform automatic duties one at a time until none is due. */
  async #runDuties(): Promise<void> {
    const session = this.#session;
    if (session === null || this.#running || this.#disposed || this.busy.value) return;
    this.#running = true;
    const done = new Set<string>();
    try {
      for (;;) {
        const v = session.view();
        const kind = this.#nextAuto(session.duties(), v);
        if (kind === null) break;
        this.#working = true;
        this.#refresh();
        // Let the screen show "working" before a long proof blocks the thread.
        await this.#yield();
        if (this.#disposed) return;
        const head = session.view().head;
        const key = `${kind}@${head.id}`;
        try {
          // A duty still due after its event was folded in would loop forever: stop at the second try.
          if (done.has(key)) throw new ClientError('the duty is still due after its event was sent');
          done.add(key);
          const r = await this.#perform(session, kind);
          // Waiting for the event's date (`#buildDate`): `#waits` holds it until its one wake timer fires.
          if (r === 'held') {
            this.#heldDuties.add(key);
            this.#holding(
              'it is not yet known whether another device of yours already sent it (not every relay has answered)',
            );
          }
        } catch (e) {
          this.#failed.add(key);
          this.error.value = `Could not ${kind === 'deal' ? 'deal' : `send the ${kind}`}: ${errorText(e)}`;
        }
      }
    } finally {
      this.#running = false;
      this.#working = false;
      this.#refresh();
    }
  }

  /**
   * Build (or reuse) and commit the event of one automatic duty. Before signing a new event it runs the check before
   * signing (D059 item 2): `held` when not every live relay answered (tried again on the next tick), and nothing is
   * signed when the answer brought this seat's own event for the slot from another device (the session folded it).
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: every branch but a hold returns its commit's result.
  async #perform(session: Session, kind: Duty['kind']): Promise<'held' | 'wait' | void> {
    const head = session.view().head;
    const { rnd, now } = this.#d;
    if (kind === 'shuffle' || kind === 'beacon') {
      // A shuffle step or a public roll's share is a move on this head. Reusing the saved one is what keeps the seat
      // from signing two moves on one parent.
      const slot = moveSlot(head.seq + 1, head.id);
      const saved = this.#reusable(slot, head.id);
      if (saved !== null) return this.#commit(slot, saved);
      // The date the event will carry (`#buildDate`), chosen from events both devices hold alike. The local clock
      // decides only when to sign: a date ahead of it is waited for, never changed.
      const plan = this.#buildDate(session, head.id);
      if (plan !== null && plan.wait > 0) {
        // One wake time per duty, armed once: ticks do not re-run a waiting duty (`#nextAuto`).
        const key = `${kind}@${head.id}`;
        if (!this.#waits.has(key)) {
          this.#waits.set(key, now() + plan.wait);
          this.#stops.push(
            this.#d.timers.later(plan.wait * 1000 + 1000, () => {
              this.#waits.delete(key);
              this.#queueDuties();
            }),
          );
        }
        return 'wait';
      }
      if (!(await this.#clearToSign(session, kind, head.id))) return 'held';
      if (session.view().head.id !== head.id || !session.duties().some((d) => d.kind === kind)) return;
      // Both statements are fixed by the head, so the event is built from this seat's deterministic stream: two
      // devices that build it sign the very same event, not two rivals (audit-bank F3). With no plan (a head dated
      // too far ahead) it is dated now with fresh randomness, as before; the check above still applies.
      const det = plan === null ? rnd : this.#buildRnd(`${kind}:${head.id}`);
      const at = plan?.at ?? now();
      const built =
        this.#reusable(slot, head.id) ??
        (kind === 'shuffle' ? session.buildShuffle(det, at) : v1Session(session).buildBeacon(det, at));
      return this.#commit(slot, built);
    }
    if ((kind === 'deal' || kind === 'share') && this.#live(this.#dutySlot(session, kind)) === null) {
      // The check before signing, for Shares events: another device's deal or reveal is adopted instead.
      if (!(await this.#clearToSign(session, kind, null))) return 'held';
      if (!session.duties().some((d) => d.kind === kind)) return;
    }
    // A secret or attestation the session refused (an orphan: a changed result) is built anew: a seat's secret is
    // one value, and its latest attestation is the one that counts. A deal is not (D056, review F7): a seat deals
    // at most once per game, since the shuffle equivocator could translate shares between rival decks. A refused
    // deal is rebuilt only if it is not this seat's (a stray event in storage), whether or not it left this device:
    // a deal that no relay confirmed may still be on one. The session itself owes no deal once it holds this seat's
    // deal on a rival deck.
    if (kind === 'deal') return this.#single('deal', () => session.buildDeal(rnd, now()));
    if (kind === 'share') {
      // Per-position slots persist/reuse public shares without replacing the one-time setup deal.
      return this.#single(this.#dutySlot(session, 'share'), () => v1Session(session).buildShares(rnd, now()));
    }
    if (kind === 'secret') return this.#single('secret', () => session.buildSecret(rnd, now()));
    if (kind === 'attest') {
      // A new attestation must be later than the refused one, or it would not replace it (latest wins).
      const after = (): number => (this.#outbox.get('attest')?.event.created_at ?? 0) + 1;
      return this.#single('attest', () => this.#attestEvent(session, after()));
    }
  }

  /** The outbox slot of a Shares duty: `deal`, or `share:<positions>` for the positions the share duty lists. */
  #dutySlot(session: Session, kind: 'deal' | 'share'): string {
    if (kind === 'deal') return 'deal';
    const duty = session.duties().find((d) => d.kind === 'share');
    return `share:${duty?.kind === 'share' ? duty.positions.join(',') : ''}`;
  }

  /**
   * Run the check before signing for a duty: false to hold it back. Before asking the relays it looks at what they
   * already sent: a move of this seat on `parent` that the session has not taken (pooled, waiting for something)
   * must not get a rival, so the duty fails at this head.
   */
  async #clearToSign(session: Session, kind: Duty['kind'], parent: string | null): Promise<boolean> {
    const rival = (): boolean => parent !== null && this.#otherMine(`move:${parent}`, null);
    if (rival()) throw new ClientError('another device of yours already sent it');
    const check = await this.#checkBeforeSign(session, `${kind}@${session.view().head.id}`);
    if (this.#disposed) throw new Error('the game screen was closed');
    if (session.view().head.id === parent && rival())
      throw new ClientError(`another device of yours already sent the ${kind}`);
    return check === 'clear';
  }

  /**
   * The check before signing (D059 item 2; prompt-reveal §5.1 rule 9): ask the relays, the root's and this player's
   * own, for this seat's moves on the current head and its Shares events and Resigns, and fold in what comes (an
   * event this seat sent from another device is adopted). `clear` once every live counted relay answered (dead ones
   * left out; with none alive there is nothing to ask, and the D056 outbox rule still vets the event before any
   * republish); otherwise `hold`, until `HOLD_CAP_S` has passed since the first such answer for this `slot`
   * (`kind@headId`), or Send anyway.
   */
  async #checkBeforeSign(session: Session, slot: string): Promise<'clear' | 'hold'> {
    const me = this.#mySession;
    if (me === null || this.#root === null || this.#disposed) return 'clear';
    const head = session.view().head.id;
    const filters: Filter[] = [
      { kinds: [KIND.move], authors: [me], '#e': [head] },
      { kinds: [KIND.shares, KIND.resign], authors: [me], '#e': [this.rootId] },
    ];
    const info = await new Promise<EoseInfo | null>((resolve) => {
      let settled = false;
      let stop: (() => void) | null = null;
      let cancel: (() => void) | null = null;
      const finish = (i: EoseInfo | null): void => {
        if (settled) return;
        settled = true;
        stop?.();
        cancel?.();
        resolve(i);
      };
      const s = this.#d.pool.subscribe(filters, (ev) => this.#onEvent(ev), finish);
      if (settled) s();
      else {
        stop = s;
        this.#stops.push(s);
      }
      const c = this.#d.timers.later(CHECK_TIMEOUT_MS, () => finish(null));
      if (settled) c();
      else cancel = c;
    });
    if (info !== null && this.#liveAnswer(info)) {
      this.#checkSince.delete(slot);
      return 'clear';
    }
    if (this.#forced) return 'clear';
    const now = this.#d.now();
    const since = this.#checkSince.get(slot) ?? now;
    this.#checkSince.set(slot, since);
    return now - since >= HOLD_CAP_S ? 'clear' : 'hold';
  }

  /**
   * Whether `info` answers for every live relay that counts for the check before signing: the root's and this
   * player's own, less those the pool reports dead (root relays included, unlike `#fullAnswer`: the other device
   * published moments ago, to the same root relays). True when none is alive.
   */
  #liveAnswer(info: EoseInfo): boolean {
    if (info.eosedUrls === undefined) return info.eose === info.relays;
    const dead = new Set(info.deadUrls ?? []);
    const eosed = new Set(info.eosedUrls);
    const counted = unionRelays(this.#root?.relays ?? [], this.#d.relays()).filter((u) => !dead.has(u));
    return counted.every((u) => eosed.has(u));
  }

  /** This seat's deterministic stream for `label` in this game (`det-random.ts`); the injected one for no seat. */
  #buildRnd(label: string): RandomBytes {
    const me = this.#me;
    if (me === null) return this.#d.rnd;
    return deterministicRandom(seatStreamKey(me.sessionSk, me.deckSecret), `${this.rootId}:${label}`);
  }

  /**
   * The date of a deterministic build on `headId`, and how long (s) to wait before signing it, or null to date it now
   * with fresh randomness (D063). The date depends only on events both devices of the seat hold alike: the head's
   * `created_at` (chosen by the previous mover), raised to the latest date of this seat's own moves on the chain, or
   * the root's (so an ancient or 1970 date gives way to an honest one). The local clock only sets the wait: a date
   * more than `SIGN_AHEAD_S` ahead of it is waited for (relays refuse events dated far ahead), up to the smaller of
   * `MAX_WAIT_S` and a quarter of the table's deadline; a date further ahead falls back (null). Two devices that
   * straddle that bound are then hours apart, so the later one's check before signing finds the earlier one's event.
   */
  #buildDate(session: Session, headId: string): { at: number; wait: number } | null {
    const root = this.#rootEv;
    const headAt = headId === this.rootId ? root?.created_at : this.#dates.get(headId);
    if (headAt === undefined || root === null || this.#root === null) return null;
    let floor = root.created_at;
    for (const [id, at] of this.#ownMoves) if (at > floor && session.chainSeq(id) !== null) floor = at;
    const at = Math.max(headAt, floor);
    const ahead = at - this.#d.now();
    if (ahead > Math.min(MAX_WAIT_S, Math.floor(this.#root.deadline / 4))) return null;
    return { at, wait: Math.max(0, ahead - SIGN_AHEAD_S) };
  }

  /**
   * Commit the saved event for a single-slot duty, or a new one. If the session refuses the event it committed
   * (saved by this or another tab, now an orphan), build anew once, in this same step, rather than leaving the
   * duty failed until the head moves.
   */
  async #single(slot: string, build: () => NostrEvent | Promise<NostrEvent>): Promise<void> {
    try {
      return this.#commit(slot, this.#live(slot) ?? (await build()));
    } catch (e) {
      const refused = this.#outbox.get(slot);
      if (!(e instanceof ClientError) || refused?.orphan !== true) throw e;
      // Never deal twice (D056): a refused deal of this seat's is its deal for the game, sent or not.
      if (this.#ownDeal(slot, refused)) throw e;
    }
    return this.#commit(slot, await build());
  }

  /** The event saved for a single-slot duty (`deal`, `secret`, `attest`), unless the session refused it. */
  #live(slot: string): NostrEvent | null {
    const entry = this.#outbox.get(slot);
    return entry !== undefined && !entry.orphan ? entry.event : null;
  }

  /**
   * The attestation: the session's `attestTemplate(createdAt)`, signed by the player's npub (§4.8), dated now or
   * `notBefore`, whichever is later.
   */
  async #attestEvent(session: Session, notBefore = 0): Promise<NostrEvent> {
    const api = session as unknown as AttestApi;
    if (typeof api.attestTemplate !== 'function') throw new ClientError('this session cannot attest');
    const ev = await this.#d.signer.sign(api.attestTemplate(Math.max(this.#d.now(), notBefore)));
    // The signer may have kept a prompt open while the screen closed.
    if (this.#disposed) throw new Error('the game screen was closed');
    return ev;
  }

  /**
   * A move already built for `slot` on the parent `prevId`, from this tab or another tab of the same profile.
   * Reusing it is what keeps this seat from ever signing two moves on one parent (equivocation, §6.6).
   */
  #reusable(slot: string, prevId: string): NostrEvent | null {
    const fresh = loadOutbox(this.#d.storage, this.#d.profile, this.rootId).get(slot);
    if (fresh !== undefined && !this.#outbox.has(slot)) this.#outbox.set(slot, fresh);
    const held = this.#outbox.get(slot)?.event;
    return held !== undefined && prevOf(held) === prevId ? held : null;
  }

  /**
   * Save the event to the outbox, fold it in locally, then publish it. If the session rejects it, it is marked
   * an orphan and not published, and this throws (the duty is then not retried at this head). A move that
   * cannot be saved is dropped unpublished: an unsaved move could be signed again after a reload.
   */
  #commit(slot: string, built: NostrEvent): void {
    if (this.#disposed) throw new Error('the game screen was closed');
    const session = this.#session;
    if (session === null) throw new Error('the game is not loaded');
    // Another tab of this profile may have saved an event for the same slot meanwhile: use that one instead.
    // A refused event saved for a single-slot duty is replaced; a move slot always keeps what it holds.
    let saved = loadOutbox(this.#d.storage, this.#d.profile, this.rootId).get(slot);
    const held = this.#outbox.get(slot);
    // A deal this seat signed is never replaced by another (D056, review F7).
    for (const e of [saved, held])
      if (e !== undefined && e.event.id !== built.id && this.#ownDeal(slot, e))
        throw new ClientError('this seat has already dealt in this game');
    if (saved?.orphan === true && !slot.startsWith('move:')) saved = undefined;
    const ev = saved?.event ?? built;
    const entry: OutboxEntry =
      held?.event.id === ev.id && !(held.orphan && saved === undefined)
        ? held
        : { event: ev, confirmed: saved?.confirmed ?? false, orphan: saved?.orphan ?? false };
    this.#outbox.set(slot, entry);
    if (!this.#persist(slot)) {
      if (slot.startsWith('move:')) {
        this.#outbox.delete(slot);
        this.notice.value = 'This browser could not save your move, so it was not sent. Free some storage.';
        throw new Error('the move could not be saved in this browser');
      }
      this.notice.value = 'This browser could not save your last event; keep this tab open until it is sent.';
    }
    this.#unvetted.delete(slot);
    this.#fed.add(ev.id);
    const r = this.#receive(session, ev);
    if (r.status === 'rejected') {
      entry.orphan = true;
      this.#persist(slot);
      throw new ClientError(`own event rejected: ${r.reason}`);
    }
    void this.#publish(slot);
    this.#refresh();
  }

  /** Merge one slot into the stored outbox (other tabs may have written other slots). */
  #persist(slot: string): boolean {
    if (this.#disposed) return true;
    const entry = this.#outbox.get(slot);
    if (entry === undefined) return true;
    const key = outboxKey(this.#d.profile, this.rootId);
    const stored = readJson(this.#d.storage, key);
    const all: Record<string, unknown> =
      typeof stored === 'object' && stored !== null && !Array.isArray(stored)
        ? { ...(stored as Record<string, unknown>) }
        : {};
    all[slot] = entry;
    return writeJson(this.#d.storage, key, all);
  }

  #confirm(slot: string): void {
    const entry = this.#outbox.get(slot);
    // A relay has it: it is public, so there is nothing left to vet (D056).
    this.#unvetted.delete(slot);
    if (entry === undefined || entry.confirmed) return;
    entry.confirmed = true;
    this.#persist(slot);
    // A delivery notice goes once everything is delivered; a log line (a discarded or kept event) stays.
    const shown = this.notice.value;
    if (shown !== null && this.log.value.includes(shown)) return;
    if ([...this.#outbox.values()].every((e) => e.confirmed || e.orphan)) this.notice.value = null;
  }

  /** Publish the slot's event to the root's relays and this player's relays. */
  async #publish(slot: string): Promise<void> {
    const entry = this.#outbox.get(slot);
    const root = this.#root;
    if (this.#disposed || entry === undefined || entry.orphan || root === null || this.#inFlight.has(slot))
      return;
    // The owner never releases its own private layer (D058, audit-luster F3): a Shares event of a position that is
    // now this seat's own card is discarded, whatever path brought it here.
    const session = this.#session;
    if (slot.startsWith('share:') && session !== null) {
      const own = ownCardReason(
        sharePositions(entry.event) ?? [],
        session.view().mySeat,
        this.#dealt(session),
      );
      if (own !== null) {
        const fed = this.#fed.has(entry.event.id);
        this.#discard(slot, own);
        if (fed) this.#rebuild();
        return;
      }
    }
    this.#inFlight.add(slot);
    try {
      // The deck first, so a relay that takes the deal has its deck already (D056).
      if (slot === 'deal' && this.#session !== null) await this.#echoDeck(this.#session, root);
      if (this.#disposed || this.#outbox.get(slot) !== entry || entry.orphan) return;
      const results = await this.#d.pool.publish(entry.event, unionRelays(root.relays, this.#d.relays()));
      if (this.#disposed) return;
      if (results.some((r) => r.ok)) this.#confirm(slot);
      else this.notice.value = 'Not delivered to any relay yet; retrying.';
    } finally {
      this.#inFlight.delete(slot);
    }
  }

  /**
   * Republish the shuffle steps this seat deals on, before its deal, and wait for the relays' answers (D056): every
   * client that receives the deal then holds the deck it was built on, so a shuffle fork the equivocator showed to
   * some seats only is held by every client the deal reaches, and the stall falls on the equivocator there too.
   * Once per step per load.
   */
  async #echoDeck(session: Session, root: ParsedRoot): Promise<void> {
    const sends: Promise<unknown>[] = [];
    for (const id of session.deckSteps()) {
      if (this.#echoedSteps.has(id)) continue;
      const ev = this.#events.get(id) ?? [...this.#outbox.values()].find((e) => e.event.id === id)?.event;
      if (ev === undefined) continue;
      this.#echoedSteps.add(id);
      sends.push(
        this.#d.pool.publish(ev, unionRelays(root.relays, this.#d.relays())).catch(() => {
          // Best effort: the deal itself is what this seat owes.
        }),
      );
    }
    await Promise.all(sends);
  }

  /**
   * Republish what no relay has confirmed. Each event is first fed to the session again: one it has since
   * refused (a pooled move whose parent lost, for example) becomes an orphan and is retried no more. A move, deal
   * or Resign is republished only once the relays have been asked again what this seat published (D056).
   */
  #retryUndelivered(): void {
    const session = this.#session;
    // This seat's refused deal is asked about while the deal is still on: fork choice may come back to its deck.
    let vet = this.#toVet().some((slot) => this.#outbox.get(slot)?.orphan === true) || this.#secretHeld();
    for (const [slot, entry] of this.#outbox) {
      if (entry.confirmed || entry.orphan) continue;
      if (vetted(slot)) {
        // Just vetted and being published (after a load): no need to ask the relays again yet.
        if (!this.#inFlight.has(slot)) vet = true;
        continue;
      }
      if (session !== null && this.#receive(session, entry.event).status === 'rejected') {
        entry.orphan = true;
        this.#persist(slot);
        continue;
      }
      void this.#publish(slot);
    }
    if (vet) this.#startVet();
  }

  #yield(): Promise<void> {
    return new Promise((resolve) => this.#d.timers.later(0, resolve));
  }
}
