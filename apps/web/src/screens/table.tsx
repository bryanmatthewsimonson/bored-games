/*
 * The Table route (#/t/<creatorHex>/<tableId>): the lobby of one table. It shows the seats, lets an eligible
 * visitor join, lets the creator start a full table, and moves everyone to the game once a root exists.
 */
import type { LobbyView } from '@bored-games/client';
import type { Hex } from '@bored-games/protocol';
import { useEffect, useState } from 'preact/hooks';
import { PlayerTag } from '../components/avatar.tsx';
import { StatusChip } from '../components/chips.tsx';
import { JoinBackup } from '../components/join-backup.tsx';
import { useApp } from '../context.ts';
import { gameTitle } from '../game-names.ts';
import { CopyButton } from '../header.tsx';
import { joinBackupNeeded } from '../identity.ts';
import { OTHER_KEY_TABLE } from '../lobby-controller.ts';
import { useLobby } from '../lobby-hooks.ts';
import {
  attentionBadge,
  deadlineLabel,
  defaultPicks,
  freeOpenSeats,
  joinCheck,
  joinRequestPending,
  needsPicker,
  openCandidates,
  REQUEST_PENDING,
  seatListFor,
  seatRows,
  shareUrl,
  tableChip,
} from '../lobby-model.ts';
import { activeGame, gameHref, homeHref } from '../router.ts';
import { requestPersistenceOnce, storageManager, tableIsMine } from '../storage.ts';

const KIND_LABEL = { creator: 'Creator', invited: 'Invited', open: 'Open seat' } as const;

function Seats(props: { view: LobbyView; me: Hex }) {
  const rows = seatRows(props.view, props.me);
  return (
    <ol class="seat-list">
      {rows.map((r, i) => (
        <li key={`${r.kind}:${r.npub ?? i}`} class={r.joined ? 'seat joined' : 'seat waiting'}>
          <span class="seat-kind">{KIND_LABEL[r.kind]}</span>
          <span class="seat-who">
            {r.npub !== null ? (
              <PlayerTag pubkey={r.npub} isMe={r.isMe} size={32} />
            ) : (
              <span class="muted">Anyone can take this seat</span>
            )}
          </span>
          <span class={r.joined ? 'chip chip-joined' : 'chip chip-waiting'}>
            {r.joined ? 'Joined' : 'Waiting'}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The creator's choice among more open joiners than seats. */
function Picker(props: {
  view: LobbyView;
  picks: readonly Hex[];
  onChange: (picks: Hex[]) => void;
  disabled: boolean;
}) {
  const { view, picks } = props;
  const want = view.table.open;
  const toggle = (npub: Hex) =>
    props.onChange(picks.includes(npub) ? picks.filter((p) => p !== npub) : [...picks, npub]);
  return (
    <fieldset class="picker" disabled={props.disabled}>
      <legend>
        Choose {want} of {openCandidates(view).length} players for the open {want === 1 ? 'seat' : 'seats'}
      </legend>
      {openCandidates(view).map((c) => {
        const on = picks.includes(c.npub);
        return (
          <label key={c.npub} class="check">
            <input
              type="checkbox"
              checked={on}
              disabled={!on && picks.length >= want}
              onChange={() => toggle(c.npub)}
            />
            <PlayerTag pubkey={c.npub} />
          </label>
        );
      })}
      <p class="hint">
        {picks.length} of {want} chosen
      </p>
    </fieldset>
  );
}

export function TableScreen(props: { creator: string; tableId: string }) {
  const { deps, signer, profile, store } = useApp();
  const lobby = useLobby();
  const me = signer.pubkey;
  const address = `37450:${props.creator}:${props.tableId}`;
  const view = lobby.table(address).value;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  // "Copy your secret key first?" before a join with a key never backed up (D057).
  const [askBackup, setAskBackup] = useState(false);
  const [picks, setPicks] = useState<Hex[] | null>(null);
  const [searchedLong, setSearchedLong] = useState(false);
  // The header's Rules link follows this table's game while the screen is open.
  const tableGame = view?.table.game ?? null;
  useEffect(() => {
    activeGame.value = tableGame;
    return () => {
      activeGame.value = null;
    };
  }, [tableGame]);

  // Once the game exists, everybody at the table goes to it.
  const rootId = view?.root?.id ?? null;
  useEffect(() => {
    if (rootId !== null) window.location.replace(gameHref(rootId));
  }, [rootId]);

  // A table that does not turn up is probably on relays this client does not use.
  useEffect(() => {
    setSearchedLong(false);
    return deps.timers.later(8000, () => setSearchedLong(true));
  }, [deps, address]);

  if (view === null) {
    return (
      <section class="panel" aria-labelledby="table-title" aria-busy={!searchedLong}>
        <h1 id="table-title">Table</h1>
        {searchedLong ? (
          <>
            <p role="status">This table has not turned up on your relays yet.</p>
            <p class="muted">
              Check that the link is complete, or add the relays of whoever sent it in Settings. The page
              keeps looking.
            </p>
          </>
        ) : (
          <p role="status">Looking for this table on your relays…</p>
        )}
        <p>
          <a href={homeHref()}>Back to the start</a>
        </p>
      </section>
    );
  }

  const t = view.table;
  const isCreator = t.creator === me;
  const chip = tableChip(t, view);
  const check = joinCheck(view, me);
  const seated = view.joins.some((j) => j.npub === me);
  const pending = joinRequestPending(view, me);
  // Listed here under another player key (D041): joining with this key would need that key's game keys.
  const otherKey = !tableIsMine(profile, store, address, me);
  const missing = t.seats - view.seatsFilled;
  const picker = needsPicker(view);
  const chosen = picks ?? defaultPicks(view);
  const canStart = isCreator && view.full && view.root === null && t.status === 'open';
  const startReady = !picker || chosen.length === t.open;
  const url = shareUrl(window.location.href, t.creator, t.tableId);

  const run = async (job: () => Promise<unknown>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    setAskBackup(false);
    requestPersistenceOnce(profile, store, storageManager());
    return run(() => lobby.join(address), 'Could not join this table.');
  };
  const askThenJoin = () => {
    if (joinBackupNeeded(profile, store, signer)) setAskBackup(true);
    else void join();
  };
  const start = () =>
    run(async () => {
      const seats = picker ? seatListFor(view, chosen) : null;
      if (picker && seats === null) throw new Error('Those players cannot be seated. Choose again.');
      const id = await lobby.start(address, seats ?? undefined);
      window.location.replace(gameHref(id));
    }, 'Could not start the game.').then(() => setConfirming(false));

  return (
    <div class="stack">
      <section class="panel stack" aria-labelledby="table-title">
        <div class="title-row">
          <h1 id="table-title">{gameTitle(t.game)}</h1>
          <StatusChip chip={chip} />
          {attentionBadge(isCreator ? 'creator' : 'player', chip)?.kind === 'start' && (
            <span class="chip chip-attention chip-start">Ready to start</span>
          )}
        </div>
        <p class="muted">
          {isCreator ? 'You created this table.' : 'Created by'}{' '}
          {!isCreator && <PlayerTag pubkey={t.creator} />}
        </p>

        <h2>Seats</h2>
        <Seats view={view} me={me} />
        <p class="muted" role="status">
          {view.root !== null
            ? 'The game has started.'
            : t.status === 'cancelled'
              ? 'This table was cancelled.'
              : view.full
                ? 'Every seat is taken.'
                : `Waiting for ${missing} more ${missing === 1 ? 'player' : 'players'}.`}
        </p>

        {t.status === 'open' && view.root === null && (
          <div class="stack">
            {otherKey && <p class="warning">{OTHER_KEY_TABLE}</p>}
            {check.eligible && !otherKey && askBackup && (
              <JoinBackup
                busy={busy}
                idBase="join-backup"
                onJoin={() => void join()}
                onCancel={() => setAskBackup(false)}
              />
            )}
            {check.eligible && !otherKey && !askBackup && (
              <div class="row">
                <button type="button" class="btn btn-primary" disabled={busy} onClick={askThenJoin}>
                  {busy ? 'Joining…' : check.reason === 'invited' ? 'Accept invitation' : 'Join this table'}
                </button>
                <span class="muted">
                  {check.reason === 'invited'
                    ? 'You are invited.'
                    : `${freeOpenSeats(view)} open ${freeOpenSeats(view) === 1 ? 'seat' : 'seats'} left.`}
                </span>
              </div>
            )}
            {pending && <p>{REQUEST_PENDING}</p>}
            {!check.eligible && !seated && !isCreator && !pending && check.why !== '' && (
              <p class="muted">{check.why}</p>
            )}
            {seated && !isCreator && (
              <p>
                You are seated.{' '}
                {view.full
                  ? 'Waiting for the creator to start the game.'
                  : 'The game starts once every seat is taken.'}{' '}
                You will be taken to the game when it starts.
              </p>
            )}
            {isCreator && !view.full && <p>Share the link below so players can take the remaining seats.</p>}

            {canStart && !confirming && (
              <div class="row">
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  Start game
                </button>
                <span class="muted">Everyone is here.</span>
              </div>
            )}
            {canStart && confirming && (
              <section class="confirm" aria-labelledby="confirm-h">
                <h3 id="confirm-h">Start the game now?</h3>
                <p>The {t.seats} seats are fixed once the game starts, and nobody can join afterwards.</p>
                {picker && <Picker view={view} picks={chosen} onChange={setPicks} disabled={busy} />}
                <div class="row">
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled={busy || !startReady}
                    onClick={() => void start()}
                  >
                    {busy ? 'Starting…' : 'Yes, start the game'}
                  </button>
                  <button type="button" class="btn" disabled={busy} onClick={() => setConfirming(false)}>
                    Not yet
                  </button>
                </div>
              </section>
            )}
          </div>
        )}
        {error !== '' && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section class="panel stack" aria-labelledby="share-h">
        <h2 id="share-h">Share this table</h2>
        <p class="muted">
          Send this link to the players. It leaves out your profile name: profiles are local to this browser.
        </p>
        <div class="row">
          <label class="grow">
            <span class="sr-only">Table link</span>
            <input type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <CopyButton text={url} label="Copy share link" />
        </div>
      </section>

      <section class="panel" aria-labelledby="details-h">
        <h2 id="details-h">Details</h2>
        <dl class="facts">
          <dt>Players</dt>
          <dd>{t.seats} seats</dd>
          <dt>Time per move</dt>
          <dd>{deadlineLabel(t.deadline)}</dd>
          <dt>Relays</dt>
          <dd>
            <ul class="plain">
              {t.relays.map((r) => (
                <li key={r}>
                  <code>{r}</code>
                </li>
              ))}
            </ul>
          </dd>
        </dl>
      </section>
    </div>
  );
}
