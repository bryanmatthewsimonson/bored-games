import { BRAND } from '@bored-games/brand';
import { useState } from 'preact/hooks';
import { InAppBanner, LostKeyBanner } from './components/inapp-banner.tsx';
import { type AppContext, AppCtx, useApp } from './context.ts';
import { Header } from './header.tsx';
import { dismissLostKey, EXTENSION_MISSING_NOTICE, UNSAVED_KEY_BANNER } from './identity.ts';
import { IN_APP_DISMISSED } from './inapp-model.ts';
import { creditsHref, route } from './router.ts';
import { Screen } from './screens.tsx';
import { IGNORED_RELAYS_NOTICE } from './settings.ts';
import { SettingsDialog } from './settings-dialog.tsx';
import { readItem, sessionStore, storageKey, writeItem } from './storage.ts';

export function App(props: { ctx: AppContext }) {
  return (
    <AppCtx.Provider value={props.ctx}>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <Banners />
      <main id="main" tabIndex={-1}>
        <Screen route={route.value} />
      </main>
      <footer class="app-footer">
        {BRAND.name} · <a href={creditsHref()}>Credits</a>
      </footer>
      <SettingsDialog />
    </AppCtx.Provider>
  );
}

/**
 * Page-wide warnings: a key that will not survive a reload, a missing extension, an ignored `?profile=` or
 * `?relays=` value, and an in-app browser.
 */
function Banners() {
  const app = useApp();
  const { persistent, signer, invalidProfile, profile, store, ignoredRelays, extensionMissing, inApp } = app;
  const [lost, setLost] = useState(app.lostPrevious);
  const dismissKey = storageKey(profile, IN_APP_DISMISSED);
  const [session] = useState(sessionStore);
  const [inAppDismissed, setInAppDismissed] = useState(() => readItem(session, dismissKey) === '1');
  const showInApp = inApp !== null && !inAppDismissed;
  if (persistent && invalidProfile === null && !ignoredRelays && !extensionMissing && !showInApp && !lost)
    return null;
  return (
    <div class="banners">
      {lost && (
        <LostKeyBanner
          onDismiss={() => {
            dismissLostKey(profile, store);
            setLost(false);
          }}
        />
      )}
      {showInApp && (
        <InAppBanner
          onDismiss={() => {
            writeItem(session, dismissKey, '1');
            setInAppDismissed(true);
          }}
        />
      )}
      {!persistent && signer.kind === 'local' && (
        <p class="warning" role="alert">
          <strong>Your key is not being saved.</strong> {UNSAVED_KEY_BANNER}
        </p>
      )}
      {invalidProfile !== null && (
        <p class="warning" role="status">
          "{invalidProfile}" is not a valid profile name (use 1 to 32 letters, digits, dots, dashes or
          underscores), so the {profile} profile is in use.
        </p>
      )}
      {extensionMissing && (
        <p class="warning" role="alert">
          {EXTENSION_MISSING_NOTICE}
        </p>
      )}
      {ignoredRelays && (
        <p class="warning" role="status">
          {IGNORED_RELAYS_NOTICE}
        </p>
      )}
    </div>
  );
}

/** Shown when the chosen signer cannot start, for example when the extension refuses. */
export function IdentityError(props: { message: string; onUseLocal: () => void }) {
  return (
    <main class="panel">
      <div role="alert">
        <h1>Could not load your identity</h1>
        <p>{props.message}</p>
      </div>
      <button type="button" class="btn btn-primary" onClick={props.onUseLocal}>
        Use a local key instead
      </button>
    </main>
  );
}
