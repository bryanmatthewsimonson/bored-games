import {
  type Action,
  apply,
  choices,
  type EntropyAction,
  invariants,
  type State,
  setup,
  view,
} from '@bored-games/driftwrights';
import { createRng, shuffle } from '@bored-games/game-kit';
import { render } from 'preact';
import { chooseForTest } from '../../../../packages/games/driftwrights/src/choices.ts';
import { DriftwrightsBoard } from '../../src/games/driftwrights/board.tsx';

// This fixture is served only by Vite's development server. It is not a route in the hosted application.
const seats = Number(new URL(location.href).searchParams.get('seats') ?? 3);
const rng = createRng(`browser-${seats}`);
const first = setup(
  seats,
  shuffle(
    Array.from({ length: 25 }, (_, i) => i),
    rng,
  ),
);
if (!first.ok) throw new Error(first.error.message);
const saved = sessionStorage.getItem('drift-reference-state');
let state: State = saved ? (JSON.parse(saved) as State) : first.value;
let error = '';
let viewer: number | null = state.actor;
let count = Number(sessionStorage.getItem('drift-reference-count') ?? 0);
function move(action: Action | EntropyAction): void {
  const result = apply(state, action);
  if (!result.ok) {
    error = result.error.message;
    paint();
    return;
  }
  state = result.state;
  count++;
  const bad = invariants(state);
  if (bad.length) throw new Error(bad.join(','));
  if (state.chance) {
    const c = state.chance;
    move(
      c.kind === 'dice'
        ? { type: 'dice', actor: 'entropy', faces: [1 + rng.int(6), 1 + rng.int(6)] }
        : { type: 'theft', actor: 'entropy', index: rng.int(c.size) },
    );
    return;
  }
  viewer = state.actor;
  sessionStorage.setItem('drift-reference-state', JSON.stringify(state));
  sessionStorage.setItem('drift-reference-count', String(count));
  paint();
}
function paint(): void {
  const root = document.getElementById('fixture');
  if (!root) return;
  const list = viewer === state.actor ? choices(state) : [];
  render(
    <main>
      <p>Development reference fixture. No multiplayer transport, signatures or audit.</p>
      <label>
        View
        <select
          aria-label="View"
          value={viewer ?? 'spectator'}
          onChange={(e) => {
            viewer = e.currentTarget.value === 'spectator' ? null : Number(e.currentTarget.value);
            paint();
          }}
        >
          <option value="spectator">Spectator</option>
          {state.players.map((_, i) => (
            <option key={i} value={i}>
              Player {i + 1}
            </option>
          ))}
        </select>
      </label>
      <p role="alert">{error}</p>
      <DriftwrightsBoard
        state={view(state, viewer)}
        viewer={viewer}
        names={state.players.map((_, i) => `Player ${i + 1}`)}
        actions={list}
        onAction={move}
      />
    </main>,
    root,
  );
}
declare global {
  interface Window {
    driftReference: {
      next: () => Action;
      finished: () => boolean;
      count: () => number;
      digest: () => string;
    };
  }
}
window.driftReference = {
  next: () => chooseForTest(state, choices(state)),
  finished: () => state.result !== null,
  count: () => count,
  digest: () => JSON.stringify(view(state, null)),
};
paint();
