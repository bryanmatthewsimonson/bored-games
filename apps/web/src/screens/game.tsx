/*
 * The Game route (#/g/<rootId>): one GameController for the life of the screen, bound to the Chain Reaction
 * component. The controller performs the automatic duties; this screen shows progress and passes the
 * player's decisions to `act`.
 */
import type { ChainReactionAction, ChainReactionState } from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import type { SessionView } from '@bored-games/client';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { npubEncode, shortNpub } from '../bech32.ts';
import { useApp } from '../context.ts';
import { GameController, type GameStatus } from '../game-controller.ts';
import { type Audit, ChainReactionGame, newlyPlacedTile } from '../games/chain-reaction/index.ts';
import { homeHref } from '../router.ts';

/** "2d 4h left", "3h 10m left", "overdue", from seconds remaining. */
export function formatDeadline(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'deadline passed';
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

/** What the screen says while the game is not waiting on the player. */
export function statusNotice(status: GameStatus, view: SessionView | null): string | undefined {
  switch (status) {
    case 'syncing':
      return 'Loading the game from the relays…';
    case 'working':
      if (view?.phase === 'shuffle') return 'Shuffling the deck…';
      if (view?.phase === 'deal') return 'Dealing…';
      return 'Working…';
    case 'cancelled':
      return 'This game was cancelled.';
    default:
      return undefined;
  }
}

/**
 * Seats flagged for signing two rival moves. The session is gaining `view().equivocators`; read it through
 * this shim so the screen compiles before and after.
 */
export function equivocatorsOf(view: SessionView | null): readonly number[] {
  const e = (view as { equivocators?: unknown } | null)?.equivocators;
  return Array.isArray(e) ? e.filter((x): x is number => Number.isInteger(x)) : [];
}

/** Why the decision form is disabled, for `lockedReason`. */
function lockedReason(status: GameStatus): string {
  if (status === 'syncing') return 'Still loading the game from the relays.';
  if (status === 'working') return 'Finishing an automatic step first.';
  return 'It is not your decision right now.';
}

function SetupProgress(props: { view: SessionView | null; status: GameStatus; error: string | null }) {
  const v = props.view;
  const step =
    v === null
      ? 'Looking for the game on your relays…'
      : v.phase === 'shuffle'
        ? `Shuffling the deck: ${v.head.seq} of ${v.seats} players done.`
        : 'Dealing the tiles…';
  return (
    <section class="panel game-loading" aria-labelledby="game-title" aria-busy={props.status !== 'waiting'}>
      <h1 id="game-title">{CHAIN_REACTION_THEME.title}</h1>
      <p role="status">{step}</p>
      {props.status === 'working' && <p class="muted">Working… this can take a few seconds.</p>}
      {props.status === 'waiting' && <p class="muted">Waiting for the other players' clients.</p>}
      {props.error !== null && (
        <p class="error" role="alert">
          {props.error}
        </p>
      )}
    </section>
  );
}

export function GameScreen(props: { rootId: string }) {
  const { deps } = useApp();
  const ctl = useMemo(() => new GameController(props.rootId, deps), [props.rootId, deps]);
  useEffect(() => {
    ctl.start();
    return () => ctl.dispose();
  }, [ctl]);

  const view = ctl.view.value;
  const status = ctl.status.value;
  const busy = ctl.busy.value;
  const error = ctl.error.value;
  const notice = ctl.notice.value;
  const seats = ctl.seats.value;
  const now = ctl.clock.value;
  const target = ctl.timeoutTarget.value;
  const state = (view?.state ?? null) as ChainReactionState | null;

  // The last placed tile, from consecutive states (the session exposes states, not the engine's events).
  const prev = useRef<{ state: ChainReactionState | null; last: number | null }>({ state: null, last: null });
  if (state !== null && state !== prev.current.state) {
    const placed = newlyPlacedTile(prev.current.state, state);
    prev.current = { state, last: placed ?? prev.current.last };
  }

  const names = useMemo(() => seats.map((npub) => shortNpub(npubEncode(npub))), [seats]);

  if (status === 'cancelled') {
    return (
      <section class="panel" aria-labelledby="game-title">
        <h1 id="game-title">Game cancelled</h1>
        <p>A player stalled before the first move, so this game ended without a result.</p>
        <p>
          <a href={homeHref()}>Back to the start</a>
        </p>
      </section>
    );
  }
  if (state === null || view === null || view.phase === 'shuffle' || view.phase === 'deal')
    return <SetupProgress view={view} status={status} error={error} />;

  const audit: Audit | undefined = view.phase === 'end' || view.phase === 'done' ? view.audit : undefined;
  const cheats = equivocatorsOf(view);
  const deadlineLeft = view.pendingSince + view.deadline - now;
  return (
    <>
      {error !== null && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {cheats.length > 0 && (
        <p class="warning" role="alert">
          {cheats.map((seat) => names[seat] ?? `Seat ${seat + 1}`).join(', ')}{' '}
          {cheats.length === 1 ? 'has' : 'have'} signed two rival moves for the same turn.
        </p>
      )}
      <ChainReactionGame
        state={state}
        mySeat={view.mySeat}
        legal={ctl.legal.value as readonly ChainReactionAction[]}
        canAct={status === 'your-turn' && !busy}
        lockedReason={lockedReason(status)}
        busy={busy || status === 'working'}
        onAct={(a) => ctl.act(a)}
        names={names}
        events={[]}
        lastTile={prev.current.last}
        audit={audit}
        notice={notice ?? statusNotice(status, view)}
        deadline={view.phase === 'play' ? formatDeadline(deadlineLeft) : undefined}
        onClaimTimeout={target === null ? undefined : () => void ctl.claimTimeout()}
      />
    </>
  );
}
