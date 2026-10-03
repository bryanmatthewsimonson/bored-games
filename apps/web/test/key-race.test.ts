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
  keyChangedElsewhere,
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

/** A view of `store` as one page sees it: `get` may answer a read instead (undefined: read through). */
function pageView(
  store: KeyValueStore,
  hooks: { get?: (k: string) => string | null | undefined; afterSet?: (k: string, v: string) => void },
): KeyValueStore {
  return {
    getItem: (k) => {
      const v = hooks.get?.(k);
      return v === undefined ? store.getItem(k) : v;
    },
    setItem: (k, v) => {
      store.setItem(k, v);
      hooks.afterSet?.(k, v);
    },
    removeItem: (k) => store.removeItem(k),
  };
}

describe('two pages making a key at once (D057, item 10)', () => {
  it('both read no key and both write one: both end up on the stored key', async () => {
    const b = await keyFrom(77);
    const store = memoryStorage();
    // Page 1 read no key; page 2 also read none and writes B right after page 1 writes A.
    let p2Wrote = false;
    const page1 = pageView(store, {
      afterSet: (k) => {
        if (k === SK && !p2Wrote) {
          p2Wrote = true;
          store.setItem(SK, b.hex);
        }
      },
    });
    const one = await loadIdentity('p', page1, seeded(1));
    // Page 2 read everything before page 1 wrote anything: until its own write, it sees an empty store.
    let p2Writing = false;
    const page2 = pageView(store, {
      get: () => (p2Writing ? undefined : null),
      afterSet: () => {
        p2Writing = true;
      },
    });
    const two = await loadIdentity('p', page2, seeded(77));
    expect(one.pubkey).toBe(b.pubkey);
    expect(two.pubkey).toBe(b.pubkey);
    expect(store.getItem(SK)).toBe(b.hex);
    await expect(one.sign(TEMPLATE)).resolves.toMatchObject({ pubkey: b.pubkey });
    // Neither page reports a lost key: there was none before.
    expect(one.lostPrevious).toBe(false);
    expect(two.lostPrevious).toBe(false);
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
