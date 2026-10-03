/*
 * The key race behind the D057 incident (item 10): two pages of the site starting at once on a fresh browser both
 * found no key and both made one; the last write won in storage while one page kept the other key in memory, joined
 * a table with it, and lost it on the next reload.
 */
import { describe, expect, it } from 'vitest';
import { KeyChangedDialog } from '../src/app.tsx';
import {
  blockableSigner,
  KEY_CHANGED,
  KEY_CHANGED_ELSEWHERE,
  KEY_NOT_SAVED,
  keepReplacedKey,
  keptKeys,
  keyChangedElsewhere,
  type LockManagerLike,
  loadIdentity,
  storedKeyProblem,
} from '../src/identity.ts';
import type { RandomBytes } from '../src/random.ts';
import { type KeyValueStore, memoryStorage } from '../src/storage.ts';
import { findAll, renderTree, spokenText } from './render-tree.ts';

function seeded(start = 1): RandomBytes {
  let n = start;
  return (len) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = ((n++ * 37) % 251) + 1;
    return out;
  };
}

const SK = 'bg:p:sk';
const TEMPLATE = { kind: 1, created_at: 1_700_000_000, tags: [], content: 'hi' };

/** The key (hex) and pubkey `loadIdentity` makes from `seed` on an empty store. */
async function keyFrom(seed: number): Promise<{ hex: string; pubkey: string }> {
  const s = memoryStorage();
  const id = await loadIdentity('p', s, seeded(seed));
  return { hex: s.getItem(SK) as string, pubkey: id.pubkey };
}

/**
 * A Web Locks manager for one origin: callbacks for the same name run one after another, in request order, each
 * after the previous one settled. Records the requests it saw.
 */
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const seen: { name: string; mode: string }[] = [];
  const locks: LockManagerLike = {
    request: <T>(
      name: string,
      options: { mode: 'exclusive' },
      callback: () => Promise<T> | T,
    ): Promise<T> => {
      seen.push({ name, mode: options.mode });
      const prev = tails.get(name) ?? Promise.resolve();
      const run = prev.then(() => callback());
      tails.set(
        name,
        run.catch(() => {}),
      );
      return run;
    },
  };
  return { locks, seen };
}

describe('two pages making a key at once (D057, item 10)', () => {
  it('with Web Locks: two pages that both found no key end on one key, made once', async () => {
    const store = memoryStorage();
    const { locks, seen } = fakeLocks();
    let draws = 0;
    const counted = (seed: number): RandomBytes => {
      const r = seeded(seed);
      return (n) => {
        draws++;
        return r(n);
      };
    };
    // Both pages start before either has written: each reads no key, then asks for the lock.
    const [one, two] = await Promise.all([
      loadIdentity('p', store, counted(1), undefined, { locks }),
      loadIdentity('p', store, counted(77), undefined, { locks }),
    ]);
    expect(one.pubkey).toBe(two.pubkey);
    expect(draws).toBe(1); // only the first page made a key; the second found it inside the lock
    expect(seen).toEqual([
      { name: 'bg:p:sk', mode: 'exclusive' },
      { name: 'bg:p:sk', mode: 'exclusive' },
    ]);
    await expect(one.sign(TEMPLATE)).resolves.toMatchObject({ pubkey: one.pubkey });
    await expect(two.sign(TEMPLATE)).resolves.toMatchObject({ pubkey: one.pubkey });
    expect(one.lostPrevious || two.lostPrevious).toBe(false);
  });

  it('with Web Locks: a stored key is used without asking for the lock', async () => {
    const store = memoryStorage();
    const first = await loadIdentity('p', store, seeded(1));
    const { locks, seen } = fakeLocks();
    const again = await loadIdentity('p', store, seeded(9), undefined, { locks });
    expect(again.pubkey).toBe(first.pubkey);
    expect(seen).toEqual([]);
  });

  it('without Web Locks: the same path, unlocked; the guards below catch a key replaced later', async () => {
    const store = memoryStorage();
    const [one, two] = await Promise.all([
      loadIdentity('p', store, seeded(1)),
      loadIdentity('p', store, seeded(77)),
    ]);
    // Here the second page's read already sees the first page's write (one cache). Across processes it may not:
    // the signer's check before every signature and the storage event cover that (below, and e2e).
    expect(two.pubkey).toBe(one.pubkey);
  });

  it('the loser of a later write refuses to sign before anything goes out', async () => {
    const store = memoryStorage();
    const one = await loadIdentity('p', store, seeded(1));
    await expect(one.sign(TEMPLATE)).resolves.toMatchObject({ pubkey: one.pubkey });
    // Another page overwrites the key after this page read it back.
    const b = await keyFrom(77);
    store.setItem(SK, b.hex);
    await expect(one.sign(TEMPLATE)).rejects.toThrow(KEY_CHANGED);
    // A key removed from storage after it was saved is refused too.
    store.removeItem(SK);
    await expect(one.sign(TEMPLATE)).rejects.toThrow(KEY_NOT_SAVED);
  });

  it('a key that was never stored (site data blocked) still signs', async () => {
    const refusing: KeyValueStore = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const id = await loadIdentity('p', refusing, seeded(1));
    expect(id.persistent).toBe(false);
    await expect(id.sign(TEMPLATE)).resolves.toMatchObject({ pubkey: id.pubkey });
  });

  it('storedKeyProblem: the same key is fine, another valid key or a vanished saved key is not', async () => {
    const a = await keyFrom(1);
    const b = await keyFrom(77);
    const store = memoryStorage();
    store.setItem(SK, a.hex);
    expect(storedKeyProblem('p', store, a.hex, true)).toBeNull();
    store.setItem(SK, b.hex);
    expect(storedKeyProblem('p', store, a.hex, true)).toBe(KEY_CHANGED);
    store.setItem(SK, 'junk');
    expect(storedKeyProblem('p', store, a.hex, true)).toBe(KEY_NOT_SAVED);
    expect(storedKeyProblem('p', store, a.hex, false)).toBeNull();
  });
});

describe('a key changed by another page (storage event, D057 item 10)', () => {
  it('flags a replaced, removed or cleared local key, and a changed signer choice', async () => {
    const a = await keyFrom(1);
    const b = await keyFrom(77);
    const me = { kind: 'local' as const, pubkey: a.pubkey };
    expect(keyChangedElsewhere({ key: SK, newValue: b.hex }, 'p', me)).toBe(true);
    expect(keyChangedElsewhere({ key: SK, newValue: null }, 'p', me)).toBe(true);
    expect(keyChangedElsewhere({ key: SK, newValue: 'junk' }, 'p', me)).toBe(true);
    expect(keyChangedElsewhere({ key: null, newValue: null }, 'p', me)).toBe(true);
    expect(keyChangedElsewhere({ key: 'bg:p:signer', newValue: 'nip07' }, 'p', me)).toBe(true);
  });

  it('ignores the same key written again, other items, other profiles, and the key under the extension', async () => {
    const a = await keyFrom(1);
    const b = await keyFrom(77);
    const me = { kind: 'local' as const, pubkey: a.pubkey };
    expect(keyChangedElsewhere({ key: SK, newValue: a.hex }, 'p', me)).toBe(false);
    expect(keyChangedElsewhere({ key: 'bg:p:tables', newValue: '[]' }, 'p', me)).toBe(false);
    expect(keyChangedElsewhere({ key: 'bg:q:sk', newValue: b.hex }, 'p', me)).toBe(false);
    expect(keyChangedElsewhere({ key: 'bg:p:signer', newValue: 'local' }, 'p', me)).toBe(false);
    const ext = { kind: 'nip07' as const, pubkey: b.pubkey };
    expect(keyChangedElsewhere({ key: SK, newValue: a.hex }, 'p', ext)).toBe(false);
    expect(keyChangedElsewhere({ key: 'bg:p:signer', newValue: 'nip07' }, 'p', ext)).toBe(false);
    expect(keyChangedElsewhere({ key: 'bg:p:signer', newValue: 'local' }, 'p', ext)).toBe(true);
    expect(keyChangedElsewhere({ key: 'bg:p:signer', newValue: null }, 'p', ext)).toBe(true);
  });

  it('a blocked signer refuses to sign; the dialog has one Reload button', async () => {
    let blocked = false;
    const id = await loadIdentity('p', memoryStorage(), seeded(1));
    const s = blockableSigner(id, () => blocked);
    expect(s.pubkey).toBe(id.pubkey);
    await expect(s.sign(TEMPLATE)).resolves.toMatchObject({ pubkey: id.pubkey });
    blocked = true;
    await expect(s.sign(TEMPLATE)).rejects.toThrow(KEY_CHANGED_ELSEWHERE);

    let reloads = 0;
    const tree = renderTree(KeyChangedDialog({ onReload: () => reloads++ }));
    const [dialog] = findAll(tree, (el) => el.attrs.role === 'alertdialog');
    expect(dialog?.attrs['aria-modal']).toBe('true');
    expect(spokenText(tree)).toContain(KEY_CHANGED_ELSEWHERE);
    const buttons = findAll(tree, (el) => el.tag === 'button');
    expect(buttons.map((b) => spokenText([b]))).toEqual(['Reload']);
    (buttons[0]?.attrs.onClick as (() => void) | undefined)?.();
    expect(reloads).toBe(1);
  });
});

describe("keeping this page's key when another page replaced it (D057, item 10)", () => {
  it('a refused signature keeps the replaced key under Other keys, once', async () => {
    const store = memoryStorage();
    const a = await loadIdentity('p', store, seeded(1), undefined, { now: () => 1234 });
    const b = await keyFrom(77);
    store.setItem(SK, b.hex);
    await expect(a.sign(TEMPLATE)).rejects.toThrow(KEY_CHANGED);
    expect(keptKeys('p', store).map((k) => [k.pubkey, k.at])).toEqual([[a.pubkey, 1234]]);
    await expect(a.sign(TEMPLATE)).rejects.toThrow(KEY_CHANGED);
    expect(keptKeys('p', store)).toHaveLength(1);
  });

  it('rescue (the storage event path) keeps it too, also when the key was removed; nothing while it is stored', async () => {
    const store = memoryStorage();
    const a = await loadIdentity('p', store, seeded(1));
    expect(a.rescue()).toBe(true);
    expect(keptKeys('p', store)).toEqual([]);
    store.removeItem(SK);
    expect(a.rescue()).toBe(true);
    expect(keptKeys('p', store).map((k) => k.pubkey)).toEqual([a.pubkey]);
    // The next load makes a new key; the old one stays kept, and the loss is reported.
    const next = await loadIdentity('p', store, seeded(50));
    expect(next.pubkey).not.toBe(a.pubkey);
    expect(next.lostPrevious).toBe(true);
    expect(keptKeys('p', store).map((k) => k.pubkey)).toEqual([a.pubkey]);
  });

  it('keepReplacedKey ignores a malformed key and keeps other kept keys', async () => {
    const store = memoryStorage();
    const a = await keyFrom(1);
    const b = await keyFrom(77);
    store.setItem(SK, b.hex);
    expect(keepReplacedKey('p', store, 'junk', 1)).toBe(true);
    expect(keptKeys('p', store)).toEqual([]);
    expect(keepReplacedKey('p', store, a.hex, 5)).toBe(true);
    expect(keepReplacedKey('p', store, b.hex, 6)).toBe(true); // the stored key: not kept
    expect(keptKeys('p', store).map((k) => k.pubkey)).toEqual([a.pubkey]);
  });

  it('the page key is exported from memory, also when storage holds another key or none', async () => {
    const store = memoryStorage();
    const a = await loadIdentity('p', store, seeded(1));
    const want = a.exportNsec?.();
    expect(want).toMatch(/^nsec1/);
    store.setItem(SK, (await keyFrom(77)).hex);
    expect(a.exportNsec?.()).toBe(want);
    const refusing: KeyValueStore = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const r = await loadIdentity('p', refusing, seeded(3));
    expect(r.exportNsec?.()).toMatch(/^nsec1/);
  });
});
