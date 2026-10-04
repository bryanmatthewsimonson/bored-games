/*
 * Vetting a saved Shares event before it is published (D056 applied to Luster's prompt shares, audit-luster F3).
 * Pure. A Shares event carries no head (PROTOCOL §4.5), so one built on a branch that later lost fork choice still
 * verifies on the winning branch: its position may be undrawn there, or drawn by this very seat as a private card,
 * and publishing it then would hand out this seat's own layer. The owner never releases its own private layer.
 */
import { type NostrEvent, parseShares } from '@bored-games/protocol';

/** The positions a Shares event carries, ascending, or null when it is not a well-formed Shares event. */
export function sharePositions(ev: NostrEvent): number[] | null {
  try {
    return parseShares(ev).shares.map((s) => s.pos);
  } catch {
    return null;
  }
}

/** One deck position as the module deals it (`GameModule.dealt`): its owner, or null for a public card. */
export interface DealtLike {
  readonly pos: number;
  readonly to: number | null;
}

export interface ShareVetInput {
  /** The positions the saved event carries. */
  positions: readonly number[];
  /** This client's seat. */
  mySeat: number | null;
  /** Every position dealt on the current head (`GameModule.dealt` of the head's state). */
  dealt: readonly DealtLike[];
  /**
   * The positions this seat owes now (the session's `share` duty), when the event is not folded into the session
   * yet; null when it is (the session then holds it, so the duty no longer lists its positions).
   */
  owed: readonly number[] | null;
  /** Whether the relays sent another Shares event of this seat carrying `pos` (another device's). */
  sentElsewhere: (pos: number) => boolean;
}

/** Why a saved Shares event would reveal this seat's own private card, or null when it would not. */
export function ownCardReason(positions: readonly number[], mySeat: number | null, dealt: readonly DealtLike[]) {
  if (mySeat === null) return null;
  const mine = new Set(dealt.filter((d) => d.to === mySeat).map((d) => d.pos));
  return positions.some((pos) => mine.has(pos)) ? 'it would reveal your own private card' : null;
}

/**
 * `send`, or why the saved Shares event must be discarded: it would reveal this seat's own private card; it names a
 * card not drawn on the current head (the game went another way); or a position is no longer owed by this seat
 * (another device sent it, or it is not needed any more).
 */
export function shareVerdict(input: ShareVetInput): 'send' | string {
  const { positions, mySeat, dealt } = input;
  if (positions.length === 0) return 'it carries no card';
  const own = ownCardReason(positions, mySeat, dealt);
  if (own !== null) return own;
  const drawn = new Set(dealt.map((d) => d.pos));
  if (positions.some((pos) => !drawn.has(pos))) return 'the game went another way, and that card is not drawn';
  if (input.owed !== null) {
    const owed = new Set(input.owed);
    if (positions.some((pos) => !owed.has(pos))) return 'that card reveal is no longer owed';
  } else if (positions.some((pos) => input.sentElsewhere(pos))) {
    return 'another device of yours already sent that card reveal';
  }
  return 'send';
}
