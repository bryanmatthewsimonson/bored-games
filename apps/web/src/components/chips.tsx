import { npubEncode, shortNpub } from '../bech32.ts';
import { CHIP_LABEL, type TableChip, type TurnBadge } from '../lobby-model.ts';

/** A table's status: a word as well as a color. */
export function StatusChip(props: { chip: TableChip }) {
  return <span class={`chip chip-${props.chip}`}>{CHIP_LABEL[props.chip]}</span>;
}

/** "Your turn" or "Ready to start". */
export function AttentionBadge(props: { badge: TurnBadge | null }) {
  const b = props.badge;
  if (b === null) return null;
  return <span class={`chip chip-attention chip-${b.kind}`}>{b.label}</span>;
}

/** A short npub with the full key on hover, and a "you" tag for the player's own key. */
export function NpubTag(props: { pubkey: string; isMe?: boolean }) {
  const npub = npubEncode(props.pubkey);
  return (
    <span class="npub-tag">
      <code class="npub" title={npub}>
        {shortNpub(npub)}
      </code>
      {props.isMe === true && <span class="chip chip-you">you</span>}
    </span>
  );
}
