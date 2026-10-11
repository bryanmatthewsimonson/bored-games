/*
 * Chess's cover: a white king and a black knight face off on a board running into the dark, lit from above. The
 * pieces are the Cburnett set the game uses (BSD-3-Clause, credited on the credits page, D048); the board and the
 * light are original. Drawn 600 × 360 with the pieces in the middle 360, so the square catalog tile crops it.
 */
import { pieceSrc } from './pieces/cburnett.ts';

const LIGHT = '#f0d9b5';
const DARK = '#b58863';
const HORIZON = 196;
const FILES = 12;

/** The board in perspective: rows of squares shrinking toward the horizon. */
function Board() {
  const rows = [360, 316, 280, 252, 230, 214, 203];
  const at = (y: number) => (y - HORIZON + 10) / (360 - HORIZON + 10);
  const squares = [];
  for (const [r, y0] of rows.slice(0, -1).entries()) {
    const y1 = rows[r + 1] ?? HORIZON;
    const [w0, w1] = [900 * at(y0), 900 * at(y1)];
    for (let f = 0; f < FILES; f++) {
      const a0 = 300 - w0 / 2 + (w0 * f) / FILES;
      const a1 = 300 - w0 / 2 + (w0 * (f + 1)) / FILES;
      const b0 = 300 - w1 / 2 + (w1 * f) / FILES;
      const b1 = 300 - w1 / 2 + (w1 * (f + 1)) / FILES;
      squares.push(
        <path
          key={`${r}-${f}`}
          d={`M${a0.toFixed(1)} ${y0}L${a1.toFixed(1)} ${y0}L${b1.toFixed(1)} ${y1}L${b0.toFixed(1)} ${y1}Z`}
          fill={(r + f) % 2 === 0 ? DARK : LIGHT}
        />,
      );
    }
  }
  return <g>{squares}</g>;
}

export function ChessCover() {
  return (
    <svg
      class="game-cover"
      viewBox="0 0 600 360"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Chess artwork: a white king and a black knight face each other on a board under a spotlight"
    >
      <defs>
        <linearGradient id="chess-cover-sky" x2="0" y2="1">
          <stop stop-color="#1a120d" />
          <stop offset="1" stop-color="#3d2a1d" />
        </linearGradient>
        <radialGradient id="chess-cover-light" cx=".5" cy=".55" r=".5">
          <stop stop-color="#fff1d2" stop-opacity=".5" />
          <stop offset="1" stop-color="#fff1d2" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="chess-cover-fade" x2="0" y2="1">
          <stop stop-color="#1a120d" stop-opacity=".85" />
          <stop offset=".45" stop-color="#1a120d" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect width="600" height="360" fill="url(#chess-cover-sky)" />
      <Board />
      <rect y="203" width="600" height="157" fill="url(#chess-cover-fade)" />
      <ellipse cx="300" cy="210" rx="280" ry="190" fill="url(#chess-cover-light)" />
      <ellipse cx="226" cy="318" rx="62" ry="12" fill="#000" opacity=".35" />
      <ellipse cx="380" cy="318" rx="58" ry="12" fill="#000" opacity=".35" />
      <image href={pieceSrc('K')} x="132" y="128" width="190" height="190" />
      <image href={pieceSrc('n')} x="298" y="144" width="172" height="172" />
      <rect x="15" y="15" width="570" height="330" rx="2" stroke={LIGHT} fill="none" opacity=".4" />
    </svg>
  );
}
