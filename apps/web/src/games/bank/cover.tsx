/*
 * Bank's cover: the game's two dice tumbling on green baize in front of a pillared bank, with the pot stacked on
 * either side. Original vector art; the dice are the in-game faces (`pips`, the colors of `bank.css`). Drawn
 * 600 × 360 with the dice in the middle 360, so the square catalog tile crops it.
 */
import { pips } from './model.ts';

const FACE = '#f3e6c8';
const EDGE = '#c9b48a';
const PIP = '#1c2230';
const GOLD = '#e2b553';
const GOLD_DARK = '#9a7426';

function Die(props: { face: number; x: number; y: number; size: number; tilt: number }) {
  const s = props.size / 100;
  return (
    <g transform={`translate(${props.x} ${props.y}) rotate(${props.tilt}) scale(${s}) translate(-50 -50)`}>
      <rect x="8" y="12" width="92" height="92" rx="16" fill="#000" opacity=".3" />
      <rect x="4" y="4" width="92" height="92" rx="16" fill={FACE} stroke={EDGE} stroke-width="2" />
      {pips(props.face).map((p) => (
        <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r="8" fill={PIP} />
      ))}
    </g>
  );
}

/** A stack of `n` coins standing at (x, base). */
function Coins(props: { x: number; base: number; n: number }) {
  return (
    <g>
      {Array.from({ length: props.n }, (_, i) => {
        const y = props.base - i * 7;
        return (
          <g key={i}>
            <ellipse cx={props.x} cy={y + 3} rx="24" ry="8" fill={GOLD_DARK} />
            <ellipse cx={props.x} cy={y} rx="24" ry="8" fill={GOLD} stroke={GOLD_DARK} stroke-width="1" />
          </g>
        );
      })}
    </g>
  );
}

export function BankCover() {
  return (
    <svg
      class="game-cover"
      viewBox="0 0 600 360"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Bank artwork: two dice tumbling on green baize before a pillared bank, with stacks of coins"
    >
      <defs>
        <radialGradient id="bank-cover-felt" cx=".5" cy=".7" r=".75">
          <stop stop-color="#2f7a58" />
          <stop offset="1" stop-color="#123d2c" />
        </radialGradient>
      </defs>
      <rect width="600" height="360" fill="url(#bank-cover-felt)" />
      <g fill="#0d2f22" opacity=".55">
        <path d="M150 112 300 46 450 112Z" />
        <rect x="150" y="116" width="300" height="12" />
        {[166, 214, 262, 310, 358, 406].map((x) => (
          <rect key={x} x={x} y="134" width="26" height="112" />
        ))}
        <rect x="140" y="246" width="320" height="12" />
        <rect x="128" y="260" width="344" height="10" />
      </g>
      <circle cx="300" cy="90" r="12" fill="none" stroke={GOLD} stroke-width="2" opacity=".6" />
      <ellipse cx="300" cy="306" rx="250" ry="40" fill="#0b281d" opacity=".45" />
      <Coins x={102} base={300} n={6} />
      <Coins x={150} base={316} n={3} />
      <Coins x={460} base={316} n={4} />
      <Coins x={506} base={298} n={8} />
      <Die face={6} x={252} y={226} size={104} tilt={-14} />
      <Die face={5} x={352} y={238} size={104} tilt={9} />
      <path
        d="M196 158 182 146M206 146l-6-18M406 162l14-10M398 148l8-18"
        stroke="#f3e6c8"
        stroke-width="3"
        stroke-linecap="round"
        opacity=".7"
      />
      <rect x="15" y="15" width="570" height="330" rx="2" stroke={GOLD} fill="none" opacity=".55" />
    </svg>
  );
}
