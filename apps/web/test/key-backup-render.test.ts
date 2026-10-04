import { describe, expect, it } from 'vitest';
import { BACKUP_BUTTON, BackupOffer, RestoreNotice } from '../src/components/key-backup.tsx';
import { BACKUP_NO_NIP44, RESTORE_TEXT } from '../src/key-backup.ts';
import { findAll, renderTree, spokenText } from './render-tree.ts';

const buttons = (t: ReturnType<typeof renderTree>) =>
  findAll(t, (el) => el.tag === 'button').map((b) => spokenText([b]));

describe('the game screen’s key backup notices (D065)', () => {
  it('says the keys are being restored, then that both devices can play', () => {
    const restoring = renderTree(RestoreNotice({ state: 'restoring', onRetry: () => {} }));
    expect(spokenText(restoring)).toBe('Restoring your game keys from your backup…');
    expect(buttons(restoring)).toEqual([]);
    const done = spokenText(renderTree(RestoreNotice({ state: 'restored', onRetry: () => {} })));
    expect(done).toBe(RESTORE_TEXT.restored);
    expect(done).toContain('You can play on both devices');
  });

  it('a failed restore tells the player what to do, with Try again', () => {
    let retried = 0;
    for (const state of [
      'none',
      'incomplete',
      'unreadable',
      'mismatch',
      'failed',
      'refused',
      'timeout',
    ] as const) {
      const t = renderTree(RestoreNotice({ state, onRetry: () => retried++ }));
      expect(spokenText(t)).toContain("You're watching this game");
      expect(buttons(t)).toEqual(['Try again']);
      const click = findAll(t, (el) => el.tag === 'button')[0]?.attrs.onClick as () => void;
      click();
    }
    expect(retried).toBe(7);
    expect(RESTORE_TEXT.none).toContain('Open the game on the device you joined with');
    const ext = renderTree(RestoreNotice({ state: 'unavailable', onRetry: () => {} }));
    expect(spokenText(ext)).toContain(BACKUP_NO_NIP44);
    expect(buttons(ext)).toEqual([]);
  });

  it('a local key backs up by itself; an extension is offered the button; errors can be retried', () => {
    const offer = (state: Parameters<typeof BackupOffer>[0]['state'], signer: 'local' | 'nip07') =>
      renderTree(BackupOffer({ state, signer, onBackup: () => {} }));
    expect(offer('due', 'local')).toEqual([]);
    expect(offer('done', 'nip07')).toEqual([]);
    expect(buttons(offer('due', 'nip07'))).toEqual([BACKUP_BUTTON]);
    const failed = offer({ error: 'No relay accepted the backup.' }, 'local');
    expect(buttons(failed)).toEqual([BACKUP_BUTTON]);
    expect(spokenText(failed)).toContain('No relay accepted the backup.');
    expect(spokenText(offer('sending', 'nip07'))).toBe("Backing up this game's keys…");
    expect(spokenText(offer('unavailable', 'nip07'))).toContain(BACKUP_NO_NIP44);
  });
});
