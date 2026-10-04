/*
 * The game screen's notices about the backup of a seat's game keys (D065): restoring them on another device, and
 * backing them up from the device that joined. Hookless, for the render tests; the wording is in key-backup.ts.
 */
import type { BackupState, RestoreState } from '../game-controller.ts';
import type { SignerKind } from '../identity.ts';
import { BACKUP_NO_NIP44, RESTORE_TEXT } from '../key-backup.ts';

/** "Back up this game's keys" (D065). */
export const BACKUP_BUTTON = "Back up this game's keys";

/** Publish the backup again, from the done state (review M1). */
export const BACKUP_AGAIN = 'Back up again';

/** The restore of this seat's game keys from the player's backup: in progress, done, or why not, with Try again. */
export function RestoreNotice(props: { state: RestoreState; onRetry: () => void }) {
  const { state } = props;
  if (state === 'restoring' || state === 'retry')
    return (
      <p class="muted watch-notice" role="status" aria-busy="true">
        {RESTORE_TEXT.restoring}
      </p>
    );
  if (state === 'restored')
    return (
      <p class="muted watch-notice" role="status">
        {RESTORE_TEXT.restored}
      </p>
    );
  const text =
    state === 'unavailable'
      ? `You're watching this game: this browser does not hold your game keys for it. ${BACKUP_NO_NIP44} Open the game on the device you joined with.`
      : RESTORE_TEXT[state];
  return (
    <div class="warning watch-notice" role="status">
      <p>{text}</p>
      {state !== 'unavailable' && (
        <div class="row">
          <button type="button" class="btn" onClick={props.onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The backup of this seat's game keys from this browser: a local key backs up by itself (nothing shown while it
 * checks or sends, unless it failed); an extension is offered the button, since each backup asks it to encrypt and
 * sign. Once done, "Back up again" stays available (review M1).
 */
export function BackupOffer(props: { state: BackupState; signer: SignerKind; onBackup: () => void }) {
  const { state } = props;
  if (state === 'checking' || (state === 'due' && props.signer === 'local')) return null;
  if (state === 'done')
    return (
      <div class="row game-backup">
        <span class="muted grow">This game's keys are backed up on its relays.</span>
        <button type="button" class="btn btn-small" onClick={props.onBackup}>
          {BACKUP_AGAIN}
        </button>
      </div>
    );
  if (state === 'unavailable')
    return <p class="muted game-backup">This game's keys are not backed up. {BACKUP_NO_NIP44}</p>;
  if (state === 'sending')
    return (
      <p class="muted game-backup" role="status">
        Backing up this game's keys…
      </p>
    );
  return (
    <div class="game-backup stack">
      <p class="muted">
        Your keys for this game are only in this browser. Back them up, encrypted to your key, so another
        device with your key can play this seat.
      </p>
      <div class="row">
        <button type="button" class="btn" onClick={props.onBackup}>
          {BACKUP_BUTTON}
        </button>
      </div>
      {typeof state === 'object' && (
        <p class="error" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
