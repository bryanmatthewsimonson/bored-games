/*
 * Other keys (D065, bug 2 of the owner's 2026-10-03 reports): Settings lists every key this browser's tables or saved
 * game keys belong to, kept or not, and Home never promises a switch to a key this browser does not hold.
 */
import { getPublicKey } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { npubEncode, shortNpub } from '../src/bech32.ts';
import { bytesToHex } from '../src/hex.ts';
import { otherKeyDetail, otherKeys, SAVED_KEYS_DETAIL } from '../src/other-keys.ts';
import { otherKeyNote } from '../src/settings-key.tsx';
import { addToTableList, memoryStorage, saveGameStatus, saveSecrets, storageKey } from '../src/storage.ts';

const key = (n: number) => {
  const sk = new Uint8Array(32).fill(n);
  return { sk: bytesToHex(sk), pubkey: getPublicKey(sk) };
};
const me = key(1);
const keptKey = key(2);
const lost = key(3);
const table = (creator: string, id: string) => `37450:${creator}:${id}`;
const secrets = (owner: string, rootId?: string) => ({
  sessionSk: new Uint8Array(32).fill(7),
  deckSecret: new Uint8Array(32).fill(8),
  owner,
  ...(rootId === undefined ? {} : { rootId }),
});

describe('otherKeys (D065)', () => {
  it('lists the owner of saved game keys whose key is not kept, with its games; the D057 incident', () => {
    const store = memoryStorage();
    store.setItem(storageKey('p', 'sk'), me.sk);
    // The race: seat 3's game keys were saved for key A, and key A itself never reached storage.
    const t1 = table(key(9).pubkey, 'game-1');
    saveSecrets('p', store, t1, secrets(lost.pubkey, 'ab'.repeat(32)));
    addToTableList('p', store, t1, lost.pubkey);
    // A table of the key in use is not another key's.
    const t2 = table(key(9).pubkey, 'game-2');
    saveSecrets('p', store, t2, secrets(me.pubkey));
    addToTableList('p', store, t2, me.pubkey);
    expect(otherKeys('p', store, me.pubkey)).toEqual([
      {
        pubkey: lost.pubkey,
        kept: false,
        games: [{ address: t1, rootId: 'ab'.repeat(32), savedKeys: true }],
      },
    ]);
  });

  it('lists kept keys first, even with no game; leaves out finished games and owners with none left', () => {
    const store = memoryStorage();
    store.setItem(storageKey('p', 'sk'), me.sk);
    store.setItem(storageKey('p', 'sk-history'), JSON.stringify([{ sk: keptKey.sk, at: 5 }]));
    const done = table(key(9).pubkey, 'done');
    saveSecrets('p', store, done, secrets(lost.pubkey, 'cd'.repeat(32)));
    addToTableList('p', store, done, lost.pubkey);
    saveGameStatus('p', store, 'cd'.repeat(32), { status: 'done', seq: 9, updatedAt: 1 });
    const keptGame = table(keptKey.pubkey, 'mine');
    saveSecrets('p', store, keptGame, secrets(keptKey.pubkey));
    addToTableList('p', store, keptGame, keptKey.pubkey);
    const noKeys = table(key(9).pubkey, 'listed');
    addToTableList('p', store, noKeys, lost.pubkey);
    expect(otherKeys('p', store, me.pubkey)).toEqual([
      { pubkey: keptKey.pubkey, kept: true, games: [{ address: keptGame, rootId: null, savedKeys: true }] },
      { pubkey: lost.pubkey, kept: false, games: [{ address: noKeys, rootId: null, savedKeys: false }] },
    ]);
  });

  it('an empty profile has none', () => {
    expect(otherKeys('p', memoryStorage(), me.pubkey)).toEqual([]);
  });

  it('Settings says what the saved game keys allow', () => {
    expect(otherKeyNote(true)).toContain('open a game to play your seat with them');
    expect(otherKeyNote(false)).toContain('import it below');
  });
});

describe('otherKeyDetail: Home never promises an impossible switch (D065)', () => {
  const who = shortNpub(npubEncode(lost.pubkey));
  const base = {
    owner: lost.pubkey,
    kept: false,
    matched: false,
    savedKeys: false,
    started: false,
    creator: false,
  };

  it('offers the switch only for a kept key', () => {
    expect(otherKeyDetail({ ...base, kept: true })).toBe(
      `Under another key (${who}): switch to it in Settings to play`,
    );
    for (const f of [
      { ...base },
      { ...base, savedKeys: true },
      { ...base, savedKeys: true, started: true },
      { ...base, savedKeys: true, creator: true },
      { ...base, matched: true, savedKeys: true, started: true },
    ])
      expect(otherKeyDetail(f)).not.toContain('switch');
  });

  it('says the game can be played with the saved game keys when it can', () => {
    expect(otherKeyDetail({ ...base, matched: true, savedKeys: true, started: true })).toBe(
      SAVED_KEYS_DETAIL,
    );
    expect(otherKeyDetail({ ...base, savedKeys: true, started: true })).toBe(
      `Under another key (${who}), not kept here: open the game to play it with this browser's saved game keys`,
    );
    expect(otherKeyDetail({ ...base, savedKeys: true })).toContain('once it starts');
    expect(otherKeyDetail({ ...base, savedKeys: true, creator: true })).toContain('only that key can start');
    expect(otherKeyDetail(base)).toBe(`Under another key (${who}), not kept in this browser`);
  });
});
