/*
 * Two dice, drawn in SVG. A face is cream with dark pips. The component does not roll: the faces come from the
 * session, after every seat has shown the dice.
 */
import { dieTilt, pips } from './model.ts';

export function Die(props: { face: number | null; tilt: number; className: string }) {
  const label = props.face === null ? 'Die, not yet shown' : `Die showing ${props.face}`;
  return (
    <svg
      class={props.className}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      style={{ transform: `rotate(${props.tilt}deg)` }}
    >
      <rect class="bank-die-face" x="4" y="4" width="92" height="92" rx="16" />
      {props.face !== null &&
        pips(props.face).map((pip) => (
          <circle key={`${pip.x}-${pip.y}`} class="bank-die-pip" cx={pip.x} cy={pip.y} r="8" />
        ))}
    </svg>
  );
}

/** The pair. `rollId` tilts them; null faces are the waiting squares. `onSettled` runs when a tumble ends. */
export function DicePair(props: {
  faces: readonly [number, number] | null;
  rollId: number;
  className: string;
  onSettled?: () => void;
}) {
  const [a, b] = props.faces ?? [null, null];
  const spoken = a === null || b === null ? 'Dice not shown yet' : `Dice showing ${a} and ${b}`;
  return (
    <div
      class="bank-dice"
      data-testid="bank-dice"
      data-faces={a === null || b === null ? '' : `${a},${b}`}
      onAnimationEnd={props.onSettled}
    >
      <span class="sr-only">{spoken}</span>
      <Die face={a} tilt={dieTilt(props.rollId, 0)} className={props.className} />
      <Die face={b} tilt={dieTilt(props.rollId, 1)} className={props.className} />
    </div>
  );
}
