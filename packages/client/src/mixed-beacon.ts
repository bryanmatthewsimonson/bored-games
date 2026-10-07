/** Card positions precede roll slots. Deckless legacy games keep their original roll positions/domain. */
export function beaconPosition(deckSize: number, id: number): number {
  if (
    !Number.isSafeInteger(deckSize) ||
    deckSize < 0 ||
    !Number.isSafeInteger(id) ||
    id < 0 ||
    !Number.isSafeInteger(deckSize + id)
  )
    throw new Error('Invalid beacon position.');
  return deckSize + id;
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
