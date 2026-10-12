/*
 * Battle dice (D088): the attacker's in crimson, the defender's in ivory, with pips (Bank's layout, D058).
 */
const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[15, 15]],
  2: [
    [9, 9],
    [21, 21],
  ],
  3: [
    [8, 8],
    [15, 15],
    [22, 22],
  ],
  4: [
    [9, 9],
    [21, 9],
    [9, 21],
    [21, 21],
  ],
  5: [
    [8, 8],
    [22, 8],
    [15, 15],
    [8, 22],
    [22, 22],
  ],
  6: [
    [9, 8],
    [21, 8],
    [9, 15],
    [21, 15],
    [9, 22],
    [21, 22],
  ],
};

export function DieArt(props: { value: number; side: 'attack' | 'defend' }) {
  const attack = props.side === 'attack';
  return (
    <g>
      <rect
        x="1"
        y="1"
        width="28"
        height="28"
        rx="6"
        fill={attack ? '#a8322d' : '#f4ecd8'}
        stroke={attack ? '#5e1513' : '#8a7a5a'}
        stroke-width="1.5"
      />
      {(PIPS[props.value] ?? []).map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r="2.7" fill={attack ? '#fdf3e3' : '#2b2318'} />
      ))}
    </g>
  );
}

export function Die(props: { value: number; side: 'attack' | 'defend' }) {
  return (
    <svg
      class="hz-die"
      viewBox="0 0 30 30"
      role="img"
      aria-label={`${props.side === 'attack' ? 'Attack' : 'Defence'} die: ${props.value}`}
    >
      <DieArt value={props.value} side={props.side} />
    </svg>
  );
}
