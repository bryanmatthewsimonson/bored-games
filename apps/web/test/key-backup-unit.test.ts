/* The key backup's pure parts (D065, review fixes): no relay. */
import { type EventTemplate, finalizeEvent, getPublicKey, keyBackupTemplate } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { Timers } from '../src/clock.ts';
import { bytesToHex } from '../src/hex.ts';
import { localNip44, type Nip44 } from '../src/identity.ts';
import {
  backupRecordKey,
  ciphertextProblem,
  completeAnswer,
  publishKeyBackup,
  restoreKeyBackup,
} from '../src/key-backup.ts';
import { memoryStorage, saveSecrets } from '../src/storage.ts';

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

describe('the encryptor is not trusted (review L2)', () => {
  const sk = new Uint8Array(32).fill(6);
  const pubkey = getPublicKey(sk);
  const honest = localNip44(sk, (n) => new Uint8Array(n).fill(3));
  const t: Timers = { later: () => () => {}, every: () => () => {} };
  const address = `37450:${'ef'.repeat(32)}:t`;
  const store = memoryStorage();
  const keys = {
    sessionSk: new Uint8Array(32).fill(7),
    deckSecret: new Uint8Array(32).fill(8),
    owner: pubkey,
  };
  saveSecrets('p', store, address, keys);
  const deps = (nip44: Nip44) => {
    const published: unknown[] = [];
    return {
      published,
      deps: {
        timers: t,
        pool: {
          publish: async (ev: unknown) => {
            published.push(ev);
            return [{ url: 'wss://r', ok: true, message: '' }];
          },
          subscribe: () => () => {},
        },
        signer: {
          kind: 'nip07' as const,
          pubkey,
          sign: async (tpl: EventTemplate) => finalizeEvent(tpl, sk, (n) => new Uint8Array(n)),
          nip44,
        },
        storage: store,
        profile: 'p',
        relays: () => ['wss://r'],
        now: () => 1,
      },
    };
  };

  it('publishes nothing when the extension hands back the plaintext, a NIP-04 string or a wrong payload', async () => {
    const liars: Nip44[] = [
      { encrypt: async (_p, text) => text, decrypt: honest.decrypt },
      { encrypt: async () => 'bm90IG5pcDQ0?iv=AAAAAAAAAAAAAAAAAAAAAA==', decrypt: honest.decrypt },
      // A real payload of something else: the right shape only by accident, and it decrypts to other text.
      {
        encrypt: async (p, text) => honest.encrypt(p, text.replace(/[0-9a-f]/, 'z')),
        decrypt: honest.decrypt,
      },
    ];
    for (const nip44 of liars) {
      const d = deps(nip44);
      const r = await publishKeyBackup(d.deps, address, { tableRelays: ['wss://r'] });
      expect(r.ok).toBe(false);
      expect(d.published).toEqual([]);
    }
  });

  it('an honest payload is published, also when the extension may not decrypt it back', async () => {
    for (const nip44 of [
      honest,
      { encrypt: honest.encrypt, decrypt: async () => Promise.reject(new Error('no')) },
    ]) {
      store.removeItem(backupRecordKey('p', address));
      const d = deps(nip44);
      const r = await publishKeyBackup(d.deps, address, { tableRelays: ['wss://r'] });
      expect(r.ok).toBe(true);
      expect(d.published).toHaveLength(1);
      expect(JSON.stringify(d.published)).not.toContain(bytesToHex(keys.sessionSk));
    }
  });

  it('a new backup is dated after the last one known, so a relay replaces it (NIP-01 addressable events)', async () => {
    store.removeItem(backupRecordKey('p', address));
    const d = deps(honest);
    const r = await publishKeyBackup(d.deps, address, { tableRelays: ['wss://r'], notBefore: 100 });
    expect(r.ok && r.event.created_at).toBe(100);
    // Again in the same second: after the recorded one.
    const r2 = await publishKeyBackup(d.deps, address, { tableRelays: ['wss://r'] });
    expect(r2.ok && r2.event.created_at).toBe(101);
  });

  it('ciphertextProblem refuses content that carries a secret', async () => {
    const text = `{"x":"${'ab'.repeat(32)}"}`;
    const payload = await honest.encrypt(pubkey, text);
    expect(await ciphertextProblem(honest, pubkey, payload, text, ['ab'.repeat(32)], t)).toBeNull();
    expect(await ciphertextProblem(honest, pubkey, text, text, ['ab'.repeat(32)], t)).not.toBeNull();
  });
});
