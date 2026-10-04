import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import type { Outcome } from '@bored-games/game-kit';
import {
  cardSharesTemplate,
  endAttestTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  type NostrEvent,
  type PosShare,
  parseSharesV2,
  secretTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity } from '../../src/types.ts';
import { gameRecord } from '../../src/v2/record.ts';
import type { GameSessionV2 } from '../../src/v2/session.ts';
import { LATE, MODULES, NOW } from '../helpers.ts';
import {
  type AnyModule,
  actionAt,
  buildAuto,
  inOrders,
  replay,
  runAuto,
  send,
  shuffleAll,
  type V2Table,
  v2Table,
} from './helpers-v2.ts';

/*
 * A standing result is played out as if no fork were held (PROTOCOL-v2 §5.4, review N1, V2-54; build plan T11;
 * vector 5's N1 trace). Chain Reaction needs 3 seats (its rules' minimum), so the trace has a cheat C and two honest
 * seats, H and O, where the spec's has one: C wins nothing honestly, it skips a placement though it holds a playable
 * tile (a forged `skipPlace`: the others' views cannot see its hand), the game reaches its end, H and O end-attest it,
 * and C then signs a rival move at its own old prev, so the end stands against the fork (C attested nothing; it is
 * E). C withholds its Secret reveal. Expected: C is stalled at the result's head, H's claim there is accepted once
 * H's own deadline passes, and C forfeits for the withheld secret, with no step blocked by the held fork. With C's
 * secret published instead, the full audit fails C.
 */

const tilesOn = (s: ChainReactionState): number => s.board.filter((c) => c !== null).length;

/** Chain Reaction over at the place phase once one tile beyond the setup ones is on the board. */
function endsAt(s: ChainReactionState): boolean {
  return s.phase.kind === 'place' && tilesOn(s) >= s.seats + 1;
}

const shortGame: AnyModule = {
  ...chainReaction,
  pending: (s: ChainReactionState) => (endsAt(s) ? { type: 'over' } : chainReaction.pending(s)),
  legalActions: (s: ChainReactionState, seat: number) =>
    endsAt(s) ? [] : chainReaction.legalActions(s, seat),
  outcome: (s: ChainReactionState): Outcome | null => {
    if (!endsAt(s)) return chainReaction.outcome(s);
    const scores = chainReaction.standings(s);
    return { places: scores.map((x) => 1 + scores.filter((y) => y > x).length), scores, reason: 'declared' };
  },
};
const registry = new Map([...MODULES, [chainReaction.id, shortGame]]);

describe('N1: a cheat that forks at its own old prev after the end attestations (Chain Reaction, 3 seats)', () => {
  let t: V2Table;
  let C: number;
  let H: number;
  let O: number;
  /** P: the head C was to place on, where it skipped and later signs its rival. */
  let P: Hex;
  /** X's head: the move after which the module is over. */
  let X: Hex;
  /** Everything up to the end attestations and the honest secrets, with C's rival; C's secret apart. */
  let log: NostrEvent[];
  let cSecret: NostrEvent;
  let rival: NostrEvent;

  const pendingSeat = (x: V2Table): number => (x.spectator.view().pending as { seat: number }).seat;
  /** The honest sessions: H, O and the spectator (C's own session sees its hand and never links the skip). */
  const honest = (x: V2Table): GameSessionV2[] =>
    [x.players[H], x.players[O], x.spectator] as GameSessionV2[];

  /** Run the honest seats' automatic duties of `kinds` to rest. */
  function honestAuto(kinds: string[]): void {
    for (let guard = 0; guard < 50; guard++) {
      let did = false;
      for (const k of [H, O]) {
        const d = (t.players[k] as GameSessionV2).duties().find((x) => kinds.includes(x.kind));
        if (d === undefined) continue;
        const ev = buildAuto(t, k, d);
        send(t, ev);
        did = true;
      }
      if (!did) return;
    }
    throw new Error('duties never settle');
  }

  beforeAll(() => {
    t = v2Table(shortGame, 3, 'n1', chainReaction.defaultRules(), registry);
    shuffleAll(t);
    runAuto(t, ['deal', 'release']);
    C = pendingSeat(t);
    const order = [C, (C + 1) % 3, (C + 2) % 3];
    H = order[1] as number;
    O = order[2] as number;
    const v = t.spectator.view();
    P = v.head.id;
    expect((v.state as ChainReactionState).phase.kind).toBe('place');
    // C holds a playable tile: its own session offers no skip.
    const own = (t.players[C] as GameSessionV2).legalActions() as { type: string }[];
    expect(own.some((a) => a.type === 'skipPlace')).toBe(false);
    // The forged skip, and C's end of turn by hand (buying nothing, discarding nothing: the others cannot check).
    const skip = actionAt(t, C, P, v.head.seq + 1, { type: 'skipPlace', actor: C });
    expect(send(t, skip, honest(t))).toEqual(['accepted', 'accepted', 'accepted']);
    const end = { type: 'endTurn', actor: C, buy: [], declareEnd: false, discard: [] };
    const v2 = t.spectator.view();
    send(t, actionAt(t, C, v2.head.id, v2.head.seq + 1, end), honest(t));
    honestAuto(['release']);
    // H places a tile and ends its turn: the game is over at O's place phase.
    for (let i = 0; i < 8 && t.spectator.view().result === null; i++) {
      expect(pendingSeat(t)).toBe(H);
      const s = t.players[H] as GameSessionV2;
      const ev = s.buildAction(s.legalActions()[0], t.game.rnd, NOW);
      expect(send(t, ev, honest(t))).toEqual(['accepted', 'accepted', 'accepted']);
      honestAuto(['release']);
    }
    const done = t.spectator.view();
    expect(done.result?.kind).toBe('over');
    X = done.head.id;
    // H and O end-attest and publish their secrets (C attests nothing).
    honestAuto(['end', 'secret']);
    expect(t.spectator.view().endAttested).toEqual([H, O].sort((a, b) => a - b));
    // C's rival at its own old prev: the placement it should have made, built by its own session (stuck at P).
    const cs = t.players[C] as GameSessionV2;
    expect(cs.view().head.id).toBe(P);
    const place = (cs.legalActions() as { type: string }[]).find((a) => a.type === 'place');
    rival = cs.buildAction(place, t.game.rnd, NOW + 1);
    send(t, rival, honest(t));
    log = [...t.log];
    const cid = t.game.ids[C] as Identity;
    cSecret = finalizeEvent(
      secretTemplate({ rootId: t.game.rootId, deckSecret: cid.deckSecret }, NOW, '2'),
      cid.sessionSk,
      t.game.rnd,
    );
  }, 300_000);

  it('V2-54, V2-18: the end stands against the fork; C, its secret withheld, is stalled at the result head, in any order', () => {
    const r = inOrders(t, log, 'n1-stood', 2);
    for (const s of honest(r)) {
      const v = s.view();
      expect(v.result).toEqual({ kind: 'over', head: X, forfeit: [] });
      expect(v).toMatchObject({ stood: true, stop: null, fork: { at: P, seat: C }, equivocators: [C] });
      // Played out as without the fork: the End phase at X's head, waiting for C's secret.
      expect(v).toMatchObject({ phase: 'end', head: { id: X }, outcome: null, audit: 'pending' });
      expect(s.waitingFor()).toEqual([C]);
      expect(v.pendingSince).toBe(NOW);
    }
    // Nobody honest owes anything more (no end attestation while the fork is held; their secrets are in).
    expect((r.players[H] as GameSessionV2).duties()).toEqual([]);
    expect((r.players[O] as GameSessionV2).duties()).toEqual([]);
  });

  it("V2-54: H's claim at the result head is accepted once H's own deadline passes, and C forfeits for the withheld secret", () => {
    const r = replay(t, log);
    const h = r.players[H] as GameSessionV2;
    expect(h.timeoutTarget(NOW)).toBeNull();
    expect(h.timeoutTarget(LATE)).toBe(C);
    const claim = h.buildTimeout(C, r.game.rnd, LATE);
    // A claim naming the fork point P is no End-phase claim: it is held and changes nothing.
    const atP = finalizeEvent(
      timeoutTemplate({ rootId: r.game.rootId, headId: P, seat: C }, LATE, '2'),
      (r.game.ids[O] as Identity).sessionSk,
      r.game.rnd,
    );
    // Received before the deadline on the spectator's clock: kept, then accepted when its clock passes it.
    for (const ev of [atP, claim]) expect(r.spectator.receive(ev, NOW).status).toBe('stored');
    expect(r.spectator.view().phase).toBe('end');
    for (const s of [h, r.players[O] as GameSessionV2]) {
      expect(s.receive(atP, LATE).status).toBe('stored');
      expect(s.view().phase).toBe('end');
    }
    r.spectator.tick(LATE);
    for (const s of [h, r.players[O] as GameSessionV2])
      expect(s.receive(claim, LATE).status).toBe('accepted');
    const declared = shortGame.outcome(r.spectator.view().state) as Outcome;
    for (const s of honest(r)) {
      const v = s.view();
      expect(v).toMatchObject({ phase: 'done', stood: true, forfeits: [C] });
      expect(v.audit).toEqual({ fail: [C], reason: 'withheld secret' });
      expect(v.outcome?.places[C]).toBe(3);
      expect(v.outcome?.reason).toBe('forfeit');
      expect(v.outcome?.scores).toEqual(declared.scores);
      expect(s.waitingFor()).toEqual([]);
    }
    expect(gameRecord(r.spectator.view())).toMatchObject({
      ending: 'over',
      rated: [true, true, true],
      equivocators: [C],
    });
    // Final: C's secret arriving later changes nothing.
    r.spectator.receive(cSecret, LATE);
    expect(r.spectator.view().audit).toEqual({ fail: [C], reason: 'withheld secret' });
  });

  it('V2-39 (partial): with C’s secret published instead, the full audit at the standing result fails C, in any order (N1)', () => {
    const r = inOrders(t, [...log, cSecret], 'n1-audit', 2);
    for (const s of honest(r)) {
      const v = s.view();
      expect(v).toMatchObject({ phase: 'done', stood: true, result: { kind: 'over', head: X } });
      expect(v.audit).toMatchObject({ fail: [C] });
      expect(v.forfeits).toEqual([C]);
      expect(v.outcome?.places[C]).toBe(3);
      expect(s.waitingFor()).toEqual([]);
    }
  });

  it('V2-54: late attestations that make the end stand do not make C claimable at once: the deadline runs from when it first stood here', () => {
    const deadline = (t.spectator.view().deadline as number) * 1;
    const ends = log.filter((e) => e.kind === 7456);
    const r = replay(
      t,
      log.filter((e) => !ends.includes(e)),
    );
    // A stop first (no end attestation held); the attestations arrive two deadlines after everything else.
    expect(r.spectator.view().stop).toMatchObject({ at: P, seat: C });
    const late = NOW + 2 * deadline;
    for (const s of honest(r)) for (const e of ends) s.receive(e, late);
    const h = r.players[H] as GameSessionV2;
    for (const s of honest(r)) {
      expect(s.view()).toMatchObject({ stood: true, phase: 'end', pendingSince: late });
      expect(s.waitingFor()).toEqual([C]);
    }
    // The moves of X's line are old, but C is not claimable until a full deadline after the result stood.
    expect(h.timeoutTarget(late)).toBeNull();
    expect(h.timeoutTarget(late + deadline - 1)).toBeNull();
    expect(h.timeoutTarget(late + deadline)).toBe(C);
    const claim = h.buildTimeout(C, r.game.rnd, late + deadline);
    expect(r.spectator.receive(claim, late + deadline - 1).status).toBe('stored');
    expect(r.spectator.view().phase).toBe('end');
    r.spectator.tick(late + deadline);
    expect(r.spectator.view()).toMatchObject({ phase: 'done', forfeits: [C] });
    expect(r.spectator.view().audit).toEqual({ fail: [C], reason: 'withheld secret' });
  });

  it('without H’s and O’s end attestations the fork stops the game instead: no claim counts (H2), C rated last', () => {
    const ends = new Set(log.filter((e) => e.kind === 7456).map((e) => e.id));
    const r = replay(
      t,
      log.filter((e) => !ends.has(e.id)),
    );
    const v = r.spectator.view();
    expect(v).toMatchObject({ result: null, stop: { at: P, seat: C, cancelled: false } });
    expect((r.players[H] as GameSessionV2).timeoutTarget(LATE)).toBeNull();
    // The after-stop partial audit up to P cannot see the skip (it lies past P): C is last for its fork alone.
    expect(v.outcome?.places[C]).toBe(3);
  });

  it('V2-18, V2-19: a share O released anchored on C’s rival (its second device) keeps the end from standing: the anchor clause', () => {
    // O's deal, re-signed as a release anchored on the rival: its shares verify (the same D), and its anchor is off
    // X's line (proposal §6.7, "the cutoff without the anchor clause").
    const oKey = getPublicKey((t.game.ids[O] as Identity).sessionSk);
    const deal = log.find((e) => e.kind === 7453 && e.pubkey === oKey) as NostrEvent;
    const shares = parseSharesV2(deal) as { shares: PosShare[] };
    const onRival = finalizeEvent(
      cardSharesTemplate({ rootId: t.game.rootId, anchorId: rival.id, shares: shares.shares }, NOW + 2),
      (t.game.ids[O] as Identity).sessionSk,
      t.game.rnd,
    );
    const r = inOrders(t, [...log, onRival], 'n1-anchor', 2);
    for (const s of honest(r)) {
      const v = s.view();
      expect(v).toMatchObject({ result: null, stood: false, stop: { at: P, seat: C, cancelled: false } });
      expect(v.outcome?.places[C]).toBe(3);
    }
    // Anchored on X's head instead (past it), the same shares block nothing.
    const atHead = finalizeEvent(
      cardSharesTemplate({ rootId: t.game.rootId, anchorId: X, shares: shares.shares }, NOW + 3),
      (t.game.ids[O] as Identity).sessionSk,
      t.game.rnd,
    );
    expect(replay(t, [...log, atHead]).spectator.view()).toMatchObject({ stood: true, result: { head: X } });
  });

  it('the end attestation names the result: built with the session key, no prompt; its log hash covers X’s line', () => {
    const e = log.find((x) => x.kind === 7456) as NostrEvent;
    const head = (e.tags.find((x) => x[3] === 'head') as string[])[1];
    expect(head).toBe(X);
    // An attestation of X by C itself would change nothing (C is E): built here by hand for the record.
    const byC = finalizeEvent(
      endAttestTemplate(
        {
          rootId: t.game.rootId,
          headId: X,
          end: { kind: 'over', forfeit: [], logHash: JSON.parse(e.content).end.logHash as Hex },
        },
        NOW,
      ),
      (t.game.ids[C] as Identity).sessionSk,
      t.game.rnd,
    );
    const r = replay(t, [...log, byC]);
    expect(r.spectator.view()).toMatchObject({ stood: true, endAttested: [0, 1, 2] });
  });
});
