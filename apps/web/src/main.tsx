import { BRAND } from '@bored-games/brand';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { App, IdentityError } from './app.tsx';
import { nowSeconds, platformTimers } from './clock.ts';
import {
  DEFAULT_PROFILE,
  invalidProfileName,
  loadIdentity,
  profileFromLocation,
  readSignerChoice,
  waitForNostr,
  writeSignerChoice,
} from './identity.ts';
import { appPool, MODULES } from './net.ts';
import { randomBytes } from './random.ts';
import { startRouter } from './router.ts';
import { createSettings, relaysFromLocation } from './settings.ts';
import { browserStorage } from './storage.ts';
import './styles.css';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) throw new Error('missing #app');

  const profile = profileFromLocation(window.location);
  document.title = profile === DEFAULT_PROFILE ? BRAND.name : `${BRAND.name} (${profile})`;

  const store = browserStorage();
  // An extension chosen in Settings may inject `window.nostr` late: give it a second before falling back.
  const wantsExtension = readSignerChoice(profile, store) === 'nip07';
  const nostr = await waitForNostr(
    () => window.nostr,
    wantsExtension ? 1000 : 0,
    (ms) => new Promise((r) => setTimeout(r, ms)),
  );
  const extensionMissing = wantsExtension && nostr === undefined;
  let signer: Awaited<ReturnType<typeof loadIdentity>>;
  try {
    signer = await loadIdentity(profile, store, randomBytes, nostr);
  } catch (e) {
    render(
      <IdentityError
        message={e instanceof Error ? e.message : 'Unknown error.'}
        onUseLocal={() => {
          writeSignerChoice(profile, store, 'local');
          window.location.reload();
        }}
      />,
      root,
    );
    return;
  }

  const settings = createSettings(profile, store, import.meta.env.DEV);
  // `?relays=` with only local relays replaces this profile's relay list (saved, as if edited in Settings), in a
  // dev server or a build for the e2e test only. Anything else is refused, with a notice: a shared link must not
  // choose a player's relays.
  const linkRelays = import.meta.env.DEV || import.meta.env.VITE_ALLOW_LINK_RELAYS === '1';
  const urlRelays = relaysFromLocation(window.location, linkRelays);
  if (urlRelays.kind === 'local') settings.setRelays(urlRelays.relays);
  const pool = appPool(settings);
  startRouter(window);
  render(
    <App
      ctx={{
        profile,
        invalidProfile: invalidProfileName(window.location),
        ignoredRelays: urlRelays.kind === 'ignored',
        extensionMissing,
        store,
        nostr,
        signer,
        persistent: signer.persistent,
        settings,
        settingsOpen: signal(false),
        deps: {
          pool,
          signer,
          storage: store,
          profile,
          relays: () => settings.relays.value,
          rnd: randomBytes,
          now: nowSeconds,
          modules: MODULES,
          timers: platformTimers,
        },
      }}
    />,
    root,
  );
}

main();
