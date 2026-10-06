import { type Action, view as boardView, type NetworkState } from '@bored-games/driftwrights';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { DriftwrightsBoard } from './board.tsx';

export function DriftwrightsGame(p: GameViewProps) {
  const state = p.view.state as NetworkState;
  const special = p.legal.filter((a) => ['transfer', 'declare'].includes((a as { type: string }).type));
  const normal = p.legal.filter(
    (a) => !['transfer', 'declare', 'contribute'].includes((a as { type: string }).type),
  );
  const pending = p.view.pending;
  return (
    <section
      data-testid="driftwrights-game"
      data-seat={p.mySeat ?? 'spectator'}
      data-seq={p.view.head.seq}
      data-stage={state.stage}
      data-actor={state.actor}
      data-terrain={state.terrain.join(',')}
      data-yields={state.yields.join(',')}
      data-buildings={state.buildings.map((b) => (b ? `${b.seat}:${b.hub ? 1 : 0}` : '')).join(',')}
    >
      <a href={rulesHref('driftwrights')}>How to play</a>
      {p.notice && <p role="status">{p.notice}</p>}
      {pending.type === 'beacon' || (pending.type === 'player' && pending.decision === 'contribute') ? (
        <p role="status">Gathering the guilds’ dice contributions…</p>
      ) : null}
      <DriftwrightsBoard
        state={{ ...boardView(state, p.mySeat), result: p.view.outcome ?? state.result }}
        viewer={p.mySeat}
        names={p.names}
        actions={normal as Action[]}
        disabled={!p.canAct || p.busy}
        onAction={(a) => void p.onAct(a).catch(() => {})}
      />
      {special.map((action) => (
        <button
          key={(action as { type: string }).type}
          type="button"
          data-action={JSON.stringify(action)}
          disabled={!p.canAct || p.busy}
          onClick={() => void p.onAct(action).catch(() => {})}
        >
          {(action as { type: string }).type === 'declare'
            ? 'Declare victory'
            : 'Deliver the selected supply'}
        </button>
      ))}
      {p.ended && (
        <p role="status" data-testid="drift-audit">
          {p.audit === 'pass'
            ? 'Audit passed.'
            : p.audit && p.audit !== 'pending'
              ? `Audit failed: ${p.audit.reason}`
              : 'Waiting for the final audit…'}
        </p>
      )}
      {p.deadline && !p.ended && <p>{p.deadline}</p>}
      {p.onClaimTimeout && p.timeoutExplanation && (
        <ClaimTimeout onClaim={p.onClaimTimeout} explanation={p.timeoutExplanation} busy={p.busy} />
      )}
    </section>
  );
}
