/*
 * Settings → "Name and picture" (D040): the player's kind 0 name, about line and picture. A picture comes from
 * an uploaded photo, the preset gallery (both stored on the Blossom picture server) or a pasted link.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EncodedAvatar } from './avatar-image.ts';
import { photoToAvatar, presetToAvatar } from './avatar-image.ts';
import { PRESETS, type Preset, presetDataUrl } from './avatar-model.ts';
import { type FetchLike, uploadBlob } from './blossom.ts';
import { Avatar } from './components/avatar.tsx';
import { useApp } from './context.ts';
import {
  charCount,
  cleanText,
  editedFields,
  MAX_ABOUT,
  MAX_PROFILE_NAME,
  otherAppHandle,
  type ProfileField,
  safeImageUrl,
  validateProfileForm,
} from './profile-model.ts';
import { type UnconfirmedReason, useProfile, useProfiles } from './profiles.ts';

export type PictureMode = 'upload' | 'gallery' | 'link';

const MODES: { id: PictureMode; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'link', label: 'Link' },
];

type Note = { kind: 'none' } | { kind: 'status'; text: string } | { kind: 'error'; text: string };

/** What the "Replace your profile?" step says, by why the save stopped. */
export const OVERWRITE_TEXT: Record<UnconfirmedReason, string> = {
  'no-answer':
    'None of your relays answered, so your current profile could not be loaded. Saving now may replace a profile you set up in another app, with its about text and other details.',
  timeout:
    'Not every relay answered in time, so your newest profile may not have loaded. Saving now may replace details set in another app.',
  'none-found':
    'No profile for this key was found on your relays. If you set one up in another app, add that app\u2019s relays in Settings first: saving now creates a new profile that other apps may show instead of that one.',
  'newer-known':
    'This browser has seen a newer version of your profile than your relays returned, perhaps on a relay you no longer use. Saving now replaces it, and details only it holds are lost.',
};

const browserFetch: FetchLike = (url, init) => fetch(url, { ...init, body: init.body as BodyInit });

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function ProfileSection() {
  const { signer, settings, deps } = useApp();
  const store = useProfiles();
  const entry = useProfile(signer.pubkey);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [picture, setPicture] = useState('');
  const [dirty, setDirty] = useState<ReadonlySet<ProfileField>>(new Set());
  const [mode, setMode] = useState<PictureMode>('upload');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'none' | 'picture' | 'save'>('none');
  const [note, setNote] = useState<Note>({ kind: 'none' });
  const [confirming, setConfirming] = useState<UnconfirmedReason | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const touched = dirty.size > 0;
  const [server, setServer] = useState(settings.blossom.value);

  // Fill the form from the published profile once it arrives, unless the player has started editing.
  const info = entry.info;
  useEffect(() => {
    if (touched || info === null) return;
    setName(info.name ?? '');
    setAbout(info.about ?? '');
    setPicture(info.picture ?? '');
  }, [info, touched]);

  // Move focus into the confirm step when it appears, onto Cancel, so Enter never overwrites by accident.
  useEffect(() => {
    if (confirming !== null) confirmRef.current?.focus();
  }, [confirming]);

  /** A setter that also marks `field` as edited: only edited fields are saved. */
  const edit = (field: ProfileField, f: (v: string) => void) => (v: string) => {
    setDirty((d) => new Set([...d, field]));
    setConfirming(null);
    if (field === 'picture') setPreset(null);
    f(v);
  };

  const upload = async (make: () => Promise<EncodedAvatar>, what: string, presetId: string | null = null) => {
    if (busy !== 'none') return;
    setBusy('picture');
    setNote({ kind: 'status', text: `Preparing ${what}…` });
    try {
      const img = await make();
      setNote({ kind: 'status', text: `Uploading to ${hostOf(settings.blossom.value)}…` });
      const d = await uploadBlob({
        server: settings.blossom.value,
        bytes: img.bytes,
        type: img.type,
        sign: (t) => signer.sign(t),
        now: deps.now(),
        fetch: browserFetch,
      });
      edit('picture', setPicture)(d.url);
      setPreset(presetId);
      setNote({ kind: 'status', text: 'Picture ready. Save to show it to other players.' });
    } catch (e) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : 'Could not upload the picture.' });
    } finally {
      setBusy('none');
    }
  };

  const useLink = () => {
    const url = safeImageUrl(link);
    if (url === null) {
      setNote({ kind: 'error', text: 'Use an image link starting with https:// on a public website.' });
      return;
    }
    edit('picture', setPicture)(url);
    setNote({ kind: 'status', text: 'Picture ready. Save to show it to other players.' });
  };

  const save = async (overwrite: boolean) => {
    if (busy !== 'none') return;
    if (!touched) {
      setNote({ kind: 'status', text: 'Nothing to save: change your name, about or picture first.' });
      return;
    }
    const check = validateProfileForm(editedFields({ name, about, picture }, dirty));
    if (!check.ok) {
      setNote({ kind: 'error', text: Object.values(check.errors).join(' ') });
      return;
    }
    setBusy('save');
    setConfirming(null);
    setNote({ kind: 'status', text: 'Saving…' });
    try {
      const r = await store.save(signer, settings.relays.value, check.changes, { overwrite });
      if (r.status === 'unconfirmed') {
        setConfirming(r.reason);
        setNote({ kind: 'none' });
      } else {
        setDirty(new Set());
        setNote({ kind: 'status', text: 'Saved. Other players see it on their next visit.' });
      }
    } catch (e) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : 'Could not save your profile.' });
    } finally {
      setBusy('none');
    }
  };

  const nameLen = charCount(cleanText(name));
  const aboutLen = charCount(cleanText(about));
  const preview = safeImageUrl(picture);
  // Clearing the name keeps a different handle another app set, and that handle is then shown.
  const keptHandle =
    dirty.has('name') && cleanText(name) === ''
      ? otherAppHandle(store.latestEvent(signer.pubkey)?.content ?? null)
      : null;

  return (
    <section aria-labelledby="profile-h" class="profile-section">
      <h3 id="profile-h">Name and picture</h3>
      <p class="muted">
        Other players see these beside your public key. They are published to your relays as your NOSTR
        profile, so other NOSTR apps show them too.
      </p>
      {!entry.loaded && <p class="hint">Loading your profile from your relays…</p>}

      <div class="field">
        <label for="profile-name">Name</label>
        <input
          id="profile-name"
          type="text"
          autocomplete="nickname"
          value={name}
          aria-invalid={nameLen > MAX_PROFILE_NAME}
          aria-describedby="profile-name-count"
          onInput={(e) => edit('name', setName)(e.currentTarget.value)}
        />
        <p id="profile-name-count" class={nameLen > MAX_PROFILE_NAME ? 'hint error' : 'hint'}>
          {nameLen} of {MAX_PROFILE_NAME} characters
        </p>
        {keptHandle !== null && (
          <p class="hint">
            "{keptHandle}", the name another app set, stays in your profile and will be shown instead.
          </p>
        )}
      </div>

      <div class="field">
        <label for="profile-about">About</label>
        <textarea
          id="profile-about"
          class="prose"
          rows={2}
          value={about}
          aria-invalid={aboutLen > MAX_ABOUT}
          aria-describedby="profile-about-count"
          onInput={(e) => edit('about', setAbout)(e.currentTarget.value)}
        />
        <p id="profile-about-count" class={aboutLen > MAX_ABOUT ? 'hint error' : 'hint'}>
          {aboutLen} of {MAX_ABOUT} characters
        </p>
      </div>

      <fieldset class="field picture-field" disabled={busy === 'save'}>
        <legend>Picture</legend>
        <div class="picture-row">
          <Avatar pubkey={signer.pubkey} picture={preview} size={64} alt="Your picture" />
          <div class="picture-side">
            <fieldset class="segmented">
              <legend class="sr-only">Picture source</legend>
              {MODES.map((m) => (
                <label key={m.id} class="seg">
                  <input
                    type="radio"
                    name="picture-source"
                    class="sr-only"
                    checked={mode === m.id}
                    onChange={() => setMode(m.id)}
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </fieldset>
            {preview !== null ? (
              <button
                type="button"
                class="btn btn-small"
                disabled={busy !== 'none'}
                onClick={() => {
                  edit('picture', setPicture)('');
                  setNote({ kind: 'status', text: 'Picture removed. Save to update your profile.' });
                }}
              >
                Remove picture
              </button>
            ) : (
              <span class="hint">Without a picture, your pattern shows.</span>
            )}
          </div>
        </div>

        {mode === 'upload' && (
          <div class="picture-panel">
            <label class="btn file-btn">
              {busy === 'picture' ? 'Working…' : 'Choose a photo'}
              <input
                type="file"
                accept="image/*"
                class="sr-only"
                disabled={busy !== 'none'}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (file !== undefined) void upload(() => photoToAvatar(file), 'your photo');
                }}
              />
            </label>
            <p class="hint">
              Cropped to a square, resized to 256 pixels and stripped of its metadata (such as location), then
              stored on {hostOf(settings.blossom.value)}. Anyone with the link can see it.
            </p>
          </div>
        )}

        {mode === 'gallery' && (
          <div class="picture-panel">
            <ul class="gallery">
              {PRESETS.map((p: Preset) => (
                <li key={p.id}>
                  <button
                    type="button"
                    class="gallery-item"
                    disabled={busy !== 'none'}
                    aria-pressed={preset === p.id}
                    onClick={() => void upload(() => presetToAvatar(p), `the ${p.label.toLowerCase()}`, p.id)}
                  >
                    <img src={presetDataUrl(p)} alt="" width={48} height={48} />
                    <span>{p.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p class="hint">A chosen picture is stored on {hostOf(settings.blossom.value)} like a photo.</p>
          </div>
        )}

        {mode === 'link' && (
          <div class="picture-panel">
            <div class="row">
              <label class="grow">
                <span class="sr-only">Image link</span>
                <input
                  type="text"
                  inputMode="url"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  placeholder="https://example.com/me.jpg"
                  value={link}
                  onInput={(e) => setLink(e.currentTarget.value)}
                />
              </label>
              <button type="button" class="btn" onClick={useLink}>
                Use link
              </button>
            </div>
            <p class="hint">Only https links on public websites are shown.</p>
          </div>
        )}

        <details class="server-details">
          <summary>Picture server</summary>
          <div class="row">
            <label class="grow">
              <span class="sr-only">Picture server (Blossom)</span>
              <input
                type="text"
                inputMode="url"
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                value={server}
                onInput={(e) => setServer(e.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              class="btn btn-small"
              onClick={() => {
                settings.setBlossom(server);
                setServer(settings.blossom.value);
              }}
            >
              Save server
            </button>
          </div>
          <p class="hint">
            A Blossom server that accepts uploads from this page. An invalid address restores the default.
          </p>
        </details>
      </fieldset>

      {confirming !== null && (
        <div class="confirm" role="alertdialog" aria-labelledby="overwrite-h" aria-describedby="overwrite-p">
          <h4 id="overwrite-h">Replace your profile?</h4>
          <p id="overwrite-p">{OVERWRITE_TEXT[confirming]}</p>
          <div class="row">
            <button type="button" class="btn btn-primary" onClick={() => void save(true)}>
              Save anyway
            </button>
            <button ref={confirmRef} type="button" class="btn" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div class="row">
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy !== 'none'}
          onClick={() => void save(false)}
        >
          {busy === 'save' ? 'Saving…' : 'Save name and picture'}
        </button>
      </div>
      <p role="status" class="muted">
        {note.kind === 'status' ? note.text : ''}
      </p>
      <p role="alert" class="error">
        {note.kind === 'error' ? note.text : ''}
      </p>
    </section>
  );
}
