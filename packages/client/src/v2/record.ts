import type { SessionViewV2 } from '../types.ts';

/*
 * The stats record of a protocol 2 game (PROTOCOL-v2 §7.5, F5; build plan D-H): a pure function of the session's
 * view, which Phase 4's records will store. It is computed from the held events alone (the view is), never from
 * attestations: a stop has none, and counts from its fork certificate.
 *
 * - A result (over, claim, resign; one that stood against a fork included) counts as any result: its places, rated
 *   for every seat unless the result is unrated (a Resign of 3 or more seats, v1 §8.3), with its `endedBy`.
 * - A stop: 2 seats, a rated loss for E and a rated win for the other seat (a rated tie when both equivocated, or
 *   when the other seat failed the partial audit); 3 or more seats, only the shared last places are rated (every
 *   equivocator's and every seat a proven audit failure demoted, D067: each last against every other seat, tied
 *   among themselves), and no other pair's rating moves. E is the seat that ended the game. A stop is no completion and
 *   no win for the other seats (the reader's matter: `ending` says `stop`).
 * - A cancelled game counts for nothing: no places, nothing rated; the seat that forked is recorded (`endedBy`,
 *   `equivocators`).
 * - Every equivocator is recorded, and every seat recorded as "secret withheld" after a stop (an anti-cheat mark);
 *   a stop whose partial audit could not run is "audit incomplete".
 *
 * `rated` is the only rating flag to read (review of T10, I2): a 3-or-more-seat stop is rated for some seats and not
 * others, which `Outcome.unrated` (one flag for the whole result) cannot carry, so a stop's outcome has no `unrated`.
 * A deck stop's record may change while it is "audit incomplete" (a demotion once the last secret arrives).
 */

export interface GameRecord {
  readonly ending: 'over' | 'claim' | 'resign' | 'stop' | 'cancelled';
  /** 1-based places per seat (ties share a place); empty for a cancelled game. */
  readonly places: readonly number[];
  /** Whether each seat's place counts toward its rating. */
  readonly rated: readonly boolean[];
  /** The seat that ended the game outside its rules: E for a stop or a cancel, the resigner of an unrated Resign. */
  readonly endedBy: number | null;
  /** The seats recorded as equivocators (§5.2, M1), ascending. */
  readonly equivocators: readonly number[];
  /** The seats recorded as "secret withheld" after a stop (§7.3), ascending. */
  readonly secretWithheld: readonly number[];
  /** A stop whose partial audit cannot run for want of a secret (§7.3, N3). */
  readonly auditIncomplete: boolean;
}

/**
 * The stats record of the game `view` shows, or null while it has no final standing to record: live, or over and
 * still waiting for its audit (a deck game's secrets).
 */
export function gameRecord(view: SessionViewV2): GameRecord | null {
  const seats = view.seats;
  const equivocators = [...view.equivocators];
  const marks = { secretWithheld: [...view.secretWithheld], auditIncomplete: view.auditIncomplete };
  if (view.stop !== null && view.result === null) {
    if (view.stop.cancelled)
      return {
        ending: 'cancelled',
        places: [],
        rated: new Array<boolean>(seats).fill(false),
        endedBy: view.stop.seat,
        equivocators,
        ...marks,
      };
    if (view.outcome === null) return null;
    // The shared last places: the equivocators and the seats a proven audit failure demoted (a stop's forfeits).
    const last = new Set([...equivocators, ...view.forfeits]);
    const rated = Array.from({ length: seats }, (_, k) => seats === 2 || last.has(k));
    return {
      ending: 'stop',
      places: [...view.outcome.places],
      rated,
      endedBy: view.stop.seat,
      equivocators,
      ...marks,
    };
  }
  if (view.result === null || view.outcome === null) return null;
  const unrated = view.outcome.unrated === true;
  return {
    ending: view.result.kind,
    places: [...view.outcome.places],
    rated: new Array<boolean>(seats).fill(!unrated),
    endedBy: view.outcome.endedBy?.seat ?? null,
    equivocators,
    ...marks,
  };
}
