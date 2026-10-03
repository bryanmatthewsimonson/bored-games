import { describe, expect, it } from 'vitest';
import { COPY_NOTE, JoinBackupPrompt, proceedLabel } from '../src/components/join-backup.tsx';
import { UNSAVED_KEY } from '../src/identity.ts';
import { findAll, renderTree, spokenText } from './render-tree.ts';

type Props = Parameters<typeof JoinBackupPrompt>[0];

const base: Props = {
  mode: 'backup',
  action: 'join',
  npub: 'npub1abcdef…uvwxyz',
  copy: 'idle',
  busy: false,
  idBase: 'jb',
  dontAsk: false,
  onDontAsk: () => {},
  nsec: 'nsec1secretsecretsecret',
  onSavedByHand: () => {},
  onCopy: () => {},
  onJoin: () => {},
  onCancel: () => {},
};
const tree = (over: Partial<Props>) => renderTree(JoinBackupPrompt({ ...base, ...over }));
const buttons = (over: Partial<Props>) =>
  findAll(tree(over), (el) => el.tag === 'button').map((b) => spokenText([b]));
/** The checkboxes whose label reads `name`. */
const checkboxes = (over: Partial<Props>, name = "Don't ask again for this key") =>
  findAll(tree(over), (el) => el.tag === 'label' && spokenText([el]) === name).flatMap((label) =>
    findAll(label.children, (el) => el.tag === 'input' && el.attrs.type === 'checkbox'),
  );
const SAVED_BY_HAND = "I've saved it somewhere safe";

describe('backup before joining or creating a table (D057)', () => {
  it('offers Copy secret key, Join anyway and Cancel, named by its heading', () => {
    const t = tree({});
    const root = t[0] as { attrs: Record<string, unknown> };
    expect(root.attrs.role).toBe('alertdialog');
    expect(root.attrs['aria-labelledby']).toBe('jb-h');
    expect(root.attrs['aria-describedby']).toBe('jb-p');
    expect(spokenText(t)).toContain('Copy your secret key first?');
    expect(spokenText(t)).toContain("this browser's key (npub1abcdef…uvwxyz)");
    expect(buttons({})).toEqual(['Copy secret key', 'Join anyway', 'Cancel']);
    for (const b of findAll(t, (el) => el.tag === 'button')) expect(b.attrs.type).toBe('button');
  });

  it('after a copy: says so, and Join is the main button; a failed copy points to Settings', () => {
    expect(buttons({ copy: 'copied' })).toEqual(['Join', 'Cancel']);
    expect(spokenText(tree({ copy: 'copied' }))).toContain(COPY_NOTE.copied);
    const failed = tree({ copy: 'failed' });
    expect(findAll(failed, (el) => el.attrs.class === 'error').map((el) => spokenText([el]))).toEqual([
      COPY_NOTE.failed,
    ]);
    expect(buttons({ copy: 'failed' })).toEqual(['Copy secret key', 'Join anyway', 'Cancel']);
  });

  it('offers "Don\'t ask again for this key" with Join anyway, not once the key is copied', () => {
    const [box] = checkboxes({});
    expect(spokenText(tree({}))).toContain("Don't ask again for this key");
    expect(box?.attrs.checked).toBe(false);
    const seen: boolean[] = [];
    (box?.attrs.onChange as ((e: unknown) => void) | undefined)?.({ currentTarget: { checked: true } });
    expect(seen).toEqual([]);
    const [box2] = checkboxes({ onDontAsk: (c) => seen.push(c) });
    (box2?.attrs.onChange as ((e: unknown) => void) | undefined)?.({ currentTarget: { checked: true } });
    expect(seen).toEqual([true]);
    expect(checkboxes({ copy: 'copied' })).toHaveLength(0);
  });

  it('a new table: the same prompt, with Create anyway', () => {
    expect(buttons({ action: 'create' })).toEqual(['Copy secret key', 'Create anyway', 'Cancel']);
    expect(buttons({ action: 'create', copy: 'copied' })).toEqual(['Create table', 'Cancel']);
  });

  it('a key that is not being saved: no way on until it is copied, then an explicit confirm', () => {
    const t = tree({ mode: 'unsaved' });
    expect(spokenText(t)).toContain("This browser isn't saving your key");
    expect(spokenText(t)).toContain(UNSAVED_KEY);
    expect(buttons({ mode: 'unsaved' })).toEqual(['Copy secret key', 'Cancel']);
    expect(buttons({ mode: 'unsaved', copy: 'failed' })).toEqual(['Copy secret key', 'Cancel']);
    expect(buttons({ mode: 'unsaved', copy: 'copied' })).toEqual(["I've saved it: join", 'Cancel']);
    expect(buttons({ mode: 'unsaved', action: 'create', copy: 'copied' })).toEqual([
      "I've saved it: create the table",
      'Cancel',
    ]);
    expect(checkboxes({ mode: 'unsaved' })).toHaveLength(0);
    expect(checkboxes({ mode: 'unsaved' }, SAVED_BY_HAND)).toHaveLength(1);
    expect(proceedLabel('unsaved', 'join', 'idle')).toBeNull();
  });

  it('disables every control while the join is under way', () => {
    const t = tree({ busy: true });
    for (const b of findAll(t, (el) => el.tag === 'button' || el.attrs.type === 'checkbox'))
      expect(b.attrs.disabled).toBe(true);
  });

  it('shows the key from memory on request, with "I\'ve saved it somewhere safe" as an alternative to the clipboard', () => {
    const t = tree({});
    const [details] = findAll(t, (el) => el.tag === 'details');
    expect(details?.attrs.open).toBe(false);
    expect(spokenText(t)).toContain('Show the secret key instead');
    const [input] = findAll(t, (el) => el.tag === 'input' && el.attrs.type === 'text');
    expect(input?.attrs.value).toBe('nsec1secretsecretsecret');
    expect(input?.attrs.readOnly).toBe(true);
    let saved = 0;
    const [box] = checkboxes({ onSavedByHand: () => saved++ }, SAVED_BY_HAND);
    (box?.attrs.onChange as ((e: unknown) => void) | undefined)?.({ currentTarget: { checked: true } });
    expect(saved).toBe(1);
    // A failed copy opens it, so the key can be saved by hand; a key that is not being saved too.
    expect(findAll(tree({ copy: 'failed' }), (el) => el.tag === 'details')[0]?.attrs.open).toBe(true);
    expect(spokenText(tree({ mode: 'unsaved', copy: 'failed' }))).toContain("I've saved it somewhere safe");
  });

  it('a key saved by hand goes on like a copied one', () => {
    expect(buttons({ copy: 'saved' })).toEqual(['Join', 'Cancel']);
    expect(buttons({ mode: 'unsaved', copy: 'saved' })).toEqual(["I've saved it: join", 'Cancel']);
    expect(spokenText(tree({ copy: 'saved' }))).toContain(COPY_NOTE.saved);
    expect(findAll(tree({ copy: 'saved' }), (el) => el.tag === 'details')).toHaveLength(0);
    // Without a key to show (the extension), there is nothing to show.
    expect(findAll(tree({ nsec: null }), (el) => el.tag === 'details')).toHaveLength(0);
  });
});
