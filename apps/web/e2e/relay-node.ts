/*
 * Node-side relay access for the e2e specs: publish an event, query by filter, and seed a protocol 1 Chain Reaction
 * table. Signing is `@bored-games/protocol`'s, with templates from its own `tableTemplate`; the app has no way to make
 * a protocol 1 Chain Reaction table (every new table is proto 2), and nothing here overrides that in production code.
 */
import { randomBytes } from 'node:crypto';
import { chainReaction } from '@bored-games/chain-reaction';
import {
  DEFAULT_DEADLINE,
  finalizeEvent,
  getPublicKey,
  type NostrEvent,
  tableAddress,
  tableTemplate,
} from '@bored-games/protocol';

const rnd = (n: number): Uint8Array => new Uint8Array(randomBytes(n));

/** Send one NIP-01 message and collect the relay's replies until `done` returns a value. */
function exchange<T>(relay: string, message: unknown[], done: (reply: unknown[]) => T | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relay);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`relay ${relay} did not answer`));
    }, 15_000);
    const finish = (f: () => void) => {
      clearTimeout(timer);
      ws.close();
      f();
    };
    ws.onopen = () => ws.send(JSON.stringify(message));
    ws.onerror = () => finish(() => reject(new Error(`relay ${relay} failed`)));
    ws.onmessage = (m) => {
      const reply = JSON.parse(String(m.data)) as unknown[];
      const out = done(reply);
      if (out !== undefined) finish(() => resolve(out));
    };
  });
}

/** Publish `ev` and wait for the relay's OK. */
export async function publish(relay: string, ev: NostrEvent): Promise<void> {
  const reply = await exchange(relay, ['EVENT', ev], (r) => (r[0] === 'OK' && r[1] === ev.id ? r : undefined));
  if (reply[2] !== true) throw new Error(`the relay refused the event: ${String(reply[3])}`);
}

/** Every stored event matching `filter`. */
export function query(relay: string, filter: Record<string, unknown>): Promise<NostrEvent[]> {
  const events: NostrEvent[] = [];
  const sub = `q${Math.random().toString(36).slice(2, 8)}`;
  return exchange(relay, ['REQ', sub, filter], (r) => {
    if (r[0] === 'EVENT' && r[1] === sub) events.push(r[2] as NostrEvent);
    return r[0] === 'EOSE' && r[1] === sub ? events : undefined;
  });
}

/** The value of the first tag named `name`. */
export const tagOf = (ev: NostrEvent, name: string): string | undefined =>
  ev.tags.find((t) => t[0] === name)?.[1];

/** The newest Table event at `address` (`37450:<creator>:<id>`), or null. */
export async function latestTable(relay: string, address: string): Promise<NostrEvent | null> {
  const [, creator, id] = address.split(':');
  const found = await query(relay, { kinds: [37450], authors: [creator], '#d': [id] });
  return found.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

/** The game's Root events published by `creator` for `address`. */
export const rootsOf = (relay: string, creator: string, address: string): Promise<NostrEvent[]> =>
  query(relay, { kinds: [7450], authors: [creator], '#a': [address] });

/**
 * Publish an open protocol 1 Chain Reaction table (3 seats, two open besides the creator) signed by `creatorSk`, and
 * return its share path (`#/t/<creator>/<id>`) and address. The creator joins it from a browser holding the same key
 * (the Join carries game keys only that browser can make).
 */
export async function seedV1ChainReactionTable(
  relay: string,
  creatorSk: Uint8Array,
): Promise<{ hash: string; address: string; creator: string }> {
  const creator = getPublicKey(creatorSk);
  const tableId = randomBytes(8).toString('hex');
  const template = tableTemplate(
    {
      proto: '1',
      tableId,
      game: 'chain-reaction',
      version: chainReaction.version,
      seats: 3,
      deadline: DEFAULT_DEADLINE,
      invited: [],
      open: 2,
      relays: [relay],
      status: 'open',
      rules: chainReaction.defaultRules(),
    },
    Math.floor(Date.now() / 1000),
  );
  await publish(relay, finalizeEvent(template, creatorSk, rnd));
  return { hash: `#/t/${creator}/${tableId}`, address: tableAddress(creator, tableId), creator };
}
