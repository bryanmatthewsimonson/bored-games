/*
 * Room for Doubt's glyphs as images (D078). The art (`@bored-games/room-for-doubt/art`) is SVG markup for a 64-unit
 * box drawn in `currentColor`; the screen shows it as an `<img>` (or an SVG `<image>`) whose source is a whole SVG
 * document in a data URI, so no markup is ever set as HTML.
 */
import { GLYPH_STROKE } from '@bored-games/room-for-doubt/art';

const STROKE = Object.entries(GLYPH_STROKE)
  .map(([k, v]) => ` ${k}="${v}"`)
  .join('');

/** An attribute value as written in the SVG: only the characters a colour name or `#rrggbb` uses. */
const attr = (s: string): string => s.replace(/[^#\w]/g, '');

const cache = new Map<string, string>();

/** `markup` drawn in `color`, with the art's stroke, as a `data:image/svg+xml,` URI. */
export function glyphUri(markup: string, color: string): string {
  const key = `${color}\n${markup}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" color="${attr(color)}"${STROKE}>${markup}</svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}
