import { chess } from '@bored-games/chess';
import type { Hex, NostrEvent } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionViewV2 } from '../../src/types.ts';
import { gameRecord } from '../../src/v2/record.ts';
import { type AnyModule, act, actionAt, inOrders, runAuto, type V2Table, v2Table } from './helpers-v2.ts';

/*
 * The stats record (PROTOCOL-v2 §7.5, F5; build plan D-H, T10): `gameRecord(view)`, a pure function of the session's
 * view, computed from the held events and never from attestations. Real games give the `over` result and the stop;
 * the claim and resign kinds are built by hand from a real view here (the sessions count them since T12:
 * `claims-resign.test.ts`).
 */

const mv = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });

/** Fool's mate: Black mates on move 4. */
function foolsMate(seed: string): { t: V2Table; moves: NostrEvent[] } {
  const t = v2Table(chess as AnyModule, 2, seed);
  const plies: [number, string][] = [
    [0, 'f2f3'],
    [1, 'e7e5'],
    [0, 'g2g4'],
    [1, 'd8h4'],
  ];
  const moves = plies.map(([seat, uci]) => act(t, seat, mv(seat, uci)));
  return { t, moves };
}

/** A view of a live game, to build other views from. */
function liveView(): SessionViewV2 {
  return v2Table(chess as AnyModule, 2, 'record-live').spectator.view();
}

const HEAD = 'ab'.repeat(32) as Hex;

describe('gameRecord (PROTOCOL-v2 §7.5)', () => {
  it('records nothing while the game is live', () => {
    expect(gameRecord(liveView())).toBeNull();
  });

  it('records an over result as any result: its places, every seat rated, nobody recorded', () => {
    const { t } = foolsMate('record-over');
    runAuto(t, ['end']);
    const v = t.spectator.view();
    expect(v.result?.kind).toBe('over');
    expect(gameRecord(v)).toEqual({
      ending: 'over',
      places: [...(v.outcome?.places ?? [])],
      rated: [true, true],
      endedBy: null,
      equivocators: [],
      secretWithheld: [],
      auditIncomplete: false,
    });
    expect(v.outcome?.places).toEqual([2, 1]);
  });

  it('records nothing for an over result still waiting for its audit (no outcome yet)', () => {
    const v: SessionViewV2 = {
      ...liveView(),
      result: { kind: 'over', head: HEAD, forfeit: [] },
      outcome: null,
    };
    expect(gameRecord(v)).toBeNull();
  });

  it('records a claim, rated for every seat, with its forfeiting places', () => {
    const v: SessionViewV2 = {
      ...liveView(),
      phase: 'done',
      result: { kind: 'claim', head: HEAD, forfeit: [1] },
      outcome: { places: [1, 2], reason: 'timeout', scores: [0, 0] },
    };
    expect(gameRecord(v)).toMatchObject({
      ending: 'claim',
      places: [1, 2],
      rated: [true, true],
      endedBy: null,
    });
  });

  it('records an unrated Resign of 3 or more seats: nothing rated, the resigner recorded as ending it', () => {
    const v: SessionViewV2 = {
      ...liveView(),
      seats: 3,
      phase: 'done',
      result: { kind: 'resign', head: HEAD, forfeit: [2] },
      outcome: {
        places: [1, 2, 3],
        reason: 'resign',
        scores: [5, 3, 0],
        unrated: true,
        endedBy: { type: 'resign', seat: 2 },
      },
    };
    expect(gameRecord(v)).toMatchObject({
      ending: 'resign',
      places: [1, 2, 3],
      rated: [false, false, false],
      endedBy: 2,
    });
  });

  it('records a result that stood against a fork like any result, with its equivocators and no change to places', () => {
    const v: SessionViewV2 = {
      ...liveView(),
      phase: 'done',
      result: { kind: 'over', head: HEAD, forfeit: [] },
      stood: true,
      equivocators: [1],
      outcome: { places: [2, 1], reason: 'mate', scores: [0, 1] },
    };
    expect(gameRecord(v)).toEqual({
      ending: 'over',
      places: [2, 1],
      rated: [true, true],
      endedBy: null,
      equivocators: [1],
      secretWithheld: [],
      auditIncomplete: false,
    });
  });

  it('V2-41 counts a 2-seat stop from its fork certificate, in any order: a rated loss for E, a rated win for the other', () => {
    const { t, moves } = foolsMate('record-stop');
    const m2 = moves[1] as NostrEvent;
    // White signs a second move 3 on m2, after the mate was played on the other side: a stop at m2, never the mate.
    const rival = actionAt(t, 0, m2.id, 3, mv(0, 'b1c3'));
    const r = inOrders(t, [...t.log, rival], 'record-stop');
    const v = r.spectator.view();
    expect(v.attested).toEqual([]);
    expect(v.endAttested).toEqual([]);
    expect(gameRecord(v)).toEqual({
      ending: 'stop',
      places: [2, 1],
      rated: [true, true],
      endedBy: 0,
      equivocators: [0],
      secretWithheld: [],
      auditIncomplete: false,
    });
  });

  it('records a stop with 3 or more seats: only the equivocators rated, each last; a stop not yet scored records nothing', () => {
    const base = liveView();
    const stopped: SessionViewV2 = {
      ...base,
      seats: 4,
      phase: 'done',
      fork: { at: HEAD, seat: 1, certificate: [] },
      stop: { at: HEAD, seat: 1, cancelled: false },
      equivocators: [1, 3],
      secretWithheld: [2],
      auditIncomplete: true,
      outcome: { places: [1, 3, 2, 3], reason: 'stop', scores: [4, 2, 1, 7] },
    };
    expect(gameRecord(stopped)).toEqual({
      ending: 'stop',
      places: [1, 3, 2, 3],
      rated: [false, true, false, true],
      endedBy: 1,
      equivocators: [1, 3],
      secretWithheld: [2],
      auditIncomplete: true,
    });
    expect(gameRecord({ ...stopped, outcome: null })).toBeNull();
  });

  it('records a cancelled game as nothing: no places, nothing rated, the seat that forked recorded', () => {
    const v: SessionViewV2 = {
      ...liveView(),
      phase: 'cancelled',
      fork: { at: HEAD, seat: 0, certificate: [] },
      stop: { at: HEAD, seat: 0, cancelled: true },
      equivocators: [0],
    };
    expect(gameRecord(v)).toEqual({
      ending: 'cancelled',
      places: [],
      rated: [false, false],
      endedBy: 0,
      equivocators: [0],
      secretWithheld: [],
      auditIncomplete: false,
    });
  });
});
