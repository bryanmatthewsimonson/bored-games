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
}

export type PublishResult = { url: string; ok: boolean; message: string };
export type RelayState = 'connecting' | 'open' | 'closed';

export const DEFAULT_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];
export const PUBLISH_TIMEOUT_MS = 10_000;

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
}

interface Subscription {
  id: string;
  filters: Filter[];
  onEvent: (ev: NostrEvent, url: string) => void;
  onEose: (() => void) | undefined;
  seen: Set<string>;
  /** Relays that have answered with EOSE or CLOSED, or have failed, since the subscription began. */
  answered: Set<string>;
  eoseFired: boolean;
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
  readonly #relays: Relay[];
  readonly #subs = new Map<string, Subscription>();
  #nextSub = 1;
  #closed = false;

  constructor(urls: string[], opts: RelayPoolOptions) {
    this.#WS = opts.WebSocket;
    this.#backoff = opts.backoffMs && opts.backoffMs.length > 0 ? opts.backoffMs : DEFAULT_BACKOFF_MS;
    this.#publishTimeout = opts.publishTimeoutMs ?? PUBLISH_TIMEOUT_MS;
    this.#relays = [...new Set(urls)].map((url) => ({
      url,
      ws: null,
      state: 'closed',
      attempt: 0,
      reconnect: null,
      pending: new Map(),
    }));
    for (const r of this.#relays) this.#connect(r);
  }

  status(): { url: string; state: RelayState }[] {
    return this.#relays.map((r) => ({ url: r.url, state: r.state }));
  }

  /** Send to every relay and resolve with one result each. Never rejects, never mutates `ev`. */
  publish(ev: NostrEvent): Promise<PublishResult[]> {
    const frame = JSON.stringify(['EVENT', ev]);
    return Promise.all(
      this.#relays.map(
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
   * Subscribe on every relay. `onEose` fires once, when each relay has sent EOSE, closed the subscription
   * or failed to connect. Returns the unsubscribe function.
   */
  subscribe(
    filters: Filter[],
    onEvent: (ev: NostrEvent, url: string) => void,
    onEose?: () => void,
  ): () => void {
    const sub: Subscription = {
      id: `bg-${this.#nextSub++}`,
      filters,
      onEvent,
      onEose,
      seen: new Set(),
      answered: new Set(),
      eoseFired: false,
    };
    this.#subs.set(sub.id, sub);
    for (const r of this.#relays) if (this.#isOpen(r)) this.#sendReq(r, sub);
    // A relay already known to be down does not hold the end-of-stored-events signal back.
    for (const r of this.#relays) if (r.state === 'closed') sub.answered.add(r.url);
    this.#checkEose(sub);
    return () => {
      if (this.#subs.get(sub.id) !== sub) return;
      this.#subs.delete(sub.id);
      for (const r of this.#relays) if (this.#isOpen(r)) this.#send(r, JSON.stringify(['CLOSE', sub.id]));
    };
  }

  /** Close every socket, stop reconnecting, and settle outstanding publishes as `closed`. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
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
    sub.eoseFired = true;
    sub.onEose?.();
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
        sub.onEvent(ev, r.url);
        return;
      }
      case 'EOSE':
      case 'CLOSED': {
        const sub = typeof msg[1] === 'string' ? this.#subs.get(msg[1]) : undefined;
        if (!sub) return;
        sub.answered.add(r.url);
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
