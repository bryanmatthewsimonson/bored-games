import { COLS, ROWS } from '@bored-games/chain-reaction';
import type { BoardCell, ChainView, HandTile } from './model.ts';

const ROW_LETTERS = 'ABCDEFGHI';
const COLUMNS = Array.from({ length: COLS }, (_, i) => i + 1);

/** A chain's label letter on its pattern and color: never color alone. */
export function Swatch(props: { chain: ChainView; class?: string }) {
  return (
    <span
      class={`cr-swatch cr-pat-${props.chain.pattern}${props.class ? ` ${props.class}` : ''}`}
      style={`--c:${props.chain.color}`}
      aria-hidden="true"
    >
      {props.chain.label}
    </span>
  );
}

function cellText(cell: BoardCell): string {
  const what =
    cell.kind === 'chain'
      ? (cell.chain?.name ?? 'chain')
      : cell.kind === 'loose'
        ? 'unincorporated tile'
        : cell.kind === 'pending'
          ? 'tile being placed'
          : 'empty';
  return `${cell.id}: ${what}${cell.last ? ', last placed' : ''}`;
}

function Cell(props: { cell: BoardCell; preview: HandTile | null }) {
  const { cell, preview } = props;
  const previewing = preview !== null && preview.tile === cell.index;
  const classes = ['cr-cell', `cr-cell-${cell.kind}`];
  if (cell.chain) classes.push(`cr-pat-${cell.chain.pattern}`);
  if (cell.last) classes.push('cr-cell-last');
  if (previewing) classes.push('cr-cell-preview', `cr-preview-${preview.badge ?? 'unknown'}`);
  return (
    <td>
      <div class={classes.join(' ')} style={cell.chain ? `--c:${cell.chain.color}` : undefined}>
        <span class="sr-only">
          {previewing
            ? `${cellText(cell)}; ${preview.id} would land here: ${preview.preview}`
            : cellText(cell)}
        </span>
        {cell.chain ? (
          <span class="cr-cell-label" aria-hidden="true">
            {cell.chain.label}
          </span>
        ) : (
          <span class="cr-cell-id" aria-hidden="true">
            {cell.id}
          </span>
        )}
        {previewing && (
          <span class="cr-cell-badge" aria-hidden="true">
            {preview.badge}
          </span>
        )}
      </div>
    </td>
  );
}

/** The 12 × 9 board, rows A–I and columns 1–12. */
export function Board(props: { cells: readonly BoardCell[]; preview: HandTile | null }) {
  return (
    <div class="cr-board-wrap">
      <table class="cr-board">
        <caption class="sr-only">Board</caption>
        <colgroup>
          <col class="cr-board-headcol" />
        </colgroup>
        <thead>
          <tr>
            <td />
            {COLUMNS.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: ROWS }, (_, r) => (
            <tr key={ROW_LETTERS[r]}>
              <th scope="row">{ROW_LETTERS[r]}</th>
              {props.cells.slice(r * COLS, (r + 1) * COLS).map((cell) => (
                <Cell key={cell.index} cell={cell} preview={props.preview} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
