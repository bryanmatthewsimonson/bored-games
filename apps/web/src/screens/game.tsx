/*
 * The Game route (#/g/<rootId>): one GameController for the life of the screen. The screen is generic (D045): it
 * shows the setup progress, the chrome every game shares (warnings, the result line, Resign) and dispatches the
 * play area to the registry's component for the table's game. The controller performs the automatic duties; the
 * player's decisions go to `act`.
 */
import type { SessionView } from '@bored-games/client';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { npubEncode, shortNpub } from '../bech32.ts';
import { Avatar } from '../components/avatar.tsx';
import { ClaimTimeout } from '../components/claim-timeout.tsx';
import { RecoveredNotice, WatchingNotice } from '../components/watching.tsx';
import { useApp } from '../context.ts';
import { GameController, type GameStatus } from '../game-controller.ts';
import { gameTitle } from '../game-names.ts';
import { webGame } from '../games/registry.ts';
import type { Audit, SetupCopy } from '../games/types.ts';
import { keptKeys, switchToKeptKey } from '../identity.ts';
import type { ProfileInfo } from '../profile-model.ts';
import { usePlayerProfiles } from '../profiles.ts';
import { activeGame, homeHref } from '../router.ts';
import { waitingLine } from '../waiting-model.ts';
import { localTableRecord, myTableCount, type WatchNotice, watchNotice } from '../watch-model.ts';

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
      if (view?.phase === 'done') return 'Signing the result…';
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
 * What claiming a timeout against `who` does (PROTOCOL §8.2, D030 R5), for the claim's confirm step. Before the
 * first game action (the shuffle, the deal, or play before any move after them) the game is cancelled instead.
 */
export function timeoutExplanation(view: SessionView, who: string): string {
  const started = view.phase !== 'shuffle' && view.phase !== 'deal' && view.head.seq > view.shuffleSteps;
  if (!started)
    return `${who} has missed the move deadline. If you claim the timeout, ${who} forfeits, and because no move has been played yet the game is cancelled without a result.`;
  if (view.phase === 'end')
    return `${who} has not sent their end-of-game secret in time. If you claim the timeout, ${who} forfeits and is ranked last.`;
  return `${who} has missed the move deadline. If you claim the timeout, ${who} forfeits: the game ends now, ${who} is ranked last and the others are ranked as if the game ended now.`;
}

/** The seats whose resignation ended the game (PROTOCOL §4.9); empty otherwise. */
export function resignedSeats(view: SessionView | null): readonly number[] {
  const r = (view as { resigned?: unknown } | null)?.resigned;
  return Array.isArray(r) ? r.filter((x): x is number => Number.isInteger(x)) : [];
}

/**
 * What resigning does, for the confirm step (D045, D052). Before the first move the game is cancelled. With 2
 * players you lose. With 3 or more the game ends for everyone, ranked as if it ended now, unrated, and the
 * resignation is recorded.
 */
export function resignExplanation(view: SessionView): string {
  const started = view.phase !== 'shuffle' && view.phase !== 'deal' && view.head.seq > view.shuffleSteps;
  if (!started) return 'No move has been played yet, so resigning cancels the game without a result.';
  if (view.seats >= 3)
    return "Resigning ends the game for everyone. Final places are worked out as if the game ended now; the game won't count toward ratings, and your resignation is recorded.";
  return 'You lose the game. This cannot be undone.';
}

/**
 * The platform's line about a resignation that ended the game (PROTOCOL §8.3, D052), or null when none did:
 * - 3 or more players: "Ended early: Ann resigned · unrated.", then the final places once every secret is in and
 *   checked, or a note that the end-of-game check is under way;
 * - 2 players: "The game is over: Ann has resigned. Final places: 1. Bo, 2. Ann."
 */
export function resignLine(view: SessionView | null, names: readonly string[]): string | null {
  const quit = resignedSeats(view);
  if (view === null || quit.length === 0 || view.phase === 'cancelled') return null;
  const who = quit.map((seat) => names[seat] ?? `Seat ${seat + 1}`).join(', ');
  const places = placesText(view, names);
  if (view.seats >= 3) {
    const head = `Ended early: ${who} resigned · unrated.`;
    if (view.outcome === null)
      return `${head} Checking the game: waiting for every player's end-of-game secret.`;
    return `${head} Final places: ${places}.`;
  }
  return `The game is over: ${who} ${quit.length === 1 ? 'has' : 'have'} resigned. Final places: ${places}.`;
}

/**
 * The note for an unrated end that holds only because a deck secret froze its fork (D056, `endedBy` type `fork`):
 * "Unrated: Ann signed two rival moves, and this end holds only because a player's secret was already out."
 * Null otherwise.
 */
export function forkLine(view: SessionView | null, names: readonly string[]): string | null {
  const by = view?.outcome?.endedBy;
  if (by?.type !== 'fork') return null;
  const who = names[by.seat] ?? `Seat ${by.seat + 1}`;
  return `Unrated: ${who} signed two rival moves, and this end holds only because a player's secret was already out.`;
}

/**
 * "Result confirmed: signed by both players" (two seats) or "… by all 3 players", or "Result signed by 1 of 2
 * players so far", once the session has a result to attest; null before.
 */
export function attestLine(view: SessionView | null): string | null {
  if (view === null || view.phase !== 'done' || view.outcome === null) return null;
  const n = view.attested.length;
  if (n !== view.seats) return `Result signed by ${n} of ${view.seats} players so far.`;
  return n === 2
    ? 'Result confirmed: signed by both players.'
    : `Result confirmed: signed by all ${n} players.`;
}

/**
 * The seats a timeout claim made forfeit, when one ended the game; empty otherwise. After a resign (D052) a claim
 * can only be for a withheld secret, and the resigning seat (and any equivocator) is not among them.
 */
export function timedOutSeats(view: SessionView | null): readonly number[] {
  const a = view?.phase === 'done' ? view.audit : null;
  if (typeof a !== 'object' || a === null) return [];
  if (a.reason === 'timeout' || a.reason === 'withheld secret') return a.fail;
  if (a.reason !== 'resign; withheld secret') return [];
  const not = new Set([...resignedSeats(view), ...equivocatorsOf(view)]);
  return a.fail.filter((seat) => !not.has(seat));
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

/** The shuffle and deal progress, or the loading notice for a game not built yet (a deckless game has no setup). */
export function setupStep(view: SessionView | null, copy: SetupCopy | null): string {
  if (view === null) return 'Looking for the game on your relays…';
  if (view.phase === 'shuffle') {
    const completed =
      view.shuffleSteps > view.seats
        ? Math.floor(view.head.seq / (view.shuffleSteps / view.seats))
        : view.head.seq;
    return `${copy?.shuffling ?? 'Shuffling'}: ${completed} of ${view.seats} players done.`;
  }
  if (view.phase === 'deal') return copy?.dealing ?? 'Dealing…';
  return 'Loading the game…';
}

/** "Waiting for the other players' clients.": only when the session cannot say whom it waits for. */
export const WAITING_FALLBACK = "Waiting for the other players' clients.";

function SetupProgress(props: {
  title: string;
  view: SessionView | null;
  copy: SetupCopy | null;
  status: GameStatus;
  error: string | null;
  claim: { explanation: string; busy: boolean; onClaim: () => void } | null;
  /** Who the setup waits for (`waitingLine`), or null. */
  waiting: string | null;
  /** "You're watching this game", when the key in use holds no seat (D057). */
  watching: ComponentChildren;
  log: readonly string[];
  onSendAnyway: (() => void) | null;
}) {
  return (
    <section class="panel game-loading" aria-labelledby="game-title" aria-busy={props.status !== 'waiting'}>
      <h1 id="game-title">{props.title}</h1>
      {props.watching}
      <p role="status">{setupStep(props.view, props.copy)}</p>
      {props.status === 'working' && <p class="muted">Working… this can take a few seconds.</p>}
      {props.status === 'stuck' && (
        <p class="error" role="alert">
          An automatic step failed. Reload the page to retry.
        </p>
      )}
      {props.status === 'waiting' && <p class="muted">{props.waiting ?? WAITING_FALLBACK}</p>}
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
      {props.onSendAnyway !== null && <SendAnyway onSend={props.onSendAnyway} />}
      <SyncNotes lines={props.log} />
    </section>
  );
}

/**
 * "Resign", then a confirm step that says what resigning does. A resignation cannot be taken back, so it is
 * never sent on the first click.
 */
export function ResignButton(props: { explanation: string; busy: boolean; onResign: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" class="btn btn-small" disabled={props.busy} onClick={() => setConfirming(true)}>
        Resign
      </button>
    );
  }
  return (
    <section class="claim-confirm" role="alertdialog" aria-labelledby="resign-confirm-h">
      <p id="resign-confirm-h">
        <strong>Resign this game?</strong> {props.explanation}
      </p>
      <div class="row">
        <button
          type="button"
          class="btn btn-small btn-primary"
          disabled={props.busy}
          onClick={() => {
            setConfirming(false);
            props.onResign();
          }}
        >
          Yes, resign
        </button>
        <button type="button" class="btn btn-small" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/**
 * "Send anyway" (D056): offered once a saved event or the end-of-game secret has waited `HOLD_CAP_S` for every
 * relay to answer, or for this device to catch up with the relays.
 */
export function SendAnyway(props: { onSend: () => void }) {
  return (
    <p class="warning send-anyway" role="status">
      Something saved on this device is still waiting for every relay to answer before it is sent. If you
      already played this turn on another device, sending it counts as signing two moves for one turn, and you
      forfeit.{' '}
      <button type="button" class="btn btn-small" onClick={props.onSend}>
        Send anyway
      </button>
    </p>
  );
}

/**
 * "Sync notes": what the controller did with events saved on this device that no relay had confirmed (D056), such
 * as a move discarded because the game moved on, or a deal kept but not sent. Nothing when there are none.
 */
export function SyncNotes(props: { lines: readonly string[] }) {
  if (props.lines.length === 0) return null;
  return (
    <details class="sync-notes">
      <summary>Sync notes ({props.lines.length})</summary>
      <ul>
        {props.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

/** Final places, best first: "1. Ann, 2. Bo", for an ending outside the rules (a resign or a timeout). */
export function placesText(view: SessionView, names: readonly string[]): string {
  const o = view.outcome;
  if (o === null) return '';
  return o.places
    .map((place, seat) => ({ place, seat }))
    .sort((a, b) => a.place - b.place || a.seat - b.seat)
    .map(({ place, seat }) => `${place}. ${names[seat] ?? `Seat ${seat + 1}`}`)
    .join(', ');
}

export function GameScreen(props: { rootId: string }) {
  const { deps, profile, store, signer } = useApp();
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
  const log = ctl.log.value;
  const sendAnyway = ctl.canSendAnyway.value ? () => ctl.sendAnyway() : null;
  const seats = ctl.seats.value;
  const now = ctl.clock.value;
  const target = ctl.timeoutTarget.value;
  const gameId = ctl.game.value;
  const game = gameId === null ? undefined : webGame(gameId);
  // The header's Rules link follows this game while the screen is open.
  useEffect(() => {
    activeGame.value = gameId;
    return () => {
      activeGame.value = null;
    };
  }, [gameId]);

  // Seat profiles come from the page's ProfileStore (D040), which keeps one kind 0 subscription for every screen.
  const profiles = usePlayerProfiles(seats);
  const names = useMemo(() => playerNames(seats, namesOf(profiles)), [seats, profiles]);
  const avatars = useMemo(
    () => seats.map((pk, i) => <Avatar key={pk} pubkey={pk} picture={profiles[i]?.picture ?? null} />),
    [seats, profiles],
  );
  const nameOf = (seat: number): string => names[seat] ?? `Seat ${seat + 1}`;

  // "You're watching this game" when the key in use holds no seat (D057), from this profile's local records.
  const tableAddress = ctl.tableAddress.value;
  const recovered = ctl.recovered.value;
  // Only once the session exists and holds no seat: before it, a seat recovered from saved game keys is not known
  // yet, and the notice would flash.
  const spectating = view !== null && view.mySeat === null;
  const kept = useMemo(() => keptKeys(profile, store).map((k) => k.pubkey), [profile, store]);
  const watch: WatchNotice | null = useMemo(
    () =>
      tableAddress === null || !spectating
        ? null
        : watchNotice({
            seats,
            me: signer.pubkey,
            kept,
            record: localTableRecord(profile, store, tableAddress),
            myTables: myTableCount(profile, store, signer.pubkey),
          }),
    [seats, tableAddress, spectating, kept, profile, store, signer],
  );
  const [switchError, setSwitchError] = useState('');
  const onSwitch = (pubkey: string) => {
    const r = switchToKeptKey(profile, store, pubkey, { current: signer.pubkey, now: deps.now() });
    if (r.ok) window.location.reload();
    else setSwitchError(r.error);
  };
  const watching =
    recovered !== null ? (
      <RecoveredNotice
        seat={recovered.seat}
        joined={recovered.npub}
        me={signer.pubkey}
        // The joining key is kept here: switching back to it also restores signing the result.
        onSwitch={kept.includes(recovered.npub) ? onSwitch : null}
        switchError={switchError}
      />
    ) : watch === null ? null : (
      <WatchingNotice notice={watch} me={signer.pubkey} switchError={switchError} onSwitch={onSwitch} />
    );
  const waiting =
    view === null || status !== 'waiting'
      ? null
      : waitingLine({
          phase: view.phase,
          pending: view.pending,
          mySeat: view.mySeat,
          waiting: ctl.waiting.value,
          names,
        });

  if (status === 'cancelled') {
    const quit = resignedSeats(view);
    return (
      <section class="panel" aria-labelledby="game-title">
        <h1 id="game-title">Game cancelled</h1>
        <p>
          {quit.length > 0
            ? `${quit.map(nameOf).join(', ')} resigned before the first move, so this game ended without a result.`
            : 'A player stalled before the first move, so this game ended without a result.'}
        </p>
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
          explanation: timeoutExplanation(view, nameOf(target)),
          busy,
          onClaim: () => void ctl.claimTimeout(),
        };
  const title = gameId === null ? 'Game' : gameTitle(gameId);
  const copy = game?.setupCopy(view !== null && view.shuffleSteps > 0) ?? null;
  if (view === null || view.state === null || view.phase === 'shuffle' || view.phase === 'deal')
    return (
      <SetupProgress
        title={title}
        view={view}
        copy={copy}
        status={status}
        error={error}
        claim={claim}
        waiting={waiting}
        watching={watching}
        log={log}
        onSendAnyway={sendAnyway}
      />
    );
  if (game === undefined) {
    return (
      <section class="panel" aria-labelledby="game-title">
        <h1 id="game-title">{title}</h1>
        <p class="error" role="alert">
          This app cannot show {title} games yet.
        </p>
      </section>
    );
  }

  const audit: Audit | undefined = view.phase === 'end' || view.phase === 'done' ? view.audit : undefined;
  const cheats = equivocatorsOf(view);
  const timedOut = timedOutSeats(view);
  const resigned = resignLine(view, names);
  const forked = forkLine(view, names);
  const deadlineLeft = view.pendingSince + view.deadline - now;
  const attested = attestLine(view);
  const Component = game.Component;
  return (
    <>
      {watching}
      {waiting !== null && (
        <p class="muted game-waiting" role="status">
          {waiting}
        </p>
      )}
      {error !== null && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {cheats.length > 0 && (
        <p class="warning" role="alert">
          {cheats.map(nameOf).join(', ')} {cheats.length === 1 ? 'has' : 'have'} signed two rival moves for
          the same turn.
        </p>
      )}
      {timedOut.length > 0 && (
        <p class="warning" role="status">
          The game is over: {timedOut.map(nameOf).join(', ')} ran out of time and{' '}
          {timedOut.length === 1 ? 'forfeits' : 'forfeit'}. Final places: {placesText(view, names)}.
        </p>
      )}
      {resigned !== null && (
        <p class="warning game-resigned" role="status">
          {resigned}
        </p>
      )}
      {forked !== null && (
        <p class="warning" role="status">
          {forked}
        </p>
      )}
      <Component
        view={view}
        mySeat={view.mySeat}
        legal={ctl.legal.value}
        canAct={status === 'your-turn' && !busy}
        lockedReason={lockedReason(status)}
        busy={busy}
        onAct={(a) => ctl.act(a)}
        names={names}
        avatars={avatars}
        audit={audit}
        notice={notice ?? statusNotice(status, view)}
        deadline={view.phase === 'play' ? formatDeadline(deadlineLeft) : undefined}
        onClaimTimeout={claim?.onClaim}
        timeoutExplanation={claim?.explanation}
        ended={view.phase !== 'play'}
      />
      <div class="game-chrome">
        {attested !== null && (
          <p class="muted game-attested" role="status">
            {attested}
          </p>
        )}
        {ctl.canResign.value && view.phase === 'play' && (
          <ResignButton
            explanation={resignExplanation(view)}
            busy={busy}
            onResign={() => void ctl.resign()}
          />
        )}
        {sendAnyway !== null && <SendAnyway onSend={sendAnyway} />}
        <SyncNotes lines={log} />
      </div>
    </>
  );
}
