/* The key backup's pure parts (D065, review fixes): no relay. */
import { finalizeEvent, getPublicKey, keyBackupTemplate } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { Timers } from '../src/clock.ts';
import { completeAnswer, restoreKeyBackup } from '../src/key-backup.ts';

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

describe('restoreKeyBackup with an extension (review L4)', () => {
  const root = { id: 'cd'.repeat(32), tableAddress: `37450:${'ef'.repeat(32)}:t`, seats: [] };
  // A structurally valid backup event is needed to reach the decrypt: build one signed by a throwaway key.
  const sk = new Uint8Array(32).fill(5);
  const author = getPublicKey(sk);
  const ev = finalizeEvent(
    keyBackupTemplate(root.tableAddress, 'x'.repeat(200), 1),
    sk,
    (n) => new Uint8Array(n),
  );
  const manual = (): { timers: Timers; fire: () => void } => {
    const pending: (() => void)[] = [];
    return {
      timers: {
        later: (_ms, fn) => {
          pending.push(fn);
          return () => {};
        },
        every: () => () => {},
      },
      fire: () => {
        for (const f of pending.splice(0)) f();
      },
    };
  };

  it('a refused prompt is "refused", not a bad backup', async () => {
    const t = manual();
    const signer = {
      kind: 'nip07' as const,
      pubkey: author,
      nip44: { encrypt: async () => '', decrypt: async () => Promise.reject(new Error('user rejected')) },
    };
    expect(await restoreKeyBackup(signer, root, [ev], t.timers)).toEqual({ kind: 'refused' });
    // The same failure with a local key is a payload that does not decrypt.
    expect(await restoreKeyBackup({ ...signer, kind: 'local' }, root, [ev], t.timers)).toEqual({
      kind: 'unreadable',
    });
  });

  it('an unanswered prompt times out instead of hanging', async () => {
    const t = manual();
    const signer = {
      kind: 'nip07' as const,
      pubkey: author,
      nip44: { encrypt: async () => '', decrypt: () => new Promise<string>(() => {}) },
    };
    const p = restoreKeyBackup(signer, root, [ev], t.timers);
    await Promise.resolve();
    t.fire();
    expect(await p).toEqual({ kind: 'timeout' });
  });
});
