import { chess } from '@bored-games/chess';
import { G, initialDeck, makeMoveRollShare, makeShare, shuffleDeck } from '@bored-games/deck';
import { canonicalJson, createRng, type GameModule, shuffle } from '@bored-games/game-kit';
import {
  attestTemplate,
  cardSharesTemplate,
  deviceNoteTemplate,
  type EventTemplate,
  endAttestTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  logHash,
  moveTemplate,
  type NostrEvent,
  resignTemplate,
  rollSharesTemplate,
  secretTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { ClientError } from '../../src/errors.ts';
import { GameSession } from '../../src/session.ts';
import { openSession } from '../../src/session-api.ts';
import type { Identity, ReceiveResult } from '../../src/types.ts';
import { GameSessionV2 } from '../../src/v2/session.ts';
import { MODULES, makeModuleGame, NOW, ROOT_SEEN, T0, type TestGame } from '../helpers.ts';

/*
 * The protocol 2 session, core I (build plan T7): intake at proto 2, the walk (PROTOCOL-v2 §5.1) with C(h) and the
 * fork it ends at, deckless play to `over` with the module's audit, and the end and stats attestations (§4.3, §7).
 * Chess is the deckless game.
 */

/** Fool's mate: 1. f3 e5 2. g4 Qh4#, by seat (White is seat 0). */
const FOOLS_MATE: readonly [number, string][] = [
  [0, 'f2f3'],
  [1, 'e7e5'],
  [0, 'g2g4'],
  [1, 'd8h4'],
];

const move = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

interface Table {
  game: TestGame;
  players: GameSessionV2[];
  spectator: GameSessionV2;
  all: GameSessionV2[];
}

function session(game: TestGame, seat: number | null, modules = game.modules): GameSessionV2 {
  return GameSessionV2.create({
    modules,
    table: game.table,
    joins: game.joins,
    root: game.root,
    me: seat === null ? null : (game.ids[seat] as Identity),
    rootSeenAt: ROOT_SEEN,
  });
}

function table(seed: string, modules: ReadonlyMap<string, AnyModule> = MODULES): Table {
  const game = makeModuleGame(chess, 2, seed, chess.defaultRules(), '2');
  const players = [session(game, 0, modules), session(game, 1, modules)];
  const spectator = session(game, null, modules);
  return { game, players, spectator, all: [...players, spectator] };
}

const deliver = (sessions: readonly GameSessionV2[], ev: unknown, now = NOW): string[] =>
  sessions.map((s) => s.receive(ev, now).status);

/** Seat `seat` builds `uci` on its head and every session receives it; returns the move. */
function play(t: Table, seat: number, uci: string): NostrEvent {
  const ev = (t.players[seat] as GameSessionV2).buildAction(move(seat, uci), t.game.rnd, NOW);
  expect(deliver(t.all, ev)).toEqual(['accepted', 'accepted', 'accepted']);
  return ev;
}

/** A Move signed by `seat`'s session key on `prev`, at `proto`, built by hand (any action, any seq). */
function rawMove(
  t: Table,
  seat: number,
  prevId: Hex,
  seq: number,
  action: unknown,
  proto: '1' | '2' = '2',
): NostrEvent {
  const id = t.game.ids[seat] as Identity;
  const tmpl = moveTemplate(
    { rootId: t.game.rootId, prevId, seq, content: { type: 'action', action, reveals: [], shares: [] } },
    T0 + 50,
    proto,
  );
  return finalizeEvent(tmpl, id.sessionSk, t.game.rnd);
}

const protoTags = (ev: { tags: string[][] }): string[][] => ev.tags.filter((tag) => tag[0] === 'proto');

/** `t` with its proto tag set to `value`. */
const withProto = (t: EventTemplate, value: string): EventTemplate => ({
  ...t,
  tags: [...t.tags.filter((tag) => tag[0] !== 'proto'), ['proto', value]],
});

describe('GameSessionV2: deckless play (Chess)', () => {
  it('starts in play on the root with White to decide; openSession builds it for a proto-2 root', () => {
    const t = table('v2-start');
    const v = t.spectator.view();
    expect(v).toMatchObject({
      proto: 2,
      phase: 'play',
      shuffleSteps: 0,
      head: { id: t.game.rootId, seq: 0 },
      pending: { type: 'player', seat: 0 },
      fork: null,
      result: null,
      endAttested: [],
    });
    expect(t.players.map((s) => s.duties())).toEqual([[{ kind: 'decide' }], []]);
    expect(t.players[0]?.legalActions()).toHaveLength(40);
    for (const s of t.all) expect(s.waitingFor()).toEqual([0]);
    const opened = openSession({
      modules: MODULES,
      table: t.game.table,
      joins: t.game.joins,
      root: t.game.root,
      me: null,
      rootSeenAt: ROOT_SEEN,
    });
    expect(opened).toBeInstanceOf(GameSessionV2);
    expect(opened.proto).toBe(2);
  });

  it("V2-39 (partial) plays Fool's mate to over: the result (over, head, []) and the module's audit at once, deckless", () => {
    const t = table('v2-mate');
    const moves = FOOLS_MATE.map(([seat, uci]) => play(t, seat, uci));
    const head = moves[3] as NostrEvent;
    for (const s of t.all) {
      const v = s.view();
      expect(v).toMatchObject({
        phase: 'done',
        audit: 'pass',
        forfeits: [],
        head: { id: head.id, seq: 4 },
        result: { kind: 'over', head: head.id, forfeit: [] },
        fork: null,
        stood: false,
        stop: null,
      });
      expect(v.outcome).toEqual({ places: [2, 1], reason: 'checkmate', scores: [0, 2] });
      expect(v.logHash).toBe(logHash(moves.map((m) => m.id)));
      expect(v.resultLogHash).toBe(v.logHash);
      expect(s.waitingFor()).toEqual([]);
      expect(s.legalActions()).toEqual([]);
    }
    // The end attestation is due at once, before the stats attestation (PROTOCOL-v2 §7.1).
    expect(t.players.map((s) => s.duties())).toEqual([[{ kind: 'end' }], [{ kind: 'end' }]]);
  });

  it('V2-39 (partial) applies a failed audit to places and scores: the winner, whose move the replay rejects, forfeits', () => {
    // A module whose full-mode setup has no black pawn on e7 (board index 52): the audit's replay rejects Black's
    // 1... e5, so the audit fails seat 1, which mated in the view-mode game, and the places change.
    const noE7: AnyModule = {
      ...chess,
      setup: (input) => {
        const r = chess.setup(input);
        if (!r.ok || input.mode !== 'full') return r;
        const board = [...(r.value as { board: readonly unknown[] }).board];
        board[52] = null;
        return { ok: true, value: { ...r.value, board } as unknown as typeof r.value };
      },
    };
    const t = table('v2-audit-fail', new Map([...MODULES, ['chess', noE7]]));
    for (const [seat, uci] of FOOLS_MATE) play(t, seat, uci);
    const v = t.spectator.view();
    expect(v.phase).toBe('done');
    expect(v.audit).toMatchObject({ fail: [1] });
    expect(v.forfeits).toEqual([1]);
    // Black won by checkmate on the board ([2, 1]); the audit verdict puts it last ([1, 2]), scores unchanged.
    expect(v.outcome).toEqual({ places: [1, 2], reason: 'forfeit', scores: [0, 2] });
    // The audit changes places and scores only: the result's identity is still (over, head, []).
    expect(v.result).toMatchObject({ kind: 'over', forfeit: [] });
  });

  it('V2-11 counts end attestations by the session key and by the npub for their seat; V2-01 (partial) the builders tag proto 2', () => {
    const t = table('v2-end-keys');
    const moves = FOOLS_MATE.map(([seat, uci]) => play(t, seat, uci));
    const head = (moves[3] as NostrEvent).id;
    for (const ev of moves) expect(protoTags(ev)).toEqual([['proto', '2']]);

    // Seat 0 attests automatically, with its session key.
    const bySession = (t.players[0] as GameSessionV2).buildEndAttest(t.game.rnd, NOW);
    expect(bySession.pubkey).toBe(getPublicKey((t.game.ids[0] as Identity).sessionSk));
    expect(protoTags(bySession)).toEqual([['proto', '2']]);
    expect(JSON.parse(bySession.content)).toEqual({
      end: { forfeit: [], kind: 'over', logHash: logHash(moves.map((m) => m.id)) },
    });
    expect(deliver(t.all, bySession)).toEqual(['accepted', 'accepted', 'accepted']);
    for (const s of t.all) expect(s.view().endAttested).toEqual([0]);

    // Seat 1 attests the same result with its npub, as a human-signed attestation would be.
    const byNpub = finalizeEvent(
      endAttestTemplate(
        {
          rootId: t.game.rootId,
          headId: head,
          end: { kind: 'over', forfeit: [], logHash: logHash(moves.map((m) => m.id)) },
        },
        NOW,
      ),
      t.game.npubSks[1] as Uint8Array,
      t.game.rnd,
    );
    expect(deliver(t.all, byNpub)).toEqual(['accepted', 'accepted', 'accepted']);
    for (const s of t.all) expect(s.view().endAttested).toEqual([0, 1]);
    // Either key satisfies the seat's end duty: both seats owe only the stats attestation now.
    expect(t.players.map((s) => s.duties())).toEqual([[{ kind: 'attest' }], [{ kind: 'attest' }]]);
    // A second end attestation of the same result by one seat, with its other key, adds nothing.
    const twice = finalizeEvent(
      endAttestTemplate(
        {
          rootId: t.game.rootId,
          headId: head,
          end: { kind: 'over', forfeit: [], logHash: logHash(moves.map((m) => m.id)) },
        },
        NOW + 1,
      ),
      (t.game.ids[1] as Identity).sessionSk,
      t.game.rnd,
    );
    expect(deliver(t.all, twice)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    for (const s of t.all) expect(s.view().endAttested).toEqual([0, 1]);

    // The stats attestations: the npub signs the session's template, at proto 2.
    for (const [seat, s] of t.players.entries()) {
      const tmpl = s.attestTemplate(NOW);
      expect(protoTags(tmpl)).toEqual([['proto', '2']]);
      const ev = finalizeEvent(tmpl, t.game.npubSks[seat] as Uint8Array, t.game.rnd);
      expect(deliver(t.all, ev)).toEqual(['accepted', 'accepted', 'accepted']);
    }
    for (const s of t.all) expect(s.view().attested).toEqual([0, 1]);
    expect(t.players.map((s) => s.duties())).toEqual([[], []]);
  });

  it('refuses end attestations by a key with no seat, stats attestations by a session key, and seats out of range', () => {
    const t = table('v2-end-refused');
    const moves = FOOLS_MATE.map(([seat, uci]) => play(t, seat, uci));
    const head = (moves[3] as NostrEvent).id;
    const hash = logHash(moves.map((m) => m.id));
    const end = (forfeit: number[], kind: 'over' | 'claim' = 'over') =>
      endAttestTemplate({ rootId: t.game.rootId, headId: head, end: { kind, forfeit, logHash: hash } }, NOW);
    const stranger = new Uint8Array(32).fill(7);
    expect(t.spectator.receive(finalizeEvent(end([]), stranger, t.game.rnd), NOW)).toEqual({
      status: 'rejected',
      reason: 'not signed by a seated session key or npub',
    });
    const id0 = t.game.ids[0] as Identity;
    expect(t.spectator.receive(finalizeEvent(end([2], 'claim'), id0.sessionSk, t.game.rnd), NOW)).toEqual({
      status: 'rejected',
      reason: 'there is no seat 2',
    });
    const stats = attestTemplate(
      {
        rootId: t.game.rootId,
        audit: 'pass',
        logHash: hash,
        outcome: { places: [2, 1], reason: 'checkmate', scores: [0, 2] },
      },
      NOW,
      '2',
    );
    expect(t.spectator.receive(finalizeEvent(stats, id0.sessionSk, t.game.rnd), NOW)).toEqual({
      status: 'rejected',
      reason: 'not signed by a seated npub',
    });
    expect(t.spectator.view().endAttested).toEqual([]);
    expect(t.spectator.view().attested).toEqual([]);
  });

  it('V2-12 ignores an end attestation whose logHash does not match the line to its head, once that line is held', () => {
    const t = table('v2-loghash');
    const late = session(t.game, null);
    const moves = FOOLS_MATE.map(([seat, uci]) => play(t, seat, uci));
    const head = (moves[3] as NostrEvent).id;
    const good = logHash(moves.map((m) => m.id));
    const bad = logHash(moves.slice(0, 3).map((m) => m.id));
    const sign = (seat: number, hash: Hex) =>
      finalizeEvent(
        endAttestTemplate(
          { rootId: t.game.rootId, headId: head, end: { kind: 'over', forfeit: [], logHash: hash } },
          NOW,
        ),
        (t.game.ids[seat] as Identity).sessionSk,
        t.game.rnd,
      );
    const mismatched = sign(0, bad);
    const matched = sign(1, good);
    // Before the line is held, both are unresolved: kept, counted for nothing yet.
    expect(late.receive(mismatched, NOW)).toEqual({ status: 'stored' });
    expect(late.receive(matched, NOW)).toEqual({ status: 'stored' });
    // The line arrives (out of order): the matching one counts, the mismatched one is ignored for good.
    for (const i of [2, 0, 3, 1]) late.receive(moves[i], NOW);
    expect(late.view()).toMatchObject({ phase: 'done', result: { kind: 'over', head } });
    expect(late.view().endAttested).toEqual([1]);
    expect(late.receive(mismatched, NOW)).toMatchObject({ status: 'rejected' });
    // A mismatched one received once the line is held is rejected at once, and seat 0 still owes its own.
    expect(t.players[0]?.receive(mismatched, NOW)).toMatchObject({
      status: 'rejected',
      reason: "the end attestation's log hash does not match the line to its head",
    });
    expect(t.players[0]?.view().endAttested).toEqual([]);
    expect(t.players[0]?.duties()).toEqual([{ kind: 'end' }]);
  });

  it('V2-08 rejects a card Shares event in a deckless game, and a roll Shares event in a game that does not roll', () => {
    const t = table('v2-shares-variant');
    const id = t.game.ids[0] as Identity;
    // A re-encrypted card, so the share is well formed; the deckless session refuses it before any check.
    const reencrypted = shuffleDeck(initialDeck('dummy', 1), G.multiply(id.deckSecret), t.game.rnd).out;
    const ct = reencrypted[0] as (typeof reencrypted)[0];
    const card = finalizeEvent(
      cardSharesTemplate(
        {
          rootId: t.game.rootId,
          anchorId: t.game.rootId,
          shares: [
            {
              pos: 0,
              share: makeShare(
                id.deckSecret,
                ct,
                { rootId: t.game.rootId, deckId: 'dummy', pos: 0 },
                t.game.rnd,
              ),
            },
          ],
        },
        NOW,
      ),
      id.sessionSk,
      t.game.rnd,
    );
    expect(protoTags(card)).toEqual([['proto', '2']]);
    expect(deliver(t.all, card)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(t.spectator.receive(card, NOW)).toEqual({
      status: 'rejected',
      reason: 'a card Shares event in a game without a deck',
    });
    const m1 = play(t, 0, 'e2e4');
    const roll = finalizeEvent(
      rollSharesTemplate(
        {
          rootId: t.game.rootId,
          anchorId: m1.id,
          moveId: m1.id,
          shares: [{ pos: 0, share: makeMoveRollShare(id.deckSecret, t.game.rootId, m1.id, 0, t.game.rnd) }],
        },
        NOW,
      ),
      id.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(roll, NOW)).toEqual({
      status: 'rejected',
      reason: 'a roll Shares event in a game that does not roll',
    });
    expect(t.spectator.view().head.id).toBe(m1.id);
  });

  it("V2-02 rejects every in-game event whose proto is not the game's, and the v1 session rejects proto-2 events", () => {
    const t = table('v2-proto');
    const id = t.game.ids[0] as Identity;
    const sign = (tmpl: EventTemplate, sk = id.sessionSk) => finalizeEvent(tmpl, sk, t.game.rnd);
    const at = (proto: string) => [
      sign(
        withProto(
          moveTemplate(
            {
              rootId: t.game.rootId,
              prevId: t.game.rootId,
              seq: 1,
              content: { type: 'action', action: move(0, 'e2e4'), reveals: [], shares: [] },
            },
            T0 + 50,
          ),
          proto,
        ),
      ),
      sign(
        withProto(timeoutTemplate({ rootId: t.game.rootId, headId: t.game.rootId, seat: 1 }, T0 + 50), proto),
      ),
      sign(withProto(resignTemplate({ rootId: t.game.rootId, headId: t.game.rootId }, T0 + 50), proto)),
      sign(withProto(secretTemplate({ rootId: t.game.rootId, deckSecret: id.deckSecret }, T0 + 50), proto)),
      sign(
        withProto(
          endAttestTemplate(
            {
              rootId: t.game.rootId,
              headId: t.game.rootId,
              end: { kind: 'over', forfeit: [], logHash: logHash([]) },
            },
            T0 + 50,
          ),
          proto,
        ),
      ),
    ];
    for (const proto of ['1', '3']) {
      for (const ev of at(proto)) {
        const r = t.spectator.receive(ev, NOW) as Extract<ReceiveResult, { status: 'rejected' }>;
        expect(r.status, `kind ${ev.kind} at proto ${proto}`).toBe('rejected');
        expect(r.reason).toMatch(/bad-proto/);
      }
    }
    // Two proto tags.
    const doubled = sign({
      ...moveTemplate(
        {
          rootId: t.game.rootId,
          prevId: t.game.rootId,
          seq: 1,
          content: { type: 'action', action: move(0, 'e2e4'), reveals: [], shares: [] },
        },
        T0 + 50,
        '2',
      ),
      tags: [
        ['e', t.game.rootId, '', 'root'],
        ['e', t.game.rootId, '', 'prev'],
        ['seq', '1'],
        ['proto', '2'],
        ['proto', '2'],
      ],
    });
    expect(t.spectator.receive(doubled, NOW)).toMatchObject({
      status: 'rejected',
      reason: expect.stringMatching(/bad-proto/),
    });
    expect(t.spectator.view().head.seq).toBe(0);
    // The same move at proto 2 is accepted.
    const [good] = at('2');
    expect(t.spectator.receive(good, NOW)).toEqual({ status: 'accepted' });

    // A v1 Chess game's session refuses the proto-2 move.
    const v1 = makeModuleGame(chess, 2, 'v2-proto-v1', chess.defaultRules(), '1');
    const v1Session = GameSession.create({
      modules: MODULES,
      table: v1.table,
      joins: v1.joins,
      root: v1.root,
      me: null,
      rootSeenAt: ROOT_SEEN,
    });
    const v1Id = v1.ids[0] as Identity;
    const proto2 = finalizeEvent(
      moveTemplate(
        {
          rootId: v1.rootId,
          prevId: v1.rootId,
          seq: 1,
          content: { type: 'action', action: move(0, 'e2e4'), reveals: [], shares: [] },
        },
        T0 + 50,
        '2',
      ),
      v1Id.sessionSk,
      v1.rnd,
    );
    expect(v1Session.receive(proto2, NOW)).toMatchObject({
      status: 'rejected',
      reason: expect.stringMatching(/bad-proto/),
    });
  });
});

describe('GameSessionV2: the walk', () => {
  it('reaches the same view from the same events in any arrival order, with duplicates (the walk is a function of the held events)', () => {
    const t = table('v2-orders');
    const moves = FOOLS_MATE.map(([seat, uci]) => play(t, seat, uci));
    const ends = t.players.map((s) => s.buildEndAttest(t.game.rnd, NOW));
    for (const ev of ends) deliver(t.all, ev);
    const stats = t.players.map((s, seat) =>
      finalizeEvent(s.attestTemplate(NOW), t.game.npubSks[seat] as Uint8Array, t.game.rnd),
    );
    for (const ev of stats) deliver(t.all, ev);
    // A late rival of move 3 and a move past it: the walk ends at the fork at move 2 whatever the order.
    const rival = rawMove(t, 0, (moves[1] as NostrEvent).id, 3, move(0, 'b1c3'));
    const past = rawMove(t, 1, rival.id, 4, move(1, 'b8c6'));
    const events: NostrEvent[] = [...moves, ...ends, ...stats];
    const digest = (s: GameSessionV2): string => canonicalJson(s.view());
    const rng = createRng('v2-orders');
    for (const set of [events, [...events, rival, past]]) {
      const reference = session(t.game, null);
      for (const ev of set) reference.receive(ev, NOW);
      for (let i = 0; i < 6; i++) {
        const order = shuffle([...set, rng.pick(set), rng.pick(set)], rng);
        const s = session(t.game, null);
        for (const ev of order) s.receive(ev, NOW);
        expect(digest(s)).toBe(digest(reference));
      }
    }
  });

  it('V2-14 (partial) ends the walk at a fork when the root has two valid-looking first moves, in any arrival order', () => {
    const t = table('v2-fork-root');
    const a = rawMove(t, 0, t.game.rootId, 1, move(0, 'e2e4'));
    const b = rawMove(t, 0, t.game.rootId, 1, move(0, 'd2d4'));
    const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const s = session(t.game, 1);
      expect(s.receive(order[0], NOW)).toEqual({ status: 'accepted' });
      expect(s.view().head.seq).toBe(1);
      expect(s.receive(order[1], NOW)).toEqual({ status: 'accepted' });
      const v = s.view();
      expect(v.fork).toEqual({ at: t.game.rootId, seat: 0, certificate: [lo.id, hi.id] });
      // The walk ends at P: no head to play on, no decision, no result, nothing scored yet.
      expect(v.head).toEqual({ id: t.game.rootId, seq: 0 });
      expect(v.result).toBeNull();
      expect(s.duties()).toEqual([]);
      expect(s.legalActions()).toEqual([]);
      expect(() => s.buildAction(move(1, 'e7e5'), t.game.rnd, NOW)).toThrow(ClientError);
    }
  });

  it('V2-14 (partial) a fork below the head ends the walk there; moves past it are held, never linked', () => {
    const t = table('v2-fork-deep');
    const m1 = play(t, 0, 'e2e4');
    const m2 = play(t, 1, 'e7e5');
    const m3 = play(t, 0, 'g1f3');
    const m4 = play(t, 1, 'b8c6');
    // White signs a second move 3 on m2: a rival of m3, valid-looking at m2.
    const rival = rawMove(t, 0, m2.id, 3, move(0, 'f1c4'));
    expect(deliver(t.all, rival)).toEqual(['accepted', 'accepted', 'accepted']);
    for (const s of t.all) {
      const v = s.view();
      expect(v.fork).toMatchObject({ at: m2.id, seat: 0 });
      expect(v.fork?.certificate).toEqual([m3.id, rival.id].sort());
      expect(v.head).toEqual({ id: m2.id, seq: 2 });
      expect(s.chainSeq(m1.id)).toBe(1);
      expect(s.chainSeq(m3.id)).toBeNull();
      // Past the fork at the head: held above P, never linked, so not ahead either (review L1).
      expect(s.branchOf(m4.id)).toBe('unknown');
      expect(s.aheadOfHead()).toBe(false);
      expect(s.duties()).toEqual([]);
    }
    // A later client holding every event in another order walks to the same fork.
    const late = session(t.game, null);
    for (const ev of [m4, rival, m3, m1, m2]) late.receive(ev, NOW);
    expect(late.view()).toMatchObject({ fork: t.spectator.view().fork, head: { id: m2.id } });
  });

  it('an invalid move is not valid-looking: rejected (still held), and no fork; a move waits for its prev', () => {
    const t = table('v2-invalid');
    // Black moving first, a wrong seq and an illegal move by White are not valid-looking at the root.
    const wrongSeat = rawMove(t, 1, t.game.rootId, 1, move(1, 'e7e5'));
    expect(t.spectator.receive(wrongSeat, NOW)).toEqual({
      status: 'rejected',
      reason: 'move 1 must be signed by seat 0',
    });
    const illegal = rawMove(t, 0, t.game.rootId, 1, move(0, 'e2e5'));
    expect(t.spectator.receive(illegal, NOW)).toMatchObject({ status: 'rejected' });
    const rolled = rawMove(t, 0, t.game.rootId, 1, { type: 'rolled', actor: 0, id: 0, dice: [1, 1] });
    expect(t.spectator.receive(rolled, NOW)).toEqual({
      status: 'rejected',
      reason: 'a player does not send the dice',
    });
    // A received-again invalid move is still rejected.
    expect(t.spectator.receive(wrongSeat, NOW)).toEqual({
      status: 'rejected',
      reason: 'move 1 must be signed by seat 0',
    });
    const m1 = play(t, 0, 'e2e4');
    expect(t.spectator.view()).toMatchObject({ fork: null, head: { id: m1.id, seq: 1 } });

    // A move whose prev is not held waits, and links once the prev arrives.
    const late = session(t.game, null);
    const m2 = play(t, 1, 'e7e5');
    expect(late.receive(m2, NOW)).toEqual({ status: 'stored' });
    expect(late.missingParents()).toEqual([m1.id]);
    expect(late.receive(m1, NOW)).toEqual({ status: 'accepted' });
    expect(late.view().head).toEqual({ id: m2.id, seq: 2 });
    expect(late.receive(m2, NOW)).toEqual({ status: 'duplicate' });
  });

  it('V2-37 (partial) owes an end attestation only for a result it computes, never while it holds a fork', () => {
    const t = table('v2-end-fork');
    const moves = FOOLS_MATE.map(([seat, uci]) => play(t, seat, uci));
    expect(t.players[0]?.duties()).toEqual([{ kind: 'end' }]);
    // While the game is live no end attestation can be built.
    const fresh = table('v2-end-live');
    expect(() => fresh.players[0]?.buildEndAttest(fresh.game.rnd, NOW)).toThrow(/no end duty/);
    // White signs a rival move 1 after the end: the walk now ends at a fork at the root, so no result is computed
    // here (the cutoff, T11, decides whether the over result stands) and no end attestation is owed or built.
    const rival = rawMove(t, 0, t.game.rootId, 1, move(0, 'e2e4'));
    expect(deliver(t.all, rival)).toEqual(['accepted', 'accepted', 'accepted']);
    for (const s of t.all)
      expect(s.view()).toMatchObject({ result: null, fork: { at: t.game.rootId, seat: 0 } });
    expect(t.players.map((s) => s.duties())).toEqual([[], []]);
    expect(() => t.players[1]?.buildEndAttest(t.game.rnd, NOW)).toThrow(/no end duty/);
    expect(moves).toHaveLength(4);
  });

  it('stores Timeout claims and Resigns (counted from T12) and Device notes; refuses secrets in a deckless game', () => {
    const t = table('v2-stored');
    const id1 = t.game.ids[1] as Identity;
    const claim = finalizeEvent(
      timeoutTemplate({ rootId: t.game.rootId, headId: t.game.rootId, seat: 0 }, NOW, '2'),
      id1.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(claim, NOW)).toEqual({ status: 'stored' });
    expect(t.spectator.receive(claim, NOW)).toEqual({ status: 'duplicate' });
    const self = finalizeEvent(
      timeoutTemplate({ rootId: t.game.rootId, headId: t.game.rootId, seat: 1 }, NOW, '2'),
      id1.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(self, NOW)).toEqual({
      status: 'rejected',
      reason: 'a seat cannot claim a timeout against itself',
    });
    const resign = finalizeEvent(
      resignTemplate({ rootId: t.game.rootId, headId: t.game.rootId }, NOW, '2'),
      id1.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(resign, NOW)).toEqual({ status: 'stored' });
    const secret = finalizeEvent(
      secretTemplate({ rootId: t.game.rootId, deckSecret: id1.deckSecret }, NOW, '2'),
      id1.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(secret, NOW)).toEqual({
      status: 'rejected',
      reason: 'a deckless game has no deck secrets',
    });
    expect(t.spectator.view()).toMatchObject({ phase: 'play', result: null, head: { seq: 0 } });
    const note = finalizeEvent(
      deviceNoteTemplate({ rootId: t.game.rootId, device: 'ab'.repeat(16), n: 1 }, NOW),
      id1.sessionSk,
      t.game.rnd,
    );
    expect(t.spectator.receive(note, NOW)).toEqual({ status: 'accepted' });
    expect(t.spectator.receive(note, NOW)).toEqual({ status: 'duplicate' });
    expect(t.players[1]?.canResign()).toBe(false);
    expect(t.players[1]?.timeoutTarget(NOW + 10_000_000)).toBeNull();
  });
});

describe('GameSessionV2: review follow-ups after T7 (L1, I4, V2-56)', () => {
  /** A card Shares event by `seat`, anchored on `anchorId`, with one well-formed share of position 0 of a dummy card. */
  function cardVariant(t: Table, seat: number, anchorId: Hex): NostrEvent {
    const id = t.game.ids[seat] as Identity;
    const ct = shuffleDeck(initialDeck('dummy', 1), G.multiply(id.deckSecret), t.game.rnd).out[0];
    const share = makeShare(
      id.deckSecret,
      ct as NonNullable<typeof ct>,
      { rootId: t.game.rootId, deckId: 'dummy', pos: 0 },
      t.game.rnd,
    );
    return finalizeEvent(
      cardSharesTemplate({ rootId: t.game.rootId, anchorId, shares: [{ pos: 0, share }] }, NOW),
      id.sessionSk,
      t.game.rnd,
    );
  }

  it("L1: aheadOfHead and branchOf follow only moves that can still link: a non-pending seat's junk move 1 and its child are not ahead", () => {
    const t = table('v2-l1-junk');
    // Seat 1 is not pending at the root. Its move 1 can never link (rejected, held) and its seq-2 child never either.
    const junk = rawMove(t, 1, t.game.rootId, 1, move(1, 'e7e5'));
    const child = rawMove(t, 1, junk.id, 2, move(1, 'd7d5'));
    expect(t.spectator.receive(junk, NOW)).toMatchObject({ status: 'rejected' });
    expect(t.spectator.receive(child, NOW)).toEqual({ status: 'stored' });
    expect(t.spectator.aheadOfHead()).toBe(false);
    expect(t.spectator.branchOf(child.id)).toBe('unknown');
    expect(t.spectator.branchOf(junk.id)).toBe('unknown');
    // The same in the other arrival order.
    const late = session(t.game, null);
    late.receive(child, NOW);
    late.receive(junk, NOW);
    expect(late.aheadOfHead()).toBe(false);
    expect(late.branchOf(child.id)).toBe('unknown');
    // A move whose seq does not follow its prev cannot link either, even on a good move.
    const m1 = play(t, 0, 'e2e4');
    const skip = rawMove(t, 1, m1.id, 3, move(1, 'e7e5'));
    const past = rawMove(t, 0, skip.id, 4, move(0, 'd2d4'));
    t.spectator.receive(skip, NOW);
    t.spectator.receive(past, NOW);
    expect(t.spectator.view().head.id).toBe(m1.id);
    expect(t.spectator.branchOf(past.id)).toBe('unknown');
    expect(t.spectator.aheadOfHead()).toBe(false);
  });

  it('L1: aheadOfHead is false while a fork is held, and moves past the fork are not ahead', () => {
    const t = table('v2-l1-fork');
    const a = rawMove(t, 0, t.game.rootId, 1, move(0, 'e2e4'));
    const b = rawMove(t, 0, t.game.rootId, 1, move(0, 'd2d4'));
    const a2 = rawMove(t, 1, a.id, 2, move(1, 'e7e5'));
    const a3 = rawMove(t, 0, a2.id, 3, move(0, 'g1f3'));
    for (const ev of [a, b, a2, a3]) t.spectator.receive(ev, NOW);
    expect(t.spectator.view().fork).toMatchObject({ at: t.game.rootId, seat: 0 });
    expect(t.spectator.aheadOfHead()).toBe(false);
    expect(t.spectator.branchOf(a3.id)).toBe('unknown');
    expect(t.spectator.branchOf(a.id)).toBe('unknown');
  });

  it('I4: a shape-bad move off the walk is rejected when received again, not a duplicate', () => {
    const t = table('v2-i4');
    const id = t.game.ids[0] as Identity;
    const ct = shuffleDeck(initialDeck('dummy', 1), G.multiply(id.deckSecret), t.game.rnd).out[0];
    const share = makeShare(
      id.deckSecret,
      ct as NonNullable<typeof ct>,
      { rootId: t.game.rootId, deckId: 'dummy', pos: 0 },
      t.game.rnd,
    );
    // A move with a share in a deckless game, on a prev nobody holds: never judged, rejected by its shape.
    const bad = finalizeEvent(
      moveTemplate(
        {
          rootId: t.game.rootId,
          prevId: 'ab'.repeat(32),
          seq: 2,
          content: { type: 'action', action: move(1, 'e7e5'), reveals: [], shares: [{ pos: 0, share }] },
        },
        NOW,
        '2',
      ),
      (t.game.ids[1] as Identity).sessionSk,
      t.game.rnd,
    );
    const first = t.spectator.receive(bad, NOW);
    expect(first).toEqual({ status: 'rejected', reason: 'a deckless game carries no shares or reveals' });
    expect(t.spectator.receive(bad, NOW)).toEqual(first);
  });

  it('V2-56 (partial) holds every Shares event and end attestation with a seated signer, whatever its validity, in any arrival order', () => {
    const t = table('v2-56');
    const moves = FOOLS_MATE.map(([seat, uci]) => play(t, seat, uci));
    const head = (moves[3] as NostrEvent).id;
    const hash = logHash(moves.map((m) => m.id));
    const unheld = 'cd'.repeat(32);
    const id0 = t.game.ids[0] as Identity;
    const id1 = t.game.ids[1] as Identity;
    const end = (
      sk: Uint8Array,
      headId: Hex,
      kind: 'over' | 'claim',
      forfeit: number[],
      logH: Hex,
      at = NOW,
    ) =>
      finalizeEvent(
        endAttestTemplate({ rootId: t.game.rootId, headId, end: { kind, forfeit, logHash: logH } }, at),
        sk,
        t.game.rnd,
      );
    const roll = finalizeEvent(
      rollSharesTemplate(
        {
          rootId: t.game.rootId,
          anchorId: unheld,
          moveId: unheld,
          shares: [
            { pos: 0, share: makeMoveRollShare(id1.deckSecret, t.game.rootId, unheld, 0, t.game.rnd) },
          ],
        },
        NOW,
      ),
      id1.sessionSk,
      t.game.rnd,
    );
    // `bad`: rejected on arrival; `badLater`: rejected once the line to its head is held (a log-hash mismatch).
    type Held = {
      ev: NostrEvent;
      kind: 'shares' | 'roll' | 'end';
      seat: number;
      at: Hex;
      bad: boolean;
      badLater?: true;
    };
    const events: Held[] = [
      // An inapplicable card variant (a deckless game), anchored on a move of the line.
      {
        ev: cardVariant(t, 0, moves[1]?.id as Hex),
        kind: 'shares',
        seat: 0,
        at: moves[1]?.id as Hex,
        bad: true,
      },
      // An inapplicable roll variant, whose anchor and requesting move are not held.
      { ev: roll, kind: 'roll', seat: 1, at: unheld, bad: true },
      // An end attestation naming a non-seat, a mismatched log hash, and one whose head is not held (unresolved).
      { ev: end(id0.sessionSk, head, 'claim', [5], hash), kind: 'end', seat: 0, at: head, bad: true },
      {
        ev: end(id1.sessionSk, head, 'over', [], logHash([])),
        kind: 'end',
        seat: 1,
        at: head,
        bad: false,
        badLater: true,
      },
      { ev: end(id1.sessionSk, unheld, 'over', [], hash), kind: 'end', seat: 1, at: unheld, bad: false },
      // A valid end attestation, and a duplicate of it by the seat's npub.
      { ev: end(id0.sessionSk, head, 'over', [], hash), kind: 'end', seat: 0, at: head, bad: false },
      {
        ev: end(t.game.npubSks[0] as Uint8Array, head, 'over', [], hash),
        kind: 'end',
        seat: 0,
        at: head,
        bad: false,
      },
    ];
    const expected = events
      .map(({ ev, kind, seat, at }) => ({ id: ev.id, kind, seat, at }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const orders = [
      events.map((_, i) => i),
      events.map((_, i) => events.length - 1 - i),
      [3, 0, 6, 2, 5, 1, 4],
    ];
    for (const order of orders) {
      const s = session(t.game, null);
      for (const i of order) {
        const e = events[i] as (typeof events)[number];
        const r = s.receive(e.ev, NOW);
        if (e.bad) expect(r.status).toBe('rejected');
      }
      // Invalid events stay held, and received again they are still rejected (the store does not lose them).
      for (const e of events) if (e.bad) expect(s.receive(e.ev, NOW).status).toBe('rejected');
      for (const m of moves) s.receive(m, NOW);
      for (const e of events) if (e.bad || e.badLater) expect(s.receive(e.ev, NOW).status).toBe('rejected');
      expect(s.heldSet()).toEqual(expected);
      // Validity is a separate pool: only seat 0's valid attestation counts for the result.
      expect(s.view().endAttested).toEqual([0]);
    }
  });
});
