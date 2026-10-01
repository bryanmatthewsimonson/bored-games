import type { Share } from '@bored-games/deck';
import type { DealtPosition } from '@bored-games/game-kit';

/** What `ShareStore.add` did: kept a new share, or nothing (one is already kept for that seat and position). */
export type AddResult = 'new' | 'none';

/**
 * Verified decryption shares, at most one per (seat, position): the first valid share is kept, so a seat that
 * publishes the same position twice (fresh proof randomness, same `D`) is counted once (PROTOCOL §5.4, D025).
 * Callers verify a share before adding it.
 */
export class ShareStore {
  private readonly seats: number;
  /** For each position, one slot per seat; `null` means missing. */
  private readonly byPos = new Map<number, (Share | null)[]>();

  constructor(seats: number) {
    this.seats = seats;
  }

  /** Whether `seat`'s share of `pos` is kept. */
  has(seat: number, pos: number): boolean {
    return (this.byPos.get(pos)?.[seat] ?? null) !== null;
  }

  /** Keep `share` as `seat`'s share of `pos` unless one is already kept. */
  add(seat: number, pos: number, share: Share): AddResult {
    let slots = this.byPos.get(pos);
    if (slots === undefined) {
      slots = new Array<Share | null>(this.seats).fill(null);
      this.byPos.set(pos, slots);
    }
    if (slots[seat] !== null) return 'none';
    slots[seat] = share;
    return 'new';
  }

  /** A copy of `pos`'s slots in seat order, optionally with `without`'s slot left empty. */
  slots(pos: number, without: number | null = null): (Share | null)[] {
    const slots = [...(this.byPos.get(pos) ?? new Array<Share | null>(this.seats).fill(null))];
    if (without !== null) slots[without] = null;
    return slots;
  }

  /** Whether every seat except `except` (or every seat, for null) has a share of `pos`. */
  covered(pos: number, except: number | null = null): boolean {
    for (let k = 0; k < this.seats; k++) if (k !== except && !this.has(k, pos)) return false;
    return true;
  }

  /** The positions `seat` owes and has not yet shared, ascending (PROTOCOL §6.2). */
  missing(seat: number, dealt: readonly DealtPosition[]): number[] {
    return owedPositions(dealt, seat).filter((pos) => !this.has(seat, pos));
  }
}

/** Every position `dealt` assigns to a seat other than `seat`, or to nobody (public), ascending and unique. */
export function owedPositions(dealt: readonly DealtPosition[], seat: number): number[] {
  const out = new Set<number>();
  for (const d of dealt) if (d.to !== seat) out.add(d.pos);
  return [...out].sort((a, b) => a - b);
}
