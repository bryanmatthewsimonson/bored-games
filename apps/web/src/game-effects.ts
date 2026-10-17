/*
 * The game screen's effects (D095): the highlights of the plays since the viewer's last one, a sound when a play
 * arrives, a chime when it becomes the viewer's move, and the tab title while that waits in the background. Plays
 * already on the chain when the screen opens are highlighted but make no sound; only arrivals do.
 */
import type { SessionView } from '@bored-games/client';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { platformTimers } from './clock.ts';
import type { GameStatus } from './game-controller.ts';
import type { RecapStep, Recent, WebGame } from './games/types.ts';
import { appended, cueOf, recentOf, replayRecent, sinceOwn, turnTitle } from './recap.ts';
import { type Cue, type SoundMode, soundBoard, unlockOnGesture } from './sound.ts';

/** How long each replay step shows. */
export const REPLAY_STEP_MS = 900;

/** The pause between a play's sound and the turn chime that follows it. */
const CHIME_AFTER_MS = 350;

export interface GameEffects {
  /** The plays since the viewer's own last one, oldest first (empty for a game without a recap). */
  readonly since: readonly RecapStep[];
  /** What the board highlights; undefined for a game without a recap. */
  readonly recent: Recent | undefined;
  /** The replay step on show, or null. */
  readonly replaying: number | null;
  replay(): void;
  stopReplay(): void;
}

export function useGameEffects(input: {
  game: WebGame | undefined;
  view: SessionView | null;
  status: GameStatus;
  names: readonly string[];
  sound: SoundMode;
  title: string;
}): GameEffects {
  const { game, view, status, names, sound, title } = input;
  const events = view?.events ?? null;
  const recap = game?.recap;
  const steps = useMemo(
    () => (recap === undefined || events === null ? [] : recap(events, names)),
    [recap, events, names],
  );
  const mySeat = view?.mySeat ?? null;
  const since = useMemo(() => sinceOwn(steps, mySeat), [steps, mySeat]);
  const [pulse, setPulse] = useState(0);
  const [replaying, setReplaying] = useState<number | null>(null);

  // The sound mode as of now, for timers that fire later.
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const play = (cue: Cue) => soundBoard.play(cue, soundRef.current);

  useEffect(() => unlockOnGesture(soundBoard), []);

  // A play that arrived: restart the highlight's animation and play its cue (a tick in a game without a recap).
  const prevEvents = useRef<readonly unknown[] | null>(null);
  const prevSeq = useRef<number | null>(null);
  useEffect(() => {
    if (events === null || view === null) return;
    const added = appended(prevEvents.current, events);
    const seqBefore = prevSeq.current;
    prevEvents.current = events;
    prevSeq.current = view.head.seq;
    if (added === null || seqBefore === null || view.head.seq <= seqBefore) return;
    const arrived = recap === undefined ? [] : recap(added, names);
    // A move with no step of its own (a purchase, or any move in a game without a recap) still ticks.
    if (arrived.length === 0) {
      if (view.phase === 'play') play('tick');
      return;
    }
    setReplaying(null);
    setPulse((p) => p + 1);
    play(cueOf(arrived) ?? 'tick');
  }, [events, view, recap, names]);

  // It became the viewer's move: a chime (after the play's own sound), and the tab title while hidden.
  const prevStatus = useRef<GameStatus | null>(null);
  useEffect(() => {
    const before = prevStatus.current;
    prevStatus.current = status;
    if (status !== 'your-turn' || before === null || before === 'syncing' || before === 'your-turn') return;
    return platformTimers.later(CHIME_AFTER_MS, () => play('yourTurn'));
  }, [status]);
  const yourTurn = status === 'your-turn';
  useEffect(() => {
    if (!yourTurn) return;
    const original = document.title;
    const apply = () => {
      document.title = document.hidden ? turnTitle(title) : original;
    };
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => {
      document.removeEventListener('visibilitychange', apply);
      document.title = original;
    };
  }, [yourTurn, title]);

  // The game left play while the screen was open.
  const prevPhase = useRef<string | null>(null);
  const phase = view?.phase ?? null;
  useEffect(() => {
    const before = prevPhase.current;
    prevPhase.current = phase;
    if (before === 'play' && (phase === 'end' || phase === 'done')) play('gameOver');
  }, [phase]);

  // The replay: one step at a time, each with its sound, then back to the highlights.
  useEffect(() => {
    if (replaying === null) return;
    const step = since[replaying];
    if (step === undefined) {
      setReplaying(null);
      return;
    }
    if (step.cue !== null) play(step.cue);
    return platformTimers.later(REPLAY_STEP_MS, () => {
      setPulse((p) => p + 1);
      setReplaying((i) => (i === null || i + 1 >= since.length ? null : i + 1));
    });
  }, [replaying, since]);

  const recent = useMemo(() => {
    if (recap === undefined) return undefined;
    return replaying === null
      ? recentOf(since, mySeat, pulse)
      : replayRecent(since, replaying, mySeat, pulse);
  }, [recap, since, replaying, mySeat, pulse]);

  return {
    since,
    recent,
    replaying,
    replay: () => {
      if (since.length === 0) return;
      setPulse((p) => p + 1);
      setReplaying(0);
    },
    stopReplay: () => setReplaying(null),
  };
}
