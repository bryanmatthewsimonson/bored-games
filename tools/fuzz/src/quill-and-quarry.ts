import type { FuzzPolicy } from '@bored-games/game-kit';
import { evaluate, type Placement, type State, TILES } from '@bored-games/quill-and-quarry';
/** Geometry/transport policy; vocabulary decisions are explicitly table-adjudicated, as in the live game. */
export const QUILL_POLICIES: readonly FuzzPolicy<State>[] = [
  {
    name: 'word-builder',
    choose(s, seat, legal, rng) {
      if (s.phase === 'review') return { type: rng.int(4) === 0 ? 'challenge' : 'accept', actor: seat };
      if (s.phase === 'judge') return { type: 'judge', actor: seat, valid: rng.int(2) === 0 };
      if (s.phase !== 'turn' || s.scoreless >= 6) return rng.pick(legal);
      const hand = s.hands[seat] ?? [];
      if (s.bag.length >= 7 && rng.int(8) === 0)
        return {
          type: 'exchange',
          actor: seat,
          positions: hand
            .slice(0, 1 + rng.int(hand.length))
            .map((h) => h.pos)
            .sort((a, b) => a - b),
        };
      if (rng.int(6) === 0) return { type: 'pass', actor: seat };
      const starts = Array.from({ length: 225 }, (_, i) => i);
      if (s.board.every((t) => t === null)) starts.unshift(112);
      for (const cell of starts)
        for (const step of [1, 15]) {
          const tiles: Placement[] = [];
          for (let n = 0; n < hand.length; n++) {
            const slot = hand[n],
              target = cell + n * step;
            if (
              !slot ||
              slot.card === null ||
              target > 224 ||
              (step === 1 && Math.floor(target / 15) !== Math.floor(cell / 15)) ||
              s.board[target]
            )
              break;
            tiles.push({
              cell: target,
              pos: slot.pos,
              card: slot.card,
              letter: TILES[slot.card]?.letter || 'A',
            });
            if (evaluate(s, seat, tiles).ok) return { type: 'place', actor: seat, tiles };
          }
        }
      return { type: 'pass', actor: seat };
    },
  },
];
