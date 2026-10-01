import { useState } from 'preact/hooks';

/**
 * "Claim timeout", then a confirm step that says what the claim does (`explanation`, from `timeoutExplanation`).
 * A claim cannot be taken back, so it is never sent on the first click.
 */
export function ClaimTimeout(props: { explanation: string; busy: boolean; onClaim: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" class="btn btn-small" disabled={props.busy} onClick={() => setConfirming(true)}>
        Claim timeout
      </button>
    );
  }
  return (
    <section class="claim-confirm" aria-label="Claim a timeout">
      <p>{props.explanation}</p>
      <div class="row">
        <button
          type="button"
          class="btn btn-small btn-primary"
          disabled={props.busy}
          onClick={() => {
            setConfirming(false);
            props.onClaim();
          }}
        >
          Yes, claim the timeout
        </button>
        <button type="button" class="btn btn-small" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </section>
  );
}
