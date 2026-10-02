import { useEffect, useRef, useState } from 'preact/hooks';
import { npubEncode } from './bech32.ts';
import { useApp } from './context.ts';
import { CopyButton } from './header.tsx';
import { exportNsec, writeSignerChoice } from './identity.ts';
import { parseRelayInput } from './settings.ts';
import { ProfileSection } from './settings-profile.tsx';

function RelaySection() {
  const { settings } = useApp();
  const [draft, setDraft] = useState<string[]>(() => [...settings.relays.value]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'no' | 'yes' | 'failed'>('no');

  const change = (next: string[]) => {
    setDraft(next);
    setSaved('no');
  };
  const add = (e: Event) => {
    e.preventDefault();
    const r = parseRelayInput(input);
    if (!r.ok) return setError(r.error);
    if (draft.includes(r.url)) return setError('That relay is already in the list.');
    setError('');
    setInput('');
    change([...draft, r.url]);
  };

  return (
    <section aria-labelledby="relays-h">
      <h3 id="relays-h">Relays</h3>
      <p class="muted">Tables and game events are published to these relays, in this order.</p>
      <ul class="relay-list">
        {draft.map((url) => (
          <li key={url}>
            <code>{url}</code>
            <button
              type="button"
              class="btn btn-small"
              aria-label={`Remove ${url}`}
              onClick={() => change(draft.filter((u) => u !== url))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {draft.length === 0 && <p class="muted">The list is empty: saving restores the defaults.</p>}
      <form class="row" onSubmit={add}>
        <label class="grow">
          <span class="sr-only">Relay URL</span>
          <input
            type="text"
            inputMode="url"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            placeholder="wss://relay.example.com"
            value={input}
            aria-invalid={error !== ''}
            aria-describedby="relay-error"
            onInput={(e) => setInput(e.currentTarget.value)}
          />
        </label>
        <button type="submit" class="btn">
          Add
        </button>
      </form>
      <p id="relay-error" class="error" role="alert">
        {error}
      </p>
      <div class="row">
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => {
            const ok = settings.setRelays(draft);
            setDraft([...settings.relays.value]);
            setSaved(ok ? 'yes' : 'failed');
          }}
        >
          Save relays
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            const ok = settings.resetRelays();
            setDraft([...settings.relays.value]);
            setSaved(ok ? 'yes' : 'failed');
          }}
        >
          Reset to defaults
        </button>
        <span role="status" class={saved === 'failed' ? 'error' : 'muted'}>
          {saved === 'yes'
            ? 'Saved.'
            : saved === 'failed'
              ? 'Applied for this visit only: this browser would not save the list.'
              : ''}
        </span>
      </div>
    </section>
  );
}

function IdentitySection() {
  const { profile, store, signer, nostr } = useApp();
  const [reveal, setReveal] = useState(false);
  const npub = npubEncode(signer.pubkey);
  const nsec = signer.kind === 'local' && reveal ? exportNsec(profile, store) : null;
  // Reveal reads the key back from storage; when storage is blocked there is nothing to show.
  const revealFailed = signer.kind === 'local' && reveal && nsec === null;

  const useExtension = (on: boolean) => {
    writeSignerChoice(profile, store, on ? 'nip07' : 'local');
    // A different signer is a different player: start clean rather than patch live state.
    window.location.reload();
  };

  return (
    <section aria-labelledby="identity-h">
      <h3 id="identity-h">Identity</h3>
      <p class="muted">Profile: {profile}. Another tab can use another profile with ?profile=name.</p>
      <p>
        Public key (npub)
        <br />
        <code class="wrap">{npub}</code> <CopyButton text={npub} label="Copy npub" />
      </p>
      {nostr !== undefined && (
        <label class="check">
          <input
            type="checkbox"
            checked={signer.kind === 'nip07'}
            onChange={(e) => useExtension(e.currentTarget.checked)}
          />
          Use browser extension (NIP-07)
        </label>
      )}
      {signer.kind === 'nip07' ? (
        <p class="muted">Your key is held by the browser extension, so there is nothing to export here.</p>
      ) : (
        <>
          <p class="warning" role="note">
            <strong>Keep this key private.</strong> It is stored in this browser only. Anyone who has it can
            play as you, and clearing this site's data deletes it for good. Back it up before you do.
          </p>
          {nsec === null ? (
            <>
              <button type="button" class="btn" onClick={() => setReveal(true)}>
                Show secret key (nsec)
              </button>
              <p class="error" role="alert">
                {revealFailed
                  ? 'Could not read the secret key: this browser is not storing it, so it cannot be exported.'
                  : ''}
              </p>
            </>
          ) : (
            <div>
              <label for="nsec">Secret key (nsec)</label>
              <div class="row">
                <input
                  id="nsec"
                  type="text"
                  class="grow"
                  readOnly
                  value={nsec}
                  onFocus={(e) => e.currentTarget.select()}
                  autocomplete="off"
                  spellcheck={false}
                />
                <CopyButton text={nsec} label="Copy nsec" />
                <button type="button" class="btn btn-small" onClick={() => setReveal(false)}>
                  Hide
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function SettingsDialog() {
  const { settingsOpen } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const open = settingsOpen.value;

  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby="settings-h"
      onClose={() => (settingsOpen.value = false)}
      onPointerDown={(e) => {
        // A press on the backdrop lands on the <dialog> element itself. Escape closes it from the keyboard.
        if (e.target === ref.current) settingsOpen.value = false;
      }}
    >
      {open && (
        <div class="dialog-body">
          <div class="dialog-head">
            <h2 id="settings-h">Settings</h2>
            <button type="button" class="btn" onClick={() => (settingsOpen.value = false)}>
              Close
            </button>
          </div>
          <ProfileSection />
          <RelaySection />
          <IdentitySection />
        </div>
      )}
    </dialog>
  );
}
