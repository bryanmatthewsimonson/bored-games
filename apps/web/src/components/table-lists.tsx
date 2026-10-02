/*
 * The two table lists of Home and of a game's page: the player's own tables and games, and the open tables they
 * may join. A game's page passes only that game's tables.
 *
 * Filtering by game is client-side: relays index only single-letter tags, so a subscription cannot ask for one
 * game's tables (the `game` tag); the lobby fetches every open table and the page keeps the ones it shows.
 */
import type { Hex } from '@bored-games/protocol';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useApp } from '../context.ts';
import type { MyTable, TableEntry } from '../lobby-controller.ts';
import { useLobby } from '../lobby-hooks.ts';
import { attentionBadge, cardGameStatus, joinButtonLabel, joinCheck, tableChip } from '../lobby-model.ts';
import { gameHref, tableHref } from '../router.ts';
import { requestPersistenceOnce, storageManager } from '../storage.ts';
import { TableCard } from './table-card.tsx';

/** A listed table of another player key this profile used (D041). */
export const OTHER_KEY_DETAIL = 'Under another key: switch to it in Settings to play';

/** The open tables `me` can still sit at: not mine, not joined, and open to all or inviting me. */
export function joinableTables(
  open: readonly TableEntry[],
  mine: readonly MyTable[],
  me: Hex,
  game: string | null = null,
): TableEntry[] {
  const mineAddresses = new Set(mine.map((t) => t.address));
  return open.filter(
    (t) =>
      (game === null || t.table.game === game) &&
      !mineAddresses.has(t.address) &&
      t.table.creator !== me &&
      (t.table.open > 0 || t.table.invited.includes(me)),
  );
}

export function MyTables(props: { tables: readonly MyTable[]; empty: ComponentChildren }) {
  const lobby = useLobby();
  if (props.tables.length === 0) return <p class="empty">{props.empty}</p>;
  return (
    <ul class="cards">
      {[...props.tables]
        .sort((a, b) => Number(a.otherKey) - Number(b.otherKey))
        .map((t) => {
          // A started game's status comes from what its game screen saved; Home never runs a game session.
          const started = t.rootId !== null || t.table.status === 'started';
          const known =
            started && t.table.status !== 'cancelled'
              ? cardGameStatus(t.rootId === null ? null : lobby.gameStatus(t.rootId), lobby.now())
              : { status: null, check: false };
          const chip = tableChip(t.table, t.lobby, known.status);
          const seated = t.lobby === null ? null : `${t.lobby.seatsFilled} of ${t.table.seats} seated`;
          return (
            <TableCard
              key={t.address}
              href={t.rootId !== null ? gameHref(t.rootId) : tableHref(t.table.creator, t.table.tableId)}
              game={t.table.game}
              seats={t.table.seats}
              deadline={t.table.deadline}
              creator={t.table.creator}
              isCreator={t.role === 'creator'}
              chip={chip}
              badge={t.otherKey ? null : attentionBadge(t.role, chip, known.status)}
              detail={t.otherKey ? OTHER_KEY_DETAIL : known.check ? 'Open to check' : seated}
              action={
                <a
                  class="btn btn-small"
                  href={t.rootId !== null ? gameHref(t.rootId) : tableHref(t.table.creator, t.table.tableId)}
                >
                  {t.rootId !== null ? 'Open game' : 'Open table'}
                </a>
              }
            />
          );
        })}
    </ul>
  );
}

export function OpenTables(props: { tables: readonly TableEntry[]; me: Hex; empty: ComponentChildren }) {
  const { profile, store } = useApp();
  const lobby = useLobby();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ address: string; message: string } | null>(null);

  const join = async (t: TableEntry) => {
    if (busy !== null) return;
    requestPersistenceOnce(profile, store, storageManager());
    setBusy(t.address);
    setError(null);
    try {
      const view = await lobby.lobbyOf(t.address);
      const check = joinCheck(view, props.me);
      if (view !== null && !check.eligible && check.why !== '') throw new Error(check.why);
      await lobby.join(t.address);
      window.location.hash = tableHref(t.table.creator, t.table.tableId);
    } catch (e) {
      setError({ address: t.address, message: e instanceof Error ? e.message : 'Could not join.' });
    } finally {
      setBusy(null);
    }
  };

  if (lobby.loading.value && props.tables.length === 0) return <p class="empty">Looking for open tables…</p>;
  if (props.tables.length === 0) return <p class="empty">{props.empty}</p>;
  return (
    <ul class="cards">
      {props.tables.map((t) => {
        const invitedMe = t.table.invited.includes(props.me);
        const free = t.table.open;
        const failure = error?.address === t.address ? error.message : null;
        const label = busy === t.address ? 'Joining…' : invitedMe ? 'Accept invitation' : 'Join';
        return (
          <TableCard
            key={t.address}
            href={tableHref(t.table.creator, t.table.tableId)}
            game={t.table.game}
            seats={t.table.seats}
            deadline={t.table.deadline}
            creator={t.table.creator}
            isCreator={false}
            chip="open"
            badge={null}
            detail={invitedMe ? 'You are invited' : `up to ${free} open ${free === 1 ? 'seat' : 'seats'}`}
            action={
              <>
                <button
                  type="button"
                  class="btn btn-small btn-primary"
                  disabled={busy !== null}
                  aria-label={joinButtonLabel(label, t.table.creator)}
                  onClick={() => void join(t)}
                >
                  {label}
                </button>
                {failure !== null && (
                  <span class="error" role="alert">
                    {failure}
                  </span>
                )}
              </>
            }
          />
        );
      })}
    </ul>
  );
}
