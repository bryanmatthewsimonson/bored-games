/*
 * "Copy your secret key first?" (D057): asked once per join while the local key has never been backed up (D041).
 * A seat belongs to the key that joined; a key kept only in this browser is lost with its storage, and the seat
 * with it. The extension keeps its own key, so its users are never asked (`joinBackupNeeded`).
 */
import { useState } from 'preact/hooks';
import { npubEncode, shortNpub } from '../bech32.ts';
import { copyText } from '../clipboard.ts';
import { useApp } from '../context.ts';
import { exportNsec, markBackedUp } from '../identity.ts';

export type CopyState = 'idle' | 'copied' | 'failed';

export const COPY_NOTE: Record<CopyState, string> = {
  idle: '',
  copied: 'Copied. Paste it somewhere safe, such as a password manager, before you close this page.',
  failed: 'Could not copy it. Open Settings to show your secret key and copy it from there.',
};

/** The prompt itself, without state: `JoinBackup` wires it to the clipboard and storage. */
export function JoinBackupPrompt(props: {
  /** The key in use, as a short npub. */
  npub: string;
  copy: CopyState;
  busy: boolean;
  /** Distinguishes the ids when a list could show more than one. */
  idBase: string;
  onCopy: () => void;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const head = `${props.idBase}-h`;
  const body = `${props.idBase}-p`;
  const copied = props.copy === 'copied';
  return (
    <section class="confirm join-backup" role="alertdialog" aria-labelledby={head} aria-describedby={body}>
      <h3 id={head}>Copy your secret key first?</h3>
      <p id={body}>
        Your seat will belong to this browser's key ({props.npub}), which is kept only here and has never been
        backed up. If this site's data is cleared, or you open the game in another app or browser, you need
        the secret key to play your seat.
      </p>
      <div class="row">
        {!copied && (
          <button type="button" class="btn btn-primary" disabled={props.busy} onClick={props.onCopy}>
            Copy secret key
          </button>
        )}
        <button
          type="button"
          class={copied ? 'btn btn-primary' : 'btn'}
          disabled={props.busy}
          onClick={props.onJoin}
        >
          {copied ? 'Join' : 'Join anyway'}
        </button>
        <button type="button" class="btn" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      <p class={props.copy === 'failed' ? 'error' : 'muted'} role="status">
        {COPY_NOTE[props.copy]}
      </p>
    </section>
  );
}

/** The prompt for the key in use: "Copy secret key" copies the nsec and marks the key backed up, as Settings does. */
export function JoinBackup(props: {
  busy: boolean;
  idBase: string;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const { profile, store, signer } = useApp();
  const [copy, setCopy] = useState<CopyState>('idle');
  const onCopy = async () => {
    const nsec = exportNsec(profile, store);
    const ok = nsec !== null && (await copyText(nsec));
    if (ok) markBackedUp(profile, store, signer.pubkey);
    setCopy(ok ? 'copied' : 'failed');
  };
  return (
    <JoinBackupPrompt
      npub={shortNpub(npubEncode(signer.pubkey))}
      copy={copy}
      busy={props.busy}
      idBase={props.idBase}
      onCopy={() => void onCopy()}
      onJoin={props.onJoin}
      onCancel={props.onCancel}
    />
  );
}
