/*
 * The Home route (#/): the New table form, the player's own tables and games, and the open tables to join.
 */
import { BRAND } from '@bored-games/brand';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import type { Hex } from '@bored-games/protocol';
import { useState } from 'preact/hooks';
import { Avatar } from '../components/avatar.tsx';
import { NewTableForm } from '../components/new-table-form.tsx';
import { TableCard } from '../components/table-card.tsx';
import { useApp } from '../context.ts';
import { backupReminderVisible, markBackedUp } from '../identity.ts';
import type { MyTable, TableEntry } from '../lobby-controller.ts';
import { useLobby } from '../lobby-hooks.ts';
import { attentionBadge, cardGameStatus, joinButtonLabel, joinCheck, tableChip } from '../lobby-model.ts';
import { profileNudgeVisible } from '../profile-model.ts';
import { useProfile } from '../profiles.ts';
import { gameHref, tableHref } from '../router.ts';
import { readItem, requestPersistenceOnce, storageKey, storageManager, writeItem } from '../storage.ts';

/** A listed table of another player key this profile used (D041). */
export const OTHER_KEY_DETAIL = 'Under another key: switch to it in Settings to play';

/** Storage name of the dismissed profile nudge. */
export const NUDGE_DISMISSED = 'nudge-profile';

/** "Back up your key", for a local key with a table, until the nsec is copied or the player says it is saved. */
function BackupReminder() {
  const { signer, store, profile, settingsOpen } = useApp();
  const lobby = useLobby();
  const [, setSaved] = useState(false);
  // Read so that a new table, or closing Settings after copying the key, renders this again.
  void lobby.myTables.value;
  void settingsOpen.value;
  if (!backupReminderVisible(profile, store, signer)) return null;
  return (
    <section class="panel warning backup" aria-labelledby="backup-h">
      <h2 id="backup-h">Back up your key</h2>
      <p>
        Your seats belong to a secret key kept only in this browser. If this site's data is cleared, or you
        move to another device, you need the key to play your games. Copy it from Settings and keep it
        somewhere safe, such as a password manager.
      </p>
      <div class="row">
        <button type="button" class="btn btn-primary" onClick={() => (settingsOpen.value = true)}>
          Open Settings to copy it
        </button>
        <label class="check">
          <input
            type="checkbox"
            onChange={(e) => {
              if (e.currentTarget.checked && markBackedUp(profile, store, signer.pubkey)) setSaved(true);
            }}
          />
          I've saved it
        </label>
      </div>
    </section>
  );
}

/** "Add your name and picture", once the player's profile has loaded without a name. */
function ProfileNudge() {
  const { signer, store, profile, settingsOpen } = useApp();
  const me = useProfile(signer.pubkey);
  const key = storageKey(profile, NUDGE_DISMISSED);
  const [dismissed, setDismissed] = useState(() => readItem(store, key) === '1');
  if (!profileNudgeVisible(me, dismissed)) return null;
  return (
    <section class="panel nudge" aria-label="Your name and picture">
      <Avatar pubkey={signer.pubkey} picture={null} size={48} />
      <div class="nudge-body">
        <p>
          <strong>Add your name and picture so friends recognize you.</strong> Until then, other players see
          only your public key and this pattern.
        </p>
        <div class="row">
          <button type="button" class="btn btn-primary" onClick={() => (settingsOpen.value = true)}>
            Add name and picture
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => {
              writeItem(store, key, '1');
              setDismissed(true);
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}

function MyTables(props: { tables: readonly MyTable[] }) {
  const lobby = useLobby();
  if (props.tables.length === 0)
    return (
      <p class="empty">
        No games yet. Create a table above, or join one from the list below or from a link a friend sent you.
      </p>
    );
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

function OpenTables(props: { tables: readonly TableEntry[]; me: Hex }) {
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
  if (props.tables.length === 0)
    return <p class="empty">No open tables right now. Create one above and share its link with friends.</p>;
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

export function HomeScreen() {
  const { signer } = useApp();
  const lobby = useLobby();
  const me = signer.pubkey;
  const mine = lobby.myTables.value;
  const mineAddresses = new Set(mine.map((t) => t.address));
  // Open tables I can still sit at: not mine, not already joined, and either open to all or inviting me.
  const open = lobby.openTables.value.filter(
    (t) =>
      !mineAddresses.has(t.address) &&
      t.table.creator !== me &&
      (t.table.open > 0 || t.table.invited.includes(me)),
  );
  return (
    <div class="home stack">
      <section class="panel hero" aria-labelledby="home-title">
        <h1 id="home-title">
          {BRAND.name}: {CHAIN_REACTION_THEME.title}
        </h1>
        <p class="lede">{CHAIN_REACTION_THEME.tagline}</p>
        <p class="muted">{BRAND.tagline}</p>
      </section>

      <BackupReminder />
      <ProfileNudge />

      <div class={mine.length > 0 ? 'home-grid lists-first' : 'home-grid'}>
        <div class="stack">
          <NewTableForm />
          <section class="panel" aria-labelledby="how-h">
            <h2 id="how-h">How it works</h2>
            <ul class="plain">
              <li>Games are played at your own pace: your turn may come hours later.</li>
              <li>Come back whenever you like; the table waits for you.</li>
              <li>
                Keep this browser profile: your player key and each game's secrets are stored here. Clearing
                site data loses your seat.
              </li>
            </ul>
          </section>
        </div>

        <div class="stack home-lists">
          <section class="panel" aria-labelledby="mine-h">
            <h2 id="mine-h">Your games</h2>
            <MyTables tables={mine} />
          </section>
          <section class="panel" aria-labelledby="open-h">
            <h2 id="open-h">Open tables</h2>
            <OpenTables tables={open} me={me} />
          </section>
        </div>
      </div>
    </div>
  );
}
