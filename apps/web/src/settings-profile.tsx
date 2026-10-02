/*
 * Settings → "Name and picture" (D040): the player's kind 0 name, about line and picture. A picture comes from
 * an uploaded photo, the preset gallery (both stored on the Blossom picture server) or a pasted link.
 */
import { useEffect, useState } from 'preact/hooks';
import type { EncodedAvatar } from './avatar-image.ts';
import { photoToAvatar, presetToAvatar } from './avatar-image.ts';
import { PRESETS, type Preset, presetDataUrl } from './avatar-model.ts';
import { type FetchLike, uploadBlob } from './blossom.ts';
import { Avatar } from './components/avatar.tsx';
import { useApp } from './context.ts';
import {
  charCount,
  cleanText,
  MAX_ABOUT,
  MAX_PROFILE_NAME,
  safeImageUrl,
  validateProfileForm,
} from './profile-model.ts';
import { useProfile, useProfiles } from './profiles.ts';

export type PictureMode = 'upload' | 'gallery' | 'link';

const MODES: { id: PictureMode; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'link', label: 'Link' },
];

type Note = { kind: 'none' } | { kind: 'status'; text: string } | { kind: 'error'; text: string };

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
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<PictureMode>('upload');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'none' | 'picture' | 'save'>('none');
  const [note, setNote] = useState<Note>({ kind: 'none' });
  const [confirming, setConfirming] = useState(false);
  const [server, setServer] = useState(settings.blossom.value);

  // Fill the form from the published profile once it arrives, unless the player has started editing.
  const info = entry.info;
  useEffect(() => {
    if (touched || info === null) return;
    setName(info.name ?? '');
    setAbout(info.about ?? '');
    setPicture(info.picture ?? '');
  }, [info, touched]);

  const edit = (f: (v: string) => void) => (v: string) => {
    setTouched(true);
    setConfirming(false);
    f(v);
  };

  const upload = async (make: () => Promise<EncodedAvatar>, what: string) => {
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
      edit(setPicture)(d.url);
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
    edit(setPicture)(url);
    setNote({ kind: 'status', text: 'Picture ready. Save to show it to other players.' });
  };

  const save = async (overwrite: boolean) => {
    if (busy !== 'none') return;
    const check = validateProfileForm({ name, about, picture });
    if (!check.ok) {
      setNote({ kind: 'error', text: Object.values(check.errors).join(' ') });
      return;
    }
    setBusy('save');
    setConfirming(false);
    setNote({ kind: 'status', text: 'Saving…' });
    try {
      const r = await store.save(signer, settings.relays.value, check.changes, { overwrite });
      if (r.status === 'unconfirmed') {
        setConfirming(true);
        setNote({ kind: 'none' });
      } else {
        setTouched(false);
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
          onInput={(e) => edit(setName)(e.currentTarget.value)}
        />
        <p id="profile-name-count" class={nameLen > MAX_PROFILE_NAME ? 'hint error' : 'hint'}>
          {nameLen} of {MAX_PROFILE_NAME} characters
        </p>
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
          onInput={(e) => edit(setAbout)(e.currentTarget.value)}
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
                <button
                  key={m.id}
                  type="button"
                  class="btn btn-small"
                  aria-pressed={mode === m.id}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </fieldset>
            {preview !== null ? (
              <button
                type="button"
                class="btn btn-small"
                disabled={busy !== 'none'}
                onClick={() => {
                  edit(setPicture)('');
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
                    onClick={() => void upload(() => presetToAvatar(p), `the ${p.label.toLowerCase()}`)}
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

      {confirming && (
        <div class="confirm" role="alertdialog" aria-labelledby="overwrite-h">
          <h4 id="overwrite-h">Replace your profile?</h4>
          <p>
            Your current profile did not load from your relays. Saving now may replace a profile you set up in
            another app, such as its about text.
          </p>
          <div class="row">
            <button type="button" class="btn btn-primary" onClick={() => void save(true)}>
              Save anyway
            </button>
            <button type="button" class="btn" onClick={() => setConfirming(false)}>
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
