import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from '../src/hex.ts';
import {
  addToTableList,
  gameStatusKey,
  isPersistentStore,
  loadGameStatus,
  loadSecrets,
  loadTableList,
  memoryStorage,
  persistState,
  requestPersistence,
  requestPersistenceOnce,
  saveGameStatus,
  saveRootId,
  saveSecrets,
  storageKey,
} from '../src/storage.ts';

const ADDR = `31923:${'a'.repeat(64)}:table-1`;
const SECRETS = { sessionSk: new Uint8Array(32).fill(7), deckSecret: new Uint8Array(32).fill(9) };

describe('hex', () => {
  it('round-trips and rejects bad input', () => {
    expect(bytesToHex(Uint8Array.of(0, 1, 255))).toBe('0001ff');
    expect(hexToBytes('0001ff')).toEqual(Uint8Array.of(0, 1, 255));
    expect(() => hexToBytes('abc')).toThrow(RangeError);
    expect(() => hexToBytes('zz')).toThrow(RangeError);
    expect(() => hexToBytes('AB')).toThrow(RangeError);
  });
});

describe('storageKey', () => {
  it('namespaces by profile', () => {
    expect(storageKey('alice', 'sk')).toBe('bg:alice:sk');
  });
});

describe('game secrets', () => {
  it('round-trips through a fake Storage as hex', () => {
    const store = memoryStorage();
    saveSecrets('alice', store, ADDR, SECRETS);
    expect(loadSecrets('alice', store, ADDR)).toEqual(SECRETS);
    const raw = store.getItem(storageKey('alice', `secrets:${ADDR}`));
    expect(JSON.parse(raw ?? '')).toEqual({ sessionSk: '07'.repeat(32), deckSecret: '09'.repeat(32) });
  });

  it('is empty for an unknown table', () => {
    expect(loadSecrets('alice', memoryStorage(), ADDR)).toBeNull();
  });

  it('keeps profiles and tables apart', () => {
    const store = memoryStorage();
    saveSecrets('alice', store, ADDR, SECRETS);
    expect(loadSecrets('bob', store, ADDR)).toBeNull();
    expect(loadSecrets('alice', store, `${ADDR}-2`)).toBeNull();
  });

  it('treats malformed stored data as absent', () => {
    const store = memoryStorage();
    const key = storageKey('alice', `secrets:${ADDR}`);
    for (const bad of ['', 'nope', '{}', '{"sessionSk":"zz","deckSecret":"00"}', '[]', 'null']) {
      store.setItem(key, bad);
      expect(loadSecrets('alice', store, ADDR), bad).toBeNull();
    }
  });
});

describe('root id and table list', () => {
  const ROOT = 'b'.repeat(64);

  it('saves the root id with existing secrets only', () => {
    const store = memoryStorage();
    expect(saveRootId('alice', store, ADDR, ROOT)).toBe(false);
    saveSecrets('alice', store, ADDR, SECRETS);
    expect(saveRootId('alice', store, ADDR, ROOT)).toBe(true);
    expect(loadSecrets('alice', store, ADDR)).toEqual({ ...SECRETS, rootId: ROOT });
  });

  it('ignores a malformed stored root id', () => {
    const store = memoryStorage();
    store.setItem(
      storageKey('alice', `secrets:${ADDR}`),
      JSON.stringify({ sessionSk: '07'.repeat(32), deckSecret: '09'.repeat(32), rootId: 'nope' }),
    );
    expect(loadSecrets('alice', store, ADDR)).toEqual(SECRETS);
  });

  it('keeps a per-profile list of table addresses without duplicates', () => {
    const store = memoryStorage();
    addToTableList('alice', store, ADDR);
    addToTableList('alice', store, ADDR);
    addToTableList('alice', store, `${ADDR}-2`);
    expect(loadTableList('alice', store)).toEqual([ADDR, `${ADDR}-2`]);
    expect(loadTableList('bob', store)).toEqual([]);
    store.setItem(storageKey('bob', 'tables'), '{"no":1}');
    expect(loadTableList('bob', store)).toEqual([]);
  });

  it('knows a memory store is not persistent', () => {
    expect(isPersistentStore(memoryStorage())).toBe(false);
    const m = new Map<string, string>();
    expect(
      isPersistentStore({
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => void m.set(k, v),
        removeItem: (k) => void m.delete(k),
      }),
    ).toBe(true);
  });
});

describe('game status cache', () => {
  const ROOT = 'b'.repeat(64);
  it('round-trips under bg:<profile>:gamestatus:<rootId>', () => {
    const store = memoryStorage();
    expect(loadGameStatus('alice', store, ROOT)).toBeNull();
    expect(saveGameStatus('alice', store, ROOT, { status: 'your-turn', seq: 7, updatedAt: 1234 })).toBe(true);
    expect(gameStatusKey('alice', ROOT)).toBe(`bg:alice:gamestatus:${ROOT}`);
    expect(JSON.parse(store.getItem(gameStatusKey('alice', ROOT)) ?? '')).toEqual({
      status: 'your-turn',
      seq: 7,
      updatedAt: 1234,
    });
    expect(loadGameStatus('alice', store, ROOT)).toEqual({ status: 'your-turn', seq: 7, updatedAt: 1234 });
    // Profiles do not share entries.
    expect(loadGameStatus('bob', store, ROOT)).toBeNull();
  });
  it('reads malformed entries as absent', () => {
    const store = memoryStorage();
    const key = gameStatusKey('alice', ROOT);
    for (const bad of [
      'nope',
      '[]',
      '{}',
      JSON.stringify({ status: 'syncing', seq: 1, updatedAt: 1 }),
      JSON.stringify({ status: 'waiting', seq: -1, updatedAt: 1 }),
      JSON.stringify({ status: 'waiting', seq: 1.5, updatedAt: 1 }),
      JSON.stringify({ status: 'waiting', seq: 1, updatedAt: 'now' }),
    ]) {
      store.setItem(key, bad);
      expect(loadGameStatus('alice', store, ROOT)).toBeNull();
    }
  });
});

describe('persistent storage (D041)', () => {
  const manager = (granted: boolean) => {
    const calls: string[] = [];
    return {
      calls,
      m: {
        persisted: async () => {
          calls.push('persisted');
          return granted;
        },
        persist: async () => {
          calls.push('persist');
          return granted;
        },
      },
    };
  };

  it('reports the state, and unsupported without a storage manager', async () => {
    expect(await persistState(manager(true).m)).toBe('persisted');
    expect(await persistState(manager(false).m)).toBe('best-effort');
    expect(await persistState(null)).toBe('unsupported');
    expect(await requestPersistence(manager(true).m)).toBe('persisted');
    expect(await requestPersistence(null)).toBe('unsupported');
  });

  it('asks once per profile', () => {
    const store = memoryStorage();
    const { m, calls } = manager(false);
    expect(requestPersistenceOnce('p', store, m)).toBe(true);
    expect(requestPersistenceOnce('p', store, m)).toBe(false);
    expect(calls).toEqual(['persist']);
    expect(requestPersistenceOnce('q', store, m)).toBe(true);
    expect(requestPersistenceOnce('r', store, null)).toBe(false);
  });
});
