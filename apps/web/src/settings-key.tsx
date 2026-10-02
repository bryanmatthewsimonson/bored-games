/*
 * Settings → Identity, the parts about keeping the key (D041): whether the browser keeps this site's data,
 * importing a secret key from elsewhere, and switching back to the key used before the import.
 */
import { useEffect, useState } from 'preact/hooks';
import { npubEncode, shortNpub } from './bech32.ts';
import { useApp } from './context.ts';
import { gamesInProgress, importSecretKey, KEY_ERRORS, keptKeys, switchToKeptKey } from './identity.ts';
import {
  isPersistentStore,
  type PersistState,
  persistState,
  requestPersistence,
  storageManager,
} from './storage.ts';

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

/** Copy for the games a key still has, as a sentence fragment. */
export function gamesLabel(n: number): string {
  return n === 0 ? 'no games in progress' : n === 1 ? '1 game in progress' : `${n} games in progress`;
}

/** What the import form says about the current key's games and where the key goes. */
export function importNote(games: number, kind: 'local' | 'nip07'): string {
  const stay =
    games === 0
      ? 'Your games stay with your current key.'
      : games === 1
        ? '1 game in progress stays with your current key: switch back to it to play.'
        : `${games} games in progress stay with your current key: switch back to it to play them.`;
  return kind === 'local'
    ? `${stay} Your current key is kept in this browser under "Other keys", so you can switch back.`
    : `${stay} The extension keeps its key; turn the extension back on above to use it again.`;
}

/** The keys this profile used before, with "Switch to"; and "Use a key from elsewhere": paste, confirm, reload. */
export function KeyImport() {
  const { profile, store, signer, deps } = useApp();
  const [text, setText] = useState('');
  const [sure, setSure] = useState(false);
  const [error, setError] = useState('');
  const [switchError, setSwitchError] = useState('');
  const games = gamesInProgress(profile, store, signer.pubkey);
  const kept = keptKeys(profile, store);
  const persistent = isPersistentStore(store);
  const ctx = () => ({ current: signer.pubkey, now: deps.now() });

  const submit = (e: Event) => {
    e.preventDefault();
    if (!sure) return setError('Tick the box to confirm first.');
    const r = importSecretKey(profile, store, text, ctx());
    if (!r.ok) return setError(r.error);
    setText('');
    // A different key is a different player: start clean.
    window.location.reload();
  };

  return (
    <div class="stack key-import">
      {kept.length > 0 && (
        <section aria-labelledby="kept-h">
          <h4 id="kept-h">Other keys</h4>
          <p class="muted">Keys this profile used before. Their games stay with them.</p>
          <ul class="kept-keys">
            {kept.map((k) => (
              <li key={k.pubkey} class="row">
                <span class="grow">
                  <code class="npub">{shortNpub(npubEncode(k.pubkey))}</code>{' '}
                  <span class="muted">{gamesLabel(gamesInProgress(profile, store, k.pubkey, false))}</span>
                </span>
                <button
                  type="button"
                  class="btn btn-small"
                  aria-label={`Switch to ${shortNpub(npubEncode(k.pubkey))}`}
                  onClick={() => {
                    const r = switchToKeptKey(profile, store, k.pubkey, ctx());
                    if (r.ok) window.location.reload();
                    else setSwitchError(r.error);
                  }}
                >
                  Switch to
                </button>
              </li>
            ))}
          </ul>
          {switchError !== '' && (
            <p class="error" role="alert">
              {switchError}
            </p>
          )}
        </section>
      )}
      <details>
        <summary>Use a secret key from elsewhere</summary>
        {!persistent ? (
          <p class="warning" role="note">
            {KEY_ERRORS.notPersistent}
          </p>
        ) : (
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
              <span class="key-label">Secret key</span>
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
              {importNote(games, signer.kind)}
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
        )}
      </details>
    </div>
  );
}
