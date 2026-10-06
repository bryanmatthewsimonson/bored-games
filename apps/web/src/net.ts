/*
 * Networking for the app: the one RelayPool built from the Settings relay list, the rules-module registry,
 * and the dependencies the lobby and game controllers share. Controllers take these as constructor arguments,
 * so tests run them in Node against the dev relay with local signers and a memory store.
 */
import { bank } from '@bored-games/bank';
import { chainReaction } from '@bored-games/chain-reaction';
import { chess } from '@bored-games/chess';
import type { GameModule } from '@bored-games/game-kit';
import { luster } from '@bored-games/luster';
import type { NostrEvent } from '@bored-games/protocol';
import {
  type EoseInfo,
  type Filter,
  type PublishResult,
  RelayPool,
  type SubscribeOptions,
} from '@bored-games/relay';
import { rightOfWay } from '@bored-games/right-of-way';
import { effect } from '@preact/signals';
import type { Timers } from './clock.ts';
import type { Signer } from './identity.ts';
import type { RandomBytes } from './random.ts';
import type { Settings } from './settings.ts';
import type { KeyValueStore } from './storage.ts';

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

export type ModuleRegistry = ReadonlyMap<string, AnyModule>;

/** The games this client can play, by module id; each also has a web registry entry (games/registry.ts). */
export const MODULES: ModuleRegistry = new Map<string, AnyModule>([
  [chainReaction.id, chainReaction],
  [chess.id, chess],
  [bank.id, bank],
  [luster.id, luster],
  [rightOfWay.id, rightOfWay],
]);

/** The part of `RelayPool` the controllers use. `addRelays` is optional so a test double may leave it out. */
export interface PoolLike {
  publish(ev: NostrEvent, urls?: readonly string[]): Promise<PublishResult[]>;
  subscribe(
    filters: Filter[],
    onEvent: (ev: NostrEvent, url: string) => void,
    onEose?: (info: EoseInfo) => void,
    opts?: SubscribeOptions,
  ): () => void;
  addRelays?(urls: readonly string[]): void;
}

/** What a lobby or game controller is built from. */
export interface ControllerDeps {
  pool: PoolLike;
  /** The player's identity signer (NIP-07 or a local key). */
  signer: Signer;
  storage: KeyValueStore;
  /** The storage namespace (`?profile=`). */
  profile: string;
  /** The player's own relays, read at each publish. */
  relays: () => readonly string[];
  rnd: RandomBytes;
  /** Unix seconds. */
  now: () => number;
  modules: ModuleRegistry;
  timers: Timers;
}

/** Distinct relay URLs, in first-seen order. */
export function unionRelays(...lists: (readonly string[])[]): string[] {
  const out: string[] = [];
  for (const list of lists) for (const url of list) if (!out.includes(url)) out.push(url);
  return out;
}

let shared: RelayPool | null = null;

/**
 * The app's single relay pool, connected to the Settings relays. Relays added in Settings later are connected
 * too; a relay removed there stays connected until the page reloads (open games may still use it).
 */
export function appPool(settings: Settings): RelayPool {
  if (shared !== null) return shared;
  const pool = new RelayPool(settings.relays.value, { WebSocket });
  effect(() => pool.addRelays(settings.relays.value));
  shared = pool;
  return pool;
}
