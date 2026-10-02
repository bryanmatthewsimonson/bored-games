/*
 * The ProfileStore: one per page, like the LobbyController. Screens say which pubkeys they show (`want`), the
 * store keeps one batched kind 0 subscription for all of them, and each pubkey's profile is a signal, served
 * from the storage cache first. Saving merges the player's edits into the newest published version (D040).
 */
import type { Hex, NostrEvent } from '@bored-games/protocol';
import { type ReadonlySignal, type Signal, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { useApp } from './context.ts';
import { isImportedKey, type Signer } from './identity.ts';
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

/** Why a save stopped to ask before overwriting. */
export type UnconfirmedReason = 'no-answer' | 'timeout' | 'newer-known' | 'none-found';

export type SaveResult =
  | { status: 'saved'; event: NostrEvent }
  | { status: 'unconfirmed'; reason: UnconfirmedReason };

export interface LatestProfile {
  event: NostrEvent | null;
  answered: number;
  complete: boolean;
  newestKnown: number | null;
  knownNewer: boolean;
}

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

  /**
   * Take a kind 0 event (from a relay or just published). The newest raw event per author is always kept, for
   * merging on save; the shown profile and the cache change only when it is newer than what the cache knows.
   * True when it became the shown profile.
   */
  offer(ev: NostrEvent): boolean {
    if (this.#disposed) return false;
    const parsed = parseProfile(ev);
    if (parsed === null) return false;
    const prev = this.#events.get(ev.pubkey) ?? null;
    if (newerEvent(prev, ev) !== ev) return false;
    this.#events.set(ev.pubkey, ev);
    const cached = this.#cache.get(ev.pubkey);
    const now = this.#d.now();
    if (cached === undefined || isNewer(parsed, cached)) {
      this.#cache.set(ev.pubkey, { ...parsed, seenAt: now });
      const s = this.get(ev.pubkey) as Signal<ProfileEntry>;
      s.value = { loaded: true, info: parsed };
      this.#scheduleCacheSave();
      return true;
    }
    if (cached.id === parsed.id) {
      this.#cache.set(ev.pubkey, { ...cached, seenAt: now });
      this.#scheduleCacheSave();
    }
    return false;
  }

  /** The newest raw kind 0 event seen this page for `pubkey`, or null. */
  latestEvent(pubkey: Hex): NostrEvent | null {
    return this.#events.get(pubkey) ?? null;
  }

  /**
   * The newest kind 0 of `pubkey` on the relays, merged with what is already known, waiting at most `ms`.
   * - `event`: the newest raw event known (from the relays or this page).
   * - `answered`: how many relays sent EOSE (a relay that failed to connect does not count).
   * - `complete`: false when the wait ran out first.
   * - `newestKnown`: the newest `created_at` known from any source, the storage cache included.
   * - `knownNewer`: the cache knows a newer version than `event`, whose content it cannot merge.
   */
  fetchLatest(pubkey: Hex, ms = FETCH_LATEST_MS): Promise<LatestProfile> {
    return new Promise((resolve) => {
      let done = false;
      let unsub = (): void => {};
      let cancel = (): void => {};
      const finish = (complete: boolean, answered: number) => {
        if (done) return;
        done = true;
        cancel();
        unsub();
        const event = this.#events.get(pubkey) ?? null;
        const cached = this.#cache.get(pubkey) ?? null;
        const knownNewer =
          cached !== null &&
          (event === null ||
            cached.createdAt > event.created_at ||
            (cached.createdAt === event.created_at && cached.id < event.id));
        const newestKnown = Math.max(event?.created_at ?? -1, cached?.createdAt ?? -1);
        resolve({ event, answered, complete, knownNewer, newestKnown: newestKnown < 0 ? null : newestKnown });
      };
      // The pool's own deadline reports how many relays answered by then; this timer is only a backstop for
      // a pool that never calls back.
      cancel = this.#d.timers.later(ms + 2000, () => finish(false, 0));
      unsub = this.#d.pool.subscribe(
        [{ kinds: [0], authors: [pubkey] }],
        (ev) => {
          if (ev.kind === 0 && ev.pubkey === pubkey) this.offer(ev);
        },
        (info) => finish(!info.timedOut, info.eose),
        { eoseTimeoutMs: ms },
      );
      if (done) unsub();
    });
  }

  /**
   * Publish the player's edited profile: fetch the newest version, merge the edits into it (untouched and
   * unknown fields and tags kept), sign, and publish to `relays`; at least one relay must accept it. Unless
   * `overwrite`, it returns `unconfirmed` instead when the merge could lose data: no relay answered, the wait
   * ran out, this browser knows a newer version than the relays returned, or nothing was found for a key that
   * did not start here (an extension's or an imported key, which may have a profile on other relays).
   * `created_at` is always above the newest version known.
   */
  async save(
    signer: Signer,
    relays: readonly string[],
    changes: ProfileChanges,
    opts: { overwrite?: boolean } = {},
  ): Promise<SaveResult> {
    const latest = await this.fetchLatest(signer.pubkey);
    if (opts.overwrite !== true) {
      const reason: UnconfirmedReason | null =
        latest.answered === 0
          ? 'no-answer'
          : latest.knownNewer
            ? 'newer-known'
            : !latest.complete
              ? 'timeout'
              : latest.event === null && this.#fromElsewhere(signer)
                ? 'none-found'
                : null;
      if (reason !== null) return { status: 'unconfirmed', reason };
    }
    const ev = await signer.sign(profileTemplate(latest.event, changes, this.#d.now(), latest.newestKnown));
    const results = await this.#d.pool.publish(ev, relays);
    if (!results.some((r) => r.ok)) throw new Error(NO_RELAY_ACCEPTED_PROFILE);
    this.offer(ev);
    return { status: 'saved', event: ev };
  }

  /** A key that may have a profile made in another app: the extension's, or one imported into this profile. */
  #fromElsewhere(signer: Signer): boolean {
    return signer.kind === 'nip07' || isImportedKey(this.#d.profile, this.#d.storage, signer.pubkey);
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
      (info) => {
        // Only an actual answer means "no profile": when every relay failed, stay unknown.
        if (info.eose === 0) return;
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
