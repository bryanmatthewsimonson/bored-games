/*
 * The Game route (#/g/<rootId>): one GameController for the life of the screen. The screen is generic (D045): it
 * shows the setup progress, the chrome every game shares (warnings, the result line, Resign) and dispatches the
 * play area to the registry's component for the table's game. The controller performs the automatic duties; the
 * player's decisions go to `act`.
 */
import type { SessionView, SessionViewV2 } from '@bored-games/client';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { npubEncode, shortNpub } from '../bech32.ts';
import { Avatar } from '../components/avatar.tsx';
import { ClaimTimeout } from '../components/claim-timeout.tsx';
import { BackupOffer, RestoreNotice } from '../components/key-backup.tsx';
import { RecoveredNotice, WatchingNotice } from '../components/watching.tsx';
import { useApp } from '../context.ts';
import { GameController, type GameStatus } from '../game-controller.ts';
import { gameTitle } from '../game-names.ts';
import { shareWordsOf, webGame } from '../games/registry.ts';
import type { Audit, SetupCopy } from '../games/types.ts';
import { keptKeys, switchToKeptKey } from '../identity.ts';
import type { ProfileInfo } from '../profile-model.ts';
import { usePlayerProfiles } from '../profiles.ts';
import { activeGame, homeHref } from '../router.ts';
import { formatDeadline, listNames, owedWords, ownRevealLine, waitingLine } from '../waiting-model.ts';
import { localTableRecord, myTableCount, type WatchNotice, watchNotice } from '../watch-model.ts';

export { formatDeadline } from '../waiting-model.ts';

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
  // Protocol 2: nothing is attested while a fork is held, a stop or a result standing against it (V2-38).
  if (v2Of(view)?.fork != null) return null;
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

/** The protocol 2 view (PROTOCOL-v2 §5–§8), or null for a protocol 1 game or none. */
export function v2Of(view: SessionView | null): SessionViewV2 | null {
  return (view as { proto?: unknown } | null)?.proto === 2 ? (view as SessionViewV2) : null;
}

const seatName = (names: readonly string[], seat: number): string => names[seat] ?? `Seat ${seat + 1}`;

/**
 * The line for a game stopped at a fork (PROTOCOL-v2 §5.6, §7.5), or null: who forked (E), every other equivocator,
 * and the final places with E last. With 3 or more players only the shared last places (the equivocators, and any
 * seat a proven audit failure demoted) count toward ratings: "unrated for the others". A stop before the first game
 * action is a cancel (`cancelledText`).
 */
export function stopLine(view: SessionView | null, names: readonly string[]): string | null {
  const v = v2Of(view);
  const stop = v?.stop ?? null;
  if (v === null || stop === null || stop.cancelled || v.result !== null || v.outcome === null) return null;
  const others = v.equivocators.filter((seat) => seat !== stop.seat);
  const also =
    others.length === 0
      ? ''
      : ` ${listNames(others.map((k) => seatName(names, k)))} also signed two rival moves.`;
  const head = `Stopped: ${seatName(names, stop.seat)} signed two rival moves for the same turn, so the game ended there.${also}`;
  const places = `Final places: ${placesText(v, names, stop.seat)}.`;
  if (v.seats < 3) return `${head} ${places}`;
  const rated = [...new Set([...v.equivocators, ...v.forfeits])].sort((a, b) => a - b);
  return `${head} ${places} Rated only for ${listNames(rated.map((k) => seatName(names, k)))}, ranked last; unrated for the others.`;
}

/** "Result stood despite a fork by Ann." for a result standing against a held fork (PROTOCOL-v2 §5.4), or null. */
export function stoodLine(view: SessionView | null, names: readonly string[]): string | null {
  const v = v2Of(view);
  if (v === null || !v.stood || v.fork === null) return null;
  return `Result stood despite a fork by ${seatName(names, v.fork.seat)}.`;
}

/**
 * After a stop in a game with a deck (PROTOCOL-v2 §7.3, V2-55): each seat whose end-of-game secret is not in ("secret
 * withheld", an anti-cheat mark in the game's record), and "audit incomplete" while the end-of-game check cannot run
 * for want of one (the places may still change). Empty otherwise.
 */
export function afterStopLines(view: SessionView | null, names: readonly string[]): string[] {
  const v = v2Of(view);
  if (v === null) return [];
  const out: string[] = [];
  if (v.secretWithheld.length > 0) {
    const who = listNames(v.secretWithheld.map((k) => seatName(names, k)));
    const one = v.secretWithheld.length === 1;
    out.push(
      `Secret withheld: ${who} ${one ? 'has' : 'have'} not sent their end-of-game secret. Each one missing is recorded against that player.`,
    );
  }
  if (v.auditIncomplete)
    out.push(
      'Audit incomplete: the game cannot be checked without every end-of-game secret, so these places may still change.',
    );
  return out;
}

/** "Game ended, waiting for its events.": a result this device counted before a reload, its events not held yet (D070). */
export function awaitingLine(view: SessionView | null): string | null {
  return v2Of(view)?.awaitingCounted != null ? 'Game ended, waiting for its events.' : null;
}

/** Why a game was cancelled, for the Game cancelled panel. */
export function cancelledText(view: SessionView | null, names: readonly string[]): string {
  const quit = resignedSeats(view);
  if (quit.length > 0)
    return `${quit.map((k) => seatName(names, k)).join(', ')} resigned before the first move, so this game ended without a result.`;
  const stop = v2Of(view)?.stop ?? null;
  if (stop?.cancelled === true) {
    const others = (v2Of(view)?.equivocators ?? []).filter((seat) => seat !== stop.seat);
    const also =
      others.length === 0
        ? ''
        : ` ${listNames(others.map((k) => seatName(names, k)))} also signed two rival moves.`;
    return `${seatName(names, stop.seat)} signed two rival moves before the first move, so this game was cancelled without a result.${also}`;
  }
  return 'A player stalled before the first move, so this game ended without a result.';
}

/**
 * The own-forfeit question to show (PROTOCOL-v2 §8.1, review N2, V2-52), or null: the session asks about a Timeout
 * claim that forfeits only this seat (`view.ownForfeit`), unless the player already answered "Play" for that head.
 * Keyed on the head, never on the claim id: a lower-id claim at the same head replaces the one named, so keying on
 * the id would ask again for each one (an opponent fishing for a misclick; review of T12, L-2).
 */
export function ownForfeitAsk(view: SessionView | null, played: string | null): { head: string } | null {
  const asked = v2Of(view)?.ownForfeit ?? null;
  if (asked === null || asked.head === played) return null;
  return { head: asked.head };
}

/**
 * "You were timed out: accept?" (V2-52): another player claims this seat missed the deadline, though by this device's
 * clock it has not passed (`left`, from `formatDeadline`). "Play" comes first and is the default: leaving the
 * question unanswered accepts nothing, and a move made in time makes the claim fail. Accepting forfeits at once.
 */
export function OwnForfeitDialog(props: {
  left: string;
  /** Whether a game action has been played: before one, accepting cancels the game instead. */
  started: boolean;
  busy: boolean;
  onPlay: () => void;
  onAccept: () => void;
}) {
  const accept = props.started
    ? 'If you accept, you forfeit: the game ends now and you are ranked last.'
    : 'If you accept, the game is cancelled without a result.';
  return (
    <section class="claim-confirm own-forfeit" role="alertdialog" aria-labelledby="own-forfeit-h">
      <p id="own-forfeit-h">
        <strong>You were timed out: accept?</strong> Another player claims you missed the move deadline, but
        by this device's clock you still have time ({props.left}). {accept}
      </p>
      <div class="row">
        <button type="button" class="btn btn-small btn-primary" onClick={props.onPlay}>
          Play
        </button>
        <button type="button" class="btn btn-small" disabled={props.busy} onClick={props.onAccept}>
          Accept the timeout
        </button>
      </div>
    </section>
  );
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
  /** The own-forfeit question (`OwnForfeitDialog`), or nothing. */
  ownForfeit: ComponentChildren;
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
      {props.ownForfeit}
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

/**
 * Final places, best first: "1. Ann, 2. Bo", for an ending outside the rules (a resign, a timeout or a stop). `last`,
 * the seat that forked a stopped game, comes after the seats sharing its place.
 */
export function placesText(view: SessionView, names: readonly string[], last: number | null = null): string {
  const o = view.outcome;
  if (o === null) return '';
  return o.places
    .map((place, seat) => ({ place, seat }))
    .sort((a, b) => a.place - b.place || Number(a.seat === last) - Number(b.seat === last) || a.seat - b.seat)
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
  // The head the player answered "Play" for in the own-forfeit question (V2-52): never asked again at that head.
  const [played, setPlayed] = useState<string | null>(null);
  const onSwitch = (pubkey: string) => {
    const r = switchToKeptKey(profile, store, pubkey, { current: signer.pubkey, now: deps.now() });
    if (r.ok) window.location.reload();
    else setSwitchError(r.error);
  };
  // Restoring this seat's game keys from the player's backup, and backing them up from here (D065).
  const restore = ctl.restore.value;
  const backup = ctl.backup.value;
  const watching = (
    <>
      {restore !== null && <RestoreNotice state={restore} onRetry={() => ctl.retryRestore()} />}
      {recovered !== null ? (
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
      )}
      {backup !== null && (
        <BackupOffer state={backup} signer={signer.kind} onBackup={() => void ctl.backupKeys()} />
      )}
    </>
  );
  // A card reveal or a roll contribution owed out of turn (D060, PROTOCOL-v2 §6.4): who owes it and when they can
  // be timed out for it.
  const owed = ctl.owed.value;
  // How this game names it (Chain Reaction: a share of a tile; Luster: a card reveal; a roll: a contribution).
  const shareWords = owedWords(owed, shareWordsOf(game));
  const waiting =
    view === null || status !== 'waiting'
      ? null
      : waitingLine({
          phase: view.phase,
          pending: view.pending,
          mySeat: view.mySeat,
          waiting: ctl.waiting.value,
          names,
          ...(view.phase === 'play' && owed !== null ? { secondsLeft: owed.until - now } : {}),
          share: shareWords,
        });
  // This seat's own reveal, when its app is not sending it right now (held back, stuck or undelivered).
  const ownReveal =
    view === null || status === 'working' ? null : ownRevealLine(owed, view.mySeat, now, shareWords);

  // "You were timed out: accept?" (V2-52), keyed on the head the player answered "Play" for.
  const ask = ownForfeitAsk(view, played);
  const ownForfeit =
    ask === null || view === null ? null : (
      <OwnForfeitDialog
        key={ask.head}
        left={formatDeadline(view.pendingSince + view.deadline - now)}
        started={view.phase !== 'shuffle' && view.phase !== 'deal' && view.head.seq > view.shuffleSteps}
        busy={busy}
        onPlay={() => setPlayed(ask.head)}
        onAccept={() => void ctl.confirmOwnForfeit()}
      />
    );

  if (status === 'cancelled') {
    return (
      <section class="panel" aria-labelledby="game-title">
        <h1 id="game-title">Game cancelled</h1>
        <p>{cancelledText(view, names)}</p>
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
        ownForfeit={ownForfeit}
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
  const stopped = stopLine(view, names);
  const stood = stoodLine(view, names);
  const afterStop = afterStopLines(view, names);
  const awaiting = awaitingLine(view);
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
      {ownReveal !== null && (
        <p class="warning game-owed" role="status">
          {ownReveal}
        </p>
      )}
      {error !== null && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {ownForfeit}
      {awaiting !== null && (
        <p class="muted game-awaiting" role="status">
          {awaiting}
        </p>
      )}
      {stopped !== null && (
        <p class="warning game-stopped" role="status">
          {stopped}
        </p>
      )}
      {stood !== null && (
        <p class="warning game-stood" role="status">
          {stood}
        </p>
      )}
      {afterStop.map((line) => (
        <p key={line} class="warning game-after-stop" role="status">
          {line}
        </p>
      ))}
      {cheats.length > 0 && stopped === null && (
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
