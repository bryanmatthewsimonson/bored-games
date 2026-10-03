import { IN_APP_NOTICE } from '../inapp-model.ts';

/**
 * "You're in an in-app browser" (D057), until dismissed for this tab (sessionStorage). Hookless, for the render
 * tests: `Banners` holds the state.
 */
export function InAppBanner(props: { onDismiss: () => void }) {
  return (
    <div class="warning banner-dismissible" role="status">
      <p>{IN_APP_NOTICE}</p>
      <button type="button" class="btn btn-small" onClick={props.onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
