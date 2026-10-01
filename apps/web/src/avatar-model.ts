/*
 * Avatars, pure: the generated pattern every player has (a 5×5 mirrored grid and two hues taken from the
 * pubkey), and the built-in gallery of preset pictures (D040). A preset is uploaded like a photo when chosen,
 * so a profile never links to this app's own origin.
 */
import type { Hex } from '@bored-games/protocol';

export interface PatternAvatar {
  /** 25 cells, row by row; true is filled. Columns 3 and 4 mirror columns 1 and 0. */
  cells: boolean[];
  /** CSS colors. */
  fg: string;
  bg: string;
}

function byteAt(hex: string, i: number): number {
  const v = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return Number.isNaN(v) ? 0 : v;
}

/** The pattern for a pubkey: the same everywhere, for everybody. */
export function patternAvatar(pubkey: Hex): PatternAvatar {
  const hue = ((byteAt(pubkey, 0) << 8) | byteAt(pubkey, 1)) % 360;
  const hue2 = (hue + 150 + (byteAt(pubkey, 2) % 60)) % 360;
  const bits = (byteAt(pubkey, 3) << 8) | byteAt(pubkey, 4);
  let half = Array.from({ length: 15 }, (_, i) => ((bits >> i) & 1) === 1);
  const on = half.filter(Boolean).length;
  // Nearly empty or nearly full grids read as a blank square: mix in a checkerboard.
  if (on < 4 || on > 11) half = half.map((x, i) => x !== (i % 2 === 0));
  const cells: boolean[] = [];
  for (let row = 0; row < 5; row++) {
    const left = [0, 1, 2].map((col) => half[row * 3 + col] as boolean);
    cells.push(
      left[0] as boolean,
      left[1] as boolean,
      left[2] as boolean,
      left[1] as boolean,
      left[0] as boolean,
    );
  }
  return { cells, fg: `hsl(${hue} 55% 42%)`, bg: `hsl(${hue2} 50% 88%)` };
}

/** One of the gallery's pictures: a square SVG, rasterized and uploaded when chosen. */
export interface Preset {
  id: string;
  label: string;
  svg: string;
}

const svg = (bg: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/>${body}</svg>`;

export const PRESETS: readonly Preset[] = [
  {
    id: 'fox',
    label: 'Fox',
    svg: svg(
      '#fde7d2',
      '<path d="M12 14l12 10h16l12-10-4 22-16 16-16-16z" fill="#e8742a"/><path d="M20 38l12 14 12-14-12 4z" fill="#fff"/><circle cx="25" cy="32" r="2.5" fill="#2b1a10"/><circle cx="39" cy="32" r="2.5" fill="#2b1a10"/><circle cx="32" cy="46" r="2.5" fill="#2b1a10"/>',
    ),
  },
  {
    id: 'owl',
    label: 'Owl',
    svg: svg(
      '#e3ecf7',
      '<path d="M16 16l8 6h16l8-6v26a16 14 0 0 1-32 0z" fill="#8a6a4a"/><circle cx="25" cy="31" r="7" fill="#fff"/><circle cx="39" cy="31" r="7" fill="#fff"/><circle cx="25" cy="31" r="3" fill="#222"/><circle cx="39" cy="31" r="3" fill="#222"/><path d="M29 38h6l-3 5z" fill="#f2b233"/>',
    ),
  },
  {
    id: 'cat',
    label: 'Cat',
    svg: svg(
      '#efe6fb',
      '<path d="M14 12l10 10h16l10-10v26a18 16 0 0 1-36 0z" fill="#5d5d6e"/><ellipse cx="25" cy="34" rx="3" ry="4" fill="#b5e35a"/><ellipse cx="39" cy="34" rx="3" ry="4" fill="#b5e35a"/><path d="M30 41h4l-2 2z" fill="#f49ab0"/><path d="M18 42h8M18 45h8M38 42h8M38 45h8" stroke="#ddd" stroke-width="1"/>',
    ),
  },
  {
    id: 'whale',
    label: 'Whale',
    svg: svg(
      '#d9f1fb',
      '<path d="M8 36c0-10 12-16 26-16s22 8 22 16-10 12-24 12S8 46 8 36z" fill="#2f6fb3"/><path d="M50 30l8-8v14z" fill="#2f6fb3"/><circle cx="20" cy="34" r="2" fill="#fff"/><path d="M14 42c8 4 22 4 30 0" stroke="#bfe0f5" stroke-width="2" fill="none"/><path d="M26 18c0-4 2-6 4-8M30 18c2-4 4-6 6-6" stroke="#2f6fb3" stroke-width="2" fill="none"/>',
    ),
  },
  {
    id: 'cactus',
    label: 'Cactus',
    svg: svg(
      '#fbf1d6',
      '<rect x="27" y="12" width="10" height="40" rx="5" fill="#3c9a50"/><path d="M27 34h-7a4 4 0 0 1-4-4v-8" stroke="#3c9a50" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M37 30h7a4 4 0 0 0 4-4v-6" stroke="#3c9a50" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M20 52h24l-3 8H23z" fill="#c8693a"/>',
    ),
  },
  {
    id: 'moon',
    label: 'Moon',
    svg: svg(
      '#1f2747',
      '<path d="M40 12a20 20 0 1 0 12 32A16 16 0 0 1 40 12z" fill="#f4e7a1"/><circle cx="16" cy="16" r="1.5" fill="#fff"/><circle cx="50" cy="20" r="1" fill="#fff"/><circle cx="12" cy="44" r="1" fill="#fff"/>',
    ),
  },
  {
    id: 'sun',
    label: 'Sun',
    svg: svg(
      '#fff6d0',
      '<g stroke="#f2a20c" stroke-width="4" stroke-linecap="round"><path d="M32 6v8M32 50v8M6 32h8M50 32h8M13 13l6 6M45 45l6 6M13 51l6-6M45 19l6-6"/></g><circle cx="32" cy="32" r="13" fill="#f7b928"/>',
    ),
  },
  {
    id: 'leaf',
    label: 'Leaf',
    svg: svg(
      '#e5f5dc',
      '<path d="M14 50C14 26 28 14 52 12c-2 24-14 38-38 38z" fill="#4caf50"/><path d="M14 50L44 20" stroke="#2e7d32" stroke-width="2.5"/>',
    ),
  },
  {
    id: 'wave',
    label: 'Wave',
    svg: svg(
      '#e0f4f7',
      '<path d="M0 40c8-10 16-10 24 0s16 10 24 0 12-10 16-6v30H0z" fill="#1e88a8"/><path d="M0 48c8-8 16-8 24 0s16 8 24 0 12-8 16-4v20H0z" fill="#53b9d1"/><path d="M18 30c4-10 16-14 22-6-6-2-12 0-14 6z" fill="#1e88a8"/>',
    ),
  },
  {
    id: 'mountain',
    label: 'Mountain',
    svg: svg(
      '#dceefc',
      '<path d="M4 54l20-30 10 14 8-10 18 26z" fill="#5f6f86"/><path d="M24 24l6 9-4-2-4 4-3-3z" fill="#fff"/><circle cx="48" cy="16" r="5" fill="#f7c948"/>',
    ),
  },
  {
    id: 'balloon',
    label: 'Balloon',
    svg: svg(
      '#fde4ea',
      '<ellipse cx="32" cy="26" rx="14" ry="17" fill="#e5484d"/><path d="M29 43h6l-3 4z" fill="#c13438"/><path d="M32 47c-4 4 4 8 0 12" stroke="#555" stroke-width="1.5" fill="none"/><ellipse cx="26" cy="20" rx="3" ry="5" fill="#f7a1a4"/>',
    ),
  },
  {
    id: 'kite',
    label: 'Kite',
    svg: svg(
      '#e6f0ff',
      '<path d="M32 8l16 18-16 22-16-22z" fill="#7c4dff"/><path d="M32 8v40M16 26h32" stroke="#fff" stroke-width="1.5"/><path d="M32 48c-6 4 6 6 0 10" stroke="#555" stroke-width="1.5" fill="none"/><path d="M28 54l-4 2 3 2zM34 58l4 1-3 2z" fill="#ff9f1c"/>',
    ),
  },
];

/** A preset's SVG as a `data:` URL, for its own preview in the gallery (never published). */
export function presetDataUrl(p: Preset): string {
  return `data:image/svg+xml,${encodeURIComponent(p.svg)}`;
}
