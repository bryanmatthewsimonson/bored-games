import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { canonicalJson, createRng, type Rng, shuffle, stateHash } from '@bored-games/game-kit';
import {
  attestTemplate,
  finalizeEvent,
  type MoveContent,
  moveTemplate,
  type NostrEvent,
  parseMove,
  secretTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { rankWithForfeits } from '../src/audit.ts';
import { ClientError } from '../src/errors.ts';
import { GameSession } from '../src/session.ts';
import type { Identity, SessionView } from '../src/types.ts';
import { forgeAction, lenientSkips } from './cheat.ts';
import { deliver, makeGame, newSession, playShuffle, statuses, T0, type TestGame } from './helpers.ts';

const SEATS = 3;
const DECK = 108;
const NOW = T0 + 1_000_000;
/** A full game to the end takes a minute or two; replaying one takes seconds. */
const LONG = 600_000;

type Action = { type: string; actor: number; declareEnd?: boolean };

const stateOf = (s: GameSession): ChainReactionState => s.view().state as ChainReactionState;
const publicHash = (s: GameSession): string => stateHash(chainReaction.view(stateOf(s), null));
const actionOf = (ev: NostrEvent): Action =>
  (parseMove(ev, DECK).content as Extract<MoveContent, { type: 'action' }>).action as Action;

/** The uniform fuzz policy, except that it declares the end whenever it may, so games end quickly. */
function choose(legal: readonly unknown[], rng: Rng): unknown {
  return (legal as Action[]).find((a) => a.declareEnd === true) ?? rng.pick(legal);
}

interface Played {
  /** Every event in publication order. */
  log: NostrEvent[];
  moves: NostrEvent[];
  secrets: NostrEvent[];
  attests: NostrEvent[];
  /** Views when the game is over, before any secret; once done, before any attestation. */
  atEnd: SessionView[];
  atDone: SessionView[];
  /** Duties per player at those two points. */
  dutiesAtEnd: unknown[];
  dutiesAtDone: unknown[];
  /** Per move, whether every session agreed on head, pending, logHash and the public state. */
  agreed: boolean[];
}

interface Hooks {
  /** Called once the deal is done, before the first action, with the events so far. May replace players. */
  beforePlay?: (players: GameSession[], log: readonly NostrEvent[]) => void;
  /** A forged move to publish instead of the policy's choice for the `i`-th action, or null. */
  forge?: (i: number, s: GameSession) => NostrEvent | null;
}

/**
 * Play `game` to the end and through its secrets and attestations. `players[k]` is seat k's session; every event
 * goes to `players` and `others`, and must be accepted by all. The last of `others` is the reference for whose
 * turn it is.
 */
function playToEnd(
  game: TestGame,
  players: GameSession[],
  others: readonly GameSession[],
  seed: string,
  hooks: Hooks = {},
): Played {
  let all = [...players, ...others];
  const reference = others[others.length - 1] as GameSession;
  const p: Played = {
    log: [],
    moves: [],
    secrets: [],
    attests: [],
    atEnd: [],
    atDone: [],
    dutiesAtEnd: [],
    dutiesAtDone: [],
    agreed: [],
  };
  const publish = (ev: NostrEvent): void => {
    const results = statuses(deliver(all, [ev]));
    if (results.some((r) => r !== 'accepted'))
      throw new Error(`event ${p.log.length}: ${results.join(', ')}`);
    p.log.push(ev);
  };
  p.log.push(...playShuffle(game, players, others));
  for (const [k, s] of players.entries()) publish(s.buildDeal(game.rnd, T0 + 200 + k));
  if (hooks.beforePlay !== undefined) {
    hooks.beforePlay(players, p.log);
    all = [...players, ...others];
  }

  const rng = createRng(seed);
  let t = T0 + 1000;
  for (let i = 0; reference.view().phase === 'play'; i++) {
    if (i > 2000) throw new Error('the game does not end');
    const pending = reference.view().pending;
    if (pending.type !== 'player') throw new Error(`move ${i}: no player decision is pending`);
    const s = players[pending.seat] as GameSession;
    if (s.duties().length !== 1 || s.duties()[0]?.kind !== 'decide') {
      throw new Error(`move ${i}: seat ${pending.seat} has duties ${JSON.stringify(s.duties())}`);
    }
    const ev = hooks.forge?.(i, s) ?? s.buildAction(choose(s.legalActions(), rng), game.rnd, t++);
    publish(ev);
    p.moves.push(ev);
    const rows = all.map((x) => {
      const v = x.view();
      return canonicalJson({ head: v.head, pending: v.pending, logHash: v.logHash, hash: publicHash(x) });
    });
    p.agreed.push(new Set(rows).size === 1);
  }

  p.atEnd = all.map((s) => s.view());
  p.dutiesAtEnd = players.map((s) => s.duties());
  for (const s of players) {
    const ev = s.buildSecret(game.rnd, t++);
    publish(ev);
    p.secrets.push(ev);
  }
  p.atDone = all.map((s) => s.view());
  p.dutiesAtDone = players.map((s) => s.duties());
  for (const [k, s] of players.entries()) {
    const ev = finalizeEvent(s.attestTemplate(t++), game.npubSks[k] as Uint8Array, game.rnd);
    publish(ev);
    p.attests.push(ev);
  }
  return p;
}

/** `events` with some repeated, in an order shuffled by `seed`. */
function scrambled(events: readonly NostrEvent[], seed: string): NostrEvent[] {
  const rng = createRng(seed);
  const extra = events.filter(() => rng.int(4) === 0);
  return shuffle([...events, ...extra], rng);
}

describe('end of game: an honest game played to the end', () => {
  const game = makeGame(SEATS, 'client-end');
  let players: GameSession[];
  let spectator: GameSession;
  let played: Played;

  beforeAll(() => {
    players = [0, 1, 2].map((seat) => newSession(game, seat));
    spectator = newSession(game, null);
    played = playToEnd(game, players, [spectator], 'client-end-policy');
  }, LONG);

  it('plays three seats to the end with the uniform policy, through merger disposals, all agreeing', () => {
    expect(played.agreed.every(Boolean)).toBe(true);
    const types = played.moves.map((ev) => actionOf(ev).type);
    expect(types).toContain('dispose');
    expect(types[types.length - 1]).toBe('endTurn');
    expect(actionOf(played.moves[played.moves.length - 1] as NostrEvent).declareEnd).toBe(true);
  });

  it('enters the end phase when the module is over: every seat owes its secret, and there is no outcome yet', () => {
    for (const v of played.atEnd) {
      expect(v.phase).toBe('end');
      expect(v.outcome).toBeNull();
      expect(v.audit).toBe('pending');
    }
    expect(played.dutiesAtEnd).toEqual([[{ kind: 'secret' }], [{ kind: 'secret' }], [{ kind: 'secret' }]]);
    expect(spectator.duties()).toEqual([]);
  });

  it('audits once every secret is in: every session passes, with the same outcome and logHash', () => {
    const declared = chainReaction.outcome(stateOf(spectator));
    expect(declared).not.toBeNull();
    for (const v of played.atDone) {
      expect(v.phase).toBe('done');
      expect(v.audit).toBe('pass');
      expect(v.outcome).toEqual(declared);
      expect(v.forfeits).toEqual([]);
      expect(v.equivocators).toEqual([]);
      expect(v.logHash).toBe(played.atDone[0]?.logHash);
      expect(v.attested).toEqual([]);
    }
    expect(played.dutiesAtDone).toEqual([[{ kind: 'attest' }], [{ kind: 'attest' }], [{ kind: 'attest' }]]);
    // The last secret is the game's last progress.
    const last = played.secrets[played.secrets.length - 1] as NostrEvent;
    expect(spectator.view().pendingSince).toBe(last.created_at);
  });

  it('accepts every seat attestation, signed by its npub; then nothing is due', () => {
    for (const s of [...players, spectator]) {
      expect(s.view().attested).toEqual([0, 1, 2]);
      expect(s.duties()).toEqual([]);
    }
    expect(() => players[0]?.attestTemplate(NOW)).toThrow(ClientError);
    expect(() => spectator.attestTemplate(NOW)).toThrow(ClientError);
    expect(() => players[0]?.buildSecret(game.rnd, NOW)).toThrow(ClientError);
    const views = [...players, spectator].map((s) => s.view());
    expect(new Set(views.map((v) => canonicalJson([v.outcome, v.audit, v.logHash, v.attested]))).size).toBe(
      1,
    );
  });

  it('rejects a secret that does not match its seat, or is signed by a key that holds no seat', () => {
    const id0 = game.ids[0] as Identity;
    const sign = (deckSecret: bigint, sk: Uint8Array): NostrEvent =>
      finalizeEvent(secretTemplate({ rootId: game.rootId, deckSecret }, NOW), sk, game.rnd);
    expect(spectator.receive(sign((game.ids[1] as Identity).deckSecret, id0.sessionSk), NOW)).toEqual({
      status: 'rejected',
      reason: "the deck secret does not match seat 0's deck key",
    });
    expect(spectator.receive(sign(0n, id0.sessionSk), NOW).status).toBe('rejected');
    expect(spectator.receive(sign(id0.deckSecret, game.npubSks[0] as Uint8Array), NOW)).toEqual({
      status: 'rejected',
      reason: 'not signed by a seated session key',
    });
    // A later copy of a held secret changes nothing.
    expect(spectator.receive(sign(id0.deckSecret, id0.sessionSk), NOW)).toEqual({ status: 'duplicate' });
    expect(spectator.receive(played.secrets[0], NOW)).toEqual({ status: 'duplicate' });
  });

  it('rejects an attestation signed by a session key, or one whose result differs', () => {
    const v = spectator.view();
    const content = {
      rootId: game.rootId,
      audit: v.audit as 'pass',
      logHash: v.logHash,
      outcome: v.outcome as NonNullable<SessionView['outcome']>,
    };
    const bySession = finalizeEvent(
      attestTemplate(content, NOW),
      game.ids[0]?.sessionSk as Uint8Array,
      game.rnd,
    );
    expect(spectator.receive(bySession, NOW)).toEqual({
      status: 'rejected',
      reason: 'not signed by a seated npub',
    });
    const wrong = finalizeEvent(
      attestTemplate({ ...content, audit: { fail: [2], reason: 'made up' } }, NOW),
      game.npubSks[2] as Uint8Array,
      game.rnd,
    );
    const mismatch = { status: 'rejected', reason: "the attestation does not match this session's result" };
    expect(spectator.receive(wrong, NOW)).toEqual(mismatch);
    expect(spectator.receive(wrong, NOW)).toEqual(mismatch);
    expect(spectator.view().attested).toEqual([0, 1, 2]);
  });

  it(
    'reaches the same view whatever the arrival order, with duplicates, for a seat and a spectator',
    () => {
      const seat = newSession(game, 1);
      const watcher = newSession(game, null);
      deliver([seat], scrambled(played.log, 'order-a'));
      deliver([watcher], scrambled(played.log, 'order-b'));
      expect(canonicalJson(seat.view())).toBe(canonicalJson(players[1]?.view()));
      expect(canonicalJson(watcher.view())).toBe(canonicalJson(spectator.view()));
    },
    LONG,
  );

  it(
    'flags a seat that re-signs an old shuffle step, without changing head or phase, in any arrival order',
    () => {
      // Seat 1 re-signs its own shuffle step (seq 2) with a new created_at, long after the game started.
      const step = parseMove(played.log[1], DECK);
      const resigned = finalizeEvent(
        moveTemplate(
          { rootId: step.rootId, prevId: step.prevId, seq: step.seq, content: step.content },
          step.createdAt + 1,
        ),
        game.ids[1]?.sessionSk as Uint8Array,
        game.rnd,
      );
      const late = newSession(game, null);
      expect(statuses(deliver([late], played.log)).every((r) => r === 'accepted')).toBe(true);
      expect(late.receive(resigned, NOW)).toEqual({ status: 'accepted' });
      const early = newSession(game, null);
      deliver([early], [resigned, ...played.log]);
      const reference = spectator.view();
      for (const s of [late, early]) {
        const v = s.view();
        expect(v.head).toEqual(reference.head);
        expect(v.phase).toBe('done');
        expect(v.audit).toBe('pass');
        expect(v.equivocators).toEqual([1]);
        expect(v.forfeits).toEqual([1]);
        // R5 at the end: the equivocator moves to the last place, the others keep their declared order.
        const declared = reference.outcome as NonNullable<SessionView['outcome']>;
        expect(v.outcome).toEqual(rankWithForfeits(declared.scores, [1], declared.places));
        // The honest attestations no longer match this result.
        expect(v.attested).toEqual([]);
      }
      expect(canonicalJson(early.view())).toBe(canonicalJson(late.view()));
    },
    LONG,
  );
});

describe('end of game: a cheater forges a skipPlace', () => {
  // A short game: the end may be declared once a chain reaches 4 tiles.
  const game = makeGame(SEATS, 'client-end-cheat', { ...chainReaction.defaultRules(), endSize: 4 });
  let cheater = -1;
  let legalThen: readonly unknown[] = [];
  let played: Played;

  beforeAll(() => {
    const players = [0, 1, 2].map((seat) => newSession(game, seat));
    const spectator = newSession(game, null);
    played = playToEnd(game, players, [spectator], 'client-end-cheat-policy', {
      // The first player cheats. Its own client runs a module that lets its forged skip through, so it keeps
      // playing: a fresh session for its seat, caught up on the shuffle and the deal.
      beforePlay(ps, log) {
        cheater = (spectator.view().pending as { seat: number }).seat;
        const s = GameSession.create({
          modules: new Map([[chainReaction.id, lenientSkips(cheater)]]),
          table: game.table,
          joins: game.joins,
          root: game.root,
          me: game.ids[cheater] as Identity,
        });
        expect(statuses(deliver([s], log)).every((r) => r === 'accepted')).toBe(true);
        ps[cheater] = s;
      },
      // On its first turn, while every tile it holds is playable, it claims to have none.
      forge(i, s) {
        if (i !== 0) return null;
        legalThen = s.legalActions();
        return forgeAction(s, { type: 'skipPlace', actor: cheater }, game.rnd, T0 + 999);
      },
    });
  }, LONG);

  it('is accepted by every session, since hands are hidden, and caught by the audit', () => {
    expect(actionOf(played.moves[0] as NostrEvent)).toEqual({ type: 'skipPlace', actor: cheater });
    // It held playable tiles: its legal actions were placements.
    expect(legalThen.length).toBeGreaterThan(0);
    expect((legalThen as Action[]).every((a) => a.type === 'place')).toBe(true);
    const ref = played.atDone[played.atDone.length - 1] as SessionView;
    const declared = chainReaction.outcome(ref.state as ChainReactionState);
    expect(declared).not.toBeNull();
    for (const v of played.atDone) {
      expect(v.phase).toBe('done');
      expect(v.audit).toEqual({
        fail: [cheater],
        reason: `move ${SEATS + 1} by seat ${cheater} fails: playable: you hold a playable tile`,
      });
      expect(v.forfeits).toEqual([cheater]);
      expect(v.equivocators).toEqual([]);
      // The cheater moves to the last place; the others keep their declared order.
      expect(v.outcome).toEqual(rankWithForfeits(declared?.scores ?? [], [cheater], declared?.places ?? []));
      expect(v.outcome?.places[cheater]).toBe(SEATS);
    }
    expect(new Set(played.atDone.map((v) => canonicalJson([v.outcome, v.audit, v.logHash]))).size).toBe(1);
  });
});
