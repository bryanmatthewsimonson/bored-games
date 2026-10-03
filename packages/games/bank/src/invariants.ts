import { contributeOrder } from './engine.ts';
import type { BankLog, BankState } from './types.ts';

function safeMoney(n: number): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
}

function replayScores(log: readonly BankLog[], seats: number): number[] {
  const scores = Array.from({ length: seats }, () => 0);
  for (const entry of log) {
    if (entry.kind !== 'bank') continue;
    scores[entry.seat] = (scores[entry.seat] ?? 0) + entry.amount;
  }
  return scores;
}

/** Human-readable violations; empty when the state is sound. */
export function checkInvariants(s: BankState): string[] {
  const out: string[] = [];
  const n = s.seats;
  if (s.game !== 'bank') out.push('game id');
  if (n < 2 || n > 6) out.push('seat count');
  if (s.scores.length !== n || s.inRound.length !== n || s.banked.length !== n) out.push('per-seat arrays');
  if (!safeMoney(s.pot)) out.push('pot is not a safe integer');
  s.scores.forEach((score, seat) => {
    if (!safeMoney(score)) out.push(`score of seat ${seat}`);
  });
  const replayed = replayScores(s.log, n);
  if (s.scores.some((score, seat) => score !== replayed[seat])) out.push('scores are not the banked amounts');

  for (let seat = 0; seat < n; seat++) {
    const inRound = s.inRound[seat] === true;
    const banked = s.banked[seat];
    if (inRound !== (banked === null)) out.push(`seat ${seat} is in the round exactly until they bank`);
    if (typeof banked === 'number' && !safeMoney(banked)) out.push(`banked amount of seat ${seat}`);
  }

  if (s.passed.some((seat) => !Number.isInteger(seat) || seat < 0 || seat >= n)) out.push('passed seat');
  if (s.passed.some((seat, index) => index > 0 && seat <= (s.passed[index - 1] ?? -1)))
    out.push('passed is sorted');
  if (new Set(s.passed).size !== s.passed.length) out.push('passed repeats a seat');
  if (s.passed.some((seat) => s.inRound[seat] !== true)) out.push('a seat who passed is still in the round');

  if (s.schedule.length !== s.nextRollId) out.push('nextRollId is the schedule length');
  s.schedule.forEach((entry, index) => {
    if (entry.id !== index) out.push('schedule ids are 0..n-1');
    if (!Number.isInteger(entry.last) || entry.last < 0 || entry.last >= n) out.push('schedule last seat');
  });

  const over = s.phase === 'over';
  if (over !== (s.round === s.rules.rounds)) out.push('the game is over exactly after the last round');
  if (over !== (s.endReason === 'score')) out.push('end reason');
  if (!over && (s.round < 0 || s.round >= s.rules.rounds)) out.push('round index');
  if (s.roller < 0 || s.roller >= n) out.push('roller');
  if (!over && s.inRound[s.roller] !== true) out.push('the roller is still in the round');
  if (!Number.isInteger(s.rolls) || s.rolls < 0 || s.rolls > s.rules.maxRollsPerRound) out.push('roll count');
  if (!over && s.rolls >= s.rules.maxRollsPerRound) out.push('an open round stopped at the roll cap');

  if (s.phase === 'call' || s.phase === 'over') {
    if (s.owe.length !== 0 || s.openRoll !== null) out.push('no open roll in a call window');
  }
  if (s.phase === 'collect') {
    if (s.owe.length === 0 || s.openRoll === null) out.push('a contribution is owed');
  }
  if (s.phase === 'beacon') {
    if (s.owe.length !== 0 || s.openRoll === null) out.push('the beacon has no seat left to ask');
  }
  if (s.openRoll !== null) {
    const last = s.schedule[s.schedule.length - 1];
    if (last?.id !== s.openRoll || s.nextRollId !== s.openRoll + 1)
      out.push('open roll is the last commitment');
    const order = contributeOrder(s.roller, n);
    const owed = order.slice(order.length - s.owe.length);
    if (owed.length !== s.owe.length || owed.some((seat, index) => seat !== s.owe[index])) {
      out.push('contributions are the remaining suffix of the order');
    }
  }
  // Banking does not change the pot, and a round resets it, so it is 0 until the first resolution.
  if (s.rolls === 0 && s.pot !== 0) out.push('the pot is 0 before the first roll of a round');

  let bustOpen = false;
  for (const entry of s.log) {
    if (bustOpen && entry.kind !== 'round') out.push('a bust paid a seat or the round continued');
    if (entry.kind === 'round') bustOpen = false;
    else if (entry.kind === 'dice' && entry.effect === 'bust') bustOpen = true;
  }
  if (bustOpen && !over) out.push('a bust left the round open');

  return out;
}
