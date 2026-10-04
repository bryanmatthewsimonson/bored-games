import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { createRng } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type Hex,
  type NostrEvent,
  secretTemplate,
  timeoutTemplate,
} from '@bored-games/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity } from '../../src/types.ts';
import { gameRecord } from '../../src/v2/record.ts';
import type { GameSessionV2 } from '../../src/v2/session.ts';
import { MODULES, NOW } from '../helpers.ts';
import {
  type AnyModule,
  act,
  decider,
  inOrders,
  quick,
  replay,
  runAuto,
  send,
  trustSteps,
  type V2Table,
  v2Session,
  v2Table,
} from './helpers-v2.ts';

/*
 * After a stop in a game with a deck (PROTOCOL-v2 §7.3, review H2; build plan T10; vector 5 of §12.2, in part): every
 * seat owes its Secret reveal, the places are fixed at the stop, a missing secret only records "secret withheld" and
 * leaves the game "audit incomplete", no Timeout claim counts, and the partial audit runs once the held secrets and
 * shares decrypt every position: only a proven failure demotes a seat, to just above the equivocators, and a verdict
 * that fails every seat demotes nobody. Chain Reaction, 3 seats.
 */

let base: V2Table;
/** The stop: the seat that forked and the head it forked on. */
let E: number;
let P: Hex;
/** The base log up to and including the fork's two moves. */
let stopped: NostrEvent[];
/** Every seat's Secret reveal, by seat. */
let secrets: NostrEvent[];

beforeAll(() => {
  base = v2Table(chainReaction as AnyModule, 3, 'after-stop');
  for (let k = 0; k < 3; k++) {
    const ev = (base.players[k] as GameSessionV2).buildShuffle(base.game.rnd, NOW);
    trustSteps(base.all, [ev]);
    send(base, ev);
  }
  runAuto(base, ['deal']);
  const rng = createRng('after-stop');
  // Every seat places a few tiles (two rounds), with the releases.
  for (let i = 0; i < 7; i++) {
    const k = decider(base) as number;
    act(base, k, quick(base.players[k]?.legalActions() ?? [], k, rng));
    runAuto(base, ['release']);
  }
  E = decider(base) as number;
  P = base.spectator.view().head.id;
  const s = base.players[E] as GameSessionV2;
  const legal = s.legalActions();
  // Both built on P before either is sent: a fork at P, signed by E.
  const a = s.buildAction(legal[0], base.game.rnd, NOW);
  const b = s.buildAction(legal[legal.length - 1], base.game.rnd, NOW + 1);
  send(base, a);
  send(base, b);
  stopped = [...base.log];
  secrets = base.game.ids.map((id) =>
    finalizeEvent(
      secretTemplate({ rootId: base.game.rootId, deckSecret: id.deckSecret }, NOW, '2'),
      id.sessionSk,
      base.game.rnd,
    ),
  );
}, 300_000);

/** The places of the stop at P: E last, the others by standings at P. */
function placesAtP(t: V2Table): number[] {
  const scores = chainReaction.standings(t.spectator.view().state as ChainReactionState);
  const top = [0, 1, 2].filter((k) => k !== E);
  return [0, 1, 2].map((k) =>
    k === E ? 3 : 1 + top.filter((j) => (scores[j] as number) > (scores[k] as number)).length,
  );
}

/** A spectator on `modules`, holding `log` (steps trusted). */
function spectatorOn(modules: ReadonlyMap<string, AnyModule>, log: readonly NostrEvent[]): GameSessionV2 {
  const s = v2Session(base.game, null, modules);
  trustSteps([s], log.slice(0, 3));
  for (const ev of log) s.receive(ev, NOW);
  return s;
}

describe('after a stop in Chain Reaction (3 seats)', () => {
  it('V2-40 fixes the places at the stop: every seat owes its secret, a missing one only records "secret withheld", and no claim counts', () => {
    const t = replay(base, stopped);
    const places = placesAtP(t);
    const v0 = t.spectator.view();
    expect(v0.stop).toEqual({ at: P, seat: E, cancelled: false });
    expect(v0).toMatchObject({ phase: 'done', audit: 'pending', auditIncomplete: true, forfeits: [E] });
    expect(v0.outcome).toMatchObject({ places, reason: 'stop' });
    expect(v0.secretWithheld).toEqual([0, 1, 2]);
    for (const p of t.players) expect(p.duties()).toEqual([{ kind: 'secret' }]);
    // E's secret and one honest seat's arrive; the third honest seat never publishes (review H2).
    const missing = [0, 1, 2].find((k) => k !== E) as number;
    for (const k of [0, 1, 2].filter((x) => x !== missing)) {
      const ev = (t.players[k] as GameSessionV2).buildSecret(t.game.rnd, NOW);
      expect(send(t, ev)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
      expect(t.players[k]?.duties()).toEqual([]);
    }
    // A claim against the missing seat, long after its deadline: held, never counted; nobody is stalled.
    const claimant = (t.game.ids[E] as Identity).sessionSk;
    const claim = finalizeEvent(
      timeoutTemplate({ rootId: t.game.rootId, headId: P, seat: missing }, NOW, '2'),
      claimant,
      t.game.rnd,
    );
    const late = NOW + 365 * 86_400;
    for (const s of t.all) {
      expect(s.receive(claim, late)).toEqual({ status: 'stored' });
      s.tick(late);
      expect(s.waitingFor()).toEqual([]);
      const v = s.view();
      // The places stand; the missing seat is recorded, never demoted; the audit cannot run.
      expect(v.outcome?.places).toEqual(places);
      expect(v.secretWithheld).toEqual([missing]);
      expect(v.auditIncomplete).toBe(true);
      expect(v.audit).toBe('pending');
      expect(v.forfeits).toEqual([E]);
    }
    for (const p of t.players) expect(p.timeoutTarget(late)).toBeNull();
    expect(t.players[missing]?.duties()).toEqual([{ kind: 'secret' }]);
  });

  it('V2-55 (partial) records each "secret withheld" seat and "audit incomplete" in the stats record (the screens are T17)', () => {
    const missing = [0, 1, 2].find((k) => k !== E) as number;
    const t = replay(base, [...stopped, ...secrets.filter((_, k) => k !== missing)]);
    expect(gameRecord(t.spectator.view())).toEqual({
      ending: 'stop',
      places: placesAtP(t),
      rated: [0, 1, 2].map((k) => k === E),
      endedBy: E,
      equivocators: [E],
      secretWithheld: [missing],
      auditIncomplete: true,
    });
    // Once every secret is in, the partial audit runs: nobody withheld, the audit complete.
    send(t, secrets[missing] as NostrEvent);
    expect(gameRecord(t.spectator.view())).toMatchObject({ secretWithheld: [], auditIncomplete: false });
  });

  it('V2-41 counts the stop from its fork certificate: the record needs no attestation, and none is owed or built (V2-38)', () => {
    const t = replay(base, [...stopped, ...secrets]);
    const v = t.spectator.view();
    expect(v.fork?.seat).toBe(E);
    expect(v.fork?.certificate).toHaveLength(2);
    expect(v.endAttested).toEqual([]);
    expect(v.attested).toEqual([]);
    expect(gameRecord(v)).toMatchObject({ ending: 'stop', endedBy: E, equivocators: [E] });
    for (const p of t.players) {
      expect(p.duties()).toEqual([]);
      expect(() => p.buildEndAttest(t.game.rnd, NOW)).toThrow(/no end duty/);
      expect(() => p.attestTemplate(NOW)).toThrow(/no attest duty/);
    }
  });

  it('V2-40 runs the partial audit once every secret is held: a pass changes nothing, in any arrival order', () => {
    const t = inOrders(base, [...stopped, ...secrets], 'after-stop-pass', 2);
    for (const s of t.all) {
      const v = s.view();
      expect(v).toMatchObject({ phase: 'done', audit: 'pass', auditIncomplete: false, forfeits: [E] });
      expect(v.secretWithheld).toEqual([]);
      expect(v.outcome).toMatchObject({ places: placesAtP(t), reason: 'stop' });
    }
  });

  it('V2-40 demotes a seat only for a proven audit failure, to just above the equivocators; a failure of E, or of every seat, demotes nobody', () => {
    const log = [...stopped, ...secrets];
    const reference = replay(base, log).spectator.view();
    const placed = (s: ChainReactionState, a: unknown, k: number): boolean => {
      const x = a as { type?: string; actor?: number };
      return s.mode === 'full' && x.type === 'place' && x.actor === k;
    };
    /** A registry whose full-mode engine rejects `k`'s placements (the view-mode game is unchanged). */
    const rejecting = (k: number): ReadonlyMap<string, AnyModule> =>
      new Map([
        ...MODULES,
        [
          chainReaction.id,
          {
            ...chainReaction,
            apply: (s: ChainReactionState, a: unknown) =>
              placed(s, a, k)
                ? { ok: false, error: { code: 'audit', message: 'test: refused in full mode' } }
                : chainReaction.apply(s, a as never),
          } as AnyModule,
        ],
      ]);
    // An honest seat fails: it moves to just above E (second of three), the other honest seat first.
    const cheat = [0, 1, 2].find((k) => k !== E) as number;
    const honest = [0, 1, 2].find((k) => k !== E && k !== cheat) as number;
    const failed = spectatorOn(rejecting(cheat), log).view();
    expect(failed.audit).toMatchObject({ fail: [cheat] });
    expect(failed.forfeits).toEqual([E, cheat].sort((a, b) => a - b));
    expect(failed.outcome?.places[honest]).toBe(1);
    expect(failed.outcome?.places[cheat]).toBe(2);
    expect(failed.outcome?.places[E]).toBe(3);
    expect(failed.outcome?.scores).toEqual(reference.outcome?.scores);
    expect(failed.stop).toEqual(reference.stop);
    // Before its secret arrives the same game is "audit incomplete", with the stop's places.
    const early = spectatorOn(rejecting(cheat), stopped).view();
    expect(early).toMatchObject({ auditIncomplete: true, audit: 'pending', forfeits: [E] });
    expect(early.outcome).toEqual(reference.outcome);
    // E fails: E is already last; nothing changes but the verdict.
    const byE = spectatorOn(rejecting(E), log).view();
    expect(byE.audit).toMatchObject({ fail: [E] });
    expect(byE.outcome).toEqual(reference.outcome);
    expect(byE.forfeits).toEqual([E]);
    // A full-mode setup that refuses the order fails every seat: nobody is proven to blame, nobody moves.
    const refusing = new Map([
      ...MODULES,
      [
        chainReaction.id,
        {
          ...chainReaction,
          setup: (input: Parameters<typeof chainReaction.setup>[0]) =>
            input.mode === 'full'
              ? { ok: false as const, error: { code: 'audit', message: 'test: refused' } }
              : chainReaction.setup(input),
        } as AnyModule,
      ],
    ]);
    const all = spectatorOn(refusing, log).view();
    expect(all.audit).toMatchObject({ fail: [0, 1, 2] });
    expect(all.outcome).toEqual(reference.outcome);
    expect(all.forfeits).toEqual([E]);
  });
});
