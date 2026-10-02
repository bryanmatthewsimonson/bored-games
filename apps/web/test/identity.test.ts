import { finalizeEvent, getPublicKey, verifyEvent } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { decodeNostrKey, npubEncode, nsecEncode } from '../src/bech32.ts';
import { hexToBytes } from '../src/hex.ts';
import {
  backupReminderVisible,
  exportNsec,
  gamesInProgress,
  importSecretKey,
  invalidProfileName,
  isBackedUp,
  KEPT_KEYS_SOFT_CAP,
  KEY_ERRORS,
  keptKeys,
  loadIdentity,
  markBackedUp,
  type Nip07,
  parseSecretKeyInput,
  profileFromLocation,
  pruneKeptKeys,
  readSignerChoice,
  switchToKeptKey,
  waitForNostr,
  writeSignerChoice,
} from '../src/identity.ts';
import type { RandomBytes } from '../src/random.ts';
import {
  addToTableList,
  type KeyValueStore,
  loadSecrets,
  memoryStorage,
  saveGameStatus,
  saveSecrets,
  tableIsMine,
  tableOwner,
} from '../src/storage.ts';

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

describe('waitForNostr', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    sleeps.push(ms);
  };

  it('returns at once when the extension is there, or when it is not waited for', async () => {
    const nostr = { getPublicKey: async () => '', signEvent: async () => ({}) } as unknown as Nip07;
    sleeps.length = 0;
    expect(await waitForNostr(() => nostr, 1000, sleep)).toBe(nostr);
    expect(await waitForNostr(() => undefined, 0, sleep)).toBeUndefined();
    expect(sleeps).toEqual([]);
  });

  it('waits for a late extension, and gives up after the limit', async () => {
    const nostr = { getPublicKey: async () => '', signEvent: async () => ({}) } as unknown as Nip07;
    let calls = 0;
    sleeps.length = 0;
    expect(await waitForNostr(() => (++calls >= 4 ? nostr : undefined), 1000, sleep)).toBe(nostr);
    expect(sleeps).toEqual([100, 100, 100]);
    sleeps.length = 0;
    expect(await waitForNostr(() => undefined, 1000, sleep)).toBeUndefined();
    expect(sleeps).toHaveLength(10);
  });
});

describe('persistence and profile notices', () => {
  /** A Storage-like map that is not a memory store, as `localStorage` would be. */
  function durable(): KeyValueStore {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }

  it('reports a local key in durable storage as persistent', async () => {
    expect((await loadIdentity('alice', durable(), seeded())).persistent).toBe(true);
  });

  it('reports a key in a memory store, or in storage that refuses writes, as not persistent', async () => {
    expect((await loadIdentity('alice', memoryStorage(), seeded())).persistent).toBe(false);
    const readOnly: KeyValueStore = {
      ...durable(),
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect((await loadIdentity('alice', readOnly, seeded())).persistent).toBe(false);
  });

  it('reports an extension key as persistent', async () => {
    const store = durable();
    writeSignerChoice('alice', store, 'nip07');
    const sk = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const ext: Nip07 = {
      getPublicKey: async () => getPublicKey(sk),
      signEvent: async (t) => finalizeEvent(t, sk, seeded(3)),
    };
    expect((await loadIdentity('alice', store, seeded(), ext)).persistent).toBe(true);
  });

  it('names an invalid ?profile= value and nothing otherwise', () => {
    expect(invalidProfileName({ search: '?profile=a:b' })).toBe('a:b');
    expect(invalidProfileName({ search: '?profile=' })).toBe('');
    expect(invalidProfileName({ search: '?profile=bob' })).toBeNull();
    expect(invalidProfileName({ search: '' })).toBeNull();
  });
});

/** A store that counts as persistent (like localStorage), unlike `memoryStorage()`. */
function diskStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

const pk = (skHex: string) => getPublicKey(hexToBytes(skHex));

describe('key import (D041)', () => {
  const SK_A = '11'.repeat(32);
  const SK_B = '22'.repeat(32);
  const SK_C = '33'.repeat(32);
  const PK_B = pk(SK_B);
  const ctxFor = (store: KeyValueStore, now = 1000) => ({
    current: (() => {
      const sk = store.getItem('bg:p:sk');
      return sk === null ? 'ee'.repeat(32) : pk(sk);
    })(),
    now,
  });

  it('parses an nsec or 64 hex characters, and refuses an npub with its own message', () => {
    expect(parseSecretKeyInput(` ${nsecEncode(SK_B)} `)).toEqual({ ok: true, hex: SK_B });
    expect(parseSecretKeyInput(SK_B.toUpperCase())).toEqual({ ok: true, hex: SK_B });
    expect(parseSecretKeyInput(npubEncode(PK_B))).toEqual({ ok: false, error: KEY_ERRORS.npub });
    expect(parseSecretKeyInput('')).toEqual({ ok: false, error: KEY_ERRORS.empty });
    expect(parseSecretKeyInput('nsec1nope')).toEqual({ ok: false, error: KEY_ERRORS.malformed });
    expect(parseSecretKeyInput('0'.repeat(64))).toEqual({ ok: false, error: KEY_ERRORS.invalid });
    expect(parseSecretKeyInput('f'.repeat(64))).toEqual({ ok: false, error: KEY_ERRORS.invalid });
  });

  it('imports, keeps the old key, switches to the local signer, and switches back', async () => {
    const store = diskStore();
    store.setItem('bg:p:sk', SK_A);
    writeSignerChoice('p', store, 'nip07');
    expect(keptKeys('p', store)).toEqual([]);
    expect(importSecretKey('p', store, nsecEncode(SK_B), ctxFor(store))).toEqual({ ok: true, pubkey: PK_B });
    expect(store.getItem('bg:p:sk')).toBe(SK_B);
    expect(readSignerChoice('p', store)).toBe('local');
    expect(keptKeys('p', store).map((k) => k.pubkey)).toEqual([pk(SK_A)]);
    expect((await loadIdentity('p', store, seeded())).pubkey).toBe(PK_B);
    expect(importSecretKey('p', store, SK_B, ctxFor(store))).toEqual({ ok: false, error: KEY_ERRORS.same });
    // The imported key exists elsewhere: no backup reminder for it.
    expect(isBackedUp('p', store, PK_B)).toBe(true);

    expect(switchToKeptKey('p', store, pk(SK_A), ctxFor(store, 2000))).toEqual({
      ok: true,
      pubkey: pk(SK_A),
    });
    expect(store.getItem('bg:p:sk')).toBe(SK_A);
    expect(keptKeys('p', store).map((k) => k.pubkey)).toEqual([PK_B]);
    expect((await loadIdentity('p', store, seeded())).pubkey).toBe(pk(SK_A));
    expect(switchToKeptKey('p', store, pk(SK_C), ctxFor(store)).ok).toBe(false);
  });

  it('never loses a key: importing twice keeps both earlier keys (C1)', () => {
    const store = diskStore();
    store.setItem('bg:p:sk', SK_A);
    expect(importSecretKey('p', store, SK_B, ctxFor(store, 100)).ok).toBe(true);
    expect(importSecretKey('p', store, SK_C, ctxFor(store, 200)).ok).toBe(true);
    expect(store.getItem('bg:p:sk')).toBe(SK_C);
    expect(keptKeys('p', store).map((k) => k.pubkey)).toEqual([pk(SK_B), pk(SK_A)]);
    // Switch back to A, then import B again: C and A are still kept, never overwritten.
    expect(switchToKeptKey('p', store, pk(SK_A), ctxFor(store, 300)).ok).toBe(true);
    expect(importSecretKey('p', store, SK_B, ctxFor(store, 400)).ok).toBe(true);
    expect(store.getItem('bg:p:sk')).toBe(SK_B);
    expect(
      keptKeys('p', store)
        .map((k) => k.pubkey)
        .sort(),
    ).toEqual([pk(SK_A), pk(SK_C)].sort());
  });

  it('folds a key kept by the older single-slot version into the list', () => {
    const store = diskStore();
    store.setItem('bg:p:sk', SK_B);
    store.setItem('bg:p:sk-previous', SK_A);
    expect(keptKeys('p', store).map((k) => k.pubkey)).toEqual([pk(SK_A)]);
    expect(importSecretKey('p', store, SK_C, ctxFor(store)).ok).toBe(true);
    expect(store.getItem('bg:p:sk-previous')).toBeNull();
    expect(
      keptKeys('p', store)
        .map((k) => k.pubkey)
        .sort(),
    ).toEqual([pk(SK_A), pk(SK_B)].sort());
  });

  it('drops kept keys past the cap only when backed up and idle', () => {
    const keys = Array.from({ length: KEPT_KEYS_SOFT_CAP + 3 }, (_, i) => ({
      pubkey: i.toString(16).padStart(64, '0'),
      sk: '',
      at: i,
    }));
    // The three oldest (at 0, 1, 2): only 1 may go.
    const kept = pruneKeptKeys(keys, (k) => k.at === 1);
    expect(kept).toHaveLength(KEPT_KEYS_SOFT_CAP + 2);
    expect(kept.some((k) => k.at === 1)).toBe(false);
    expect(pruneKeptKeys(keys, () => true)).toHaveLength(KEPT_KEYS_SOFT_CAP);
    expect(pruneKeptKeys(keys, () => false)).toHaveLength(KEPT_KEYS_SOFT_CAP + 3);
  });

  it('refuses to import when this browser is not saving site data (I5)', () => {
    const store = memoryStorage();
    store.setItem('bg:p:sk', SK_A);
    expect(importSecretKey('p', store, SK_B, ctxFor(store))).toEqual({
      ok: false,
      error: KEY_ERRORS.notPersistent,
    });
    expect(store.getItem('bg:p:sk')).toBe(SK_A);
  });

  it('works without a current key, and refuses an npub without changing anything', () => {
    const store = diskStore();
    expect(importSecretKey('p', store, SK_B, ctxFor(store)).ok).toBe(true);
    expect(keptKeys('p', store)).toEqual([]);
    expect(importSecretKey('p', store, npubEncode(PK_B), ctxFor(store))).toEqual({
      ok: false,
      error: KEY_ERRORS.npub,
    });
    expect(store.getItem('bg:p:sk')).toBe(SK_B);
  });

  it('gives every listed table and saved secrets an owner before the key changes (I3)', () => {
    const store = diskStore();
    store.setItem('bg:p:sk', SK_A);
    const secrets = { sessionSk: new Uint8Array(32).fill(1), deckSecret: new Uint8Array(32).fill(2) };
    // Listed before keys could be imported: no owner recorded.
    addToTableList('p', store, `37450:${'cd'.repeat(32)}:1`);
    saveSecrets('p', store, `37450:${'cd'.repeat(32)}:1`, secrets);
    addToTableList('p', store, `37450:${pk(SK_A)}:2`);
    expect(tableOwner('p', store, `37450:${'cd'.repeat(32)}:1`)).toBeNull();
    expect(tableIsMine('p', store, `37450:${'cd'.repeat(32)}:1`, PK_B)).toBe(true);

    expect(importSecretKey('p', store, SK_B, ctxFor(store)).ok).toBe(true);
    for (const a of [`37450:${'cd'.repeat(32)}:1`, `37450:${pk(SK_A)}:2`]) {
      expect(tableOwner('p', store, a)).toBe(pk(SK_A));
      expect(tableIsMine('p', store, a, PK_B)).toBe(false);
      expect(tableIsMine('p', store, a, pk(SK_A))).toBe(true);
    }
    expect(loadSecrets('p', store, `37450:${'cd'.repeat(32)}:1`)?.owner).toBe(pk(SK_A));
    // Their games count for A, not for B.
    expect(gamesInProgress('p', store, PK_B)).toBe(0);
    expect(gamesInProgress('p', store, pk(SK_A), false)).toBe(2);
  });

  it('counts the games still bound to a key', () => {
    const store = memoryStorage();
    const me = 'aa'.repeat(32);
    const secrets = (rootId?: string) => ({
      sessionSk: new Uint8Array(32).fill(1),
      deckSecret: new Uint8Array(32).fill(2),
      owner: me,
      ...(rootId === undefined ? {} : { rootId }),
    });
    expect(gamesInProgress('p', store, me)).toBe(0);
    const tables = ['37450:a:1', '37450:a:2', '37450:a:3', '37450:a:4'];
    for (const t of tables) addToTableList('p', store, t, me);
    saveSecrets('p', store, tables[1] as string, secrets('aa'.repeat(32)));
    saveSecrets('p', store, tables[2] as string, secrets('bb'.repeat(32)));
    saveSecrets('p', store, tables[3] as string, secrets('cc'.repeat(32)));
    saveGameStatus('p', store, 'bb'.repeat(32), { status: 'done', seq: 9, updatedAt: 1 });
    saveGameStatus('p', store, 'cc'.repeat(32), { status: 'your-turn', seq: 3, updatedAt: 1 });
    // Table 1 is still in its lobby, 2 has no saved status, 3 is over, 4 is going.
    expect(gamesInProgress('p', store, me)).toBe(3);
    expect(gamesInProgress('p', store, 'bb'.repeat(32))).toBe(0);
    expect(gamesInProgress('q', store, me)).toBe(0);
  });

  it('reminds a local key with a table of its own to back up, until that key is marked saved', () => {
    const store = memoryStorage();
    const me = { kind: 'local' as const, pubkey: PK_B };
    expect(backupReminderVisible('p', store, me)).toBe(false);
    addToTableList('p', store, '37450:a:1', PK_B);
    expect(backupReminderVisible('p', store, me)).toBe(true);
    expect(backupReminderVisible('p', store, { ...me, kind: 'nip07' })).toBe(false);
    // A key with only another key's tables gets no reminder.
    expect(backupReminderVisible('p', store, { kind: 'local', pubkey: 'ab'.repeat(32) })).toBe(false);
    expect(markBackedUp('p', store, PK_B)).toBe(true);
    expect(isBackedUp('p', store, PK_B)).toBe(true);
    expect(backupReminderVisible('p', store, me)).toBe(false);
    // Several keys can be backed up; an older single-pubkey flag still counts.
    expect(markBackedUp('p', store, 'ab'.repeat(32))).toBe(true);
    expect(isBackedUp('p', store, PK_B)).toBe(true);
    store.setItem('bg:p:backup', 'cd'.repeat(32));
    expect(isBackedUp('p', store, 'cd'.repeat(32))).toBe(true);
  });
});
