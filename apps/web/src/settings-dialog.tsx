import { useEffect, useRef, useState } from 'preact/hooks';
import { npubEncode } from './bech32.ts';
import { type Branding, licensedPack, licensedPacksLoaded } from './brands.ts';
import { useApp } from './context.ts';
import { CATALOG } from './games/catalog.ts';
import { GAME_IDS } from './games/ids.ts';
import { CopyButton } from './header.tsx';
import { claimTablesFor, exportNsec, markBackedUp, writeSignerChoice } from './identity.ts';
import { parseRelayInput } from './settings.ts';
import { KeyImport, StorageStatus } from './settings-key.tsx';
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
  const { profile, store, signer, nostr, persistent } = useApp();
  const [reveal, setReveal] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const npub = npubEncode(signer.pubkey);
  // From memory first (D057): it works when storage refuses writes or holds another key now.
  const nsec =
    signer.kind === 'local' && reveal ? (signer.exportNsec?.() ?? exportNsec(profile, store)) : null;
  // Reveal reads the key back from storage; when storage is blocked there is nothing to show.
  const revealFailed = signer.kind === 'local' && reveal && nsec === null;

  const useExtension = (on: boolean) => {
    // The tables listed so far belong to the key in use: record that before the key changes (D041). If that
    // cannot be saved, the other key could later take these tables for its own, so do not switch.
    if (
      !claimTablesFor(profile, store, signer.pubkey) ||
      !writeSignerChoice(profile, store, on ? 'nip07' : 'local')
    ) {
      setSwitchError('Could not switch: this browser would not save the change.');
      return;
    }
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
      {switchError !== '' && (
        <p class="error" role="alert">
          {switchError}
        </p>
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
                <CopyButton
                  text={nsec}
                  label="Copy nsec"
                  onCopied={() => markBackedUp(profile, store, signer.pubkey)}
                />
                <button type="button" class="btn btn-small" onClick={() => setReveal(false)}>
                  Hide
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {signer.kind === 'local' && persistent && <StorageStatus />}
      <KeyImport />
    </section>
  );
}

/** "Chain Reaction (Jade, Lapis …)": a pack's game title, with its first chain names when it has any. */
function packExample(names: {
  gameTitle: string;
  chains?: Readonly<Record<string, { name: string }>>;
}): string {
  const chains = names.chains === undefined ? [] : Object.values(names.chains).map((c) => c.name);
  return chains.length === 0 ? names.gameTitle : `${names.gameTitle}: ${chains.slice(0, 3).join(', ')}…`;
}

/**
 * "Game names" (D046): the trademark-safe names or the licensed original ones, in a build that carries licensed
 * packs. Public builds carry none, and say so in one line.
 */
export function GameNamesSection() {
  const { settings } = useApp();
  const [saved, setSaved] = useState<'no' | 'yes' | 'failed'>('no');
  if (!licensedPacksLoaded())
    return (
      <section aria-labelledby="names-h">
        <h3 id="names-h">Game names</h3>
        <p class="muted">Only the trademark-safe names are available on this site.</p>
      </section>
    );
  const games = GAME_IDS.flatMap((id) => {
    const original = licensedPack(id);
    const safe = CATALOG.get(id)?.safe;
    return original === undefined || safe === undefined ? [] : [{ id, safe, original }];
  });
  const choose = (b: Branding) => setSaved(settings.setBranding(b) ? 'yes' : 'failed');
  const current = settings.branding.value;
  return (
    <section aria-labelledby="names-h">
      <h3 id="names-h">Game names</h3>
      <p class="muted">The names of the games and their pieces, as you see them.</p>
      <fieldset class="names-choice">
        <legend class="sr-only">Game names</legend>
        <label class="radio">
          <input type="radio" name="branding" checked={current === 'safe'} onChange={() => choose('safe')} />
          <span class="names-option">
            Trademark-safe names
            <span class="hint">{games.map((g) => packExample(g.safe)).join('; ')}</span>
          </span>
        </label>
        <label class="radio">
          <input
            type="radio"
            name="branding"
            checked={current === 'original'}
            onChange={() => choose('original')}
          />
          <span class="names-option">
            Original names (licensed)
            <span class="hint">{games.map((g) => packExample(g.original)).join('; ')}</span>
          </span>
        </label>
      </fieldset>
      <p class="hint">
        Only what you see changes: other players keep their own choice, and games are not affected.
      </p>
      <span role="status" class={saved === 'failed' ? 'error' : 'muted'}>
        {saved === 'yes'
          ? 'Saved.'
          : saved === 'failed'
            ? 'Applied for this visit only: this browser would not save it.'
            : ''}
      </span>
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
        <>
          {/* The head stays in view; only the body scrolls, and never into the page's pull-to-refresh (D057). */}
          <div class="dialog-head">
            <h2 id="settings-h">Settings</h2>
            <button type="button" class="btn" onClick={() => (settingsOpen.value = false)}>
              Close
            </button>
          </div>
          <div class="dialog-body">
            <ProfileSection />
            <GameNamesSection />
            <RelaySection />
            <IdentitySection />
            <div class="dialog-foot">
              <button type="button" class="btn" onClick={() => (settingsOpen.value = false)}>
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
