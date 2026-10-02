import { type HandTile, REVEALING } from './model.ts';

/** Shown under the hand while a tile is being revealed: tooltips do not work on touch screens. */
export const REVEALING_NOTE =
  'Your new tile is being revealed. It shows once every other player’s browser has sent its part: within ' +
  'seconds while they have the game open and in view, later if their tab is in the background or closed.';

/** What a tile the viewer never learned is called once the game has ended without its reveal (a timeout). */
export const NOT_REVEALED = 'Tile not revealed';

/**
 * The viewer's tiles. Hovering or focusing a tile previews where it lands; when the seat must place, a
 * click selects a placeable tile for the decision form. Unplayable tiles stay focusable for their preview. A
 * tile just drawn shows as "…" with a "new" badge until every other seat's decryption share is in (D039); once
 * the game has ended without it (`revealing` false), it shows as a plain "?".
 */
export function Hand(props: {
  tiles: readonly HandTile[];
  /** Tile indices the seat may place now. */
  placeable: ReadonlySet<number>;
  /**
   * Show each tile's badge and preview text. Off outside the place phase: while a founding or merger
   * resolves, the pending tile makes the classification unreliable.
   */
  showBadges: boolean;
  selected: number | null;
  disabled: boolean;
  onSelect: (tile: number) => void;
  onPreview: (tile: HandTile | null) => void;
  /** Whether a tile the viewer cannot read yet is still being revealed: false once the game has ended. */
  revealing: boolean;
}) {
  if (props.tiles.length === 0) return <p class="muted">No tiles in hand.</p>;
  const revealing = props.revealing && props.tiles.some((t) => t.tile === null);
  return (
    <>
      <ul class="cr-hand" aria-label="Your tiles">
        {props.tiles.map((t) => {
          if (t.tile === null && !props.revealing) {
            return (
              <li key={t.pos}>
                <span class="cr-tile cr-tile-unknown" role="img" aria-label={NOT_REVEALED}>
                  <span class="cr-tile-id" aria-hidden="true">
                    ?
                  </span>
                </span>
              </li>
            );
          }
          if (t.tile === null) {
            return (
              <li key={t.pos}>
                <span
                  class="cr-tile cr-tile-unknown"
                  role="img"
                  aria-label={REVEALING}
                  title={`${REVEALING}: it shows once every other player’s browser has sent its part.`}
                >
                  <span class="cr-tile-id" aria-hidden="true">
                    …
                  </span>
                  <span class="cr-tile-badge" aria-hidden="true">
                    new
                  </span>
                </span>
              </li>
            );
          }
          const tile = t.tile;
          const canPick = !props.disabled && props.placeable.has(tile);
          const enter = () => props.onPreview(t);
          const leave = () => props.onPreview(null);
          const badge = props.showBadges ? t.badge : null;
          return (
            <li key={t.pos}>
              <button
                type="button"
                class={badge === null ? 'cr-tile' : `cr-tile cr-badge-${badge}`}
                aria-pressed={canPick ? props.selected === tile : undefined}
                aria-disabled={!canPick}
                aria-label={badge === null ? `${t.id}` : `${t.id}, ${badge}: ${t.preview}`}
                title={badge === null ? undefined : t.preview}
                onMouseEnter={enter}
                onMouseLeave={leave}
                onFocus={enter}
                onBlur={leave}
                onClick={() => {
                  if (canPick) props.onSelect(tile);
                }}
              >
                <span class="cr-tile-id">{t.id}</span>
                {badge !== null && (
                  <span class="cr-tile-badge" aria-hidden="true">
                    {badge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {revealing && (
        <p class="cr-hint cr-revealing" role="status">
          {REVEALING_NOTE}
        </p>
      )}
    </>
  );
}
