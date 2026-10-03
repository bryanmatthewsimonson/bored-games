import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../context.ts';
import { gameTitle } from '../game-names.ts';
import { joinGate, KEY_NOT_SAVED, keyStillSaved } from '../identity.ts';
import { splitAddress } from '../lobby-controller.ts';
import { useLobby } from '../lobby-hooks.ts';
import { checkNewTable, DEADLINE_CHOICES, seatOptions } from '../lobby-model.ts';
import { tableHref } from '../router.ts';
import { requestPersistenceOnce, storageManager } from '../storage.ts';
import { JoinBackup } from './join-backup.tsx';

/**
 * The New table form on a game's page (D046): seats, deadline, invited players and the computed open seats, for
 * the page's game.
 */
export function NewTableForm(props: { game: string }) {
  const { deps, signer, profile, store, persistent } = useApp();
  const lobby = useLobby();
  const game = props.game;
  const module = deps.modules.get(game);
  const range = useMemo(
    () => (module === undefined ? { min: 2, max: 6 } : module.seatRange(module.defaultRules())),
    [module],
  );
  // The default seat count is the game's smallest table; a new game resets it.
  const [seats, setSeats] = useState(range.min);
  useEffect(() => setSeats(range.min), [range]);
  const [deadline, setDeadline] = useState(259200);
  const [inviteText, setInviteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Before the creator's seat is taken (D057): "Copy your secret key first?", or, when this browser is not saving
  // the key, a copy and a confirm.
  const [ask, setAsk] = useState<'backup' | 'unsaved' | null>(null);

  const check = checkNewTable({ seats, deadline, inviteText, me: signer.pubkey, range });
  const valid = check.entries.filter((e) => e.error === null).length;
  const bad = check.entries.filter((e) => e.error !== null).length;

  const submit = (e: Event) => {
    e.preventDefault();
    if (!check.ok || busy || module === undefined) return;
    const gate = joinGate(profile, store, signer, persistent);
    if (gate.kind === 'refuse') return setError(gate.error);
    if (gate.kind !== 'go') return setAsk(gate.kind);
    void create();
  };

  const create = async () => {
    setAsk(null);
    if (!check.ok || busy || module === undefined) return;
    // Read the stored key again right before the table and its seat are made (D057).
    if (!keyStillSaved(profile, store, signer)) return setError(KEY_NOT_SAVED);
    requestPersistenceOnce(profile, store, storageManager());
    setBusy(true);
    setError('');
    try {
      const address = await lobby.createTable({ seats, deadline, invited: check.invited, game });
      const a = splitAddress(address);
      if (a !== null) window.location.hash = tableHref(a.creator, a.tableId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the table.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="panel stack" onSubmit={submit} aria-labelledby="new-table-h" noValidate>
      <h2 id="new-table-h">New table</h2>
      <p class="muted">A table for {gameTitle(game)}. Nothing is shared until you create it.</p>

      <div class="field">
        <label for="seats">Players</label>
        <select
          id="seats"
          value={seats}
          onChange={(e) => setSeats(Number(e.currentTarget.value))}
          disabled={busy}
        >
          {seatOptions(range).map((n) => (
            <option key={n} value={n}>
              {n} players
            </option>
          ))}
        </select>
      </div>

      <fieldset class="field" disabled={busy}>
        <legend>Time allowed per move</legend>
        <div class="radio-row">
          {DEADLINE_CHOICES.map((c) => (
            <label key={c.seconds} class="radio">
              <input
                type="radio"
                name="deadline"
                value={c.seconds}
                checked={deadline === c.seconds}
                onChange={() => setDeadline(c.seconds)}
              />
              {c.label}
            </label>
          ))}
        </div>
        <p class="hint">After this long, the others can skip a player who has not moved.</p>
      </fieldset>

      <div class="field">
        <label for="invite">Invited players (optional)</label>
        <textarea
          id="invite"
          rows={3}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          placeholder={'npub1…\nnpub1…'}
          value={inviteText}
          aria-invalid={bad > 0}
          aria-describedby="invite-hint invite-list"
          onInput={(e) => setInviteText(e.currentTarget.value)}
          disabled={busy}
        />
        <p id="invite-hint" class="hint">
          Paste npubs or 64-character hex keys, one per line or separated by commas. Invited players keep a
          seat for them.
        </p>
        <div id="invite-list" aria-live="polite">
          {check.entries.length > 0 && (
            <ul class="invite-list">
              {check.entries.map((en, i) => (
                <li key={`${i}:${en.input}`} class={en.error === null ? 'entry ok' : 'entry bad'}>
                  {en.error === null ? (
                    <>
                      <span class="sr-only">Valid: </span>
                      <code>{en.short}</code>
                    </>
                  ) : (
                    <>
                      {en.input !== '' && <code>{en.input}</code>} <span class="error">{en.error}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p class="seat-summary">
        <strong>
          {check.open >= 0
            ? `${check.open} open ${check.open === 1 ? 'seat' : 'seats'}`
            : `${-check.open} too many invited`}
        </strong>
        <span class="muted">
          {' '}
          = {seats} players, you, {valid} invited{bad > 0 ? ` (${bad} to fix)` : ''}
        </span>
      </p>
      {check.errors.map((m) => (
        <p key={m} class="error" role="alert">
          {m}
        </p>
      ))}
      {error !== '' && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {ask !== null ? (
        <JoinBackup
          mode={ask}
          action="create"
          busy={busy}
          idBase="create-backup"
          onJoin={() => void create()}
          onCancel={() => setAsk(null)}
        />
      ) : (
        <div class="row">
          <button type="submit" class="btn btn-primary" disabled={!check.ok || busy}>
            {busy ? 'Creating…' : 'Create table'}
          </button>
        </div>
      )}
    </form>
  );
}
