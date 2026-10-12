/**
 * The share position of roll `id`. Card positions precede roll slots; deckless legacy games keep their original
 * roll positions and domain. In a game that also reshuffles in play (`stride`, D073), epoch k's cards sit at
 * `stride·k + i` with `i < deckSize`, so rolls take only the slots no card can: `deckSize … stride − 1` of each block
 * (D087). The first `stride − deckSize` rolls keep the positions they would have without a stride.
 */
export function beaconPosition(deckSize: number, id: number, stride: number | null = null): number {
  if (
    !Number.isSafeInteger(deckSize) ||
    deckSize < 0 ||
    !Number.isSafeInteger(id) ||
    id < 0 ||
    !Number.isSafeInteger(deckSize + id) ||
    (stride !== null && (!Number.isSafeInteger(stride) || stride <= deckSize))
  )
    throw new Error('Invalid beacon position.');
  if (stride === null) return deckSize + id;
  const free = stride - deckSize;
  const pos = stride * Math.floor(id / free) + deckSize + (id % free);
  if (!Number.isSafeInteger(pos)) throw new Error('Invalid beacon position.');
  return pos;
}

/**
 * The reshuffle (epoch k ≥ 1) whose card slot `pos` is, or null: epoch k's cards sit at `stride·k + i`, `i` below the
 * opening deck size (D073). Slots past that, in each block, hold no card (in a game with dice they are rolls', D087).
 */
export function epochSlot(pos: number, deckSize: number, stride: number): number | null {
  if (!Number.isSafeInteger(pos) || pos < deckSize || pos < stride) return null;
  return pos % stride < deckSize ? Math.floor(pos / stride) : null;
}

/** Whether a share at `pos` is a roll's, not a card's: see `beaconPosition`. */
export function isRollPosition(pos: number, deckSize: number, stride: number | null = null): boolean {
  if (!Number.isSafeInteger(pos) || pos < 0) return false;
  return stride === null ? pos >= deckSize : pos % stride >= deckSize;
}
export function beaconDomain(root: string, request: string | null): string {
  return request === null ? root : `${root}:${request}`;
}
/** Find the move that appended this roll in the canonical history, including trial histories. */
export function rollOrigin<S>(
  id: number,
  history: readonly { readonly id: string; readonly before: S | null; readonly after: S | null }[],
  rolls: (s: S) => readonly { readonly id: number }[],
): string | null {
  for (const step of history) {
    if (step.before === null || step.after === null) continue;
    if (!rolls(step.before).some((r) => r.id === id) && rolls(step.after).some((r) => r.id === id))
      return step.id;
  }
  return null;
}
