/*
 * Shared harness for controller tests against the real dev relay (two-device and Luster outbox tests): profiles
 * with their own key, store and pool, lobby and game controllers disposed after each test, and pool wrappers that
 * simulate a device's network.
 */
import { bankV1 } from '@bored-games/bank';
import { type DevRelay, startDevRelay } from '@bored-games/dev-relay';
import { finalizeEvent, getPublicKey, type NostrEvent } from '@bored-games/protocol';
import { type EoseInfo, type Filter, RelayPool } from '@bored-games/relay';
import { platformTimers } from '../src/clock.ts';
import { GameController, loadOutbox } from '../src/game-controller.ts';
import type { Signer } from '../src/identity.ts';
import { LobbyController } from '../src/lobby-controller.ts';
import { type ControllerDeps, MODULES, type ModuleRegistry, type PoolLike } from '../src/net.ts';
import { type KeyValueStore, memoryStorage } from '../src/storage.ts';

/**
 * The registry of a client from before Bank 0.2.0: its new Bank tables are Bank 0.1.0 at proto 1, so the tests of
 * v1 Bank behaviour (contributions as turns) play the v1 games such a client started, which this build still folds
 * with Bank 0.1.0 (PROTOCOL-v2 §2 item 5).
 */
export const OLDER_BANK_CLIENT: ModuleRegistry = new Map([...MODULES, [bankV1.id, bankV1]]);

export const rnd = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
export const now = (): number => Math.floor(Date.now() / 1000);

export interface Profile {
  name: string;
  deps: ControllerDeps;
}

export class Harness {
  relay!: DevRelay;
  readonly #pools: RelayPool[] = [];
  readonly #disposers: (() => void | Promise<void>)[] = [];

  async setup(): Promise<void> {
    this.relay = await startDevRelay({ port: 0 });
  }

  async teardown(): Promise<void> {
    for (const d of this.#disposers.splice(0).reverse()) await d();
    for (const p of this.#pools.splice(0)) p.close();
    await this.relay.close();
  }

  /** Run `fn` at teardown (before the pools close). */
  later(fn: () => void | Promise<void>): void {
    this.#disposers.push(fn);
  }

  pool(urls: string[] = [this.relay.url]): RelayPool {
    const p = new RelayPool(urls, { WebSocket });
    this.#pools.push(p);
    return p;
  }

  /**
   * A browser profile: its own key (unless given), store and pool. Its own relays: the dev relay and `extra`. Its
   * module registry is the app's unless given (`OLDER_BANK_CLIENT` plays v1 Bank games).
   */
  profile(
    name: string,
    opts: {
      store?: KeyValueStore;
      signer?: Signer;
      extra?: readonly string[];
      modules?: ModuleRegistry;
    } = {},
  ): Profile {
    const sk = rnd(32);
    const signer: Signer = opts.signer ?? {
      kind: 'local',
      pubkey: getPublicKey(sk),
      sign: async (t) => finalizeEvent(t, sk, rnd),
    };
    const extra = opts.extra ?? [];
    return {
      name,
      deps: {
        pool: this.pool(),
        signer,
        storage: opts.store ?? memoryStorage(),
        profile: name,
        relays: () => [this.relay.url, ...extra],
        rnd,
        now,
        modules: opts.modules ?? MODULES,
        timers: platformTimers,
      },
    };
  }

  /** The same player on another device: the same signer and game keys for `address`, and storage of its own. */
  secondDevice(p: Profile, address: string, extra: readonly string[] = []): Profile {
    const store = memoryStorage();
    const key = `bg:${p.name}:secrets:${address}`;
    store.setItem(key, p.deps.storage.getItem(key) as string);
    return this.profile(p.name, { store, signer: p.deps.signer, extra, modules: p.deps.modules });
  }

  lobby(p: Profile): LobbyController {
    const c = new LobbyController(p.deps);
    this.#disposers.push(() => c.dispose());
    c.listen();
    return c;
  }

  game(rootId: string, deps: ControllerDeps): GameController {
    const c = new GameController(rootId, deps);
    this.#disposers.push(() => c.dispose());
    c.start();
    return c;
  }

  /** Start a 2-seat table of `game`: the creator, then the joiner. Returns the profiles in seat order. */
  async start2(
    game: string,
    a: Profile,
    b: Profile,
    rules?: unknown,
  ): Promise<{ rootId: string; address: string; bySeat: [Profile, Profile] }> {
    const la = this.lobby(a);
    const lb = this.lobby(b);
    const address = await la.createTable({
      game,
      seats: 2,
      deadline: 86400,
      invited: [],
      relays: [this.relay.url],
      ...(rules === undefined ? {} : { rules }),
    });
    await waitFor('the open table', () => lb.openTables.value.find((t) => t.address === address));
    await lb.join(address);
    await waitFor('a full table', () => la.table(address).value?.full);
    const rootId = await la.start(address);
    await waitFor('the root', () => lb.table(address).value?.root?.id === rootId);
    const seats = la.table(address).value?.root?.seats.map((s) => s.npub) ?? [];
    const bySeat = seats.map((npub) => [a, b].find((p) => p.deps.signer.pubkey === npub)) as [
      Profile,
      Profile,
    ];
    return { rootId, address, bySeat };
  }

  /** Start a 3-seat table of `game` with three profiles. Returns the profiles in seat order. */
  async start3(
    game: string,
    ps: [Profile, Profile, Profile],
  ): Promise<{ rootId: string; address: string; bySeat: Profile[] }> {
    const [la, lb, lc] = ps.map((p) => this.lobby(p)) as [LobbyController, LobbyController, LobbyController];
    const address = await la.createTable({
      game,
      seats: 3,
      deadline: 259200,
      invited: [],
      relays: [this.relay.url],
    });
    for (const l of [lb, lc]) {
      await waitFor('the open table', () => l.openTables.value.find((t) => t.address === address));
      await l.join(address);
    }
    await waitFor('a full table', () => la.table(address).value?.full);
    const rootId = await la.start(address);
    for (const l of [lb, lc]) await waitFor('the root', () => l.table(address).value?.root?.id === rootId);
    const seats = la.table(address).value?.root?.seats.map((s) => s.npub) ?? [];
    const bySeat = seats.map((npub) => ps.find((p) => p.deps.signer.pubkey === npub) as Profile);
    return { rootId, address, bySeat };
  }

  /** Every stored event matching `filters` at `url` (the dev relay by default), from a fresh pool. */
  query(filters: Filter[], url = this.relay.url): Promise<NostrEvent[]> {
    const p = this.pool([url]);
    return new Promise((resolve) => {
      const got: NostrEvent[] = [];
      let stop = (): void => {};
      stop = p.subscribe(
        filters,
        (ev) => got.push(ev),
        () => {
          stop();
          resolve(got);
        },
      );
    });
  }
}

export async function waitFor<T>(
  what: string,
  get: () => T | null | undefined | false,
  ms = 60_000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== null && v !== undefined && v !== false) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A device whose live game feed lags: every subscription that pages (`limit`, the game feed and whole-game
 * queries) drops events signed by `key` (another device of the same seat), while a targeted query (the check before
 * signing) gets everything. Publishing can be cut off (`offline`); `published` records what went out.
 */
export function laggingOwn(real: PoolLike, key: () => string | null) {
  const net = {
    offline: false,
    published: [] as string[],
    pool: {
      subscribe: (filters, onEvent, onEose, opts) => {
        const paged = filters.some((f) => f.limit !== undefined);
        return real.subscribe(
          filters,
          (ev, url) => {
            if (!paged || ev.pubkey !== key()) onEvent(ev, url);
          },
          onEose,
          opts,
        );
      },
      publish: async (ev: NostrEvent, urls?: readonly string[]) => {
        if (net.offline) return [{ url: 'offline', ok: false, message: 'offline' }];
        net.published.push(ev.id);
        return real.publish(ev, urls);
      },
      addRelays: (urls: readonly string[]) => real.addRelays?.(urls),
    } as PoolLike,
  };
  return net;
}

/** A pool whose publishing can be cut off (`offline`, the default), recording what it did publish. */
export function offlinePool(real: PoolLike) {
  const net = {
    offline: true,
    published: [] as string[],
    pool: {
      subscribe: (filters, onEvent, onEose?: (info: EoseInfo) => void, opts?) =>
        real.subscribe(filters, onEvent, onEose, opts),
      publish: async (ev: NostrEvent, urls?: readonly string[]) => {
        if (net.offline) return [{ url: 'offline', ok: false, message: 'offline' }];
        net.published.push(ev.id);
        return real.publish(ev, urls);
      },
      addRelays: (urls: readonly string[]) => real.addRelays?.(urls),
    } as PoolLike,
  };
  return net;
}

/**
 * A device that never receives the events in `hidden` (on any subscription), with publishing that can be cut off
 * (`offline`); `published` records what went out.
 */
export function hiding(real: PoolLike, hidden: ReadonlySet<string>, offline = false) {
  const net = {
    offline,
    published: [] as string[],
    pool: {
      subscribe: (filters, onEvent, onEose, opts) =>
        real.subscribe(
          filters,
          (ev, url) => (hidden.has(ev.id) ? undefined : onEvent(ev, url)),
          onEose,
          opts,
        ),
      publish: async (ev: NostrEvent, urls?: readonly string[]) => {
        if (net.offline) return [{ url: 'offline', ok: false, message: 'offline' }];
        net.published.push(ev.id);
        return real.publish(ev, urls);
      },
      addRelays: (urls: readonly string[]) => real.addRelays?.(urls),
    } as PoolLike,
  };
  return net;
}

/** The saved outbox slots of a profile for a game. */
export const outboxSlots = (p: Profile, rootId: string): string[] => [
  ...loadOutbox(p.deps.storage, p.name, rootId).keys(),
];
