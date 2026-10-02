/*
 * Settings → Identity, the parts about keeping the key (D041): whether the browser keeps this site's data,
 * importing a secret key from elsewhere, and switching back to the key used before the import.
 */
import { useEffect, useState } from 'preact/hooks';
import { npubEncode, shortNpub } from './bech32.ts';
import { useApp } from './context.ts';
import { gamesInProgress, importSecretKey, previousKey, restorePreviousKey } from './identity.ts';
import { type PersistState, persistState, requestPersistence, storageManager } from './storage.ts';

const PERSIST_TEXT: Record<PersistState, string> = {
  persisted: 'This browser has agreed to keep this site’s data, so it will not clear your key on its own.',
  'best-effort':
    'This browser may clear this site’s data when space runs low, and with it your key. Ask it to keep the data, and back up your key.',
  unsupported: 'This browser does not say whether it keeps this site’s data. Back up your key.',
};

/** Whether the browser keeps this site's storage, with a button to ask. */
export function StorageStatus() {
  const [state, setState] = useState<PersistState | null>(null);
  useEffect(() => {
    let live = true;
    void persistState(storageManager()).then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  if (state === null) return null;
  return (
    <div class="row storage-status">
      <span role="status" class="grow">
        <strong>Browser storage:</strong> {PERSIST_TEXT[state]}
      </span>
      {state === 'best-effort' && (
        <button
          type="button"
          class="btn btn-small"
          onClick={async () => setState(await requestPersistence(storageManager()))}
        >
          Ask to keep it
        </button>
      )}
    </div>
  );
}

/** "Use a key from elsewhere": paste an nsec, confirm, reload. And "Switch back" after an import. */
export function KeyImport() {
  const { profile, store, signer } = useApp();
  const [text, setText] = useState('');
  const [sure, setSure] = useState(false);
  const [error, setError] = useState('');
  const [switchError, setSwitchError] = useState('');
  const games = gamesInProgress(profile, store);
  const previous = previousKey(profile, store);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!sure) return setError('Tick the box to confirm first.');
    const r = importSecretKey(profile, store, text);
    if (!r.ok) return setError(r.error);
    setText('');
    // A different key is a different player: start clean.
    window.location.reload();
  };

  return (
    <div class="stack key-import">
      {previous !== null && previous !== signer.pubkey && (
        <div class="row">
          <span class="grow">
            Before your last import you used <code class="npub">{shortNpub(npubEncode(previous))}</code>.
          </span>
          <button
            type="button"
            class="btn btn-small"
            onClick={() => {
              if (restorePreviousKey(profile, store)) window.location.reload();
              else setSwitchError('Could not switch back: this browser would not save the key.');
            }}
          >
            Switch back
          </button>
        </div>
      )}
      {switchError !== '' && (
        <p class="error" role="alert">
          {switchError}
        </p>
      )}
      <details>
        <summary>Use a secret key from elsewhere</summary>
        <form class="stack" onSubmit={submit} noValidate>
          <p class="muted">
            Paste the secret key (nsec) you use in another browser or app to play as that key here.
          </p>
          {signer.kind === 'nip07' && (
            <p class="muted">
              You are signing with a browser extension. Importing a key here stops using the extension for
              this profile: the imported key is kept in this browser instead. To use another key with the
              extension, change it in the extension.
            </p>
          )}
          <label class="field">
            <span>Secret key</span>
            <input
              type="password"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              placeholder="nsec1…"
              value={text}
              aria-invalid={error !== ''}
              aria-describedby="import-error"
              onInput={(e) => {
                setText(e.currentTarget.value);
                setError('');
              }}
            />
          </label>
          <p class="warning" role="note">
            {games > 0
              ? games === 1
                ? '1 game in progress stays with your current key: switch back to play it.'
                : `${games} games in progress stay with your current key: switch back to play them.`
              : 'Your games stay with your current key.'}{' '}
            {signer.kind === 'local'
              ? 'Your current key is kept in this browser so you can switch back, but back it up first.'
              : ''}
          </p>
          <label class="check">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.currentTarget.checked)} />I
            understand: this profile will play as the imported key
          </label>
          <div class="row">
            <button type="submit" class="btn" disabled={!sure || text.trim() === ''}>
              Import key and reload
            </button>
          </div>
          <p id="import-error" class="error" role="alert">
            {error}
          </p>
        </form>
      </details>
    </div>
  );
}
