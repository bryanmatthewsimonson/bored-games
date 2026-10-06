/*
 * "Waiting for Ann (npub1…) to shuffle" (D057): who the game is waiting for, by name and short npub, from the
 * session's `waitingFor()` seats. Pure. Without it every client showed "Waiting for the other players' clients",
 * and nobody could tell which seat's app had to be opened.
 */
import type { Phase } from '@bored-games/client';
import type { Pending } from '@bored-games/game-kit';

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
}

/**
 * The line naming the seats the game waits on, other than this client's own (its client is working on those),
 * or null when it waits on nobody else:
 * - shuffle: "Waiting for Ann (npub1…) to shuffle. Their app must be open on this game.";
 * - deal: every seat still missing its deal shares, "… to send their deal shares. Their apps must be open …";
 * - play: a pending reshuffle names the next shuffler ("to shuffle"); otherwise only when the game waits on
 *   seats other than the one whose decision it is (the game's own status line names that one): the seats whose
 *   shares the decision or a reveal needs;
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
      if (p.type === 'shuffle') return `Waiting for ${who} to shuffle. ${open}`;
      return `Waiting for ${who} to send their shares. ${open}`;
    case 'end':
      return `Waiting for ${who} to send their end-of-game ${others.length === 1 ? 'secret' : 'secrets'}. ${open}`;
    default:
      return null;
  }
}
