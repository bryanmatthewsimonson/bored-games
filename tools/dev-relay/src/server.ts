import { eventBytes, MAX_EVENT_BYTES, type NostrEvent, verifyEvent } from '@bored-games/protocol';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';

/*
 * An in-memory NIP-01 relay for local development and tests. It is not a production relay: no persistence,
 * no limits beyond the event size cap, no authentication. Stored events live until the process exits.
 */

interface Filter {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  tags: Map<string, string[]>;
}

export interface DevRelay {
  url: string;
  close(): Promise<void>;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const isIntArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isInteger(x));
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parse a wire filter; returns an error message when it is malformed. */
function parseFilter(raw: unknown): Filter | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'filter is not an object';
  const f: Filter = { tags: new Map() };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'ids' || key === 'authors') {
      if (!isStringArray(value)) return `${key} must be an array of strings`;
      f[key] = value;
    } else if (key === 'kinds') {
      if (!isIntArray(value)) return 'kinds must be an array of integers';
      f.kinds = value;
    } else if (key === 'since' || key === 'until' || key === 'limit') {
      if (!isCount(value)) return `${key} must be a number`;
      f[key] = value;
    } else if (/^#[a-zA-Z]$/.test(key)) {
      if (!isStringArray(value)) return `${key} must be an array of strings`;
      f.tags.set(key.slice(1), value);
    }
    // Unknown keys are ignored, as NIP-01 relays do.
  }
  return f;
}

function matches(f: Filter, ev: NostrEvent): boolean {
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (f.since !== undefined && ev.created_at < f.since) return false;
  if (f.until !== undefined && ev.created_at > f.until) return false;
  for (const [name, values] of f.tags) {
    if (!ev.tags.some((t) => t[0] === name && t[1] !== undefined && values.includes(t[1]))) return false;
  }
  return true;
}

/** Newest first; equal timestamps by lowest id (NIP-01 ordering). */
const byRecency = (a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1);

const isAddressable = (kind: number) => kind >= 30000 && kind <= 39999;
const addressKey = (ev: NostrEvent) =>
  `${ev.kind}:${ev.pubkey}:${ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;

/** Does `a` win over `b` for the same address: newer, or on a tie the lower id (NIP-01). */
const supersedes = (a: NostrEvent, b: NostrEvent) =>
  a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

export function startDevRelay(opts: { port: number }): Promise<DevRelay> {
  const events = new Map<string, NostrEvent>();
  const addresses = new Map<string, string>(); // address -> id of the stored event
  const subs = new Map<WebSocket, Map<string, Filter[]>>();

  const wss = new WebSocketServer({ port: opts.port, maxPayload: 4 * MAX_EVENT_BYTES });

  const reply = (ws: WebSocket, frame: unknown[]) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };

  function onEvent(ws: WebSocket, raw: unknown) {
    const id =
      typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string'
        ? (raw as { id: string }).id
        : '';
    if (typeof raw !== 'object' || raw === null) return reply(ws, ['OK', id, false, 'invalid: not an event']);
    if (eventBytes(raw as NostrEvent) > MAX_EVENT_BYTES)
      return reply(ws, ['OK', id, false, 'invalid: event too large']);
    if (!verifyEvent(raw)) return reply(ws, ['OK', id, false, 'invalid: bad event or signature']);
    const ev = raw;
    if (events.has(ev.id)) return reply(ws, ['OK', ev.id, true, 'duplicate: already have this event']);
    if (isAddressable(ev.kind)) {
      const key = addressKey(ev);
      const heldId = addresses.get(key);
      const held = heldId === undefined ? undefined : events.get(heldId);
      if (held) {
        if (!supersedes(ev, held)) return reply(ws, ['OK', ev.id, false, 'replaced: have a newer event']);
        events.delete(held.id);
      }
      addresses.set(key, ev.id);
    }
    events.set(ev.id, ev);
    reply(ws, ['OK', ev.id, true, '']);
    for (const [peer, bySub] of subs) {
      for (const [subId, filters] of bySub) {
        if (filters.some((f) => matches(f, ev))) reply(peer, ['EVENT', subId, ev]);
      }
    }
  }

  function onReq(ws: WebSocket, subId: unknown, rawFilters: unknown[]) {
    if (typeof subId !== 'string' || subId.length === 0 || subId.length > 64) return;
    const filters: Filter[] = [];
    for (const rf of rawFilters) {
      const f = parseFilter(rf);
      if (typeof f === 'string') return reply(ws, ['CLOSED', subId, `invalid: ${f}`]);
      filters.push(f);
    }
    const stored = new Map<string, NostrEvent>();
    for (const f of filters) {
      const hits = [...events.values()].filter((ev) => matches(f, ev)).sort(byRecency);
      for (const ev of f.limit === undefined ? hits : hits.slice(0, Math.max(0, f.limit)))
        stored.set(ev.id, ev);
    }
    for (const ev of [...stored.values()].sort(byRecency)) reply(ws, ['EVENT', subId, ev]);
    reply(ws, ['EOSE', subId]);
    subs.get(ws)?.set(subId, filters);
  }

  function onMessage(ws: WebSocket, data: RawData) {
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    if (msg[0] === 'EVENT') onEvent(ws, msg[1]);
    else if (msg[0] === 'REQ') onReq(ws, msg[1], msg.slice(2));
    else if (msg[0] === 'CLOSE' && typeof msg[1] === 'string') subs.get(ws)?.delete(msg[1]);
  }

  wss.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('message', (data) => onMessage(ws, data));
    ws.on('close', () => subs.delete(ws));
    ws.on('error', () => subs.delete(ws));
  });

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      wss.off('error', reject);
      const address = wss.address();
      const port = typeof address === 'object' && address !== null ? address.port : opts.port;
      resolve({
        url: `ws://localhost:${port}`,
        close: () =>
          new Promise<void>((done) => {
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}
