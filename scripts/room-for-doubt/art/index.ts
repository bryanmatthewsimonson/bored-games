/*
 * Every art file Room for Doubt ships, in the order they are written to `docs/games/room-for-doubt/art/`. Each file is
 * a pure function of `board.txt` and the data in this directory; `cli.ts` writes them and the art test checks the
 * files on disk against these renderers.
 */
import { parseBoard } from '../board.ts';
import { renderBoard } from './board.ts';

export const ART_FILES: readonly string[] = ['board.svg'];

export function renderAll(boardText: string): Record<string, string> {
  return { 'board.svg': renderBoard(parseBoard(boardText), boardText) };
}
