import type { Share } from '@bored-games/deck';
import type { DealtPosition } from '@bored-games/game-kit';

/** What `ShareStore.add` did: kept a new share, or nothing (one is already kept for that seat and position). */
export type AddResult = 'new' | 'none';

/**
 * Verified decryption shares, at most one per (seat, position): the first valid share is kept, so a seat that
 * publishes the same position twice (fresh proof randomness, same `D`) is counted once (PROTOCOL §5.4, D025).
 * Callers verify a share before adding it. The key is the position number, including a later epoch's
 * `128 * k + i`. Those numbers are never reused, so two epochs cannot alias one slot.
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

/**
 * Every position `dealt` assigns to a seat other than `seat`, or to nobody (public), ascending and unique, except a
 * sealed position whose first holder is `seat` (`sealedPositions`): that seat seals its share instead (D066).
 */
export function owedPositions(dealt: readonly DealtPosition[], seat: number): number[] {
  const sealed = sealedPositions(dealt);
  const out = new Set<number>();
  for (const d of dealt) if (d.to !== seat && sealed.get(d.pos) !== seat) out.add(d.pos);
  return [...out].sort((a, b) => a - b);
}

/**
 * The re-dealt private positions (D066, PROTOCOL §6.1): a position first dealt privately to one seat, then dealt
 * privately to another, and never to the public. Every other seat published its share when the first holder got the
 * card, so only the first holder's share is not public; it seals that share to each later holder (`sealedOwed`)
 * and never publishes it while the card stays private. Maps each such position to its first holder.
 */
export function sealedPositions(dealt: readonly DealtPosition[]): Map<number, number> {
  const first = new Map<number, number | null>();
  const shown = new Set<number>();
  const redealt = new Set<number>();
  for (const d of dealt) {
    if (!first.has(d.pos)) first.set(d.pos, d.to);
    else if (d.to !== null && d.to !== first.get(d.pos)) redealt.add(d.pos);
    if (d.to === null) shown.add(d.pos);
  }
  const out = new Map<number, number>();
  for (const pos of redealt) {
    const holder = first.get(pos);
    if (holder !== null && holder !== undefined && !shown.has(pos)) out.set(pos, holder);
  }
  return out;
}

/** The sealed shares `seat` owes (D066): for each sealed position it first held, one to every later holder. */
export function sealedOwed(dealt: readonly DealtPosition[], seat: number): { pos: number; to: number }[] {
  const sealed = sealedPositions(dealt);
  const out = new Map<string, { pos: number; to: number }>();
  for (const d of dealt) {
    if (d.to === null || d.to === seat || sealed.get(d.pos) !== seat) continue;
    out.set(`${d.pos}:${d.to}`, { pos: d.pos, to: d.to });
  }
  return [...out.values()].sort((a, b) => a.pos - b.pos || a.to - b.to);
}
