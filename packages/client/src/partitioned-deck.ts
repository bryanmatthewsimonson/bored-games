import type { DeckSpec } from '@bored-games/game-kit';
import { type ParsedMove, parseMove } from '@bored-games/protocol';
import { ClientError } from './errors.ts';

export interface DeckPartition {
  readonly id: string;
  readonly offset: number;
  readonly size: number;
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

/** The wire format is unchanged: each shuffle step carries the active group's deck and proof. */
export function parsePartitionMove(ev: unknown, size: number, groups: readonly DeckPartition[]): ParsedMove {
  let error: unknown;
  for (const n of new Set([Math.max(1, size), ...groups.map((g) => g.size)])) {
    try {
      return parseMove(ev, n);
    } catch (e) {
      error = e;
    }
  }
  throw error;
}

/**
 * The seat that signs shuffle step `step` (0-based): each seat shuffles every group in turn, so `groups.length`
 * steps per seat. `null` when there is no group (a deckless game, which has no shuffle steps) or the step is not
 * a non-negative integer, so a caller can never divide by zero or index with NaN.
 */
export function shuffleStepSeat(step: number, groups: readonly DeckPartition[]): number | null {
  if (groups.length === 0 || !Number.isSafeInteger(step) || step < 0) return null;
  return Math.floor(step / groups.length);
}

/** The group shuffled at step `step` (0-based), or `null` under the same conditions as `shuffleStepSeat`. */
export function shuffleStepGroup(step: number, groups: readonly DeckPartition[]): DeckPartition | null {
  if (groups.length === 0 || !Number.isSafeInteger(step) || step < 0) return null;
  return groups[step % groups.length] ?? null;
}
