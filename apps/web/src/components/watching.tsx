/*
 * "You're watching this game" (D057), on the game screen in setup and in play, when the key in use holds none of
 * the game's seats. The decision and the wording are in watch-model.ts. Hookless, for the render tests: the screen
 * keeps the switch error.
 */
import type { Hex } from '@bored-games/protocol';
import { npubEncode, shortNpub } from '../bech32.ts';
import { recoveredText, type WatchNotice, watchText } from '../watch-model.ts';

export function WatchingNotice(props: {
  notice: WatchNotice;
  me: Hex;
  /** Switch to the seated kept key and reload (the `kept` notice only). */
  onSwitch: (pubkey: Hex) => void;
  switchError: string;
}) {
  const { notice } = props;
  const { lead, body } = watchText(notice, props.me);
  if (body === null)
    return (
      <p class="muted watch-notice" role="status">
        {lead}
      </p>
    );
  return (
    <div class="warning watch-notice" role="status">
      <p>
        <strong>{lead}</strong> {body}
      </p>
      {notice.kind === 'kept' && (
        <div class="row">
          <button type="button" class="btn btn-primary" onClick={() => props.onSwitch(notice.pubkey)}>
            Switch to {shortNpub(npubEncode(notice.pubkey))} and reload
          </button>
        </div>
      )}
      {props.switchError !== '' && (
        <p class="error" role="alert">
          {props.switchError}
        </p>
      )}
    </div>
  );
}

/** "Playing seat N with the game keys saved in this browser …" (D057). */
export function RecoveredNotice(props: { seat: number; joined: Hex; me: Hex }) {
  const { lead, body } = recoveredText(props.seat, props.joined, props.me);
  return (
    <div class="warning watch-notice" role="status">
      <p>
        <strong>{lead}</strong> {body}
      </p>
    </div>
  );
}
