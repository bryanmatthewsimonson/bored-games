import { BRAND } from '@bored-games/brand';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { App, IdentityError } from './app.tsx';
import { DEFAULT_PROFILE, loadIdentity, profileFromLocation, writeSignerChoice } from './identity.ts';
import { randomBytes } from './random.ts';
import { startRouter } from './router.ts';
import { createSettings } from './settings.ts';
import { browserStorage } from './storage.ts';
import './styles.css';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) throw new Error('missing #app');

  const profile = profileFromLocation(window.location);
  document.title = profile === DEFAULT_PROFILE ? BRAND.name : `${BRAND.name} (${profile})`;

  const store = browserStorage();
  const nostr = window.nostr;
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

  startRouter(window);
  render(
    <App
      ctx={{
        profile,
        store,
        nostr,
        signer,
        settings: createSettings(profile, store, import.meta.env.DEV),
        settingsOpen: signal(false),
      }}
    />,
    root,
  );
}

main();
