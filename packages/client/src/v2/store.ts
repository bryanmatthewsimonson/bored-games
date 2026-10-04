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
 * by `prev`. Per-seat caps follow v1's for Timeout claims and Resigns.
 *
 * Shares events and end attestations form the **held set** (PROTOCOL-v2 §5.4 (b), D066): every one that parses at
 * proto 2, names the game's root and has a seated signer is kept here before any validity check, whatever its
 * validity, with no cap, because rule (b) and the rebroadcast (§9.1) count them all. What is valid (verified shares,
 * counted attestations) is recomputed from this set by the layers above; it never removes an event from it.
 */

/** The Timeout claims kept per signer per head, the lowest ids (as v1, D030 Ruling 8). */
export const MAX_CLAIMS = 4;
/** The Timeout claims kept per signer naming a head this client does not hold (as v1). */
export const MAX_UNKNOWN_CLAIMS = 8;
/** The Resigns kept per seat, the lowest ids (as v1's waiting resigns). */
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
 * What `keepClaim` and `keepResign` did: kept it (evicting the highest id kept before, under a cap), or refused it
 * for a cap (it is not stored).
 */
export type Kept =
  | { readonly kept: true; readonly evicted: Hex | null }
  | { readonly kept: false; readonly why: string };

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
  /** Timeout claims by id, within the caps. */
  readonly claims = new Map<Hex, Seated<ParsedTimeout>>();
  /** Resigns by id, within the cap. */
  readonly resigns = new Map<Hex, Seated<ParsedResign>>();
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
   * Keep claim `t` by `seat` within the caps: per signer the `MAX_CLAIMS` lowest ids per head (a lower id evicts
   * the highest kept), and at most `MAX_UNKNOWN_CLAIMS` naming heads this client does not hold.
   */
  keepClaim(t: ParsedTimeout, seat: number): Kept {
    if (!this.held(t.headId)) {
      let unknown = 0;
      for (const c of this.claims.values()) if (c.seat === seat && !this.held(c.ev.headId)) unknown++;
      if (unknown >= MAX_UNKNOWN_CLAIMS) return { kept: false, why: 'claim limit' };
    }
    const mine = [...this.claims.values()]
      .filter((c) => c.seat === seat && c.ev.headId === t.headId)
      .map((c) => c.ev.id)
      .sort();
    let evicted: Hex | null = null;
    if (mine.length >= MAX_CLAIMS) {
      const highest = mine[mine.length - 1] as Hex;
      if (t.id > highest) return { kept: false, why: 'claim limit' };
      this.claims.delete(highest);
      evicted = highest;
    }
    this.claims.set(t.id, { ev: t, seat });
    return { kept: true, evicted };
  }

  /** Keep Resign `r` by `seat`: the `MAX_RESIGNS` lowest ids per seat (a lower id evicts the highest kept). */
  keepResign(r: ParsedResign, seat: number): Kept {
    const mine = [...this.resigns.values()]
      .filter((x) => x.seat === seat)
      .map((x) => x.ev.id)
      .sort();
    let evicted: Hex | null = null;
    if (mine.length >= MAX_RESIGNS) {
      const highest = mine[mine.length - 1] as Hex;
      if (r.id > highest) return { kept: false, why: 'resign limit' };
      this.resigns.delete(highest);
      evicted = highest;
    }
    this.resigns.set(r.id, { ev: r, seat });
    return { kept: true, evicted };
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
