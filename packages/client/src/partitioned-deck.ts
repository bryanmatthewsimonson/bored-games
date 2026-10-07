import { type DeckSpec, range } from '@bored-games/game-kit';
import { type ParsedMove, parseMove } from '@bored-games/protocol';
import { ClientError } from './errors.ts';

export interface DeckPartition {
  readonly id: string;
  readonly offset: number;
  readonly size: number;
}

/**
 * The positions one shuffle step permutes, in ascending order, and the step's proof domain `id`: `<deck id>` for a
 * deck without partitions, else `<deck id>/<group id>` (PROTOCOL §5.5).
 */
export interface ShuffleGroup {
  readonly id: string;
  readonly positions: readonly number[];
}

/** One step of the shuffle: the seat that signs it, which round it belongs to and the group it shuffles. */
export interface ShuffleStep {
  readonly seat: number;
  readonly round: 1 | 2;
  readonly group: ShuffleGroup;
}

/** One group for legacy decks; optional groups use independent, domain-separated shuffle proofs. */
export function deckPartitions(deck: DeckSpec | null): readonly DeckPartition[] {
  if (deck === null) return [];
  if (deck.partitions === undefined) return [{ id: deck.id, offset: 0, size: deck.size }];
  const groups = deck.partitions;
  if (
    !Array.isArray(groups) ||
    groups.length === 0 ||
    groups.length > 16 ||
    new Set(groups.map((g) => g.id)).size !== groups.length ||
    groups.some(
      (g) => typeof g.id !== 'string' || g.id.length === 0 || !Number.isSafeInteger(g.size) || g.size <= 0,
    ) ||
    groups.reduce((n, g) => n + g.size, 0) !== deck.size
  )
    throw new ClientError('invalid deck partitions');
  let offset = 0;
  return groups.map((g) => {
    const partition = { id: `${deck.id}/${g.id}`, offset, size: g.size };
    offset += g.size;
    return partition;
  });
}

/**
 * The second round's groups in list order (D076, PROTOCOL §5.5), each with the domain `<deck id>/<group id>`; none
 * when the deck has no second round. Throws `ClientError` unless the list holds 1 to 16 groups with non-empty ids,
 * distinct from each other and from every partition id, and each group's positions are at least 2 safe integers in
 * `[0, size)`, strictly ascending, shared with no other group.
 */
function secondRoundGroups(deck: DeckSpec): readonly ShuffleGroup[] {
  const groups: unknown = deck.secondRound;
  if (groups === undefined) return [];
  const invalid = () => new ClientError('invalid deck second round');
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > 16) throw invalid();
  const partitionIds = new Set((deck.partitions ?? []).map((g) => g.id));
  const ids = new Set<unknown>();
  const taken = new Set<number>();
  return groups.map((g: unknown) => {
    const { id, positions } = (g ?? {}) as { id?: unknown; positions?: unknown };
    if (typeof id !== 'string' || id.length === 0 || ids.has(id) || partitionIds.has(id)) throw invalid();
    ids.add(id);
    if (!Array.isArray(positions) || positions.length < 2) throw invalid();
    let previous = -1;
    for (const p of positions as unknown[]) {
      // Ascending from -1 also keeps every position non-negative; the deck size is the upper bound.
      if (
        typeof p !== 'number' ||
        !Number.isSafeInteger(p) ||
        p <= previous ||
        p >= deck.size ||
        taken.has(p)
      )
        throw invalid();
      taken.add(p);
      previous = p;
    }
    return { id: `${deck.id}/${id}`, positions: [...(positions as number[])] };
  });
}

/**
 * Who signs each shuffle step and what it shuffles (PROTOCOL §5.5, D076). Round 1 is every seat shuffling each
 * first-round group in list order (the partitions, or the whole deck as one group), seat after seat. Round 2 is the
 * same over the second-round groups. So with G1 first-round groups, G2 second-round groups and S seats there are
 * (G1 + G2) · S steps, and step `s` past the first G1 · S has t = s − G1 · S, seat `floor(t / G2)` and group
 * `t mod G2`. A deckless game (`null`), or a seat count that is not a positive integer, has no steps. Throws
 * `ClientError` for an invalid partition list or second round.
 */
export function shuffleSchedule(deck: DeckSpec | null, seats: number): readonly ShuffleStep[] {
  if (deck === null) return [];
  const first: ShuffleGroup[] = deckPartitions(deck).map((g) => ({
    id: g.id,
    positions: range(g.size).map((n) => g.offset + n),
  }));
  const second = secondRoundGroups(deck);
  const steps: ShuffleStep[] = [];
  if (!Number.isSafeInteger(seats) || seats <= 0) return steps;
  for (const [round, groups] of [
    [1, first],
    [2, second],
  ] as const) {
    for (let seat = 0; seat < seats; seat++) for (const group of groups) steps.push({ seat, round, group });
  }
  return steps;
}

/**
 * The wire format is unchanged: each shuffle step carries the active group's deck and proof, so a Move parses with
 * the deck's size or the size of any scheduled group, whichever fits.
 */
export function parsePartitionMove(ev: unknown, size: number, schedule: readonly ShuffleStep[]): ParsedMove {
  let error: unknown;
  for (const n of new Set([Math.max(1, size), ...schedule.map((s) => s.group.positions.length)])) {
    try {
      return parseMove(ev, n);
    } catch (e) {
      error = e;
    }
  }
  throw error;
}
