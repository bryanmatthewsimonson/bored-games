/* Impure entry point 2 of 3 (with random.ts and storage.ts): wall-clock time and timers. */

/** Unix time in whole seconds, the unit of NOSTR `created_at`. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Timers, injected into controllers so that tests and other platforms can supply their own. */
export interface Timers {
  /** Run `fn` once after `ms`. Returns a function that cancels it. */
  later(ms: number, fn: () => void): () => void;
  /** Run `fn` every `ms`. Returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
}

export const platformTimers: Timers = {
  later(ms, fn) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  every(ms, fn) {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};
