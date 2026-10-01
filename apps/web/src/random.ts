/*
 * Impure entry point 1 of 3 (with clock.ts and storage.ts): the platform CSPRNG. Everything else receives a
 * `RandomBytes` as an argument, so tests pass a seeded source.
 */

/** Same shape as `RandomBytes` in `@bored-games/deck`. */
export type RandomBytes = (n: number) => Uint8Array;

export const randomBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
