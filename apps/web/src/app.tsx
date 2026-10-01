import { BRAND } from '@bored-games/brand';
import { type AppContext, AppCtx, useApp } from './context.ts';
import { Header } from './header.tsx';
import { route } from './router.ts';
import { Screen } from './screens.tsx';
import { IGNORED_RELAYS_NOTICE } from './settings.ts';
import { SettingsDialog } from './settings-dialog.tsx';

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
      <footer class="app-footer">{BRAND.name}</footer>
      <SettingsDialog />
    </AppCtx.Provider>
  );
}

/** Page-wide warnings: a key that will not survive a reload, and an ignored `?profile=` or `?relays=` value. */
function Banners() {
  const { persistent, signer, invalidProfile, profile, ignoredRelays } = useApp();
  if (persistent && invalidProfile === null && !ignoredRelays) return null;
  return (
    <div class="banners">
      {!persistent && signer.kind === 'local' && (
        <p class="warning" role="alert">
          <strong>Your key is not being saved.</strong> This browser is blocking site storage, so your key and
          your games last only until this tab closes. Allow site data, or export your key from Settings.
        </p>
      )}
      {invalidProfile !== null && (
        <p class="warning" role="status">
          "{invalidProfile}" is not a valid profile name (use 1 to 32 letters, digits, dots, dashes or
          underscores), so the {profile} profile is in use.
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
