import type { ChainReactionState } from '@bored-games/chain-reaction';
import { type Ciphertext, cardOf, cardTable, decryptWithSecrets } from '@bored-games/deck';
import { canonicalJson } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type NostrEvent,
  parseMove,
  parseShares,
  sharesTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClientError } from '../src/errors.ts';
import type { GameSession } from '../src/session.ts';
import type { SessionView } from '../src/types.ts';
import { deliver, makeGame, newSession, playShuffle, statuses, T0 } from './helpers.ts';

const SEATS = 3;
const HAND = 6;
const game = makeGame(SEATS, 'client-deal');

const stateOf = (s: GameSession): ChainReactionState => s.view().state as ChainReactionState;
const tilesOf = (s: GameSession, seat: number): (number | null)[] =>
  stateOf(s).players[seat]?.hand.map((h) => h.tile) ?? [];
const handPositions = (seat: number): number[] =>
  Array.from({ length: HAND }, (_, i) => SEATS + seat * HAND + i);

/** Every permutation of `xs`. */
function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('deal round', () => {
  let players: GameSession[];
  let spectator: GameSession;
  let steps: NostrEvent[];
  let deals: NostrEvent[];
  /** The audit truth: every position decrypted with all the deck secrets. */
  let truth: number[];

  beforeAll(() => {
    players = [0, 1, 2].map((seat) => newSession(game, seat));
    spectator = newSession(game, null);
    steps = playShuffle(game, players, [spectator]);
    const finalDeck = parseMove(steps[SEATS - 1], 108).content as { deck: Ciphertext[] };
    const table = cardTable('tiles', 108);
    const secrets = game.ids.map((id) => id.deckSecret);
    truth = finalDeck.deck.map((ct) => cardOf(table, decryptWithSecrets(ct, secrets)) as number);
  });

  it('owes one deal per seat; after all three, the setup tiles are public and each seat knows its hand', () => {
    const all = [...players, spectator];
    for (const s of all) expect(s.view().phase).toBe('deal');
    expect(players.map((s) => s.duties())).toEqual([
      [{ kind: 'deal' }],
      [{ kind: 'deal' }],
      [{ kind: 'deal' }],
    ]);
    expect(spectator.duties()).toEqual([]);
    expect(() => spectator.buildDeal(game.rnd, T0 + 200)).toThrow(ClientError);

    deals = players.map((s, k) => s.buildDeal(game.rnd, T0 + 200 + k));
    // Each covers the setup tiles and the other seats' hands, sorted by position.
    for (const [k, ev] of deals.entries()) {
      const owed = [0, 1, 2, ...[0, 1, 2].filter((j) => j !== k).flatMap(handPositions)].sort(
        (a, b) => a - b,
      );
      expect(parseShares(ev).shares.map((s) => s.pos)).toEqual(owed);
    }

    expect(statuses(deliver(all, [deals[0]]))).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    expect(players.map((s) => s.duties())).toEqual([[], [{ kind: 'deal' }], [{ kind: 'deal' }]]);
    expect(() => players[0]?.buildDeal(game.rnd, T0 + 300)).toThrow(ClientError);
    expect(statuses(deliver(all, deals.slice(1)))).toEqual(Array(8).fill('accepted'));

    for (const s of all) {
      const v = s.view();
      expect(v.phase).toBe('play');
      expect(v.pendingSince).toBe(T0 + 202);
      expect(stateOf(s).setupTiles).toEqual(truth.slice(0, SEATS));
      expect(v.pending.type).toBe('player');
      expect(s.duties()).toEqual([]);
    }
    expect(new Set(all.map((s) => canonicalJson(s.view().pending))).size).toBe(1);
    for (const [seat, s] of players.entries()) {
      for (let k = 0; k < SEATS; k++) {
        const want = k === seat ? handPositions(k).map((pos) => truth[pos]) : Array(HAND).fill(null);
        expect(tilesOf(s, k)).toEqual(want);
      }
    }
  });

  it('shows the spectator the board but no hands', () => {
    const state = stateOf(spectator);
    expect(state.viewer).toBeNull();
    expect(state.setupTiles).toEqual(truth.slice(0, SEATS));
    for (const tile of truth.slice(0, SEATS)) expect(state.board[tile]).not.toBeNull();
    for (let k = 0; k < SEATS; k++) expect(tilesOf(spectator, k)).toEqual(Array(HAND).fill(null));
    // A player's board matches the spectator's.
    expect(stateOf(players[1] as GameSession).board).toEqual(state.board);
  });

  it('rejects a deal event with one bad share, and treats a repeat of known shares as a duplicate', () => {
    const parsed = parseShares(deals[0]);
    // Seat 0's deal with position 0's share replaced by its share of position 1.
    const shares = parsed.shares.map((s) =>
      s.pos === 0 ? { pos: 0, share: (parsed.shares[1] as (typeof parsed.shares)[0]).share } : s,
    );
    const bad = finalizeEvent(
      sharesTemplate({ rootId: game.rootId, shares }, T0 + 400),
      game.ids[0]?.sessionSk as Uint8Array,
      game.rnd,
    );
    expect(spectator.receive(bad, T0 + 1000)).toEqual({
      status: 'rejected',
      reason: 'the share for position 0 does not verify',
    });
    // Valid shares already held, re-sent in a new event, add nothing.
    const again = finalizeEvent(
      sharesTemplate({ rootId: game.rootId, shares: parsed.shares.slice(0, 2) }, T0 + 400),
      game.ids[0]?.sessionSk as Uint8Array,
      game.rnd,
    );
    expect(spectator.receive(again, T0 + 1000)).toEqual({ status: 'duplicate' });
    expect(spectator.view().pendingSince).toBe(T0 + 202);
  });

  it('reaches identical views whatever order the shuffle and deal events arrive in', () => {
    const viewers: (number | null)[] = [null, 0, 1, 2, null, 1];
    const reference = new Map<number | null, SessionView>([
      [null, spectator.view()],
      ...players.map((s, k): [number, SessionView] => [k, s.view()]),
    ]);
    for (const [i, perm] of permutations([0, 1, 2]).entries()) {
      const viewer = viewers[i] as number | null;
      const s = newSession(game, viewer);
      const dealOrder = perm.map((k) => deals[k] as NostrEvent);
      // Half the runs deliver the deals before the shuffle steps (reversed), so the shares wait for the final deck.
      const events = i % 2 === 0 ? [...steps, ...dealOrder] : [...dealOrder, ...[...steps].reverse()];
      const results = statuses(deliver([s], events));
      expect(results.filter((r) => r === 'rejected')).toEqual([]);
      expect(canonicalJson(s.view())).toBe(canonicalJson(reference.get(viewer)));
    }
  });
});
