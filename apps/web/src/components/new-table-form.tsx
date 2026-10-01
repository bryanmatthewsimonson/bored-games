import { useMemo, useState } from 'preact/hooks';
import { useApp } from '../context.ts';
import { gameTitle } from '../game-names.ts';
import { splitAddress } from '../lobby-controller.ts';
import { useLobby } from '../lobby-hooks.ts';
import { checkNewTable, DEADLINE_CHOICES, seatOptions } from '../lobby-model.ts';
import { tableHref } from '../router.ts';

/** The New table form: seats, deadline, invited players and the computed open seats. */
export function NewTableForm() {
  const { deps, signer } = useApp();
  const lobby = useLobby();
  const game = [...deps.modules.keys()][0] ?? '';
  const module = deps.modules.get(game);
  const range = useMemo(
    () => (module === undefined ? { min: 3, max: 6 } : module.seatRange(module.defaultRules())),
    [module],
  );
  const [seats, setSeats] = useState(Math.min(Math.max(range.min, 3), range.max));
  const [deadline, setDeadline] = useState(259200);
  const [inviteText, setInviteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = checkNewTable({ seats, deadline, inviteText, me: signer.pubkey, range });
  const valid = check.entries.filter((e) => e.error === null).length;
  const bad = check.entries.filter((e) => e.error !== null).length;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!check.ok || busy || module === undefined) return;
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
        {check.entries.length > 0 && (
          <ul id="invite-list" class="invite-list">
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
        {check.entries.length === 0 && <span id="invite-list" />}
      </div>

      <p class="seat-summary" role="status">
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
      <div class="row">
        <button type="submit" class="btn btn-primary" disabled={!check.ok || busy}>
          {busy ? 'Creating…' : 'Create table'}
        </button>
      </div>
    </form>
  );
}
