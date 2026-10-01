import type { HandTile } from './model.ts';

/**
 * The viewer's tiles. Hovering or focusing a tile previews where it lands; when the seat must place, a
 * click selects a placeable tile for the decision form. Unplayable tiles stay focusable for their preview.
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
}) {
  if (props.tiles.length === 0) return <p class="muted">No tiles in hand.</p>;
  return (
    <ul class="cr-hand" aria-label="Your tiles">
      {props.tiles.map((t) => {
        if (t.tile === null) {
          return (
            <li key={t.pos}>
              <span class="cr-tile cr-tile-unknown" role="img" aria-label="Unknown tile">
                <span class="cr-tile-id">?</span>
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
  );
}
