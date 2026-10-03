import { describe, expect, it } from 'vitest';
import { COPY_NOTE, JoinBackupPrompt } from '../src/components/join-backup.tsx';
import { findAll, renderTree, spokenText } from './render-tree.ts';

describe('backup before joining (D057)', () => {
  const props = {
    npub: 'npub1abcdef…uvwxyz',
    busy: false,
    idBase: 'jb',
    onCopy: () => {},
    onJoin: () => {},
    onCancel: () => {},
  };
  const buttons = (copy: 'idle' | 'copied' | 'failed') =>
    findAll(renderTree(JoinBackupPrompt({ ...props, copy })), (el) => el.tag === 'button');

  it('offers Copy secret key, Join anyway and Cancel, named by its heading', () => {
    const tree = renderTree(JoinBackupPrompt({ ...props, copy: 'idle' }));
    const root = tree[0] as { attrs: Record<string, unknown> };
    expect(root.attrs.role).toBe('alertdialog');
    expect(root.attrs['aria-labelledby']).toBe('jb-h');
    expect(spokenText(tree)).toContain('Copy your secret key first?');
    expect(spokenText(tree)).toContain("this browser's key (npub1abcdef…uvwxyz)");
    expect(buttons('idle').map((b) => spokenText([b]))).toEqual(['Copy secret key', 'Join anyway', 'Cancel']);
    for (const b of buttons('idle')) expect(b.attrs.type).toBe('button');
  });

  it('after a copy: says so, and Join is the main button; a failed copy points to Settings', () => {
    expect(buttons('copied').map((b) => spokenText([b]))).toEqual(['Join', 'Cancel']);
    expect(spokenText(renderTree(JoinBackupPrompt({ ...props, copy: 'copied' })))).toContain(
      COPY_NOTE.copied,
    );
    const failed = renderTree(JoinBackupPrompt({ ...props, copy: 'failed' }));
    expect(findAll(failed, (el) => el.attrs.class === 'error').map((el) => spokenText([el]))).toEqual([
      COPY_NOTE.failed,
    ]);
    expect(buttons('failed').map((b) => spokenText([b]))).toEqual([
      'Copy secret key',
      'Join anyway',
      'Cancel',
    ]);
  });

  it('disables every button while the join is under way', () => {
    const tree = renderTree(JoinBackupPrompt({ ...props, copy: 'idle', busy: true }));
    for (const b of findAll(tree, (el) => el.tag === 'button')) expect(b.attrs.disabled).toBe(true);
  });
});
