import { canonicalJson } from '@bored-games/game-kit';
import type {
  Hex,
  ParsedCardShares,
  ParsedDeviceNote,
  ParsedEndAttest,
  ParsedResign,
  ParsedRollShares,
  ParsedSecret,
  ParsedStatsAttest,
  ParsedTimeout,
} from '@bored-games/protocol';
import type { ResultId } from '../types.ts';
import type { HeldMove } from './types.ts';

/*
 * EventStoreV2 (build plan D-E layer 1): every held event of one protocol 2 game, parsed, with its seat. It only
 * stores and indexes: it judges nothing, so the walk, the cutoff and every later layer are functions of what it
 * holds. Moves are kept whatever their validity (PROTOCOL-v2 §5.1: a held Move need not be valid), indexed by id and
 * by `prev`. Per-seat caps follow v1's for Timeout claims and Resigns, and keep the same set in every arrival order
 * (D069): a cap on events waiting for their head never refuses one for good.
 *
 * Shares events and end attestations form the **held set** (PROTOCOL-v2 §5.4 (b), D066): every one that parses at
 * proto 2, names the game's root and has a seated signer is kept here before any validity check, whatever its
 * validity, with no cap, because rule (b) and the rebroadcast (§9.1) count them all. What is valid (verified shares,
 * counted attestations) is recomputed from this set by the layers above; it never removes an event from it.
 */

/** The Timeout claims kept per signer per head, the lowest ids (as v1, D030 Ruling 8), whether the head is held or not. */
export const MAX_CLAIMS = 4;
/** The Timeout claims waiting per signer for a head this client does not hold yet, the lowest ids (as v1). */
export const MAX_UNKNOWN_CLAIMS = 8;
/** The Resigns waiting per seat for a head this client does not hold yet, the lowest ids (as v1 §8.3). */
export const MAX_RESIGNS = 8;

export interface Seated<T> {
  readonly ev: T;
  readonly seat: number;
}

/** An end attestation and the seat it counts for (from the session key or the npub that signed it). */
export interface HeldEnd extends Seated<ParsedEndAttest> {
  /** Whether the seat's npub signed it, rather than its session key. */
  readonly byNpub: boolean;
}

/** A seat's latest stats attestation (PROTOCOL-v2 §7.4): its id, its date and its canonical content. */
export interface HeldStats {
  readonly id: Hex;
  readonly at: number;
  readonly content: string;
}

/**
 * What `keepClaim` and `keepResign` did (D069). `kept`: the event is now held, kept or waiting for its head. `final`:
 * ids refused for good, this one or a kept claim it evicted (the per-head claim cap on a held head, which keeps the
 * lowest ids of all ever received, so the refusal is the same in every arrival order). `dropped`: waiting ids let go
 * by a waiting cap, this one or others; never for good, since a later delivery (after the head is held) is judged
 * again.
 */
export interface Kept {
  readonly kept: boolean;
  readonly final: readonly Hex[];
  readonly dropped: readonly Hex[];
}

/** Keep the `max` lowest ids among the entries of `pool` that `mine` selects; returns the ids removed. */
function trim<T>(pool: Map<Hex, T>, mine: (x: T) => boolean, max: number): Hex[] {
  const ids = [...pool].flatMap(([id, x]) => (mine(x) ? [id] : [])).sort();
  const out = ids.slice(max);
  for (const id of out) pool.delete(id);
  return out;
}

/** The key an end attestation is kept once under: its seat, its result's identity and its log hash. */
export function endKey(seat: number, e: ParsedEndAttest): string {
  return `${seat}|${e.end.kind}|${e.headId}|${e.end.forfeit.join(',')}|${e.end.logHash}`;
}

/** A result identity as one string: kind, head and forfeiting seats. */
export function resultKey(r: ResultId): string {
  return `${r.kind}|${r.head}|${r.forfeit.join(',')}`;
}

export class EventStoreV2 {
  readonly rootId: Hex;
  /** Every held move by id. */
  readonly moves = new Map<Hex, HeldMove>();
  /** The ids of the held moves on each `prev`. */
  private readonly kids = new Map<Hex, Set<Hex>>();
  /** Every held card Shares event (PROTOCOL-v2 §4.2), with its anchor, by id (D066). */
  readonly cardShares = new Map<Hex, Seated<ParsedCardShares>>();
  /** Every held roll Shares event (PROTOCOL-v2 §4.2), with its anchor, by id (D066). */
  readonly rollShares = new Map<Hex, Seated<ParsedRollShares>>();
  /** The ids of the held roll Shares events naming each requesting move. */
  private readonly rollsByMove = new Map<Hex, Set<Hex>>();
  /** Timeout claims naming a held head, by id: per signer per head the `MAX_CLAIMS` lowest ids. */
  readonly claims = new Map<Hex, Seated<ParsedTimeout>>();
  /**
   * Timeout claims naming a head not held yet, by id (D069): per signer per head the `MAX_CLAIMS` lowest ids, and per
   * signer the `MAX_UNKNOWN_CLAIMS` lowest. Each moves to `claims` when its head is held (`promote`).
   */
  readonly waitingClaims = new Map<Hex, Seated<ParsedTimeout>>();
  /** Resigns naming a held head, by id: never capped or evicted (v1 §8.3: the cap never retracts anything). */
  readonly resigns = new Map<Hex, Seated<ParsedResign>>();
  /** Resigns naming a head not held yet, by id: per seat the `MAX_RESIGNS` lowest ids; promoted as claims are. */
  readonly waitingResigns = new Map<Hex, Seated<ParsedResign>>();
  /**
   * Each seat's deck secret from a valid Resign it signed (v1 §8.3: it counts as the seat's Secret reveal), kept
   * whether the Resign is kept, waiting or let go by the waiting cap: the secret is public once published, and a
   * seat has one.
   */
  readonly resignSecrets = new Map<number, bigint>();
  /** Secret reveals by id, each matching its seat's deck key. */
  readonly secrets = new Map<Hex, Seated<ParsedSecret>>();
  /** Every held end attestation by id, duplicates and invalid ones included (D066). */
  readonly ends = new Map<Hex, HeldEnd>();
  /** The first id held per `endKey`, for the `duplicate` receive status only. */
  private readonly endKeys = new Map<string, Hex>();
  /** Each seat's latest stats attestation, by (`created_at`, id). */
  readonly stats = new Map<number, HeldStats>();
  /** Every stats attestation id received from a seated npub, kept or superseded. */
  readonly statsIds = new Set<Hex>();
  /** Device notes (PROTOCOL-v2 §4.4), stored only (§9.5 is built with the first audit-`'none'` module). */
  readonly devices = new Map<Hex, Seated<ParsedDeviceNote>>();
  /**
   * The log hash of each id's line, once that line is held (`results.ts` `lineLogHash`): a held line never changes
   * (each move names its prev), so the cutoff hashes each attested head once, however many attestations name it.
   */
  readonly lineHashes = new Map<Hex, Hex>();

  constructor(rootId: Hex) {
    this.rootId = rootId;
  }

  /** Whether `id` is the root or a held move. */
  held(id: Hex): boolean {
    return id === this.rootId || this.moves.has(id);
  }

  addMove(held: HeldMove): void {
    const { m } = held;
    this.moves.set(m.id, held);
    let kids = this.kids.get(m.prevId);
    if (kids === undefined) {
      kids = new Set();
      this.kids.set(m.prevId, kids);
    }
    kids.add(m.id);
  }

  /** The held moves whose `prev` is `id`, ascending by id. */
  kidsOf(id: Hex): HeldMove[] {
    const ids = [...(this.kids.get(id) ?? [])].sort();
    return ids.map((k) => this.moves.get(k) as HeldMove);
  }

  /**
   * The ids of the line of `id` (PROTOCOL-v2 §5.1) from move 1 to `id`, in `seq` order: `[]` for the root, null
   * when `id` or one of its ancestors through `prev` is not held.
   */
  lineIds(id: Hex): Hex[] | null {
    const out: Hex[] = [];
    let at = id;
    // Each step goes to a held move's prev, and a prev never repeats on a line of distinct ids; the bound only
    // guards against a cycle no signed event can make.
    for (let i = 0; at !== this.rootId; i++) {
      const held = this.moves.get(at);
      if (held === undefined || i > this.moves.size) return null;
      out.push(at);
      at = held.m.prevId;
    }
    return out.reverse();
  }

  /**
   * Whether held event `a` is at or past `h` (PROTOCOL-v2 §5.1): `a = h`, or the `prev` links of held moves lead
   * from `a` down to `h`.
   */
  atOrPast(a: Hex, h: Hex): boolean {
    let at = a;
    for (let i = 0; i <= this.moves.size + 1; i++) {
      if (at === h) return true;
      const held = this.moves.get(at);
      if (held === undefined) return false;
      at = held.m.prevId;
    }
    return false;
  }

  /**
   * Keep claim `t` by `seat` within the caps (D069). On a held head: per signer per head the `MAX_CLAIMS` lowest ids
   * (a lower id evicts the highest kept, for good). On a head not held: it waits (`waitingClaims`), under the same
   * per-head cap and at most `MAX_UNKNOWN_CLAIMS` per signer, the lowest ids; what those caps let go is `dropped`,
   * never refused for good. So once each claim has been delivered after its head is held (or was waiting when it
   * arrived), the claims kept on a head are its `MAX_CLAIMS` lowest ids, whatever the arrival order.
   */
  keepClaim(t: ParsedTimeout, seat: number): Kept {
    if (this.held(t.headId)) {
      const mine = [...this.claims.values()]
        .filter((c) => c.seat === seat && c.ev.headId === t.headId)
        .map((c) => c.ev.id)
        .sort();
      if (mine.length < MAX_CLAIMS) {
        this.claims.set(t.id, { ev: t, seat });
        return { kept: true, final: [], dropped: [] };
      }
      const highest = mine[mine.length - 1] as Hex;
      if (t.id > highest) return { kept: false, final: [t.id], dropped: [] };
      this.claims.delete(highest);
      this.claims.set(t.id, { ev: t, seat });
      return { kept: true, final: [highest], dropped: [] };
    }
    this.waitingClaims.set(t.id, { ev: t, seat });
    const dropped = [
      ...trim(this.waitingClaims, (c) => c.seat === seat && c.ev.headId === t.headId, MAX_CLAIMS),
      ...trim(this.waitingClaims, (c) => c.seat === seat, MAX_UNKNOWN_CLAIMS),
    ];
    return { kept: !dropped.includes(t.id), final: [], dropped };
  }

  /**
   * Keep Resign `r` by `seat` (D069, v1 §8.3): on a held head always (never capped or evicted); on a head not held it
   * waits (`waitingResigns`), at most `MAX_RESIGNS` per seat, the lowest ids, and what that cap lets go is `dropped`.
   */
  keepResign(r: ParsedResign, seat: number): Kept {
    if (this.held(r.headId)) {
      this.resigns.set(r.id, { ev: r, seat });
      return { kept: true, final: [], dropped: [] };
    }
    this.waitingResigns.set(r.id, { ev: r, seat });
    const dropped = trim(this.waitingResigns, (x) => x.seat === seat, MAX_RESIGNS);
    return { kept: !dropped.includes(r.id), final: [], dropped };
  }

  /**
   * Move `id` was just held: the claims and Resigns waiting for it are kept now (they fit: the waiting pool's
   * per-head claim cap is the kept one's, and no claim on a head is kept while it is not held). Returns the ids that
   * moved, so the cutoff is recomputed (and their first-seen times count toward when a result first stood).
   */
  promote(id: Hex): Hex[] {
    const moved: Hex[] = [];
    for (const [k, c] of this.waitingClaims)
      if (c.ev.headId === id) {
        this.waitingClaims.delete(k);
        this.claims.set(k, c);
        moved.push(k);
      }
    for (const [k, x] of this.waitingResigns)
      if (x.ev.headId === id) {
        this.waitingResigns.delete(k);
        this.resigns.set(k, x);
        moved.push(k);
      }
    return moved;
  }

  /**
   * Hold end attestation `a` for `seat`, whatever its validity (D066). Returns false when another one with the same
   * `endKey` (by either of the seat's keys) was held already: it is held too, and counts once (PROTOCOL-v2 §11
   * item 10).
   */
  addEnd(a: ParsedEndAttest, seat: number, byNpub: boolean): boolean {
    this.ends.set(a.id, { ev: a, seat, byNpub });
    const key = endKey(seat, a);
    if (this.endKeys.has(key)) return false;
    this.endKeys.set(key, a.id);
    return true;
  }

  /** Hold Shares event `s` by `seat`, of either variant, whatever its validity (D066). */
  addShares(s: ParsedCardShares | ParsedRollShares, seat: number): void {
    if (s.type === 'shares') {
      this.cardShares.set(s.id, { ev: s, seat });
      return;
    }
    this.rollShares.set(s.id, { ev: s, seat });
    let ids = this.rollsByMove.get(s.moveId);
    if (ids === undefined) {
      ids = new Set();
      this.rollsByMove.set(s.moveId, ids);
    }
    ids.add(s.id);
  }

  /** The held roll Shares events whose requesting move is `move`, ascending by id. */
  rollsFor(move: Hex): Seated<ParsedRollShares>[] {
    const ids = [...(this.rollsByMove.get(move) ?? [])].sort();
    return ids.map((id) => this.rollShares.get(id) as Seated<ParsedRollShares>);
  }

  /** Keep `a` as `seat`'s stats attestation if it is its latest by (`created_at`, id). */
  addStats(a: ParsedStatsAttest, seat: number): void {
    this.statsIds.add(a.id);
    const content = canonicalJson({ audit: a.audit, logHash: a.logHash, outcome: a.outcome });
    const held = this.stats.get(seat);
    if (held === undefined || a.createdAt > held.at || (a.createdAt === held.at && a.id > held.id))
      this.stats.set(seat, { id: a.id, content, at: a.createdAt });
  }
}
