/*
 * Sound cues (D095): short tones synthesized with the Web Audio API, so the app ships no audio files and adds no
 * dependency. A cue is a few notes; each note is one oscillator through its own gain envelope. Browsers keep an
 * AudioContext suspended until the page gets a click or a key press, so the board unlocks on the first one and
 * stays silent before it. Nothing here touches the game: a cue only says what the viewer's own view shows.
 */

/** What a cue is for. Games name the cue of each step in their recap (`WebGame.recap`). */
export type Cue = 'place' | 'capture' | 'check' | 'found' | 'merge' | 'tick' | 'yourTurn' | 'gameOver';

/** The player's choice in Settings: no sound, only the turn alerts, or every cue. */
export type SoundMode = 'off' | 'turn' | 'all';

export const SOUND_MODES: readonly SoundMode[] = ['off', 'turn', 'all'];

export const isSoundMode = (v: unknown): v is SoundMode => SOUND_MODES.includes(v as SoundMode);

/** The cues the `turn` mode keeps: it is your move, and the game is over. */
const ALERTS: ReadonlySet<Cue> = new Set<Cue>(['yourTurn', 'gameOver']);

/** Whether `mode` plays `cue`. */
export function cueAllowed(mode: SoundMode, cue: Cue): boolean {
  return mode === 'all' || (mode === 'turn' && ALERTS.has(cue));
}

/** One note: `at` and `dur` in seconds from the cue's start, `gain` the peak (0–1), `to` an optional glide. */
export interface Note {
  readonly wave: 'sine' | 'triangle' | 'square' | 'sawtooth';
  readonly freq: number;
  readonly at: number;
  readonly dur: number;
  readonly gain: number;
  readonly to?: number;
}

/** The notes of every cue. Quiet and short: the loudest peak is 0.3 and no cue lasts a second. */
export const PATCHES: Readonly<Record<Cue, readonly Note[]>> = {
  // A wooden click: a quick falling triangle.
  place: [{ wave: 'triangle', freq: 520, to: 260, at: 0, dur: 0.09, gain: 0.25 }],
  // A thud and a knock.
  capture: [
    { wave: 'triangle', freq: 180, to: 90, at: 0, dur: 0.16, gain: 0.3 },
    { wave: 'square', freq: 700, to: 350, at: 0, dur: 0.04, gain: 0.06 },
  ],
  // Two short high beeps.
  check: [
    { wave: 'square', freq: 880, at: 0, dur: 0.07, gain: 0.08 },
    { wave: 'square', freq: 880, at: 0.11, dur: 0.07, gain: 0.08 },
  ],
  // A rising pair: something new on the board.
  found: [
    { wave: 'triangle', freq: 440, at: 0, dur: 0.12, gain: 0.2 },
    { wave: 'triangle', freq: 660, at: 0.1, dur: 0.18, gain: 0.2 },
  ],
  // A low sweep up, then a chord: two things become one.
  merge: [
    { wave: 'sawtooth', freq: 110, to: 330, at: 0, dur: 0.3, gain: 0.08 },
    { wave: 'triangle', freq: 330, at: 0.28, dur: 0.3, gain: 0.18 },
    { wave: 'triangle', freq: 495, at: 0.28, dur: 0.3, gain: 0.14 },
  ],
  // The quietest cue: a move arrived in a game without its own cues.
  tick: [{ wave: 'sine', freq: 660, at: 0, dur: 0.06, gain: 0.12 }],
  // A soft three-note chime, rising.
  yourTurn: [
    { wave: 'sine', freq: 659, at: 0, dur: 0.22, gain: 0.22 },
    { wave: 'sine', freq: 784, at: 0.14, dur: 0.22, gain: 0.22 },
    { wave: 'sine', freq: 1047, at: 0.28, dur: 0.4, gain: 0.2 },
  ],
  // A falling-then-resolving phrase.
  gameOver: [
    { wave: 'triangle', freq: 523, at: 0, dur: 0.25, gain: 0.2 },
    { wave: 'triangle', freq: 392, at: 0.22, dur: 0.25, gain: 0.2 },
    { wave: 'triangle', freq: 523, at: 0.44, dur: 0.45, gain: 0.2 },
    { wave: 'triangle', freq: 659, at: 0.44, dur: 0.45, gain: 0.14 },
  ],
};

/** The part of an AudioContext the board uses, so tests can pass a fake. */
export interface AudioLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: {
      setValueAtTime(v: number, t: number): unknown;
      exponentialRampToValueAtTime(v: number, t: number): unknown;
    };
    connect(node: unknown): unknown;
    start(t: number): void;
    stop(t: number): void;
  };
  createGain(): {
    gain: {
      setValueAtTime(v: number, t: number): unknown;
      linearRampToValueAtTime(v: number, t: number): unknown;
      exponentialRampToValueAtTime(v: number, t: number): unknown;
    };
    connect(node: unknown): unknown;
  };
}

/** The ramp floor: exponential ramps cannot reach 0. */
const FLOOR = 0.0001;

/**
 * Plays cues on one AudioContext, made on the first `unlock` (a click or key press) and never before, so a page
 * that was never touched makes no sound and creates no context. `make` returns null where Web Audio is missing.
 */
export class SoundBoard {
  private ctx: AudioLike | null = null;
  private failed = false;
  private readonly make: () => AudioLike | null;

  constructor(make: () => AudioLike | null) {
    this.make = make;
  }

  /** Creates or resumes the context; call it from a user gesture. */
  unlock(): void {
    if (this.failed) return;
    if (this.ctx === null) {
      try {
        this.ctx = this.make();
      } catch {
        this.ctx = null;
      }
      if (this.ctx === null) {
        this.failed = true;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  /** True once a context exists and runs. */
  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Plays `cue` if `mode` allows it and the board is unlocked; returns whether it played. */
  play(cue: Cue, mode: SoundMode, volume = 1): boolean {
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== 'running' || !cueAllowed(mode, cue) || volume <= 0) return false;
    const t0 = ctx.currentTime + 0.01;
    for (const n of PATCHES[cue]) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      const start = t0 + n.at;
      const end = start + n.dur;
      osc.type = n.wave;
      osc.frequency.setValueAtTime(n.freq, start);
      if (n.to !== undefined) osc.frequency.exponentialRampToValueAtTime(n.to, end);
      amp.gain.setValueAtTime(FLOOR, start);
      amp.gain.linearRampToValueAtTime(Math.max(FLOOR, n.gain * volume), start + Math.min(0.01, n.dur / 4));
      amp.gain.exponentialRampToValueAtTime(FLOOR, end);
      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
    return true;
  }
}

/** The page's board, on the browser's AudioContext (null where there is none). */
export const soundBoard = new SoundBoard(() => {
  const w = globalThis as { AudioContext?: new () => AudioLike; webkitAudioContext?: new () => AudioLike };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor === undefined ? null : new Ctor();
});

/** Unlocks `board` on the page's first pointer press or key press; returns the cleanup. */
export function unlockOnGesture(board: SoundBoard, target: EventTarget = document): () => void {
  const once = () => {
    board.unlock();
    if (board.ready) off();
  };
  const off = () => {
    target.removeEventListener('pointerdown', once);
    target.removeEventListener('keydown', once);
  };
  target.addEventListener('pointerdown', once);
  target.addEventListener('keydown', once);
  return off;
}
