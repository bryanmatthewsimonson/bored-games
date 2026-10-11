/*
 * Holler's cover: a fan of the game's own cards (`CardArt`) over rays in the four colors. Original art (D085).
 * Drawn 600 × 360 with the fan in the middle 360, so the square catalog tile crops it.
 */
import { actionCard, numberCard } from '@bored-games/holler';
import { HOLLER_THEME } from '@bored-games/holler/theme';
import { CardArt } from './cards.tsx';

const FAN = [numberCard(0, 7, 0), actionCard(1, 1, 0), 104, numberCard(2, 3, 0), actionCard(3, 2, 0)];

export function HollerCover() {
  const theme = HOLLER_THEME;
  const rays = Array.from({ length: 16 }, (_, i) => i);
  return (
    <svg
      class="game-cover"
      viewBox="0 0 600 360"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Holler artwork: a fan of bright cards over rays of red, yellow, green and blue"
    >
      <rect width="600" height="360" fill={theme.ink} />
      <g transform="translate(300 230)">
        {rays.map((i) => (
          <path
            key={i}
            d="M0 0L-60 -520L60 -520Z"
            transform={`rotate(${i * 22.5})`}
            fill={theme.colors[i % 4]?.hue}
            opacity=".85"
          />
        ))}
        <circle r="120" fill={theme.ink} opacity=".25" />
      </g>
      {FAN.map((card, i) => (
        <g key={card} transform={`translate(300 330) rotate(${(i - 2) * 16}) translate(-62 -248) scale(.5)`}>
          <rect x="6" y="10" width="250" height="350" rx="22" fill="#000" opacity=".3" />
          <CardArt theme={theme} card={card} />
        </g>
      ))}
      <rect x="15" y="15" width="570" height="330" rx="2" stroke="#ffffff" fill="none" opacity=".5" />
    </svg>
  );
}
