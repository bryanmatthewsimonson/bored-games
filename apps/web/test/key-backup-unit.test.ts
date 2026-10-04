/* The key backup's pure parts (D065, review fixes): no relay. */
import { describe, expect, it } from 'vitest';
import { completeAnswer } from '../src/key-backup.ts';

describe('completeAnswer (review L1)', () => {
  const roots = ['wss://r1', 'wss://r2'];
  it('needs every root relay to answer before any deadline', () => {
    expect(completeAnswer(null, roots)).toBe(false);
    const all = { eose: 3, relays: 3, eosedUrls: ['wss://r1', 'wss://r2', 'wss://own'], timedOut: false };
    expect(completeAnswer(all, roots)).toBe(true);
    // The pool's own deadline fired: not complete, even if it counts every relay as answered.
    expect(completeAnswer({ ...all, timedOut: true }, roots)).toBe(false);
    // A root relay that never sent EOSE (down, or failed to connect).
    expect(
      completeAnswer({ eose: 2, relays: 3, eosedUrls: ['wss://r1', 'wss://own'], timedOut: false }, roots),
    ).toBe(false);
    // The player's own relay may be missing; the root's relays are the ones every device asks.
    expect(
      completeAnswer({ eose: 2, relays: 3, eosedUrls: ['wss://r1', 'wss://r2'], timedOut: false }, roots),
    ).toBe(true);
    expect(completeAnswer({ eose: 1, relays: 2, timedOut: false }, roots)).toBe(false);
  });
});
