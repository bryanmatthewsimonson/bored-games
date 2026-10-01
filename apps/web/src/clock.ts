/* Impure entry point 2 of 3 (with random.ts and storage.ts): wall-clock time. */

/** Unix time in whole seconds, the unit of NOSTR `created_at`. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
