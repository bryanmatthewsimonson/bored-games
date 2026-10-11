/*
 * Chain Reaction's cover: a skyline of company buildings in the safe pack's chain colors, rising over a row of board
 * tiles where two chains meet at a merging tile. Original vector art. Drawn 600 × 360 with the merge in the middle
 * 360, so the square catalog tile crops it. Colors and letters are the trademark-safe looks, never a licensed pack's.
 */
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';

const look = (slot: 'b1' | 'b2' | 's1' | 's2' | 's3' | 'p1' | 'p2') => CHAIN_REACTION_THEME.chains[slot];

/** Buildings left to right: x, width, height and the chain slot whose color it wears (null: an unbuilt block). */
const BLOCKS = [
  [34, 40, 92, null],
  [80, 46, 130, 's2'],
  [132, 36, 104, null],
  [174, 52, 172, 'b1'],
  [232, 40, 120, null],
  [276, 48, 196, 'p2'],
  [330, 40, 128, null],
  [376, 52, 166, 'b2'],
  [434, 36, 112, null],
  [476, 46, 140, 's3'],
  [528, 40, 96, null],
] as const;

/** Board tiles along the front: label, the chain slot that owns it (null: an empty tile with its id). */
const TILES = [
  ['3E', null],
  ['4E', 'b1'],
  ['5E', 'b1'],
  ['6E', 'b1'],
  ['7E', 'merge'],
  ['8E', 'b2'],
  ['9E', 'b2'],
  ['10E', 'b2'],
  ['11E', null],
] as const;

const BASE = 268;
const TILE = 50;

export function ChainReactionCover() {
  const x0 = 300 - (TILES.length * (TILE + 6) - 6) / 2;
  return (
    <svg
      class="game-cover"
      viewBox="0 0 600 360"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Chain Reaction artwork: company buildings over a row of tiles where two chains merge"
    >
      <defs>
        <linearGradient id="cr-cover-sky" x2="0" y2="1">
          <stop stop-color="#101a2e" />
          <stop offset=".75" stop-color="#2a2f4f" />
          <stop offset="1" stop-color="#5a3e4e" />
        </linearGradient>
        <radialGradient id="cr-cover-glow">
          <stop stop-color="#f4d27a" stop-opacity=".75" />
          <stop offset="1" stop-color="#f4d27a" stop-opacity="0" />
        </radialGradient>
        <pattern id="cr-cover-windows" width="10" height="14" patternUnits="userSpaceOnUse">
          <rect x="3" y="4" width="4" height="6" fill="#fff4d6" opacity=".55" />
        </pattern>
      </defs>
      <rect width="600" height="360" fill="url(#cr-cover-sky)" />
      <g stroke={look('p2').color} fill="none">
        <circle cx="300" cy={BASE + 25} r="92" opacity=".5" />
        <circle cx="300" cy={BASE + 25} r="132" opacity=".32" stroke-dasharray="2 8" />
        <circle cx="300" cy={BASE + 25} r="176" opacity=".2" />
        <circle cx="300" cy={BASE + 25} r="226" opacity=".12" stroke-dasharray="1 10" />
      </g>
      {BLOCKS.map(([x, w, h, slot]) => (
        <g key={x}>
          <rect
            x={x}
            y={BASE - h}
            width={w}
            height={h}
            fill={slot === null ? '#1d2440' : look(slot).color}
            opacity={slot === null ? 0.95 : 1}
          />
          <rect
            x={x}
            y={BASE - h}
            width={w}
            height={h}
            fill="url(#cr-cover-windows)"
            opacity={slot ? 0.8 : 0.35}
          />
          {slot !== null && <rect x={x} y={BASE - h} width={w} height="6" fill="#000" opacity=".25" />}
        </g>
      ))}
      <rect y={BASE} width="600" height={360 - BASE} fill="#141b2f" />
      <circle cx="300" cy={BASE + 43} r="70" fill="url(#cr-cover-glow)" />
      {TILES.map(([id, slot], i) => {
        const x = x0 + i * (TILE + 6);
        const y = BASE + 18;
        const merge = slot === 'merge';
        const chain = slot === null || merge ? null : look(slot);
        return (
          <g key={id} transform={`translate(${x} ${y})`}>
            <rect y="4" width={TILE} height={TILE} rx="5" fill="#000" opacity=".35" />
            <rect
              width={TILE}
              height={TILE}
              rx="5"
              fill={merge ? '#f4d27a' : (chain?.color ?? '#efe6d2')}
              stroke={merge ? '#fff4d6' : '#0c1222'}
              stroke-width={merge ? 3 : 1.5}
            />
            <text
              x={TILE / 2}
              y={chain === null ? 31 : 34}
              text-anchor="middle"
              font-family="Georgia, serif"
              font-size={chain === null ? 15 : 24}
              font-weight="700"
              fill={chain === null ? '#2a2f4f' : '#ffffff'}
            >
              {chain === null ? id : chain.label}
            </text>
          </g>
        );
      })}
      <rect x="15" y="15" width="570" height="330" rx="2" stroke="#f4d27a" fill="none" opacity=".45" />
    </svg>
  );
}
