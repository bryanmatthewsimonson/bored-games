import { initialDeck, jointKey, proveShuffle, shuffleDeck } from '@bored-games/deck';
import { canonicalJson } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type MoveContent,
  moveTemplate,
  type NostrEvent,
  parseMove,
  parseRoot,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClientError } from '../src/errors.ts';
import type { GameSession } from '../src/session.ts';
import type { Identity } from '../src/types.ts';
import { deliver, makeGame, NOW, newSession, statuses, T0 } from './helpers.ts';

const DECK = 108;
const game = makeGame(3, 'client-shuffle');
const contentOf = (ev: NostrEvent): MoveContent => parseMove(ev, DECK).content;

/** `content` as move `seq` after `prevId`, signed by `seat`'s session key. */
function move(
  seat: number,
  seq: number,
  prevId: string,
  content: MoveContent,
  rootId = game.rootId,
): NostrEvent {
  const t = moveTemplate({ rootId, prevId, seq, content }, T0 + 500);
  return finalizeEvent(t, game.ids[seat]?.sessionSk as Uint8Array, game.rnd);
}

describe('shuffle phase', () => {
  let players: GameSession[];
  let spectator: GameSession;
  let steps: NostrEvent[];

  beforeAll(() => {
    players = [0, 1, 2].map((seat) => newSession(game, seat));
    spectator = newSession(game, null);
  });

  it('each seat shuffles in turn; every session and a spectator accept every step', () => {
    const all = [...players, spectator];
    for (const s of all) expect(s.view().phase).toBe('shuffle');
    expect(players.map((s) => s.duties())).toEqual([[{ kind: 'shuffle' }], [], []]);
    expect(spectator.duties()).toEqual([]);

    steps = [];
    for (const [k, s] of players.entries()) {
      expect(s.duties()).toEqual([{ kind: 'shuffle' }]);
      const ev = s.buildShuffle(game.rnd, T0 + 100 + k);
      expect(statuses(deliver(all, [ev]))).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
      steps.push(ev);
    }

    for (const s of all) {
      const v = s.view();
      expect(v.phase).toBe('deal');
      expect(v.head).toEqual({ id: steps[2]?.id, seq: 3 });
      expect(v.pendingSince).toBe(T0 + 102);
      expect(v.state).not.toBeNull();
    }
    expect(new Set(all.map((s) => s.view().logHash)).size).toBe(1);
    expect(() => players[0]?.buildShuffle(game.rnd, T0 + 200)).toThrow(ClientError);
  });

  it('steps delivered in reverse order are stored, then accepted', () => {
    const late = newSession(game, null);
    const results = deliver([late], steps, [2, 1, 0]);
    expect(statuses(results)).toEqual(['stored', 'stored', 'accepted']);
    expect(late.view().phase).toBe('deal');
    expect(late.view().head).toEqual(spectator.view().head);
    expect(statuses(deliver([late], steps))).toEqual(['duplicate', 'duplicate', 'duplicate']);
  });

  it('rejects a step signed by the wrong seat', () => {
    const fresh = newSession(game, null);
    const forged = move(1, 1, game.rootId, contentOf(steps[0] as NostrEvent));
    const r = fresh.receive(forged, NOW);
    expect(r).toEqual({ status: 'rejected', reason: 'shuffle step 1 must be signed by seat 0' });
    expect(fresh.view().head.seq).toBe(0);
  });

  it('rejects a step whose proof was made against another input deck', () => {
    const fresh = newSession(game, null);
    expect(statuses(deliver([fresh], [steps[0]]))).toEqual(['accepted']);
    // Seat 1 shuffles the initial deck instead of seat 0's output, with an honest proof of that shuffle.
    const X = jointKey(parseRoot(game.root).seats.map((s) => s.deckKey));
    const input = initialDeck('tiles', DECK);
    const { out, psi, rPrime } = shuffleDeck(input, X, game.rnd);
    const proof = proveShuffle(
      input,
      out,
      X,
      psi,
      rPrime,
      { rootId: game.rootId, seat: 1, deckId: 'tiles' },
      game.rnd,
    );
    const bad = move(1, 2, steps[0]?.id as string, { type: 'shuffle', deck: out, proof });
    const r = fresh.receive(bad, NOW);
    expect(r).toEqual({ status: 'rejected', reason: 'the shuffle proof does not verify' });
    // Seat 1's honest step on the same prev is not equivocation: the bad step is invalid as of that prev, so it
    // never counts (D030 R2, Ruling 3). The honest step links and the shuffle goes on.
    expect(statuses(deliver([fresh], [steps[1], steps[2]]))).toEqual(['accepted', 'accepted']);
    expect(fresh.view().forfeits).toEqual([]);
    expect(fresh.view().phase).toBe('deal');
    expect(fresh.view().head).toEqual(spectator.view().head);
    // The bad step again, now that its prev has a successor, changes nothing.
    expect(fresh.receive(bad, NOW).status).toBe('rejected');
    expect(fresh.view().forfeits).toEqual([]);
  });

  it('flags a seat that publishes two valid shuffle steps on one prev; the shuffle goes on, in either order', () => {
    // Seat 1 shuffles twice from the same head: both steps verify against seat 0's deck.
    const seat1 = newSession(game, 1);
    expect(statuses(deliver([seat1], [steps[0]]))).toEqual(['accepted']);
    const a = seat1.buildShuffle(game.rnd, T0 + 300);
    const b = seat1.buildShuffle(game.rnd, T0 + 301);
    const lo = a.id < b.id ? a : b;
    let next: NostrEvent | undefined;
    const views = [
      [a, b],
      [b, a],
    ].map((pair) => {
      const s = newSession(game, 2);
      expect(statuses(deliver([s], [steps[0], ...pair]))).toEqual(['accepted', 'accepted', 'accepted']);
      const v = s.view();
      expect(v.phase).toBe('shuffle');
      expect(v.equivocators).toEqual([1]);
      expect(v.head).toEqual({ id: lo.id, seq: 2 });
      // Seat 2 shuffles on the canonical head, the lower id; built once and fed to both sessions.
      expect(s.duties()).toEqual([{ kind: 'shuffle' }]);
      next ??= s.buildShuffle(game.rnd, T0 + 302);
      expect(s.receive(next, NOW)).toEqual({ status: 'accepted' });
      expect(s.view().phase).toBe('deal');
      expect(statuses(deliver([s], pair))).toEqual(['duplicate', 'duplicate']);
      return canonicalJson(s.view());
    });
    expect(views[0]).toBe(views[1]);
  });

  it('reports a duplicate', () => {
    expect(players[0]?.receive(steps[0], T0 + 1000)).toEqual({ status: 'duplicate' });
  });

  it('rejects an event for another root', () => {
    const fresh = newSession(game, null);
    const other = 'ab'.repeat(32);
    const ev = move(0, 1, other, contentOf(steps[0] as NostrEvent), other);
    expect(fresh.receive(ev, T0 + 1000)).toEqual({
      status: 'rejected',
      reason: 'the event is for another game',
    });
  });

  it('rejects a bad signature', () => {
    const fresh = newSession(game, null);
    const ev = steps[0] as NostrEvent;
    const sig = (ev.sig[0] === '0' ? '1' : '0') + ev.sig.slice(1);
    const r = fresh.receive({ ...ev, sig }, T0 + 1000);
    expect(r.status).toBe('rejected');
    expect(fresh.view().head.seq).toBe(0);
  });

  it('rejects a move signed by a key that holds no seat', () => {
    const fresh = newSession(game, null);
    const t = moveTemplate(
      { rootId: game.rootId, prevId: game.rootId, seq: 1, content: contentOf(steps[0] as NostrEvent) },
      T0 + 500,
    );
    const ev = finalizeEvent(t, game.npubSks[0] as Uint8Array, game.rnd);
    expect(fresh.receive(ev, T0 + 1000)).toEqual({
      status: 'rejected',
      reason: 'not signed by a seated session key',
    });
  });
});

describe('session creation', () => {
  it('throws ClientError for a tampered root', () => {
    // Re-signed by the creator, but seat 1's session key no longer matches its Join.
    const content = JSON.parse(game.root.content) as { rules: unknown; seats: { session: string }[] };
    const seats = content.seats.map((s, i) => (i === 1 ? { ...s, session: 'cd'.repeat(32) } : s));
    const tampered = finalizeEvent(
      {
        kind: game.root.kind,
        created_at: game.root.created_at,
        tags: game.root.tags,
        content: canonicalJson({ rules: content.rules, seats }),
      },
      game.npubSks[0] as Uint8Array,
      game.rnd,
    );
    expect(() => newSession({ ...game, root: tampered }, null)).toThrow(ClientError);
    // An edit without re-signing does not parse at all.
    expect(() => newSession({ ...game, root: { ...game.root, created_at: T0 + 11 } }, null)).toThrow(
      ClientError,
    );
    expect(() => newSession(game, null)).not.toThrow();
  });

  it('throws ClientError when the identity does not hold its seat', () => {
    const seat0 = game.ids[0] as Identity;
    expect(() => newSession({ ...game, ids: [{ ...seat0, seat: 1 }] }, 0)).toThrow(ClientError);
    expect(() => newSession({ ...game, ids: [{ ...seat0, deckSecret: seat0.deckSecret + 1n }] }, 0)).toThrow(
      ClientError,
    );
    expect(() => newSession({ ...game, ids: [{ ...seat0, seat: 5 }] }, 0)).toThrow(ClientError);
  });
});
