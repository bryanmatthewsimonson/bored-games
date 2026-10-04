import { describe, expect, it } from 'vitest';
import {
  encodeKeyBackup,
  isKeyBackupEvent,
  type KeyBackup,
  keyBackupD,
  keyBackupTemplate,
  parseKeyBackup,
} from '../src/backup.ts';
import { ProtocolError } from '../src/errors.ts';
import { KIND } from '../src/kinds.ts';
import { getConversationKey, nip44Decrypt, nip44Encrypt } from '../src/nip44.ts';
import { finalizeEvent, getPublicKey } from '../src/nostr.ts';

const sk = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const pk = getPublicKey(sk);
const fixed = (n: number) => new Uint8Array(n).fill(9);
const address = `37450:${'ab'.repeat(32)}:table-1`;
const backup: KeyBackup = {
  table: address,
  sessionSk: '11'.repeat(32),
  deckSecret: '22'.repeat(32),
  rootId: 'cd'.repeat(32),
  seat: 2,
};

describe('key backup (D065)', () => {
  it('encodes and parses back, before and after the root', () => {
    expect(parseKeyBackup(encodeKeyBackup(backup))).toEqual(backup);
    const early = { ...backup, rootId: null, seat: null };
    expect(parseKeyBackup(encodeKeyBackup(early))).toEqual(early);
  });

  it('refuses anything malformed', () => {
    const good = JSON.parse(encodeKeyBackup(backup));
    const bad = [
      'not json',
      '[]',
      JSON.stringify({ ...good, v: 2 }),
      JSON.stringify({ ...good, table: 'x' }),
      JSON.stringify({ ...good, session: 'zz' }),
      JSON.stringify({ ...good, deck: 1 }),
      JSON.stringify({ ...good, root: 'short' }),
      JSON.stringify({ ...good, seat: -1 }),
      JSON.stringify({ ...good, seat: 1.5 }),
    ];
    for (const text of bad) expect(() => parseKeyBackup(text), text).toThrow(ProtocolError);
  });

  it('is a kind 30078 event addressed by the table, encrypted to the author', () => {
    const ck = getConversationKey(sk, pk);
    const content = nip44Encrypt(encodeKeyBackup(backup), ck, fixed(32));
    const ev = finalizeEvent(keyBackupTemplate(address, content, 1_700_000_000), sk, fixed);
    expect(ev.kind).toBe(KIND.backup);
    expect(ev.kind).toBe(30078);
    expect(ev.tags).toEqual([['d', keyBackupD(address)]]);
    expect(ev.content).not.toContain(backup.sessionSk);
    expect(isKeyBackupEvent(ev, pk, address)).toBe(true);
    expect(parseKeyBackup(nip44Decrypt(ev.content, ck))).toEqual(backup);
  });

  it('isKeyBackupEvent refuses another author, table, kind or a broken signature', () => {
    const ev = finalizeEvent(keyBackupTemplate(address, 'x', 1), sk, fixed);
    expect(isKeyBackupEvent(ev, 'ee'.repeat(32), address)).toBe(false);
    expect(isKeyBackupEvent(ev, pk, `37450:${'ab'.repeat(32)}:other`)).toBe(false);
    expect(isKeyBackupEvent({ ...ev, content: 'y' }, pk, address)).toBe(false);
    const other = finalizeEvent({ ...keyBackupTemplate(address, 'x', 1), kind: 1 }, sk, fixed);
    expect(isKeyBackupEvent(other, pk, address)).toBe(false);
    expect(isKeyBackupEvent(null, pk, address)).toBe(false);
  });
});
