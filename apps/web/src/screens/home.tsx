/*
 * The Home route (#/): the player's own tables and games, the game catalog (D046), and the open tables of every
 * game. A new table starts from a game's page (#/games/<id>).
 */
import { BRAND } from '@bored-games/brand';
import { useState } from 'preact/hooks';
import { Avatar } from '../components/avatar.tsx';
import { GameCatalog } from '../components/game-catalog.tsx';
import { joinableTables, MyTables, OpenTables } from '../components/table-lists.tsx';
import { useApp } from '../context.ts';
import { backupReminderVisible, markBackedUp } from '../identity.ts';
import { useLobby } from '../lobby-hooks.ts';
import { profileNudgeVisible } from '../profile-model.ts';
import { useProfile } from '../profiles.ts';
import { readItem, storageKey, writeItem } from '../storage.ts';

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

export function HomeScreen() {
  const { signer } = useApp();
  const lobby = useLobby();
  const me = signer.pubkey;
  const mine = lobby.myTables.value;
  const open = joinableTables(lobby.openTables.value, mine, me);
  return (
    <div class="home stack">
      <section class="panel hero" aria-labelledby="home-title">
        <h1 id="home-title">{BRAND.name}</h1>
        <p class="lede">{BRAND.tagline}</p>
      </section>

      <BackupReminder />
      <ProfileNudge />

      <section class="panel" aria-labelledby="mine-h">
        <h2 id="mine-h">Your games</h2>
        <MyTables
          tables={mine}
          empty="No games yet. Pick a game from the catalog below to create a table, or join one from the open tables or from a link a friend sent you."
        />
      </section>

      <GameCatalog />

      <section class="panel" aria-labelledby="open-h">
        <h2 id="open-h">Open tables</h2>
        <OpenTables
          tables={open}
          me={me}
          empty="No open tables right now. Pick a game from the catalog to create one and share its link with friends."
        />
      </section>

      <section class="panel" aria-labelledby="how-h">
        <h2 id="how-h">How it works</h2>
        <ul class="plain">
          <li>Games are played at your own pace: your turn may come hours later.</li>
          <li>Come back whenever you like; the table waits for you.</li>
          <li>
            Keep this browser profile: your player key and each game's secrets are stored here. Clearing site
            data loses your seat.
          </li>
        </ul>
      </section>
    </div>
  );
}
