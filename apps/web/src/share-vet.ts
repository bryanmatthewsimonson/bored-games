/*
 * Vetting a saved Shares event before it is published (D056 applied to Luster's prompt shares, audit-luster F3).
 * Pure. A Shares event carries no head (PROTOCOL §4.5), so one built on a branch that later lost fork choice still
 * verifies on the winning branch: its position may be undrawn there, or drawn by this very seat as a private card,
 * and publishing it then would hand out this seat's own layer. The owner never releases its own private layer.
 */
import { sealedOwed, sealedPositions } from '@bored-games/client';
import { type NostrEvent, parseSealed, parseShares } from '@bored-games/protocol';

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

/**
 * Why a saved Shares event would reveal a private card of this seat's, or null when it would not: a position dealt
 * to this seat whose latest assignment is still private (a card it holds, or a card it first held and passed on,
 * D066). A position later dealt to the public (a card shown at the end) is shared by everyone, its holders too.
 */
export function ownCardReason(
  positions: readonly number[],
  mySeat: number | null,
  dealt: readonly DealtLike[],
) {
  if (mySeat === null) return null;
  const latest = new Map<number, number | null>();
  for (const d of dealt) latest.set(d.pos, d.to);
  const mine = new Set(dealt.filter((d) => d.to === mySeat && latest.get(d.pos) !== null).map((d) => d.pos));
  return positions.some((pos) => mine.has(pos)) ? 'it would reveal your own private card' : null;
}

/** The (position, recipient) pairs a Sealed event carries, or null when it is not a well-formed Sealed event. */
export function sealedItems(ev: NostrEvent): { pos: number; to: number }[] | null {
  try {
    return parseSealed(ev).sealed.map((x) => ({ pos: x.pos, to: x.to }));
  } catch {
    return null;
  }
}

export interface SealVetInput {
  items: readonly { pos: number; to: number }[];
  mySeat: number | null;
  dealt: readonly (DealtLike & { deck?: string })[];
  /** The sealed shares this seat owes now (the session's `seal` duty), or null once the event is folded in. */
  owed: readonly { pos: number; to: number }[] | null;
  /** Whether the relays sent another Sealed event of this seat carrying that pair (another device's). */
  sentElsewhere: (pos: number, to: number) => boolean;
}

/**
 * `send`, or why a saved Sealed event must be discarded (D066, as `shareVerdict`): on the current head each pair
 * must be a re-dealt position this seat first held, dealt to that recipient, and still owed.
 */
export function sealVerdict(input: SealVetInput): 'send' | string {
  const { items, mySeat } = input;
  if (items.length === 0 || mySeat === null) return 'it carries no card';
  const dealt = input.dealt.map((d) => ({ deck: d.deck ?? '', pos: d.pos, to: d.to }));
  const first = sealedPositions(dealt);
  for (const { pos, to } of items) {
    if (first.get(pos) !== mySeat) return 'the game went another way, and that card is not yours to pass on';
    if (!dealt.some((d) => d.pos === pos && d.to === to))
      return 'the game went another way, and that card went elsewhere';
  }
  if (input.owed !== null) {
    const owed = new Set(input.owed.map((x) => `${x.pos}>${x.to}`));
    if (items.some((x) => !owed.has(`${x.pos}>${x.to}`))) return 'that sealed share is no longer owed';
  } else if (items.some((x) => input.sentElsewhere(x.pos, x.to))) {
    return 'another device of yours already sent that sealed share';
  }
  // sealedOwed is the session's own rule; the same pairs must be owed on this head whether or not it was sent.
  const due = new Set(sealedOwed(dealt, mySeat).map((x) => `${x.pos}>${x.to}`));
  return items.every((x) => due.has(`${x.pos}>${x.to}`)) ? 'send' : 'that sealed share is no longer owed';
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
  if (positions.some((pos) => !drawn.has(pos)))
    return 'the game went another way, and that card is not drawn';
  if (input.owed !== null) {
    const owed = new Set(input.owed);
    if (positions.some((pos) => !owed.has(pos))) return 'that card reveal is no longer owed';
  } else if (positions.some((pos) => input.sentElsewhere(pos))) {
    return 'another device of yours already sent that card reveal';
  }
  return 'send';
}
