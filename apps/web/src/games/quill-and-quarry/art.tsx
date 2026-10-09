/** Original line-work: a cut stone supporting a feather, with engraved contour lines. */
export function QuillMark() {
  return (
    <svg viewBox="0 0 100 112" fill="none" aria-hidden="true" class="qq-mark">
      <path d="M16 76 42 63 81 76 87 96 53 108 13 95Z" fill="currentColor" opacity=".13" />
      <path
        d="m16 76 31 8 22 24M31 84l11-21 39 13 6 20-34 12-40-13 3-19Zm15 8 29-10M52 99l27-10M20 87l6 4"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path d="M34 83C40 49 48 21 85 6 89 39 66 64 43 68" fill="currentColor" opacity=".14" />
      <path
        d="M34 83C46 53 63 29 85 6M43 68C68 62 88 39 85 6 53 17 42 37 40 61M52 47l-3-19M61 34l-1-15M46 59l23-10M54 45l24-11"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
      />
      <circle cx="21" cy="39" r="2" fill="currentColor" />
      <path d="M15 54h8m-4-4v8M87 56h6m-3-3v6" stroke="currentColor" />
    </svg>
  );
}
export function QuarryArt() {
  return (
    <svg
      class="qq-cover-art"
      viewBox="0 0 600 360"
      role="img"
      aria-label="Original Quill and Quarry artwork: a feather over a landscape of engraved letter stones"
    >
      <defs>
        <pattern id="qq-grain" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="3" r=".55" fill="#e9dfc6" opacity=".25" />
        </pattern>
        <linearGradient id="qq-sky" x2="1" y2="1">
          <stop stop-color="#24484b" />
          <stop offset="1" stop-color="#142e32" />
        </linearGradient>
      </defs>
      <rect width="600" height="360" fill="url(#qq-sky)" />
      <rect width="600" height="360" fill="url(#qq-grain)" />
      <rect x="15" y="15" width="570" height="330" rx="2" stroke="#c6ac78" fill="none" opacity=".6" />
      <path
        d="M15 263 93 213 167 251 236 199 319 234 420 172 510 227 585 193V345H15Z"
        fill="#547373"
        opacity=".5"
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path
          key={i}
          d={`M15 ${285 + i * 11} 93 ${235 + i * 11} 167 ${273 + i * 11} 236 ${221 + i * 11} 319 ${256 + i * 11} 420 ${194 + i * 11} 510 ${249 + i * 11} 585 ${215 + i * 11}`}
          stroke="#c6ac78"
          opacity=".24"
          fill="none"
        />
      ))}
      <circle cx="300" cy="128" r="78" stroke="#c6ac78" fill="none" opacity=".35" />
      <circle cx="300" cy="128" r="69" stroke="#c6ac78" stroke-dasharray="1 7" fill="none" />
      <g transform="translate(248 67)" style={{ color: '#e8d5ab' }}>
        <path d="M16 76 42 63 81 76 87 96 53 108 13 95Z" fill="#416367" stroke="currentColor" />
        <path d="m16 76 31 8 22 24M31 84l11-21M48 95l30-12M53 103l27-13" stroke="currentColor" fill="none" />
        <path d="M34 83C40 49 48 21 85 6 89 39 66 64 43 68" fill="#b5b48e" />
        <path
          d="M34 83C46 53 63 29 85 6M52 47l-3-19M61 34l-1-15M46 59l23-10M54 45l24-11"
          stroke="#f6e9c9"
          stroke-width="2"
        />
      </g>
      <g transform="translate(171 240) rotate(-9)">
        <rect width="64" height="68" rx="6" fill="#ac926c" />
        <rect width="64" height="62" rx="6" fill="#f2e6cd" />
        <text x="32" y="43" text-anchor="middle" fill="#294448" font-size="40" font-family="Georgia,serif">
          Q
        </text>
        <text x="52" y="55" text-anchor="middle" fill="#294448" font-size="12">
          10
        </text>
      </g>
      <g transform="translate(265 244) rotate(3)">
        <rect width="64" height="68" rx="6" fill="#ac926c" />
        <rect width="64" height="62" rx="6" fill="#f2e6cd" />
        <text x="32" y="44" text-anchor="middle" fill="#294448" font-size="42" font-family="Georgia,serif">
          &amp;
        </text>
      </g>
      <g transform="translate(360 233) rotate(11)">
        <rect width="64" height="68" rx="6" fill="#ac926c" />
        <rect width="64" height="62" rx="6" fill="#f2e6cd" />
        <text x="32" y="43" text-anchor="middle" fill="#294448" font-size="40" font-family="Georgia,serif">
          Q
        </text>
        <text x="52" y="55" text-anchor="middle" fill="#294448" font-size="12">
          10
        </text>
      </g>
      <path
        d="m100 99 4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1Zm396 8 3 6 7 1-5 5 1 6-6-3-6 3 1-6-5-5 7-1Z"
        fill="#c6ac78"
        opacity=".7"
      />
      <text
        x="300"
        y="40"
        text-anchor="middle"
        fill="#e8d5ab"
        font-family="Georgia,serif"
        font-size="12"
        letter-spacing="5"
      >
        THE ART OF A WELL-PLACED WORD
      </text>
    </svg>
  );
}

/** Drawn arrows stay crisp even on systems without a full symbol font. */
export function ArrowMark() {
  return (
    <svg class="qq-inline-icon" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3 11 11 3M3 3h8v8"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
