/*
 * "Waiting for Ann (npub1…) to shuffle" (D057): who the game is waiting for, by name and short npub, from the
 * session's `waitingFor()` seats. Pure. Without it every client showed "Waiting for the other players' clients",
 * and nobody could tell which seat's app had to be opened.
 */
import type { Phase } from '@bored-games/client';
import type { Pending } from '@bored-games/game-kit';

/** "2d 4h left", "3h 10m left", "1m left", or "deadline passed", from seconds remaining. */
export function formatDeadline(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'deadline passed';
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

/** "2d 4h", "3h 10m", "1m": a duration from seconds, for "within …". */
function duration(seconds: number): string {
  return formatDeadline(seconds).replace(/ left$/, '');
}

/**
 * How a game names a share it waits for out of turn (D060), from its web registry entry (`SetupCopy.share`):
 * `act` follows "Waiting for Ann to", `owed` follows "You owe".
 */
export interface ShareWords {
  act: string;
  owed: string;
}

/** The wording for a game that names none: neutral, true of any share. */
export const NEUTRAL_SHARE: ShareWords = { act: 'send their share', owed: 'a share' };

/** "Ann", "Ann and Bo", "Ann, Bo and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface WaitingInput {
  phase: Phase;
  pending: Pending;
  /** This client's seat, or null for a spectator. */
  mySeat: number | null;
  /** The seats the game waits on at the head (`GameSession.waitingFor()`), ascending. */
  waiting: readonly number[];
  /** Each seat's display name ("Ann (npub1…)", or the short npub). */
  names: readonly string[];
  /**
   * In play: the seconds left before the seats the game waits on can be timed out (`pendingSince + deadline − now`),
   * so the line says when (D060). Left out, the line names no deadline.
   */
  secondsLeft?: number;
  /** How this game names the share (`ShareWords`); `NEUTRAL_SHARE` when left out. */
  share?: ShareWords;
}

/**
 * A card reveal the game waits on (D060): in play, the seats whose share of a card the game needs before anyone can
 * act, other than the deciding seat itself. In Luster, a market refill (every seat's share) or another seat's blind
 * reservation (every other seat's share); in any game, the shares a decision waits for. A seat that owes one can be
 * timed out once `until` passes, though it is not its turn.
 */
export interface OwedReveal {
  /** The seats that owe their share, ascending (this client's own seat included). */
  seats: readonly number[];
  /** When the deadline passes (Unix seconds): the pending position's progress time plus the table's deadline. */
  until: number;
}

export function owedReveal(input: {
  phase: Phase;
  pending: Pending;
  waiting: readonly number[];
  /** `SessionView.pendingSince`. */
  pendingSince: number;
  /** `SessionView.deadline`, seconds. */
  deadline: number;
}): OwedReveal | null {
  if (input.phase !== 'play') return null;
  const p = input.pending;
  const seats =
    p.type === 'reveal'
      ? [...input.waiting]
      : p.type === 'player'
        ? input.waiting.filter((seat) => seat !== p.seat)
        : [];
  if (seats.length === 0) return null;
  return { seats, until: input.pendingSince + input.deadline };
}

/** "If it is not sent within 2d 4h, Ann can be timed out.", or that the deadline has passed. */
function deadlineSentence(who: string, secondsLeft: number, plural: boolean): string {
  if (secondsLeft <= 0) return `The deadline has passed: ${who} can be timed out.`;
  return `If ${plural ? 'they are' : 'it is'} not sent within ${duration(secondsLeft)}, ${who} can be timed out.`;
}

/**
 * This client's own line when its seat owes a card reveal (D060): its app sends the share by itself, so the player
 * only has to keep the game open; shown when it is not sending right now (held back, stuck, or not delivered).
 */
export function ownRevealLine(
  owed: OwedReveal | null,
  mySeat: number | null,
  now: number,
  share: ShareWords = NEUTRAL_SHARE,
): string | null {
  if (owed === null || mySeat === null || !owed.seats.includes(mySeat)) return null;
  return `You owe ${share.owed}: keep this game open until it is sent. ${deadlineSentence('you', owed.until - now, false)}`;
}

/**
 * The line naming the seats the game waits on, other than this client's own (its client is working on those),
 * or null when it waits on nobody else:
 * - shuffle: "Waiting for Ann (npub1…) to shuffle. Their app must be open on this game.";
 * - deal: every seat still missing its deal shares, "… to send their deal shares. Their apps must be open …";
 * - play: only when the game waits on seats other than the one whose decision it is (the game's own status line
 *   names that one): the seats whose share of a card the decision or a reveal needs, "Waiting for Ann to reveal a
 *   card", with when they can be timed out for it (D060);
 * - end: the seats whose end-of-game secret is not in.
 */
export function waitingLine(input: WaitingInput): string | null {
  const others = input.waiting.filter((seat) => seat !== input.mySeat);
  if (others.length === 0) return null;
  const p = input.pending;
  if (input.phase === 'play' && p.type === 'player' && others.length === 1 && others[0] === p.seat)
    return null;
  const who = listNames(others.map((seat) => input.names[seat] ?? `Seat ${seat + 1}`));
  const open =
    others.length === 1 ? 'Their app must be open on this game.' : 'Their apps must be open on this game.';
  switch (input.phase) {
    case 'shuffle':
      return `Waiting for ${who} to shuffle. ${open}`;
    case 'deal':
      return `Waiting for ${who} to send their deal shares. ${open}`;
    case 'play':
      // A card reveal owed out of turn (D060): who owes it, and when they can be timed out for it.
      return input.secondsLeft === undefined
        ? `Waiting for ${who} to ${(input.share ?? NEUTRAL_SHARE).act}. ${open}`
        : `Waiting for ${who} to ${(input.share ?? NEUTRAL_SHARE).act}. ${open} ${deadlineSentence(who, input.secondsLeft, others.length > 1)}`;
    case 'end':
      return `Waiting for ${who} to send their end-of-game ${others.length === 1 ? 'secret' : 'secrets'}. ${open}`;
    default:
      return null;
  }
}
