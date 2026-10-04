/** Original vector illustrations drawn for Luster. No publisher or third-party assets. */
const INKS = ['#c6e7ed', '#497fd0', '#39a980', '#de526a', '#59616b', '#efbf59'];
const SHAPES = [
  '50,7 82,30 70,72 50,93 30,72 18,30',
  '50,6 78,19 90,49 78,80 50,94 22,80 10,49 22,19',
  '28,9 72,9 86,24 86,76 72,91 28,91 14,76 14,24',
  '30,10 70,10 91,34 79,75 50,94 21,75 9,34',
  '50,7 85,28 85,72 50,93 15,72 15,28',
];
export function GemIcon(props: { color: number; class?: string }) {
  const color = props.color;
  return (
    <svg class={`luster-gem-icon ${props.class ?? ''}`} viewBox="0 0 100 100" aria-hidden="true">
      {color === 5 ? (
        <>
          <circle cx="50" cy="50" r="42" fill="#edc36b" stroke="#906820" stroke-width="4" />
          <circle cx="50" cy="50" r="33" fill="none" stroke="#fff0b7" stroke-width="2" />
          <path d="M50 23 57 42 77 50 57 58 50 77 43 58 23 50 43 42Z" fill="#9c7226" />
          <path d="M21 31A38 38 0 0 1 67 15" fill="none" stroke="#fff4ce" stroke-width="4" />
        </>
      ) : (
        <>
          <polygon
            points={SHAPES[color]}
            fill={INKS[color]}
            stroke="#122e39"
            stroke-opacity=".45"
            stroke-width="2"
          />
          <path d="M50 7 68 32 65 68 50 93 35 68 32 32Z" fill="#fff" opacity=".18" />
          <path
            d="M18 30 32 32 50 7M82 30 68 32 50 7M30 72 35 68 50 93M70 72 65 68 50 93M32 32 68 32 65 68 35 68Z"
            fill="none"
            stroke="#fff"
            stroke-opacity=".55"
            stroke-width="2"
          />
          <path d="M50 7 82 30 68 32Z" fill="#fff" opacity=".45" />
          <path d="M68 32 82 30 70 72 50 93 65 68Z" fill="#102332" opacity=".28" />
          <path d="M24 27 34 20" stroke="#fff" stroke-width="4" stroke-linecap="round" />
        </>
      )}
    </svg>
  );
}
export function GemLandscape(props: { color: number; variant: number; tier: number }) {
  const id = `luster-landscape-${props.color}-${props.variant}-${props.tier}`;
  const offset = (props.variant % 5) * 9;
  return (
    <svg class="luster-landscape" viewBox="0 0 220 144" aria-hidden="true">
      <defs>
        <linearGradient id={id} x2="0" y2="1">
          <stop stop-color="#203f4c" />
          <stop offset="1" stop-color={INKS[props.color]} stop-opacity=".72" />
        </linearGradient>
      </defs>
      <path d="M0 0H220V144H0Z" fill={`url(#${id})`} />
      <circle cx={170 - offset} cy="30" r="18" fill="#fff3d0" opacity=".65" />
      <path d="M0 96 43 35 78 82 118 46 165 96 220 54V144H0Z" fill="#092e36" opacity=".45" />
      <path d="m0 117 43-47 43 48 46-46 42 42 46-28v58H0Z" fill="#0b252d" opacity=".7" />
      {props.tier > 0 && (
        <g fill="#e2c68c" stroke="#917448" stroke-width="1.4">
          <path d="M22 113V74l22-12 22 12v39ZM25 74h38l-19-20ZM29 84h8v14h-8M50 84h8v14h-8" />
          <path d="M41 113V96h8v17" fill="#18353e" />
          {props.tier > 1 && (
            <path d="M154 114V69h16V50h12v19h16v45ZM161 69l15-14 15 14ZM161 81h6v12h-6M185 81h6v12h-6" />
          )}
        </g>
      )}
      <path d="M0 134Q60 117 111 129T220 130V144H0Z" fill="#ead8a8" opacity=".2" />
      <g transform={`translate(${80 + offset / 3} 62) scale(.63)`}>
        <polygon points={SHAPES[props.color]} fill={INKS[props.color]} stroke="#e8f6f4" stroke-width="2" />
        <path
          d="M50 7 68 32 65 68 50 93 35 68 32 32ZM18 30 32 32M82 30 68 32M30 72 35 68M70 72 65 68"
          fill="none"
          stroke="#fff"
          stroke-opacity=".6"
          stroke-width="2"
        />
        <path d="M50 7 82 30 68 32Z" fill="#fff" opacity=".45" />
        <path d="M68 32 82 30 70 72 50 93 65 68Z" fill="#071824" opacity=".28" />
      </g>
      <path d="m18 19 3-6 3 6-3 6ZM201 38l3-6 3 6-3 6" fill="#f8e4ac" opacity=".8" />
    </svg>
  );
}
export function NobleArt(props: { variant: number }) {
  return (
    <svg class="luster-noble-art" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M0 0H100V100H0Z" fill={['#385964', '#665039', '#514865'][props.variant % 3]} />
      <path
        d="M10 100V35A40 40 0 0 1 90 35V100"
        fill="none"
        stroke="#d0ad72"
        stroke-opacity=".5"
        stroke-width="2"
      />
      <path d="M21 100Q24 72 50 70T79 100" fill="#dfc19a" />
      <path d="M35 70 50 89 65 70 65 100H35Z" fill="#233d48" />
      <ellipse cx="50" cy="49" rx="19" ry="24" fill="#d4ac80" />
      <path d="M30 49V35Q30 13 54 16Q76 19 71 47L63 34 48 30 33 46" fill="#242830" />
      <path d="M30 33 34 17 45 22 52 12 59 22 70 17 73 33Z" fill="#bfa263" />
      <path d="M40 49h5m11 0h5M47 61q4 3 8 0" fill="none" stroke="#745242" stroke-width="2" />
      <circle cx="50" cy="90" r="4" fill="#eac474" />
    </svg>
  );
}
