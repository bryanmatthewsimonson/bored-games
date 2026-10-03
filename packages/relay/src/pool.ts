import { eventBytes, MAX_EVENT_BYTES, type NostrEvent, verifyEvent } from '@bored-games/protocol';

/** A NIP-01 subscription filter (the subset this platform uses). */
export type Filter = {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  '#e'?: string[];
  '#a'?: string[];
  '#d'?: string[];
  '#p'?: string[];
  since?: number;
  until?: number;
  limit?: number;
};

/**
 * The part of the standard WebSocket API the pool uses. Handler parameters are `never` so that the platform
 * `WebSocket` (whose handlers take a `MessageEvent`) is assignable without the DOM lib; the pool only reads
 * `data` from message events, defensively.
 */
export interface SocketLike {
  readyState: number;
  onopen: ((ev: never) => unknown) | null;
  onmessage: ((ev: never) => unknown) | null;
  onclose: ((ev: never) => unknown) | null;
  onerror: ((ev: never) => unknown) | null;
  send(data: string): void;
  close(): void;
}

export type SocketConstructor = new (url: string) => SocketLike;

export interface RelayPoolOptions {
  WebSocket: SocketConstructor;
  /** Reconnect delays in ms; the last value repeats. Default `[1000, 2000, 5000, 10000, 30000]`. */
  backoffMs?: number[];
  /** Per-relay wait for an `OK`, in ms. Default 10000. */
  publishTimeoutMs?: number;
  /** Default wait for EOSE before `onEose` fires anyway, in ms. Default 8000. */
  eoseTimeoutMs?: number;
  /**
   * A relay that has stayed unreachable this long (ms) since it last went down, without opening since, is listed
   * in `EoseInfo.deadUrls`. Default 120000.
   */
  deadAfterMs?: number;
}

export interface SubscribeOptions {
  /** Fire `onEose` after this many ms even if some relay has not answered. Default: the pool's (8000). */
  eoseTimeoutMs?: number;
}

export type PublishResult = { url: string; ok: boolean; message: string };

/**
 * What `onEose` is told: how many relays actually sent EOSE (a relay that failed, or closed the subscription,
 * counts as answered for the end-of-stored-events signal but not here), out of how many, and whether the
 * deadline fired first.
 */
export interface EoseInfo {
  eose: number;
  relays: number;
  /** The relays that sent EOSE (the pool always sets it; optional for callers that build an `EoseInfo`). */
  eosedUrls?: string[];
  /** The relays that have been unreachable for `deadAfterMs` or more, with no open connection since. */
  deadUrls?: string[];
  timedOut: boolean;
}
export type RelayState = 'connecting' | 'open' | 'closed';

export const DEFAULT_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];
export const PUBLISH_TIMEOUT_MS = 10_000;
export const EOSE_TIMEOUT_MS = 8000;
export const DEAD_AFTER_MS = 120_000;

const OPEN = 1;

interface Pending {
  event: NostrEvent;
  /** Frame text, serialized once so every resend is the same signed event. */
  frame: string;
  sent: boolean;
  timer: ReturnType<typeof setTimeout>;
  settle: (r: { ok: boolean; message: string }) => void;
}

interface Relay {
  url: string;
  ws: SocketLike | null;
  state: RelayState;
  attempt: number;
  reconnect: ReturnType<typeof setTimeout> | null;
  pending: Map<string, Pending>;
  /** When it went down (ms), unless it has opened since; null while it is open or has not failed yet. */
  downSince: number | null;
}

interface Subscription {
  id: string;
  filters: Filter[];
  onEvent: (ev: NostrEvent, url: string) => void;
  onEose: ((info: EoseInfo) => void) | undefined;
  seen: Set<string>;
  /** Relays that sent EOSE for this subscription. */
  eosed: Set<string>;
  /** Relays that have answered with EOSE or CLOSED, or have failed, since the subscription began. */
  answered: Set<string>;
  eoseFired: boolean;
  /** Fires `onEose` when slow relays have not answered in time. */
  eoseTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * A set of relay connections used as one. It reconnects with backoff, replays subscriptions after a
 * reconnect, deduplicates events by id and verifies every event it delivers. It never signs or alters an
 * event: a retry is the same signed bytes (PROTOCOL §9).
 */
export class RelayPool {
  readonly #WS: SocketConstructor;
  readonly #backoff: number[];
  readonly #publishTimeout: number;
  readonly #eoseTimeout: number;
  readonly #deadAfter: number;
  readonly #relays: Relay[];
  readonly #subs = new Map<string, Subscription>();
  #nextSub = 1;
  #closed = false;

  constructor(urls: string[], opts: RelayPoolOptions) {
    this.#WS = opts.WebSocket;
    this.#backoff = opts.backoffMs && opts.backoffMs.length > 0 ? opts.backoffMs : DEFAULT_BACKOFF_MS;
    this.#publishTimeout = opts.publishTimeoutMs ?? PUBLISH_TIMEOUT_MS;
    this.#eoseTimeout = opts.eoseTimeoutMs ?? EOSE_TIMEOUT_MS;
    this.#deadAfter = opts.deadAfterMs ?? DEAD_AFTER_MS;
    this.#relays = [];
    this.addRelays(urls);
  }

  status(): { url: string; state: RelayState }[] {
    return this.#relays.map((r) => ({ url: r.url, state: r.state }));
  }

  /**
   * Connect to relays the pool does not hold yet, for example a game's relays. Open subscriptions are sent to
   * them once they connect. Relays already held are left as they are.
   */
  addRelays(urls: readonly string[]): void {
    if (this.#closed) return;
    for (const url of urls) {
      if (this.#relays.some((r) => r.url === url)) continue;
      const r: Relay = {
        url,
        ws: null,
        state: 'closed',
        attempt: 0,
        reconnect: null,
        pending: new Map(),
        downSince: null,
      };
      this.#relays.push(r);
      this.#connect(r);
    }
  }

  /**
   * Send to every relay, or only to `urls` (added to the pool first when new), and resolve with one result
   * each. Never rejects, never mutates `ev`.
   */
  publish(ev: NostrEvent, urls?: readonly string[]): Promise<PublishResult[]> {
    const frame = JSON.stringify(['EVENT', ev]);
    if (urls !== undefined) this.addRelays(urls);
    const targets = urls === undefined ? this.#relays : this.#relays.filter((r) => urls.includes(r.url));
    return Promise.all(
      targets.map(
        (r) =>
          new Promise<PublishResult>((resolve) => {
            if (this.#closed) return resolve({ url: r.url, ok: false, message: 'closed' });
            const existing = r.pending.get(ev.id);
            const settle = (res: { ok: boolean; message: string }) => {
              const p = r.pending.get(ev.id);
              if (p) clearTimeout(p.timer);
              r.pending.delete(ev.id);
              resolve({ url: r.url, ...res });
            };
            if (existing) {
              // Publishing the same event again while it is outstanding joins the first attempt.
              const first = existing.settle;
              existing.settle = (res) => {
                first(res);
                resolve({ url: r.url, ...res });
              };
              return;
            }
            const timer = setTimeout(
              () => r.pending.get(ev.id)?.settle({ ok: false, message: 'timeout' }),
              this.#publishTimeout,
            );
            r.pending.set(ev.id, { event: ev, frame, sent: false, timer, settle });
            this.#flush(r);
          }),
      ),
    );
  }

  /**
   * Subscribe on every relay. `onEose` fires once, asynchronously (never inside this call), when each relay
   * has sent EOSE, closed the subscription or failed to connect, or when the EOSE deadline passes first.
   * An exception thrown by `onEvent` or `onEose` is swallowed so it cannot break the pool. Returns the
   * unsubscribe function.
   */
  subscribe(
    filters: Filter[],
    onEvent: (ev: NostrEvent, url: string) => void,
    onEose?: (info: EoseInfo) => void,
    opts: SubscribeOptions = {},
  ): () => void {
    const sub: Subscription = {
      id: `bg-${this.#nextSub++}`,
      filters,
      onEvent,
      onEose,
      seen: new Set(),
      eosed: new Set(),
      answered: new Set(),
      eoseFired: false,
      eoseTimer: null,
    };
    this.#subs.set(sub.id, sub);
    sub.eoseTimer = setTimeout(() => {
      sub.eoseTimer = null;
      this.#fireEose(sub, true);
    }, opts.eoseTimeoutMs ?? this.#eoseTimeout);
    for (const r of this.#relays) if (this.#isOpen(r)) this.#sendReq(r, sub);
    // A relay already known to be down does not hold the end-of-stored-events signal back.
    for (const r of this.#relays) if (r.state === 'closed') sub.answered.add(r.url);
    this.#checkEose(sub);
    return () => {
      if (this.#subs.get(sub.id) !== sub) return;
      this.#subs.delete(sub.id);
      this.#clearEoseTimer(sub);
      for (const r of this.#relays) if (this.#isOpen(r)) this.#send(r, JSON.stringify(['CLOSE', sub.id]));
    };
  }

  /** Close every socket, stop reconnecting, and settle outstanding publishes as `closed`. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const sub of this.#subs.values()) this.#clearEoseTimer(sub);
    this.#subs.clear();
    for (const r of this.#relays) {
      if (r.reconnect) clearTimeout(r.reconnect);
      r.reconnect = null;
      const ws = r.ws;
      r.ws = null;
      r.state = 'closed';
      if (ws) {
        detach(ws);
        try {
          ws.close();
        } catch {
          // Already gone.
        }
      }
      for (const p of [...r.pending.values()]) p.settle({ ok: false, message: 'closed' });
    }
  }

  #isOpen(r: Relay): boolean {
    return r.state === 'open' && r.ws !== null && r.ws.readyState === OPEN;
  }

  #connect(r: Relay): void {
    if (this.#closed) return;
    r.reconnect = null;
    let ws: SocketLike;
    try {
      ws = new this.#WS(r.url);
    } catch {
      r.ws = null;
      r.state = 'closed';
      this.#onDown(r);
      return;
    }
    r.ws = ws;
    r.state = 'connecting';
    ws.onopen = () => {
      if (r.ws !== ws || this.#closed) return;
      r.state = 'open';
      r.attempt = 0;
      r.downSince = null;
      for (const sub of this.#subs.values()) {
        sub.answered.delete(r.url);
        this.#sendReq(r, sub);
      }
      for (const p of r.pending.values()) p.sent = false;
      this.#flush(r);
    };
    ws.onmessage = (ev) => {
      if (r.ws !== ws || this.#closed) return;
      this.#onMessage(r, (ev as { data?: unknown }).data);
    };
    ws.onerror = () => {
      // A close always follows; reconnection is handled there.
    };
    ws.onclose = () => {
      if (r.ws !== ws || this.#closed) return;
      detach(ws);
      r.ws = null;
      r.state = 'closed';
      this.#onDown(r);
    };
  }

  /** A relay is unreachable: stop waiting for it on every subscription and schedule a retry. */
  #onDown(r: Relay): void {
    r.downSince ??= Date.now();
    for (const p of r.pending.values()) p.sent = false;
    for (const sub of this.#subs.values()) {
      sub.answered.add(r.url);
      this.#checkEose(sub);
    }
    if (this.#closed) return;
    const delay = this.#backoff[Math.min(r.attempt, this.#backoff.length - 1)] ?? 1000;
    r.attempt++;
    r.reconnect = setTimeout(() => this.#connect(r), delay);
  }

  #send(r: Relay, frame: string): void {
    try {
      r.ws?.send(frame);
    } catch {
      // The socket dropped under us; its close handler reconnects and resends.
    }
  }

  #sendReq(r: Relay, sub: Subscription): void {
    this.#send(r, JSON.stringify(['REQ', sub.id, ...sub.filters]));
  }

  #flush(r: Relay): void {
    if (!this.#isOpen(r)) return;
    for (const p of r.pending.values()) {
      if (p.sent) continue;
      p.sent = true;
      this.#send(r, p.frame);
    }
  }

  #checkEose(sub: Subscription): void {
    if (sub.eoseFired || !this.#subs.has(sub.id)) return;
    if (!this.#relays.every((r) => sub.answered.has(r.url))) return;
    this.#fireEose(sub);
  }

  /** Mark EOSE reached and call `onEose` in a microtask, unless the subscription has ended by then. */
  #fireEose(sub: Subscription, timedOut = false): void {
    if (sub.eoseFired || this.#subs.get(sub.id) !== sub) return;
    sub.eoseFired = true;
    this.#clearEoseTimer(sub);
    const onEose = sub.onEose;
    if (onEose === undefined) return;
    const now = Date.now();
    const info: EoseInfo = {
      eose: sub.eosed.size,
      relays: this.#relays.length,
      timedOut,
      eosedUrls: [...sub.eosed],
      deadUrls: this.#relays
        .filter((r) => r.downSince !== null && now - r.downSince >= this.#deadAfter)
        .map((r) => r.url),
    };
    queueMicrotask(() => {
      if (this.#subs.get(sub.id) !== sub) return;
      try {
        onEose(info);
      } catch {
        // A consumer's error must not break the pool.
      }
    });
  }

  #clearEoseTimer(sub: Subscription): void {
    if (sub.eoseTimer !== null) clearTimeout(sub.eoseTimer);
    sub.eoseTimer = null;
  }

  #onMessage(r: Relay, data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    switch (msg[0]) {
      case 'EVENT': {
        const sub = typeof msg[1] === 'string' ? this.#subs.get(msg[1]) : undefined;
        if (!sub) return;
        const ev: unknown = msg[2];
        if (typeof ev !== 'object' || ev === null) return;
        // Size first, so an oversized event is dropped before it is hashed (PROTOCOL §11).
        if (eventBytes(ev as NostrEvent) > MAX_EVENT_BYTES || !verifyEvent(ev)) return;
        if (sub.seen.has(ev.id)) return;
        sub.seen.add(ev.id);
        try {
          sub.onEvent(ev, r.url);
        } catch {
          // A consumer's error must not stop delivery to it or to other subscriptions.
        }
        return;
      }
      case 'EOSE':
      case 'CLOSED': {
        const sub = typeof msg[1] === 'string' ? this.#subs.get(msg[1]) : undefined;
        if (!sub) return;
        sub.answered.add(r.url);
        if (msg[0] === 'EOSE') sub.eosed.add(r.url);
        this.#checkEose(sub);
        return;
      }
      case 'OK': {
        const id = msg[1];
        if (typeof id !== 'string') return;
        const p = r.pending.get(id);
        if (!p) return;
        p.settle({ ok: msg[2] === true, message: typeof msg[3] === 'string' ? msg[3] : '' });
        return;
      }
      default:
        // NOTICE and anything unknown are ignored.
        return;
    }
  }
}

function detach(ws: SocketLike): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onclose = null;
  ws.onerror = null;
}
