/*
 * The Game route (#/g/<rootId>): one GameController for the life of the screen, bound to the Chain Reaction
 * component. The controller performs the automatic duties; this screen shows progress and passes the
 * player's decisions to `act`.
 */
import type { ChainReactionAction, ChainReactionState } from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import type { SessionView } from '@bored-games/client';
import { useEffect, useMemo } from 'preact/hooks';
import { npubEncode, shortNpub } from '../bech32.ts';
import { Avatar } from '../components/avatar.tsx';
import { ClaimTimeout } from '../components/claim-timeout.tsx';
import { useApp } from '../context.ts';
import { GameController, type GameStatus } from '../game-controller.ts';
import { type Audit, ChainReactionGame, lastTileOf, logLines } from '../games/chain-reaction/index.ts';
import type { ProfileInfo } from '../profile-model.ts';
import { usePlayerProfiles } from '../profiles.ts';
import { homeHref } from '../router.ts';

const NO_EVENTS: readonly unknown[] = Object.freeze([]);

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
      return 'working…';
    case 'stuck':
      return 'Stuck: an automatic step failed. Reload the page to retry.';
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

/**
 * The warning for seats flagged for signing two rival moves (D030 Ruling 5). With prompt shares (D039), other
 * seats may have shared a tile dealt on the losing branch, so its holder there or every player may know it.
 */
export function equivocationWarning(who: readonly string[]): string {
  const tiles = who.length === 1 ? 'A tile' : 'Tiles';
  return `${who.join(', ')} signed two different moves for the same turn and will be ranked last. ${tiles} dealt around then may be known to other players.`;
}

/**
 * What claiming a timeout against `who` does (PROTOCOL §8.2, D030 R5), for the claim's confirm step. Before the
 * first game action (the shuffle, the deal, or play before any move after them) the game is cancelled instead.
 */
export function timeoutExplanation(view: SessionView, who: string): string {
  const started = view.phase !== 'shuffle' && view.phase !== 'deal' && view.head.seq > view.seats;
  if (!started)
    return `${who} has missed the move deadline. If you claim the timeout, ${who} forfeits, and because no move has been played yet the game is cancelled without a result.`;
  if (view.phase === 'end')
    return `${who} has not sent their end-of-game secret in time. If you claim the timeout, ${who} forfeits and is ranked last.`;
  return `${who} has missed the move deadline. If you claim the timeout, ${who} forfeits: the game ends now, ${who} is ranked last and the others are ranked by their cash as if the game ended now.`;
}

/** The seats a timeout claim made forfeit, when one ended the game; empty otherwise. */
export function timedOutSeats(view: SessionView | null): readonly number[] {
  const a = view?.phase === 'done' ? view.audit : null;
  return typeof a === 'object' && a !== null && (a.reason === 'timeout' || a.reason === 'withheld secret')
    ? a.fail
    : [];
}

/** Each seat's short npub, after its profile name when it has one: "Ann (npub1abcdef…uvwxyz)". */
export function playerNames(seats: readonly string[], profiles: readonly (string | null)[]): string[] {
  return seats.map((pubkey, i) => {
    const short = shortNpub(npubEncode(pubkey));
    const name = profiles[i];
    return name ? `${name} (${short})` : short;
  });
}

const namesOf = (profiles: readonly (ProfileInfo | null)[]) => profiles.map((p) => p?.name ?? null);

/** Why the decision form is disabled, for `lockedReason`. */
function lockedReason(status: GameStatus): string {
  if (status === 'syncing') return 'Still loading the game from the relays.';
  if (status === 'working') return 'Finishing an automatic step first.';
  if (status === 'stuck') return 'An automatic step failed; reload the page to retry.';
  return 'It is not your decision right now.';
}

function SetupProgress(props: {
  view: SessionView | null;
  status: GameStatus;
  error: string | null;
  claim: { explanation: string; busy: boolean; onClaim: () => void } | null;
}) {
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
      {props.status === 'stuck' && (
        <p class="error" role="alert">
          An automatic step failed. Reload the page to retry.
        </p>
      )}
      {props.status === 'waiting' && <p class="muted">Waiting for the other players' clients.</p>}
      {props.claim !== null && (
        <div class="row">
          <ClaimTimeout {...props.claim} />
        </div>
      )}
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

  // Seat profiles come from the page's ProfileStore (D040), which keeps one kind 0 subscription for every screen.
  const profiles = usePlayerProfiles(seats);
  const names = useMemo(() => playerNames(seats, namesOf(profiles)), [seats, profiles]);
  const avatars = useMemo(
    () => seats.map((pk, i) => <Avatar key={pk} pubkey={pk} picture={profiles[i]?.picture ?? null} />),
    [seats, profiles],
  );
  // The session's module events (oldest first, a new frozen array on every change): the log and the last tile.
  const events = view?.events ?? NO_EVENTS;
  const mySeat = view?.mySeat ?? null;
  const over = state?.phase.kind === 'over';
  const log = useMemo(() => logLines(events, { mySeat, over, names }), [events, mySeat, over, names]);
  const lastTile = useMemo(() => lastTileOf(events), [events]);

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
  const claim =
    target === null || view === null
      ? null
      : {
          explanation: timeoutExplanation(view, names[target] ?? `Seat ${target + 1}`),
          busy,
          onClaim: () => void ctl.claimTimeout(),
        };
  if (state === null || view === null || view.phase === 'shuffle' || view.phase === 'deal')
    return <SetupProgress view={view} status={status} error={error} claim={claim} />;

  const audit: Audit | undefined = view.phase === 'end' || view.phase === 'done' ? view.audit : undefined;
  const cheats = equivocatorsOf(view);
  const timedOut = timedOutSeats(view);
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
          {equivocationWarning(cheats.map((seat) => names[seat] ?? `Seat ${seat + 1}`))}
        </p>
      )}
      {timedOut.length > 0 && (
        <p class="warning" role="status">
          The game is over: {timedOut.map((seat) => names[seat] ?? `Seat ${seat + 1}`).join(', ')} ran out of
          time and {timedOut.length === 1 ? 'forfeits' : 'forfeit'}.
        </p>
      )}
      <ChainReactionGame
        state={state}
        mySeat={view.mySeat}
        legal={ctl.legal.value as readonly ChainReactionAction[]}
        canAct={status === 'your-turn' && !busy}
        lockedReason={lockedReason(status)}
        busy={busy}
        onAct={(a) => ctl.act(a)}
        names={names}
        avatars={avatars}
        events={log}
        lastTile={lastTile}
        audit={audit}
        notice={notice ?? statusNotice(status, view)}
        deadline={view.phase === 'play' ? formatDeadline(deadlineLeft) : undefined}
        onClaimTimeout={claim?.onClaim}
        timeoutExplanation={claim?.explanation}
        ended={view.phase !== 'play'}
      />
    </>
  );
}
