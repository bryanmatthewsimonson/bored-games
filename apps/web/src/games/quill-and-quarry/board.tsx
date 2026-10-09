import { coordinate, type Placement, premiumAt, type State, TILES } from '@bored-games/quill-and-quarry';
import { QUILL_THEME } from '@bored-games/quill-and-quarry/theme';
import { useRef, useState } from 'preact/hooks';
export function TileFace(props: { letter: string; value: number; blank?: boolean }) {
  return (
    <span class={`qq-tile-face${props.blank ? ' qq-blank' : ''}`}>
      <span>{props.letter || '◇'}</span>
      <sub>{props.value}</sub>
    </span>
  );
}
export function QuillBoard(props: {
  state: State;
  draft: Placement[];
  enabled: boolean;
  onPlace: (cell: number, pos?: number) => void;
  onRecall: (cell: number) => void;
  last: number[];
}) {
  const [focus, setFocus] = useState(112);
  const root = useRef<HTMLFieldSetElement>(null);
  return (
    <div class="qq-board-frame">
      <div class="qq-board-top">
        <span>THE WORD FIELD</span>
        <span>15 × 15</span>
      </div>
      <div class="qq-board-coordinates">
        <span />
        {Array.from({ length: 15 }, (_, i) => (
          <span key={i}>{String.fromCharCode(65 + i)}</span>
        ))}
      </div>
      <div class="qq-board-body">
        <div class="qq-row-labels">
          {Array.from({ length: 15 }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <fieldset class="qq-board" ref={root} aria-label="Word field, 15 rows and 15 columns">
          {props.state.board.map((tile, cell) => {
            const draft = props.draft.find((t) => t.cell === cell),
              shown = draft ?? tile,
              premium = premiumAt(cell),
              value = shown ? (TILES[shown.card]?.value ?? 0) : 0,
              blank = shown ? TILES[shown.card]?.letter === '' : false;
            const label = `${coordinate(cell)}: ${shown ? `${shown.letter}${blank ? ' (blank)' : ''}, ${value} point${value === 1 ? '' : 's'}${draft ? ', staged tile; activate to return to rack' : ''}` : premium ? QUILL_THEME.premiums[premium] : 'empty'}`;
            return (
              <button
                type="button"
                key={cell}
                data-cell={cell}
                data-premium={premium ?? ''}
                data-occupied={shown !== null && shown !== undefined}
                class={`qq-cell${draft ? ' qq-staged' : ''}${tile && props.last.includes(cell) ? ' qq-last' : ''}`}
                aria-label={label}
                tabIndex={cell === focus ? 0 : -1}
                aria-disabled={!props.enabled || Boolean(tile)}
                onFocus={() => setFocus(cell)}
                onClick={() => {
                  if (!props.enabled || tile) return;
                  if (draft) props.onRecall(cell);
                  else props.onPlace(cell);
                }}
                onDragOver={(e) => {
                  if (props.enabled && !shown) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const raw = e.dataTransfer?.getData('application/x-quill-tile');
                  if (props.enabled && !shown && raw && /^\d+$/.test(raw)) props.onPlace(cell, Number(raw));
                }}
                onKeyDown={(e) => {
                  const delta: { [key: string]: number } = {
                    ArrowUp: -15,
                    ArrowDown: 15,
                    ArrowLeft: -1,
                    ArrowRight: 1,
                  };
                  const move = delta[e.key];
                  if (move !== undefined) {
                    e.preventDefault();
                    const next = Math.max(0, Math.min(224, cell + move));
                    setFocus(next);
                    root.current?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)?.focus();
                  }
                }}
              >
                {shown ? (
                  <TileFace letter={shown.letter} value={value} blank={blank} />
                ) : cell === 112 ? (
                  <span class="qq-center" aria-hidden="true">
                    ✦
                  </span>
                ) : premium ? (
                  <span class="qq-premium" aria-hidden="true">
                    <b>{premium[0]}×</b>
                    <span>{premium[1] === 'L' ? 'LETTER' : 'WORD'}</span>
                  </span>
                ) : (
                  <span class="qq-dot" aria-hidden="true">
                    ·
                  </span>
                )}
              </button>
            );
          })}
        </fieldset>
      </div>
      <div class="qq-board-bottom">
        <span>QUILL</span>
        <span class="qq-diamond">◆</span>
        <span>QUARRY</span>
      </div>
    </div>
  );
}
