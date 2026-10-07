/*
 * Room for Doubt's line art (D074): `glyph()` places one of the 21 glyphs the board, the cards and the pieces share.
 * The glyphs live in the game package (packages/games/room-for-doubt/src/art.ts, D078), so the web game draws the
 * same art; they are re-exported here for the renderers. Each is markup for a 64 x 64 box, drawn in `currentColor`.
 */
import { GLYPH_STROKE } from '../../packages/games/room-for-doubt/src/art.ts';
import { el } from './svg.ts';

export { EMBLEMS, EXHIBIT_GLYPHS, SCENE_GLYPHS } from '../../packages/games/room-for-doubt/src/art.ts';

/**
 * Places a glyph: a group that moves it to (x, y), scales its 64-unit box to `size`, and sets the colour and the
 * stroke every glyph is drawn with.
 */
export function glyph(markup: string, x: number, y: number, size: number, color: string): string {
  return el(
    'g',
    {
      transform: `translate(${x} ${y}) scale(${size / 64})`,
      color,
      ...GLYPH_STROKE,
    },
    markup,
  );
}
