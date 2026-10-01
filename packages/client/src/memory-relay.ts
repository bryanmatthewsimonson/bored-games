import { type Rng, shuffle } from '@bored-games/game-kit';
import { type Hex, type NostrEvent, verifyEvent } from '@bored-games/protocol';

/*
 * An in-memory NOSTR relay for simulations and tests: it stores signed events and answers filter queries. Like a
 * real relay it drops events that are not valid NIP-01 events, keeps one copy of each id and keeps only the
 * latest version of an addressable event (kinds 30000–39999, by kind, author and `d` tag). It promises no
 * delivery order: every query returns its matches in an order permuted by a seeded rng, so readers see events
 * in different orders. Pure: the rng is injected.
 */

/** A NIP-01 filter, as far as this relay understands one. Every listed condition must hold. */
export interface RelayFilter {
  ids?: readonly Hex[];
  kinds?: readonly number[];
  authors?: readonly Hex[];
  '#e'?: readonly string[];
  '#a'?: readonly string[];
  '#d'?: readonly string[];
  '#p'?: readonly string[];
}

const TAG_FILTERS = ['#e', '#a', '#d', '#p'] as const;

const isAddressable = (kind: number): boolean => kind >= 30000 && kind < 40000;

const dTag = (ev: NostrEvent): string => ev.tags.find((t) => t[0] === 'd')?.[1] ?? '';

/** Whether `ev` matches `f` (NIP-01: a tag filter matches an event with a tag of that name and a listed value). */
export function matchesFilter(ev: NostrEvent, f: RelayFilter): boolean {
  if (f.ids !== undefined && !f.ids.includes(ev.id)) return false;
  if (f.kinds !== undefined && !f.kinds.includes(ev.kind)) return false;
  if (f.authors !== undefined && !f.authors.includes(ev.pubkey)) return false;
  for (const key of TAG_FILTERS) {
    const values = f[key];
    if (values === undefined) continue;
    const name = key.slice(1);
    if (!ev.tags.some((t) => t[0] === name && t[1] !== undefined && values.includes(t[1]))) return false;
  }
  return true;
}

export class MemoryRelay {
  readonly #events = new Map<Hex, NostrEvent>();
  /** The id held for each addressable coordinate `kind:pubkey:d`. */
  readonly #addressed = new Map<string, Hex>();
  readonly #rng: Rng;

  /** `rng` permutes the order of every query's answer. */
  constructor(rng: Rng) {
    this.#rng = rng;
  }

  /**
   * Store `ev`. Returns false, storing nothing, for an invalid event, an id already held, or an addressable
   * event older than the version held (ties go to the lowest id, NIP-01).
   */
  publish(ev: NostrEvent): boolean {
    if (this.#events.has(ev.id) || !verifyEvent(ev)) return false;
    if (isAddressable(ev.kind)) {
      const coord = `${ev.kind}:${ev.pubkey}:${dTag(ev)}`;
      const heldId = this.#addressed.get(coord);
      const held = heldId === undefined ? undefined : this.#events.get(heldId);
      if (held !== undefined) {
        const newer =
          ev.created_at > held.created_at || (ev.created_at === held.created_at && ev.id < held.id);
        if (!newer) return false;
        this.#events.delete(held.id);
      }
      this.#addressed.set(coord, ev.id);
    }
    this.#events.set(ev.id, ev);
    return true;
  }

  /**
   * The stored events that match any of `filters` (one filter or several), each once, in an order permuted by
   * `rng` (the relay's own by default, so each reader can bring its own).
   */
  query(filters: RelayFilter | readonly RelayFilter[], rng: Rng = this.#rng): NostrEvent[] {
    const list: readonly RelayFilter[] = Array.isArray(filters) ? filters : [filters as RelayFilter];
    const out = [...this.#events.values()].filter((ev) => list.some((f) => matchesFilter(ev, f)));
    return shuffle(out, rng);
  }

  /** How many events the relay holds. */
  get size(): number {
    return this.#events.size;
  }
}
