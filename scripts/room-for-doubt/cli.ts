/*
 * Writes Room for Doubt's art: `node scripts/room-for-doubt/cli.ts` renders every file in `art/index.ts` from
 * `docs/games/room-for-doubt/board.txt` into `docs/games/room-for-doubt/art/` and prints the file names. Running it
 * twice leaves the working tree unchanged: the art is deterministic.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderAll } from './art/index.ts';

const game = join(import.meta.dirname, '..', '..', 'docs', 'games', 'room-for-doubt');
const rendered = renderAll(readFileSync(join(game, 'board.txt'), 'utf8'));
mkdirSync(join(game, 'art'), { recursive: true });
for (const [name, svg] of Object.entries(rendered)) {
  writeFileSync(join(game, 'art', name), svg);
  console.log(name);
}
