/*
 * "Since your last move" (D095): the plays the board highlights, in words, with a button that replays them one at
 * a time. Shown to a seated player when someone else has played since their own last play.
 */
import type { RecapStep } from '../games/types.ts';

export function RecapStrip(props: {
  steps: readonly RecapStep[];
  mySeat: number | null;
  replaying: number | null;
  onReplay: () => void;
  onStop: () => void;
}) {
  const { steps, mySeat, replaying } = props;
  if (mySeat === null || !steps.some((s) => s.seat !== mySeat)) return null;
  return (
    <section class="recap-strip" aria-labelledby="recap-h">
      <h2 id="recap-h" class="recap-title">
        Since your last move
      </h2>
      <ol class="recap-list">
        {steps.map((s, i) => (
          <li key={i} class={i === replaying ? 'recap-step current' : 'recap-step'}>
            {s.text}
          </li>
        ))}
      </ol>
      {replaying === null ? (
        <button type="button" class="btn btn-small" onClick={props.onReplay}>
          {steps.length === 1 ? 'Replay it' : `Replay all ${steps.length}`}
        </button>
      ) : (
        <button type="button" class="btn btn-small" onClick={props.onStop}>
          Stop the replay
        </button>
      )}
    </section>
  );
}
