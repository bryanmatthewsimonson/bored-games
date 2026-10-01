import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from '../src/hex.ts';
import { loadSecrets, memoryStorage, saveSecrets, storageKey } from '../src/storage.ts';

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
