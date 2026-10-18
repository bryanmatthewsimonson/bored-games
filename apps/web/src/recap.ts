/*
 * The recap (D095): which plays the board highlights, which arrived just now, and what a replay shows. Pure: the
 * game screen's effects hook (`game-effects.ts`) feeds it the session's module events and plays the sounds.
 *
 * The highlights cover every play since the viewer's own last one, so a player coming back to an asynchronous game
 * sees all that happened while they were away, on any device and without anything stored. A spectator, and a
 * player who just moved, see the latest play.
 */
import type { RecapStep, Recent } from './games/types.ts';
import type { Cue } from './sound.ts';

/**
 * The events `next` appended to `prev`, or null when that cannot be told: the first view, or a chain that
 * switched branch (the session then replaces the array with an older one). The session freezes each event once and
 * keeps it in every later array, so identity finds where `prev` ended even after the oldest events are dropped.
 */
export function appended(
  prev: readonly unknown[] | null,
  next: readonly unknown[],
): readonly unknown[] | null {
  if (prev === null) return null;
  if (prev === next) return [];
  if (prev.length === 0) return next;
  const last = prev[prev.length - 1];
  for (let i = next.length - 1; i >= 0; i--) if (next[i] === last) return next.slice(i + 1);
  return null;
}

/**
 * The plays since `mySeat`'s own last one, oldest first. A spectator (null), and a seat whose own play is the
 * newest, get the newest play alone; a seat that has not played yet gets every play.
 */
export function sinceOwn(steps: readonly RecapStep[], mySeat: number | null): readonly RecapStep[] {
  if (steps.length === 0) return [];
  const newest = steps.slice(-1);
  if (mySeat === null) return newest;
  let i = steps.length - 1;
  while (i >= 0 && steps[i]?.seat !== mySeat) i--;
  const after = steps.slice(i + 1);
  return after.length === 0 ? newest : after;
}

/** The board's highlights for `steps` (the newest one is `latest`), as `mySeat` sees them. */
export function recentOf(steps: readonly RecapStep[], mySeat: number | null, pulse: number): Recent {
  const newest = steps[steps.length - 1];
  return {
    marks: new Set(steps.flatMap((s) => s.marks)),
    latest: new Set(newest?.marks ?? []),
    mine: newest !== undefined && mySeat !== null && newest.seat === mySeat,
    pulse,
  };
}

/** During a replay, step `i` alone. */
export function replayRecent(
  steps: readonly RecapStep[],
  i: number,
  mySeat: number | null,
  pulse: number,
): Recent {
  const step = steps[i];
  return recentOf(step === undefined ? [] : [step], mySeat, pulse);
}

/** Loudest first: one cue per arrival, so a merger that lands with five events makes one sound. */
const PRIORITY: readonly Cue[] = ['gameOver', 'merge', 'capture', 'check', 'found', 'place', 'tick'];

/** The cue for plays that arrived together, or null when none has one. */
export function cueOf(steps: readonly RecapStep[]): Cue | null {
  let best: Cue | null = null;
  for (const s of steps) {
    if (s.cue === null) continue;
    if (best === null || PRIORITY.indexOf(s.cue) < PRIORITY.indexOf(best)) best = s.cue;
  }
  return best;
}

/** The title shown while it is the viewer's turn and the page is in the background. */
export const turnTitle = (title: string): string => `(Your turn) ${title}`;
