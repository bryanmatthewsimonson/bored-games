/*
 * Before a seat is taken (D057; `joinGate` in identity.ts decides which):
 * - `backup`: "Copy your secret key first?", once per join while the local key has never been backed up (D041). A
 *   seat belongs to the key that joined; a key kept only in this browser is lost with its storage, and the seat
 *   with it. "Join anyway" goes ahead without it.
 * - `unsaved`: this browser is not saving site data, so a reload loses the key. The join (or the new table) goes
 *   ahead only after the key is copied and the player confirms.
 * The extension keeps its own key, so its users are never asked.
 */
import { useState } from 'preact/hooks';
import { npubEncode, shortNpub } from '../bech32.ts';
import { copyText } from '../clipboard.ts';
import { useApp } from '../context.ts';
import { CopyButton } from '../header.tsx';
import {
  exportNsec,
  isBackedUp,
  KEY_CHANGED,
  KEY_NOT_SAVED,
  markBackedUp,
  skipBackupPrompt,
  UNSAVED_KEY,
} from '../identity.ts';

/** `saved`: the player ticked "I've saved it somewhere safe" after seeing the key, instead of the clipboard. */
export type CopyState = 'idle' | 'copied' | 'saved' | 'failed';

/** Whether the key was copied or saved by hand: the prompt may go on. */
export const keySaved = (copy: CopyState): boolean => copy === 'copied' || copy === 'saved';
export type PromptMode = 'backup' | 'unsaved';
export type PromptAction = 'join' | 'create';

export const COPY_NOTE: Record<CopyState, string> = {
  idle: '',
  copied: 'Copied. Paste it somewhere safe, such as a password manager, before you close this page.',
  saved: 'Keep it somewhere only you can reach, such as a password manager.',
  failed: 'Could not copy it. Show the secret key below and save it by hand.',
};

/** The button that goes ahead: none before the copy when the key is not being saved. */
export function proceedLabel(mode: PromptMode, action: PromptAction, copy: CopyState): string | null {
  const verb = action === 'join' ? 'join' : 'create the table';
  if (mode === 'unsaved') return keySaved(copy) ? `I've saved it: ${verb}` : null;
  if (action === 'create') return keySaved(copy) ? 'Create table' : 'Create anyway';
  return keySaved(copy) ? 'Join' : 'Join anyway';
}

/** The prompt itself, without state: `JoinBackup` wires it to the clipboard and storage. */
export function JoinBackupPrompt(props: {
  mode: PromptMode;
  action: PromptAction;
  /** The key in use, as a short npub. */
  npub: string;
  copy: CopyState;
  busy: boolean;
  /** Distinguishes the ids when a list could show more than one. */
  idBase: string;
  /** "Don't ask again for this key" (the backup prompt only). */
  dontAsk: boolean;
  onDontAsk: (checked: boolean) => void;
  /** The key this page signs with, `nsec1…`, from memory; shown on request as an alternative to the clipboard. */
  nsec: string | null;
  /** "I've saved it somewhere safe", ticked after seeing the key. */
  onSavedByHand: () => void;
  onCopy: () => void;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const head = `${props.idBase}-h`;
  const body = `${props.idBase}-p`;
  const copied = keySaved(props.copy);
  const proceed = proceedLabel(props.mode, props.action, props.copy);
  return (
    <section class="confirm join-backup" role="alertdialog" aria-labelledby={head} aria-describedby={body}>
      {props.mode === 'unsaved' ? (
        <>
          <h3 id={head}>This browser isn't saving your key</h3>
          <p id={body}>
            {UNSAVED_KEY} Your key is {props.npub}. Copy it before you go on.
          </p>
        </>
      ) : (
        <>
          <h3 id={head}>Copy your secret key first?</h3>
          <p id={body}>
            Your seat will belong to this browser's key ({props.npub}), which is kept only here and has never
            been backed up. If this site's data is cleared, or you open the game in another app or browser,
            you need the secret key to play your seat.
          </p>
        </>
      )}
      <div class="row">
        {!copied && (
          <button type="button" class="btn btn-primary" disabled={props.busy} onClick={props.onCopy}>
            Copy secret key
          </button>
        )}
        {proceed !== null && (
          <button
            type="button"
            class={copied ? 'btn btn-primary' : 'btn'}
            disabled={props.busy}
            onClick={props.onJoin}
          >
            {proceed}
          </button>
        )}
        <button type="button" class="btn" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      {!copied && props.nsec !== null && (
        <details class="join-backup-key" open={props.copy === 'failed'}>
          <summary>Show the secret key instead</summary>
          <input
            type="text"
            readOnly
            class="nsec-inline"
            aria-label="Secret key (nsec)"
            value={props.nsec}
            autocomplete="off"
            spellcheck={false}
            onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          />
          <label class="check">
            <input
              type="checkbox"
              checked={false}
              disabled={props.busy}
              onChange={(e) => {
                if ((e.currentTarget as HTMLInputElement).checked) props.onSavedByHand();
              }}
            />
            I've saved it somewhere safe
          </label>
        </details>
      )}
      {props.mode === 'backup' && !copied && (
        <label class="check">
          <input
            type="checkbox"
            checked={props.dontAsk}
            disabled={props.busy}
            onChange={(e) => props.onDontAsk((e.currentTarget as HTMLInputElement).checked)}
          />
          Don't ask again for this key
        </label>
      )}
      <p class={props.copy === 'failed' ? 'error' : 'muted'} role="status">
        {COPY_NOTE[props.copy]}
      </p>
    </section>
  );
}

/**
 * The prompt for the key in use: "Copy secret key" copies the nsec and marks the key backed up, as Settings does.
 * A key already backed up in this browser (this page's session, when site data is not saved) counts as copied.
 */
export function JoinBackup(props: {
  mode: PromptMode;
  action: PromptAction;
  busy: boolean;
  idBase: string;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const { profile, store, signer } = useApp();
  const [copy, setCopy] = useState<CopyState>(() =>
    props.mode === 'unsaved' && isBackedUp(profile, store, signer.pubkey) ? 'copied' : 'idle',
  );
  const [dontAsk, setDontAsk] = useState(false);
  // From memory: it works when storage refuses writes, or holds another key now (D057).
  const nsec = signer.exportNsec?.() ?? exportNsec(profile, store);
  const onCopy = async () => {
    setCopy('idle'); // a retry starts afresh
    const ok = nsec !== null && (await copyText(nsec));
    if (ok) markBackedUp(profile, store, signer.pubkey);
    setCopy(ok ? 'copied' : 'failed');
  };
  return (
    <JoinBackupPrompt
      mode={props.mode}
      action={props.action}
      npub={shortNpub(npubEncode(signer.pubkey))}
      copy={copy}
      busy={props.busy}
      idBase={props.idBase}
      dontAsk={dontAsk}
      onDontAsk={setDontAsk}
      nsec={nsec}
      onSavedByHand={() => {
        markBackedUp(profile, store, signer.pubkey);
        setCopy('saved');
      }}
      onCopy={() => void onCopy()}
      onJoin={() => {
        // Stored in this browser (localStorage), for this key only.
        if (dontAsk && props.mode === 'backup' && !keySaved(copy))
          skipBackupPrompt(profile, store, signer.pubkey);
        props.onJoin();
      }}
      onCancel={props.onCancel}
    />
  );
}

/**
 * After a join or a new table was refused because storage no longer holds this page's key (D057): offer to copy
 * the key this page still holds in memory, which is also kept under Settings → Other keys.
 */
export function CopyPageKey(props: { message: string }) {
  const { signer } = useApp();
  if ((props.message !== KEY_CHANGED && props.message !== KEY_NOT_SAVED) || signer.exportNsec === undefined)
    return null;
  const nsec = signer.exportNsec();
  return <CopyButton text={nsec} label="Copy this page's secret key" />;
}
