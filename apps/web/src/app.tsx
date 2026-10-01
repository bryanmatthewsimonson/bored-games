import { BRAND } from '@bored-games/brand';
import { type AppContext, AppCtx } from './context.ts';
import { Header } from './header.tsx';
import { route } from './router.ts';
import { Screen } from './screens.tsx';
import { SettingsDialog } from './settings-dialog.tsx';

export function App(props: { ctx: AppContext }) {
  return (
    <AppCtx.Provider value={props.ctx}>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1}>
        <Screen route={route.value} />
      </main>
      <footer class="app-footer">{BRAND.name}</footer>
      <SettingsDialog />
    </AppCtx.Provider>
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
