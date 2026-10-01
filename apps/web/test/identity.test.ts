import { finalizeEvent, getPublicKey, verifyEvent } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { decodeNostrKey } from '../src/bech32.ts';
import { hexToBytes } from '../src/hex.ts';
import {
  exportNsec,
  loadIdentity,
  type Nip07,
  profileFromLocation,
  readSignerChoice,
  writeSignerChoice,
} from '../src/identity.ts';
import type { RandomBytes } from '../src/random.ts';
import { type KeyValueStore, memoryStorage } from '../src/storage.ts';

/** Deterministic counter-based bytes, never zero in the first byte. */
function seeded(start = 1): RandomBytes {
  let n = start;
  return (len) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = ((n++ * 37) % 251) + 1;
    return out;
  };
}

const TEMPLATE = { kind: 1, created_at: 1_700_000_000, tags: [], content: 'hi' };

describe('profileFromLocation', () => {
  it('defaults to "default"', () => {
    expect(profileFromLocation({ search: '' })).toBe('default');
    expect(profileFromLocation({ search: '?foo=bar' })).toBe('default');
    expect(profileFromLocation({ search: '?profile=' })).toBe('default');
  });

  it('reads ?profile=<name>', () => {
    expect(profileFromLocation({ search: '?profile=alice' })).toBe('alice');
    expect(profileFromLocation({ search: '?x=1&profile=bob_2.test-3' })).toBe('bob_2.test-3');
  });

  it('falls back to default for names that could collide with storage keys', () => {
    expect(profileFromLocation({ search: '?profile=a:b' })).toBe('default');
    expect(profileFromLocation({ search: '?profile=has space' })).toBe('default');
    expect(profileFromLocation({ search: `?profile=${'x'.repeat(33)}` })).toBe('default');
  });
});

describe('local identity', () => {
  it('creates a key on first use, stores it as hex under bg:<profile>:sk, and reuses it', async () => {
    const store = memoryStorage();
    const a = await loadIdentity('alice', store, seeded());
    expect(a.kind).toBe('local');
    const stored = store.getItem('bg:alice:sk');
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(a.pubkey).toBe(getPublicKey(hexToBytes(stored ?? '')));
    // A different random source must not change the identity: the stored key wins.
    const b = await loadIdentity('alice', store, seeded(99));
    expect(b.pubkey).toBe(a.pubkey);
  });

  it('keeps profiles apart', async () => {
    const store = memoryStorage();
    const a = await loadIdentity('alice', store, seeded());
    const b = await loadIdentity('bob', store, seeded(500));
    expect(a.pubkey).not.toBe(b.pubkey);
  });

  it('signs events that verify', async () => {
    const s = await loadIdentity('alice', memoryStorage(), seeded());
    const ev = await s.sign(TEMPLATE);
    expect(ev.pubkey).toBe(s.pubkey);
    expect(verifyEvent(ev)).toBe(true);
  });

  it('replaces a corrupt stored key', async () => {
    const store = memoryStorage();
    store.setItem('bg:alice:sk', 'not hex');
    const s = await loadIdentity('alice', store, seeded());
    expect(store.getItem('bg:alice:sk')).toMatch(/^[0-9a-f]{64}$/);
    expect(s.kind).toBe('local');
  });

  it('exports the nsec of the stored key and nothing when there is none', async () => {
    const store = memoryStorage();
    expect(exportNsec('alice', store)).toBeNull();
    await loadIdentity('alice', store, seeded());
    const nsec = exportNsec('alice', store);
    expect(nsec?.startsWith('nsec1')).toBe(true);
    expect(decodeNostrKey(nsec ?? '')?.hex).toBe(store.getItem('bg:alice:sk'));
  });

  it('still works when storage throws (keeps the key in memory for the session)', async () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const s = await loadIdentity('alice', broken, seeded());
    expect(verifyEvent(await s.sign(TEMPLATE))).toBe(true);
  });
});

describe('signer choice', () => {
  it('defaults to local and round-trips', () => {
    const store = memoryStorage();
    expect(readSignerChoice('alice', store)).toBe('local');
    writeSignerChoice('alice', store, 'nip07');
    expect(store.getItem('bg:alice:signer')).toBe('nip07');
    expect(readSignerChoice('alice', store)).toBe('nip07');
    expect(readSignerChoice('bob', store)).toBe('local');
    store.setItem('bg:alice:signer', 'garbage');
    expect(readSignerChoice('alice', store)).toBe('local');
  });
});

describe('NIP-07 identity', () => {
  const sk = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const ext: Nip07 = {
    getPublicKey: async () => getPublicKey(sk),
    signEvent: async (t) => finalizeEvent(t, sk, seeded(7)),
  };

  it('is used when chosen and available', async () => {
    const store = memoryStorage();
    writeSignerChoice('alice', store, 'nip07');
    const s = await loadIdentity('alice', store, seeded(), ext);
    expect(s.kind).toBe('nip07');
    expect(s.pubkey).toBe(getPublicKey(sk));
    expect(verifyEvent(await s.sign(TEMPLATE))).toBe(true);
    expect(store.getItem('bg:alice:sk')).toBeNull();
  });

  it('is not used unless chosen', async () => {
    const s = await loadIdentity('alice', memoryStorage(), seeded(), ext);
    expect(s.kind).toBe('local');
  });

  it('falls back to a local key when chosen but the extension is missing', async () => {
    const store = memoryStorage();
    writeSignerChoice('alice', store, 'nip07');
    expect((await loadIdentity('alice', store, seeded(), undefined)).kind).toBe('local');
  });

  it('rejects an event the extension returns with a bad signature', async () => {
    const store = memoryStorage();
    writeSignerChoice('alice', store, 'nip07');
    const bad: Nip07 = {
      getPublicKey: ext.getPublicKey,
      signEvent: async (t) => ({ ...finalizeEvent(t, sk, seeded(7)), content: 'tampered' }),
    };
    const s = await loadIdentity('alice', store, seeded(), bad);
    await expect(s.sign(TEMPLATE)).rejects.toThrow(/invalid/i);
  });

  it('rejects an event signed by a different key', async () => {
    const store = memoryStorage();
    writeSignerChoice('alice', store, 'nip07');
    const other = Uint8Array.from({ length: 32 }, (_, i) => i + 40);
    const wrong: Nip07 = {
      getPublicKey: ext.getPublicKey,
      signEvent: async (t) => finalizeEvent(t, other, seeded(7)),
    };
    const s = await loadIdentity('alice', store, seeded(), wrong);
    await expect(s.sign(TEMPLATE)).rejects.toThrow(/different key/i);
  });

  it('rejects an event whose template fields the extension changed', async () => {
    const store = memoryStorage();
    writeSignerChoice('alice', store, 'nip07');
    const alter: Nip07 = {
      getPublicKey: ext.getPublicKey,
      signEvent: async (t) => finalizeEvent({ ...t, content: 'other' }, sk, seeded(7)),
    };
    const s = await loadIdentity('alice', store, seeded(), alter);
    await expect(s.sign(TEMPLATE)).rejects.toThrow(/changed/i);
  });

  it('rejects a malformed public key from the extension', async () => {
    const store = memoryStorage();
    writeSignerChoice('alice', store, 'nip07');
    const bad: Nip07 = { getPublicKey: async () => 'xyz', signEvent: ext.signEvent };
    await expect(loadIdentity('alice', store, seeded(), bad)).rejects.toThrow();
  });
});
