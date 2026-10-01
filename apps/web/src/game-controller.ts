/*
 * The game controller: binds the relay pool to a `GameSession` for one game (PROTOCOL §6–§9).
 *
 * - It loads the root, the table and the Joins, builds the session for this player's seat (from the saved game
 *   secrets) or as a spectator, and folds in every game event from the relays.
 * - It performs this seat's automatic duties one at a time (shuffle, deal, secret, attest). Only `decide` waits
 *   for the player, through `act`.
 * - Every event it builds is saved to an outbox in storage before it is published. A reopened tab republishes
 *   an unconfirmed event, and a duty whose event is already in the outbox reuses it: nothing is signed twice.
 *   A move is kept under the head it was built on, and one the session no longer accepts (an orphan, after the
 *   chain moved on) is never republished.
 */
import { ClientError, type Duty, GameSession, type Identity, type SessionView } from '@bored-games/client';
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
import { type Signal, signal } from '@preact/signals';
import { bytesToHex } from './hex.ts';
import { type ControllerDeps, unionRelays } from './net.ts';
import { loadSecrets, readJson, saveRootId, storageKey, writeJson } from './storage.ts';

export type GameStatus = 'syncing' | 'working' | 'waiting' | 'your-turn' | 'done' | 'cancelled';

/** How often `tick` runs while the controller is started, in ms. */
export const TICK_MS = 30_000;

/** The game event kinds a game subscription asks for (PROTOCOL §9). */
export const GAME_KINDS = [KIND.move, KIND.shares, KIND.timeout, KIND.reveal, KIND.attest];

/** Automatic duties, in the order they are performed. */
const AUTO: readonly Duty['kind'][] = ['shuffle', 'deal', 'secret', 'attest'];

/** One built event, whether a relay has confirmed it, and whether the session has refused it (an orphan). */
export interface OutboxEntry {
  event: NostrEvent;
  confirmed: boolean;
  orphan: boolean;
}

/** The outbox slot of a move: its seq and the head (`prev`) it was built on. */
export const moveSlot = (seq: number, prevId: string): string => `move:${seq}:${prevId}`;

export const outboxKey = (profile: string, rootId: string): string => storageKey(profile, `outbox:${rootId}`);

/**
 * The saved outbox of a game, by slot: `move:<seq>:<prev>`, `deal`, `secret`, `attest` and
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

const isTemplateLike = (v: unknown): v is EventTemplate =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as EventTemplate).kind === 'number' &&
  typeof (v as EventTemplate).created_at === 'number' &&
  Array.isArray((v as EventTemplate).tags) &&
  typeof (v as EventTemplate).content === 'string';

/**
 * The attestation builders, typed as optional: the session is gaining `attestTemplate(createdAt)` (the npub
 * signs attestations) in place of `buildAttest`. Calling through this shim compiles against either version.
 */
interface AttestApi {
  attestTemplate?(createdAt: number): EventTemplate;
  buildAttest?(rnd: ControllerDeps['rnd'], createdAt: number): unknown;
}

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
  /** Delivery state: set while one of this player's events has reached no relay yet. */
  readonly notice: Signal<string | null> = signal(null);
  /** This seat's legal actions now (empty unless it is this player's decision). */
  readonly legal: Signal<readonly unknown[]> = signal([]);
  /** A seat this player may claim a timeout against now, or null. */
  readonly timeoutTarget: Signal<number | null> = signal(null);
  /** The seats' identity pubkeys, in seat order. */
  readonly seats: Signal<readonly Hex[]> = signal([]);
  readonly table: Signal<ParsedTable | null> = signal(null);
  /** The time of the latest refresh (Unix seconds), so deadline displays follow `tick`. */
  readonly clock: Signal<number>;

  readonly #d: ControllerDeps;
  #session: GameSession | null = null;
  #rootEv: NostrEvent | null = null;
  #root: ParsedRoot | null = null;
  #tableEv: NostrEvent | null = null;
  readonly #joins = new Map<string, NostrEvent>();
  /** Game events that arrived before the session existed. */
  #buffer: NostrEvent[] = [];
  #outbox = new Map<string, OutboxEntry>();
  readonly #inFlight = new Set<string>();
  #gameEose = false;
  #lobbyEose = false;
  #synced = false;
  #working = false;
  #running = false;
  #dutyQueued = false;
  #refreshQueued = false;
  /** Automatic duties that failed at a head (`kind@headId`), not retried until the head moves. */
  readonly #failed = new Set<string>();
  readonly #stops: (() => void)[] = [];
  #started = false;
  #disposed = false;

  constructor(rootId: string, deps: ControllerDeps) {
    this.rootId = rootId;
    this.#d = deps;
    this.clock = signal(deps.now());
  }

  /** Load the game, follow its events, and tick every 30 s. */
  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#outbox = loadOutbox(this.#d.storage, this.#d.profile, this.rootId);
    this.#stops.push(
      this.#d.pool.subscribe(
        [{ ids: [this.rootId] }, { kinds: GAME_KINDS, '#e': [this.rootId] }],
        (ev) => this.#onEvent(ev),
        () => {
          this.#gameEose = true;
          this.#maybeSynced();
        },
      ),
    );
    this.#stops.push(this.#d.timers.every(TICK_MS, () => this.tick()));
  }

  dispose(): void {
    this.#disposed = true;
    for (const stop of this.#stops.splice(0)) stop();
  }

  /** Re-check deadlines and stored timeout claims, retry undelivered events, and resume duties. */
  tick(): void {
    if (this.#disposed) return;
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
      // Never build twice for one decision: fresh randomness would make a rival move (equivocation).
      const ev = this.#reusable(slot, head.id) ?? session.buildAction(action, this.#d.rnd, this.#d.now());
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

  /* --------------------------------------------------------------------------------------------- loading */

  #onEvent(ev: NostrEvent): void {
    if (this.#disposed) return;
    if (ev.kind === KIND.root && ev.id === this.rootId) {
      this.#onRoot(ev);
      return;
    }
    const entry = [...this.#outbox.entries()].find(([, e]) => e.event.id === ev.id);
    if (entry !== undefined) this.#confirm(entry[0]);
    if (this.#session === null) {
      this.#buffer.push(ev);
      return;
    }
    this.#session.receive(ev, this.#d.now());
    this.#queueRefresh();
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
    this.seats.value = root.seats.map((s) => s.npub);
    this.#d.pool.addRelays?.(root.relays);
    const [, creator, tableId] = root.tableAddress.split(':');
    this.#stops.push(
      this.#d.pool.subscribe(
        [
          { kinds: [KIND.table], authors: [creator as string], '#d': [tableId as string] },
          { kinds: [KIND.join], '#a': [root.tableAddress] },
        ],
        (lobbyEv) => this.#onLobby(lobbyEv),
        () => {
          this.#lobbyEose = true;
          this.#tryCreate();
        },
      ),
    );
  }

  #onLobby(ev: NostrEvent): void {
    if (this.#disposed) return;
    if (ev.kind === KIND.table) {
      const held = this.#tableEv;
      if (held === null || ev.created_at > held.created_at) {
        try {
          this.table.value = parseTable(ev);
          this.#tableEv = ev;
        } catch {
          return;
        }
      }
    } else if (ev.kind === KIND.join) this.#joins.set(ev.id, ev);
    this.#tryCreate();
  }

  /** Build the session once the table and every seat's Join are known. */
  #tryCreate(): void {
    const root = this.#root;
    const rootEv = this.#rootEv;
    const tableEv = this.#tableEv;
    if (this.#session !== null || root === null || rootEv === null || this.#disposed) return;
    const missing = tableEv === null || root.joinIds.some((id) => !this.#joins.has(id));
    if (missing) {
      if (this.#lobbyEose)
        this.error.value = "Still looking for this game's table and players on the relays…";
      return;
    }
    const input = {
      modules: this.#d.modules,
      table: tableEv,
      joins: [...this.#joins.values()],
      root: rootEv,
    };
    const me = this.#identity(root);
    let session: GameSession;
    try {
      session = GameSession.create({ ...input, me });
    } catch (e) {
      if (me === null) {
        this.error.value = `This game cannot be loaded: ${errorText(e)}`;
        return;
      }
      try {
        session = GameSession.create({ ...input, me: null });
        this.error.value = 'Your saved keys do not match your seat in this game, so you are watching it.';
      } catch (e2) {
        this.error.value = `This game cannot be loaded: ${errorText(e2)}`;
        return;
      }
    }
    if (this.error.value?.startsWith('Still looking')) this.error.value = null;
    this.#session = session;
    if (me !== null) saveRootId(this.#d.profile, this.#d.storage, root.tableAddress, root.id);
    // Own events first (they may never have reached a relay), then whatever arrived meanwhile. One the session
    // refuses is an orphan: it is kept (so its slot is never signed again) but never republished.
    for (const [slot, entry] of this.#outbox) {
      if (entry.orphan) continue;
      if (session.receive(entry.event, this.#d.now()).status === 'rejected') {
        entry.orphan = true;
        this.#persist(slot);
      }
    }
    for (const ev of this.#buffer.splice(0)) session.receive(ev, this.#d.now());
    this.#refresh();
    this.#maybeSynced();
  }

  /** This player's seat and secrets, or null to watch as a spectator. */
  #identity(root: ParsedRoot): Identity | null {
    const seat = root.seats.findIndex((s) => s.npub === this.#d.signer.pubkey);
    if (seat < 0) return null;
    const secrets = loadSecrets(this.#d.profile, this.#d.storage, root.tableAddress);
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
    if (session === null) return;
    const v = session.view();
    this.view.value = v;
    this.legal.value = this.#synced ? session.legalActions() : [];
    this.timeoutTarget.value = this.#synced ? session.timeoutTarget(now) : null;
    this.status.value = this.#statusOf(v, session.duties());
  }

  #statusOf(v: SessionView, duties: readonly Duty[]): GameStatus {
    if (!this.#synced) return 'syncing';
    if (v.phase === 'cancelled') return 'cancelled';
    if (this.#working || this.#nextAuto(duties, v) !== null) return 'working';
    if (v.phase === 'done') return 'done';
    if (duties.some((d) => d.kind === 'decide')) return 'your-turn';
    return 'waiting';
  }

  /* -------------------------------------------------------------------------------------------- duties */

  #nextAuto(duties: readonly Duty[], v: SessionView): Duty['kind'] | null {
    for (const kind of AUTO)
      if (duties.some((d) => d.kind === kind) && !this.#failed.has(`${kind}@${v.head.id}`)) return kind;
    return null;
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
          await this.#perform(session, kind);
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

  async #perform(session: GameSession, kind: Duty['kind']): Promise<void> {
    const head = session.view().head;
    const { rnd, now } = this.#d;
    if (kind === 'shuffle') {
      const slot = moveSlot(head.seq + 1, head.id);
      return this.#commit(slot, this.#reusable(slot, head.id) ?? session.buildShuffle(rnd, now()));
    }
    if (kind === 'deal')
      return this.#commit('deal', this.#outbox.get('deal')?.event ?? session.buildDeal(rnd, now()));
    if (kind === 'secret')
      return this.#commit('secret', this.#outbox.get('secret')?.event ?? session.buildSecret(rnd, now()));
    if (kind === 'attest') {
      const held = this.#outbox.get('attest')?.event;
      return this.#commit('attest', held ?? (await this.#attestEvent(session)));
    }
  }

  /**
   * The attestation, signed by the player's npub (PROTOCOL §4.8): the session's `attestTemplate(createdAt)`,
   * signed by the identity signer. Until the session has that method, the older `buildAttest` is used; an
   * event it returns already signed by the npub is kept, anything else is re-signed field for field.
   */
  async #attestEvent(session: GameSession): Promise<NostrEvent> {
    const api = session as unknown as AttestApi;
    const built: unknown =
      typeof api.attestTemplate === 'function'
        ? api.attestTemplate(this.#d.now())
        : typeof api.buildAttest === 'function'
          ? api.buildAttest(this.#d.rnd, this.#d.now())
          : null;
    if (verifyEvent(built) && built.pubkey === this.#d.signer.pubkey) return built;
    if (!isTemplateLike(built)) throw new ClientError('the session built no attestation');
    return this.#d.signer.sign({
      kind: built.kind,
      created_at: built.created_at,
      tags: built.tags.map((t) => [...t]),
      content: built.content,
    });
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
   * an orphan and not published, and this throws (the duty is then not retried at this head).
   */
  #commit(slot: string, built: NostrEvent): void {
    const session = this.#session;
    if (session === null) throw new Error('the game is not loaded');
    // Another tab of this profile may have saved an event for the same slot meanwhile: use that one instead.
    const saved = loadOutbox(this.#d.storage, this.#d.profile, this.rootId).get(slot);
    const ev = saved?.event ?? built;
    const entry: OutboxEntry =
      this.#outbox.get(slot)?.event.id === ev.id
        ? (this.#outbox.get(slot) as OutboxEntry)
        : { event: ev, confirmed: saved?.confirmed ?? false, orphan: saved?.orphan ?? false };
    this.#outbox.set(slot, entry);
    if (!this.#persist(slot))
      this.notice.value = 'This browser could not save your last event; keep this tab open until it is sent.';
    const r = session.receive(ev, this.#d.now());
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
    if (entry === undefined || entry.confirmed) return;
    entry.confirmed = true;
    this.#persist(slot);
    if ([...this.#outbox.values()].every((e) => e.confirmed || e.orphan)) this.notice.value = null;
  }

  /** Publish the slot's event to the root's relays and this player's relays. */
  async #publish(slot: string): Promise<void> {
    const entry = this.#outbox.get(slot);
    const root = this.#root;
    if (entry === undefined || entry.orphan || root === null || this.#inFlight.has(slot)) return;
    this.#inFlight.add(slot);
    try {
      const results = await this.#d.pool.publish(entry.event, unionRelays(root.relays, this.#d.relays()));
      if (this.#disposed) return;
      if (results.some((r) => r.ok)) this.#confirm(slot);
      else this.notice.value = 'Not delivered to any relay yet; retrying.';
    } finally {
      this.#inFlight.delete(slot);
    }
  }

  #retryUndelivered(): void {
    for (const [slot, entry] of this.#outbox) if (!entry.confirmed && !entry.orphan) void this.#publish(slot);
  }

  #yield(): Promise<void> {
    return new Promise((resolve) => this.#d.timers.later(0, resolve));
  }
}
