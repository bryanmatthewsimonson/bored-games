/*
 * Room for Doubt's card faces (D078), in the look of the art's card sheet (RULES.md "Art direction"): a framed card
 * with a band in the card's colour naming its kind, the glyph, the name and, on a Party, its monogram. Colour is
 * never the only cue. Hook-free.
 */
import { glyphUri } from './glyph-image.ts';
import { cardLook, PALETTE } from './model.ts';

/** One card of play, or a face-down card for `null` (a card this view has not learned). */
export function CardFace(props: { card: number | null; note?: string | undefined }) {
  const look = props.card === null ? null : cardLook(props.card);
  if (look === null) {
    return (
      <span class="rfd-card rfd-card-back" data-kind="back">
        <span class="rfd-card-band">Case file</span>
        <span class="rfd-card-name">Face down</span>
      </span>
    );
  }
  return (
    <span
      class="rfd-card"
      data-kind={look.kind}
      style={{ '--rfd-band': look.band, '--rfd-on-band': look.onBand }}
    >
      <span class="rfd-card-band">
        <span>{look.kindName}</span>
        {look.monogram !== null && <span class="rfd-card-mono">{look.monogram}</span>}
      </span>
      <img class="rfd-card-glyph" src={glyphUri(look.glyph, PALETTE.ink)} alt="" width={48} height={48} />
      <span class="rfd-card-name">{look.name}</span>
      {props.note !== undefined && <span class="rfd-card-note">{props.note}</span>}
    </span>
  );
}
