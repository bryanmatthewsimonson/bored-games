/*
 * Avatars and player tags (D040). Every player has a generated pattern; a profile picture is drawn on top of
 * it only when its URL is safe (https, public host), without a referrer, and it is hidden again if it fails to
 * load. A player tag always shows the short npub beside the chosen name (D035).
 */
import type { Hex } from '@bored-games/protocol';
import { patternAvatar } from '../avatar-model.ts';
import type { ProfileInfo } from '../profile-model.ts';
import { safeImageUrl } from '../profile-model.ts';
import { useProfile } from '../profiles.ts';
import { NpubTag } from './chips.tsx';

/** The generated 5×5 pattern of a pubkey. */
export function PatternAvatar(props: { pubkey: Hex }) {
  const { cells, fg, bg } = patternAvatar(props.pubkey);
  return (
    <svg class="avatar-pattern" viewBox="0 0 5 5" aria-hidden="true" focusable="false">
      <rect width="5" height="5" fill={bg} />
      {cells.map((on, i) =>
        on ? <rect key={i} x={i % 5} y={Math.floor(i / 5)} width="1.02" height="1.02" fill={fg} /> : null,
      )}
    </svg>
  );
}

/**
 * A square avatar of `size` px. `alt` names it for screen readers; leave it empty when the name is shown
 * beside it.
 */
export function Avatar(props: { pubkey: Hex; picture: string | null; size?: number; alt?: string }) {
  const size = props.size ?? 24;
  const src = safeImageUrl(props.picture);
  const alt = props.alt ?? '';
  return (
    <span
      class="avatar"
      style={{ width: `${size}px`, height: `${size}px` }}
      {...(alt === '' ? { 'aria-hidden': 'true' } : { role: 'img', 'aria-label': alt })}
    >
      <PatternAvatar pubkey={props.pubkey} />
      {src !== null && (
        <img
          key={src}
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
}

/** Avatar, name (when there is one) and short npub, with "you" for the player's own key. */
export function PlayerTagView(props: {
  pubkey: Hex;
  info: ProfileInfo | null;
  isMe?: boolean;
  size?: number;
}) {
  const name = props.info?.name ?? null;
  return (
    <span class="player-tag">
      <Avatar pubkey={props.pubkey} picture={props.info?.picture ?? null} size={props.size ?? 24} />
      {name !== null && (
        <>
          <bdi class="player-name" title={name}>
            {name}
          </bdi>{' '}
        </>
      )}
      <NpubTag pubkey={props.pubkey} {...(props.isMe === undefined ? {} : { isMe: props.isMe })} />
    </span>
  );
}

/** A PlayerTag that follows the pubkey's profile. */
export function PlayerTag(props: { pubkey: Hex; isMe?: boolean; size?: number }) {
  const p = useProfile(props.pubkey);
  return <PlayerTagView {...props} info={p.info} />;
}
