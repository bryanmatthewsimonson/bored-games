import { describe, expect, it } from 'vitest';
import { npubEncode, shortNpub } from '../src/bech32.ts';
import { RecoveredNotice, WatchingNotice } from '../src/components/watching.tsx';
import { addToTableList, memoryStorage, saveSecrets } from '../src/storage.ts';
import {
  type LocalTableRecord,
  localTableRecord,
  myTableCount,
  recoveredText,
  type WatchInput,
  watchNotice,
  watchText,
} from '../src/watch-model.ts';
import { findAll, renderTree, spokenText } from './render-tree.ts';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);
const C = 'cc'.repeat(32);
/** The key in use. */
const ME = 'dd'.repeat(32);
const OLD = 'ee'.repeat(32);
const short = (pk: string) => shortNpub(npubEncode(pk));
const NONE: LocalTableRecord = { listed: false, secrets: false, owner: null };
const input = (over: Partial<WatchInput>): WatchInput => ({
  seats: [A, B, C],
  me: ME,
  kept: [],
  record: NONE,
  myTables: 0,
  ...over,
});

describe('watch notice (D057)', () => {
  it('says nothing to a seated key, or before the seats are known', () => {
    expect(watchNotice(input({ seats: [A, ME, C] }))).toBeNull();
    expect(watchNotice(input({ seats: [] }))).toBeNull();
    // Seated wins even when a kept key is seated too.
    expect(watchNotice(input({ seats: [A, ME, OLD], kept: [OLD] }))).toBeNull();
  });

  it('the incident: a fresh key with no record of the table gets the long hint', () => {
    expect(watchNotice(input({}))).toEqual({ kind: 'elsewhere' });
    const t = watchText({ kind: 'elsewhere' }, ME);
    expect(t.lead).toBe("You're watching this game.");
    expect(t.body).toBe(
      `This browser's key (${short(ME)}) isn't one of its players. If you joined from another app or browser on this device, open the game there: each one keeps its own key.`,
    );
  });

  it('a key with tables of its own here and no record of this one is watching on purpose: the short line', () => {
    expect(watchNotice(input({ myTables: 2 }))).toEqual({ kind: 'visitor' });
    expect(watchText({ kind: 'visitor' }, ME)).toEqual({ lead: "You're watching this game.", body: null });
  });

  it('a seated kept key: names it, newest kept key first', () => {
    expect(watchNotice(input({ seats: [A, OLD, C], kept: [B, OLD], myTables: 5 }))).toEqual({
      kind: 'kept',
      pubkey: OLD,
    });
    expect(watchNotice(input({ seats: [A, OLD, C], kept: [C, OLD] }))).toEqual({ kind: 'kept', pubkey: C });
    const t = watchText({ kind: 'kept', pubkey: OLD }, ME);
    expect(t.lead).toBe(`You joined this game with ${short(OLD)} (kept in this browser).`);
    expect(t.body).toContain(short(ME));
  });

  it('game keys held here for another, seated key that is not kept: says to import it', () => {
    const record = { listed: true, secrets: true, owner: B };
    expect(watchNotice(input({ record }))).toEqual({ kind: 'other-key', owner: B });
    const t = watchText({ kind: 'other-key', owner: B }, ME);
    expect(t.body).toContain(`made for ${short(B)}`);
    expect(t.body).toContain('Use a secret key from elsewhere');
  });

  it('joined from here but not seated: says the game started without that key', () => {
    // Listed with no recorded owner: it belongs to the key in use.
    expect(watchNotice(input({ record: { listed: true, secrets: true, owner: null } }))).toEqual({
      kind: 'not-seated',
      owner: ME,
    });
    expect(watchNotice(input({ record: { listed: false, secrets: true, owner: ME } }))).toEqual({
      kind: 'not-seated',
      owner: ME,
    });
    // Another key's record, and that key is not seated either.
    expect(watchNotice(input({ record: { listed: true, secrets: false, owner: OLD } }))).toEqual({
      kind: 'not-seated',
      owner: OLD,
    });
    expect(watchText({ kind: 'not-seated', owner: ME }, ME).body).toMatch(
      /^You joined its table with this key .* started without it/,
    );
    expect(watchText({ kind: 'not-seated', owner: OLD }, ME).body).toContain(short(OLD));
  });

  it('reads the local record and the key’s own tables from storage', () => {
    const store = memoryStorage();
    const addr = `37450:${A}:t1`;
    expect(localTableRecord('p', store, addr)).toEqual(NONE);
    expect(myTableCount('p', store, ME)).toBe(0);
    addToTableList('p', store, addr, OLD);
    saveSecrets('p', store, addr, { sessionSk: new Uint8Array(32).fill(1), deckSecret: new Uint8Array(32) });
    expect(localTableRecord('p', store, addr)).toEqual({ listed: true, secrets: true, owner: OLD });
    expect(myTableCount('p', store, ME)).toBe(0);
    expect(myTableCount('p', store, OLD)).toBe(1);
    // A table listed with no owner counts for the key in use.
    addToTableList('p', store, `37450:${A}:t2`);
    expect(myTableCount('p', store, ME)).toBe(1);
    expect(localTableRecord('q', store, addr)).toEqual(NONE);
  });

  it('renders the notice as a status, with a real Switch button for a kept key', () => {
    const switched: string[] = [];
    const kept = renderTree(
      WatchingNotice({
        notice: { kind: 'kept', pubkey: OLD },
        me: ME,
        switchError: '',
        onSwitch: (pk) => switched.push(pk),
      }),
    );
    const root = kept[0] as { attrs: Record<string, unknown> };
    expect(root.attrs.role).toBe('status');
    const buttons = findAll(kept, (el) => el.tag === 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.attrs.type).toBe('button');
    expect(spokenText(buttons)).toBe(`Switch to ${short(OLD)} and reload`);
    (buttons[0]?.attrs.onClick as (() => void) | undefined)?.();
    expect(switched).toEqual([OLD]);

    const failed = renderTree(
      WatchingNotice({
        notice: { kind: 'kept', pubkey: OLD },
        me: ME,
        switchError: 'No.',
        onSwitch: () => {},
      }),
    );
    expect(findAll(failed, (el) => el.attrs.role === 'alert').map((el) => spokenText([el]))).toEqual(['No.']);

    const visitor = renderTree(
      WatchingNotice({ notice: { kind: 'visitor' }, me: ME, switchError: '', onSwitch: () => {} }),
    );
    expect(spokenText(visitor)).toBe("You're watching this game.");
    expect(findAll(visitor, (el) => el.tag === 'button')).toHaveLength(0);

    const elsewhere = renderTree(
      WatchingNotice({ notice: { kind: 'elsewhere' }, me: ME, switchError: '', onSwitch: () => {} }),
    );
    expect(spokenText(elsewhere)).toContain(`This browser's key (${short(ME)}) isn't one of its players.`);
    expect(findAll(elsewhere, (el) => el.tag === 'button')).toHaveLength(0);
  });

  it('a seat recovered from saved game keys: names the seat, the joining key and the key in use', () => {
    const t = recoveredText(2, OLD, ME);
    expect(t.lead).toBe(
      `Playing seat 3 with the game keys saved in this browser (you joined as ${short(OLD)}; this browser's key is now ${short(ME)}).`,
    );
    expect(t.body).toMatch(/will not sign it/);
    const tree = renderTree(RecoveredNotice({ seat: 2, joined: OLD, me: ME }));
    expect((tree[0] as { attrs: Record<string, unknown> }).attrs.role).toBe('status');
    expect(spokenText(tree)).toBe(`${t.lead} ${t.body}`);
  });
});
