/*
 * Every art file Room for Doubt ships, in the order they are written to `docs/games/room-for-doubt/art/`. Each file is
 * a pure function of `board.txt` and the data in this directory; `cli.ts` writes them and the art test checks the
 * files on disk against these renderers.
 */
import { parseBoard } from '../board.ts';
import { renderBoard } from './board.ts';
import { renderCards } from './cards.ts';
import { renderDocket } from './docket.ts';
import { renderPieces } from './pieces.ts';

export const ART_FILES: readonly string[] = ['board.svg', 'cards.svg', 'pieces.svg', 'docket.svg'];

export function renderAll(boardText: string): Record<string, string> {
  return {
    'board.svg': renderBoard(parseBoard(boardText), boardText),
    'cards.svg': renderCards(),
    'pieces.svg': renderPieces(),
    'docket.svg': renderDocket(),
  };
}
