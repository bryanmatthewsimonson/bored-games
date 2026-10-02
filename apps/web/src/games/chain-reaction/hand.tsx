import type { HandTile } from './model.ts';

/** What the "?" tile's popover says: why a tile the viewer drew is still hidden, and when it shows. */
export const HIDDEN_TILE_HELP =
  'Your new tile. It’s yours already, but it stays hidden until every other player has made their next ' +
  'move: each move carries that player’s part of the reveal, so no one, not even the app, can see your ' +
  'tile without you. It’s always revealed before your next turn while the game goes on.';

/** Shown under the hand while a tile is hidden: the popover needs a hover or a tap, this line does not. */
export const HIDDEN_TILE_NOTE =
  '“?” is your new tile. It shows once every other player has made their next move.';

/** What a tile the viewer never learned is called once the game has ended without its reveal (a timeout). */
export const NOT_REVEALED = 'Tile not revealed';

// ---------------------------------------------------------------- the "?" popover

/**
 * Which hidden tile's popover is open (by deck position), and whether a click or tap pinned it open. Hovering
 * opens a popover that closes when the pointer leaves; a click, a tap, Enter or Space pins it until the next
 * click, Escape, a tap elsewhere or the focus leaving.
 */
export interface TipState {
  readonly pos: number | null;
  readonly pinned: boolean;
}

export type TipEvent =
  | { readonly type: 'enter'; readonly pos: number }
  | { readonly type: 'leave'; readonly pos: number }
  | { readonly type: 'click'; readonly pos: number }
  | { readonly type: 'close' };

export const TIP_CLOSED: TipState = { pos: null, pinned: false };

export function tipReducer(s: TipState, e: TipEvent): TipState {
  switch (e.type) {
    case 'enter':
      return s.pinned ? s : { pos: e.pos, pinned: false };
    case 'leave':
      return s.pinned || s.pos !== e.pos ? s : TIP_CLOSED;
    case 'click':
      return s.pinned && s.pos === e.pos ? TIP_CLOSED : { pos: e.pos, pinned: true };
    case 'close':
      return TIP_CLOSED;
  }
}

/**
 * Whether a blur moved the focus to another element outside the "?" tile. A blur with no new focus (a click on
 * the popover text or on the page) keeps the popover; a click outside it is closed by the game's listener.
 */
export function focusLeftTip(next: unknown): boolean {
  const el = next as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === 'function' && el.closest('.cr-unknown') === null;
}

/** The id of a hidden tile's popover, for `aria-describedby` and `aria-controls`. */
export const tipId = (pos: number): string => `cr-tip-${pos}`;

/**
 * A tile the viewer drew but cannot read yet: a "?" button that opens a short explanation. The text is the
 * button's description whether or not the popover is open, so a screen reader hears it on focus. Hook-free: the
 * open state and its events come from the parent.
 */
export function UnknownTile(props: {
  pos: number;
  /** Its index in the hand, which places the popover under it. */
  index: number;
  open: boolean;
  onTip: (e: TipEvent) => void;
}) {
  const { pos, onTip } = props;
  const id = tipId(pos);
  return (
    <span
      class="cr-unknown"
      style={{ '--i': props.index }}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onTip({ type: 'enter', pos });
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') onTip({ type: 'leave', pos });
      }}
    >
      <button
        type="button"
        class="cr-tile cr-tile-unknown"
        aria-label="Hidden tile"
        aria-expanded={props.open}
        aria-controls={id}
        aria-describedby={id}
        onClick={() => onTip({ type: 'click', pos })}
        onBlur={(e) => {
          if (focusLeftTip(e.relatedTarget)) onTip({ type: 'close' });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && props.open) {
            e.preventDefault();
            e.stopPropagation();
            onTip({ type: 'close' });
          }
        }}
      >
        <span class="cr-tile-id" aria-hidden="true">
          ?
        </span>
        <span class="cr-tile-badge" aria-hidden="true">
          new
        </span>
      </button>
      <span id={id} role="tooltip" class="cr-tip" hidden={!props.open}>
        {HIDDEN_TILE_HELP}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- the hand

/**
 * The viewer's tiles. Hovering or focusing a tile previews where it lands; when the seat must place, a
 * click selects a placeable tile for the decision form. Unplayable tiles stay focusable for their preview. A
 * tile drawn but not readable yet (its other seats' decryption shares ride on their next moves, PROTOCOL §6.2)
 * is a "?" button that explains why; once the game has ended without its reveal (`ended`), it is a plain "?".
 */
export function Hand(props: {
  tiles: readonly HandTile[];
  /** Tile indices the seat may place now. */
  placeable: ReadonlySet<number>;
  /** Show each tile's badge and preview text: only for the viewer's own place decision (`handBadgesShown`). */
  showBadges: boolean;
  selected: number | null;
  disabled: boolean;
  onSelect: (tile: number) => void;
  onPreview: (tile: HandTile | null) => void;
  /** True once the game has ended outside the rules (a timeout): a hidden tile will never be revealed. */
  ended: boolean;
  /** The "?" popover's state and its events. */
  tip: TipState;
  onTip: (e: TipEvent) => void;
}) {
  if (props.tiles.length === 0) return <p class="muted">No tiles in hand.</p>;
  const hidden = !props.ended && props.tiles.some((t) => t.tile === null);
  return (
    <>
      <ul class="cr-hand" aria-label="Your tiles">
        {props.tiles.map((t, i) => {
          if (t.tile === null && props.ended) {
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
                <UnknownTile pos={t.pos} index={i} open={props.tip.pos === t.pos} onTip={props.onTip} />
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
      {hidden && <p class="cr-hint cr-hidden-note">{HIDDEN_TILE_NOTE}</p>}
    </>
  );
}
