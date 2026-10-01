import type { Share } from '@bored-games/deck';
import type { DealtPosition } from '@bored-games/game-kit';

/** What `ShareStore.add` did: kept a new share, lowered a kept share's time, or nothing. */
export type AddResult = 'new' | 'earlier' | 'none';

/**
 * Verified decryption shares, at most one per (seat, position): the first valid share is kept, so a seat that
 * publishes the same position twice (fresh proof randomness, same `D`) is counted once (PROTOCOL §5.4, D025).
 * Each kept share also carries the smallest `created_at` among the verified copies seen, so the time a share
 * became available does not depend on which copy arrived first. Callers verify a share before adding it.
 */
export class ShareStore {
  private readonly seats: number;
  /** For each position, one slot per seat; `null` means missing. */
  private readonly byPos = new Map<number, (Share | null)[]>();
  /** For each position, per seat, the earliest `created_at` of a verified copy (meaningful where a share is kept). */
  private readonly atByPos = new Map<number, number[]>();

  constructor(seats: number) {
    this.seats = seats;
  }

  /**
   * Whether `seat`'s share of `pos` is kept; with `limit`, only if a verified copy of it is dated at or before
   * `limit` (D030 R3: a timeout claim ignores events dated after it).
   */
  has(seat: number, pos: number, limit: number | null = null): boolean {
    if ((this.byPos.get(pos)?.[seat] ?? null) === null) return false;
    return limit === null || (this.atByPos.get(pos)?.[seat] as number) <= limit;
  }

  /**
   * Keep `share`, published at `createdAt`, as `seat`'s share of `pos` unless one is already kept; either way keep
   * the earliest time seen for it.
   */
  add(seat: number, pos: number, share: Share, createdAt: number): AddResult {
    let slots = this.byPos.get(pos);
    let ats = this.atByPos.get(pos);
    if (slots === undefined || ats === undefined) {
      slots = new Array<Share | null>(this.seats).fill(null);
      ats = new Array<number>(this.seats).fill(0);
      this.byPos.set(pos, slots);
      this.atByPos.set(pos, ats);
    }
    if (slots[seat] === null) {
      slots[seat] = share;
      ats[seat] = createdAt;
      return 'new';
    }
    if (createdAt < (ats[seat] as number)) {
      ats[seat] = createdAt;
      return 'earlier';
    }
    return 'none';
  }

  /**
   * The largest, over kept shares, of each one's earliest `created_at`; null when no share is kept. With `limit`,
   * shares whose earliest copy is dated after `limit` are ignored.
   */
  latest(limit: number | null = null): number | null {
    let out: number | null = null;
    for (const [pos, slots] of this.byPos) {
      const ats = this.atByPos.get(pos) as number[];
      for (let k = 0; k < this.seats; k++) {
        const at = ats[k] as number;
        if (slots[k] === null || (limit !== null && at > limit)) continue;
        if (out === null || at > out) out = at;
      }
    }
    return out;
  }

  /** A copy of `pos`'s slots in seat order, optionally with `without`'s slot left empty. */
  slots(pos: number, without: number | null = null): (Share | null)[] {
    const slots = [...(this.byPos.get(pos) ?? new Array<Share | null>(this.seats).fill(null))];
    if (without !== null) slots[without] = null;
    return slots;
  }

  /** Whether every seat except `except` (or every seat, for null) has a share of `pos` (dated by `limit`). */
  covered(pos: number, except: number | null = null, limit: number | null = null): boolean {
    for (let k = 0; k < this.seats; k++) if (k !== except && !this.has(k, pos, limit)) return false;
    return true;
  }

  /** The positions `seat` owes and has not yet shared (by `limit`), ascending (PROTOCOL §6.2). */
  missing(seat: number, dealt: readonly DealtPosition[], limit: number | null = null): number[] {
    return owedPositions(dealt, seat).filter((pos) => !this.has(seat, pos, limit));
  }
}

/** Every position `dealt` assigns to a seat other than `seat`, or to nobody (public), ascending and unique. */
export function owedPositions(dealt: readonly DealtPosition[], seat: number): number[] {
  const out = new Set<number>();
  for (const d of dealt) if (d.to !== seat) out.add(d.pos);
  return [...out].sort((a, b) => a - b);
}
