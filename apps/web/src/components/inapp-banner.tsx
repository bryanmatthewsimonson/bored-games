import { LOST_KEY_NOTICE } from '../identity.ts';
import { IN_APP_NOTICE } from '../inapp-model.ts';

/**
 * "You're in an in-app browser" (D057), until dismissed for this tab (sessionStorage). Hookless, for the render
 * tests: `Banners` holds the state.
 */
export function InAppBanner(props: { onDismiss: () => void }) {
  return (
    <div class="warning banner-dismissible" role="status">
      <p>{IN_APP_NOTICE}</p>
      <button
        type="button"
        class="btn btn-small"
        aria-label="Dismiss the in-app browser warning"
        onClick={props.onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * "Your previous key was not found in this browser …" (D057): loud (an alert), until dismissed. Hookless, for the
 * render tests.
 */
export function LostKeyBanner(props: { onDismiss: () => void }) {
  return (
    <div class="warning banner-dismissible banner-loud" role="alert">
      <p>
        <strong>{LOST_KEY_NOTICE}</strong> If you backed it up, import it in Settings → Use a secret key from
        elsewhere.
      </p>
      <button
        type="button"
        class="btn btn-small"
        aria-label="Dismiss the lost key warning"
        onClick={props.onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
