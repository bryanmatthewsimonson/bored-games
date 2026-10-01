/*
 * The ProfileStore: one per page, like the LobbyController. Screens say which pubkeys they show (`want`), the
 * store keeps one batched kind 0 subscription for all of them, and each pubkey's profile is a signal, served
 * from the storage cache first. Saving merges the player's edits into the newest published version (D040).
 */
import type { Hex, NostrEvent } from '@bored-games/protocol';
import { type ReadonlySignal, type Signal, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { useApp } from './context.ts';
import type { Signer } from './identity.ts';
import type { ControllerDeps } from './net.ts';
import {
  type CachedProfile,
  loadProfileCache,
  newerEvent,
  type ParsedProfile,
  type ProfileChanges,
  parseProfile,
  profileTemplate,
  saveProfileCache,
} from './profile-model.ts';

/** What is known of one pubkey's profile. */
export interface ProfileEntry {
  /** True once the relays answered (or the cache had it): `info` null then means "no profile". */
  loaded: boolean;
  info: ParsedProfile | null;
}

export type ProfileDeps = Pick<ControllerDeps, 'pool' | 'storage' | 'profile' | 'now' | 'timers'>;

/** How long a save waits for the newest published profile (ms). */
export const FETCH_LATEST_MS = 5000;
/** Authors per filter in the batched subscription. */
const AUTHORS_PER_FILTER = 100;

export type SaveResult = { status: 'saved'; event: NostrEvent } | { status: 'unconfirmed' };

export const NO_RELAY_ACCEPTED_PROFILE = 'No relay accepted your profile. Check your relays and try again.';

export class ProfileStore {
  readonly #d: ProfileDeps;
  readonly #entries = new Map<Hex, Signal<ProfileEntry>>();
  /** The newest kind 0 event seen this page, per pubkey. */
  readonly #events = new Map<Hex, NostrEvent>();
  readonly #cache: Map<Hex, CachedProfile>;
  readonly #refs = new Map<Hex, number>();
  #subscribed = new Set<Hex>();
  #stop: (() => void) | null = null;
  #batch: (() => void) | null = null;
  #saveCache: (() => void) | null = null;
  #disposed = false;

  constructor(deps: ProfileDeps) {
    this.#d = deps;
    this.#cache = loadProfileCache(deps.storage, deps.profile, deps.now());
  }

  /** The profile of `pubkey`; it updates as newer versions arrive. Call `want` to fetch it. */
  get(pubkey: Hex): ReadonlySignal<ProfileEntry> {
    let s = this.#entries.get(pubkey);
    if (s === undefined) {
      const cached = this.#cache.get(pubkey) ?? null;
      s = signal<ProfileEntry>(
        cached === null ? { loaded: false, info: null } : { loaded: true, info: strip(cached) },
      );
      this.#entries.set(pubkey, s);
    }
    return s;
  }

  /** Follow these pubkeys' profiles until the returned function is called (counted per pubkey). */
  want(pubkeys: readonly Hex[]): () => void {
    const list = [...new Set(pubkeys)];
    let fresh = false;
    for (const pk of list) {
      this.get(pk);
      this.#refs.set(pk, (this.#refs.get(pk) ?? 0) + 1);
      if (!this.#subscribed.has(pk)) fresh = true;
    }
    if (fresh) this.#schedule();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const pk of list) {
        const n = (this.#refs.get(pk) ?? 1) - 1;
        if (n > 0) this.#refs.set(pk, n);
        else this.#refs.delete(pk);
      }
      // Dropped pubkeys leave the subscription when it is next rebuilt.
    };
  }

  /** Take a kind 0 event (from a relay or just published). True when it is the newest for its author. */
  offer(ev: NostrEvent): boolean {
    if (this.#disposed) return false;
    const parsed = parseProfile(ev);
    if (parsed === null) return false;
    const prev = this.#events.get(ev.pubkey) ?? null;
    const cached = this.#cache.get(ev.pubkey);
    const newest = newerEvent(prev, ev) === ev && (cached === undefined || isNewer(parsed, cached));
    const now = this.#d.now();
    if (newest) {
      this.#events.set(ev.pubkey, ev);
      this.#cache.set(ev.pubkey, { ...parsed, seenAt: now });
      const s = this.get(ev.pubkey) as Signal<ProfileEntry>;
      s.value = { loaded: true, info: parsed };
    } else if (cached !== undefined && cached.id === parsed.id) {
      this.#events.set(ev.pubkey, ev);
      this.#cache.set(ev.pubkey, { ...cached, seenAt: now });
    } else return false;
    this.#scheduleCacheSave();
    return newest;
  }

  /**
   * The newest kind 0 of `pubkey` on the relays (or already seen), waiting at most `ms`. `complete` is false
   * when the relays had not all answered in time.
   */
  fetchLatest(pubkey: Hex, ms = FETCH_LATEST_MS): Promise<{ event: NostrEvent | null; complete: boolean }> {
    return new Promise((resolve) => {
      let done = false;
      let unsub = (): void => {};
      let cancel = (): void => {};
      const finish = (complete: boolean) => {
        if (done) return;
        done = true;
        cancel();
        unsub();
        resolve({ event: this.#events.get(pubkey) ?? null, complete });
      };
      cancel = this.#d.timers.later(ms, () => finish(false));
      unsub = this.#d.pool.subscribe(
        [{ kinds: [0], authors: [pubkey] }],
        (ev) => {
          if (ev.kind === 0 && ev.pubkey === pubkey) this.offer(ev);
        },
        () => finish(true),
        { eoseTimeoutMs: ms + 2000 },
      );
      if (done) unsub();
    });
  }

  /**
   * Publish the player's edited profile: fetch the newest version, merge the edits into it (unknown fields and
   * tags kept), sign, and publish to `relays`; at least one relay must accept it. For an extension key, whose
   * profile was probably made in another app, a fetch that timed out returns `unconfirmed` unless `overwrite`.
   */
  async save(
    signer: Signer,
    relays: readonly string[],
    changes: ProfileChanges,
    opts: { overwrite?: boolean } = {},
  ): Promise<SaveResult> {
    const latest = await this.fetchLatest(signer.pubkey);
    if (!latest.complete && signer.kind === 'nip07' && opts.overwrite !== true)
      return { status: 'unconfirmed' };
    const ev = await signer.sign(profileTemplate(latest.event, changes, this.#d.now()));
    const results = await this.#d.pool.publish(ev, relays);
    if (!results.some((r) => r.ok)) throw new Error(NO_RELAY_ACCEPTED_PROFILE);
    this.offer(ev);
    return { status: 'saved', event: ev };
  }

  dispose(): void {
    this.#disposed = true;
    this.#stop?.();
    this.#stop = null;
    this.#batch?.();
    this.#saveCache?.();
  }

  #schedule(): void {
    if (this.#batch !== null || this.#disposed) return;
    this.#batch = this.#d.timers.later(20, () => {
      this.#batch = null;
      this.#resubscribe();
    });
  }

  /** One subscription for every wanted pubkey, replacing the previous one. */
  #resubscribe(): void {
    if (this.#disposed) return;
    const authors = [...this.#refs.keys()].sort();
    this.#stop?.();
    this.#stop = null;
    this.#subscribed = new Set(authors);
    if (authors.length === 0) return;
    const filters = [];
    for (let i = 0; i < authors.length; i += AUTHORS_PER_FILTER)
      filters.push({ kinds: [0], authors: authors.slice(i, i + AUTHORS_PER_FILTER) });
    const wanted = new Set(authors);
    this.#stop = this.#d.pool.subscribe(
      filters,
      (ev) => {
        if (ev.kind === 0 && wanted.has(ev.pubkey)) this.offer(ev);
      },
      () => {
        for (const pk of authors) {
          const s = this.get(pk) as Signal<ProfileEntry>;
          if (!s.value.loaded) s.value = { loaded: true, info: s.value.info };
        }
      },
    );
  }

  #scheduleCacheSave(): void {
    if (this.#saveCache !== null || this.#disposed) return;
    this.#saveCache = this.#d.timers.later(1000, () => {
      this.#saveCache = null;
      saveProfileCache(this.#d.storage, this.#d.profile, this.#cache.values(), this.#d.now());
    });
  }
}

function isNewer(p: ParsedProfile, cached: CachedProfile): boolean {
  return p.createdAt > cached.createdAt || (p.createdAt === cached.createdAt && p.id < cached.id);
}

function strip(c: CachedProfile): ParsedProfile {
  const { seenAt: _, ...rest } = c;
  return rest;
}

const stores = new WeakMap<ProfileDeps, ProfileStore>();

/** The one ProfileStore of the page. */
export function profilesFor(deps: ProfileDeps): ProfileStore {
  let s = stores.get(deps);
  if (s === undefined) {
    s = new ProfileStore(deps);
    stores.set(deps, s);
  }
  return s;
}

export function useProfiles(): ProfileStore {
  return profilesFor(useApp().deps);
}

/** The profile of `pubkey`, followed while the calling component is mounted. */
export function useProfile(pubkey: Hex): ProfileEntry {
  const store = useProfiles();
  useEffect(() => store.want([pubkey]), [store, pubkey]);
  return store.get(pubkey).value;
}
