/*
 * Kind 0 profiles (NIP-01 metadata), pure: reading names and pictures safely, choosing the newest version,
 * merging the player's edits into what is already published, and the per-profile cache kept in storage (D040).
 */
import { type EventTemplate, type Hex, isHex64, type NostrEvent } from '@bored-games/protocol';
import { type KeyValueStore, readJson, storageKey, writeJson } from './storage.ts';

/** The most characters of a profile name shown or saved. */
export const MAX_PROFILE_NAME = 32;
/** The most characters of an "about" line saved from the form. */
export const MAX_ABOUT = 160;
/** The longest picture URL accepted. */
export const MAX_PICTURE_URL = 1024;

/** Letters that render blank (Hangul fillers, the braille blank), so a name made of them would look empty. */
const BLANK_LETTERS = /[\u115f\u1160\u3164\uffa0\u2800]/gu;

/**
 * Control and format characters (bidi overrides, zero-width characters) and blank-looking letters removed, and
 * whitespace collapsed. The zero-width joiner is kept inside a word, so emoji sequences survive.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\s/gu, ' ')
    .replace(/(?!\u200d)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(BLANK_LETTERS, '')
    .replace(/ *\u200d+ */gu, (m) => (m.startsWith(' ') || m.endsWith(' ') ? ' ' : '\u200d'))
    .replace(/ +/g, ' ')
    .replace(/^[ \u200d]+|[ \u200d]+$/gu, '');
}

/** The number of characters (code points) of `s`, as the counters show it. */
export const charCount = (s: string): number => [...s].length;

function cut(s: string, max: number): string {
  return [...s].slice(0, max).join('').trim();
}

function parseObject(content: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(content);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function nameOf(meta: Record<string, unknown>): string | null {
  const { display_name, name } = meta;
  for (const raw of [display_name, name]) {
    if (typeof raw !== 'string') continue;
    const clean = cleanText(raw);
    if (clean !== '') return cut(clean, MAX_PROFILE_NAME);
  }
  return null;
}

/**
 * The name in kind 0 metadata: `display_name`, else `name`, cleaned (`cleanText`) and cut to
 * `MAX_PROFILE_NAME` characters. Null when there is none.
 */
export function profileName(content: string): string | null {
  const meta = parseObject(content);
  return meta === null ? null : nameOf(meta);
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Names that never belong to a public website: local networks, mDNS, reserved and Tor names. */
const PRIVATE_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'localnet',
  'internal',
  'lan',
  'home',
  'home.arpa',
  'corp',
  'intranet',
  'test',
  'invalid',
  'example',
  'onion',
];

/**
 * `raw` as an image URL that is safe to load: https only, no credentials, port 443, a public DNS name (no IP
 * literal in any form, no single-label host, none of `PRIVATE_SUFFIXES`) and at most `MAX_PICTURE_URL`
 * characters. Null otherwise. A public name that resolves to a private address cannot be caught here.
 */
export function safeImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '' || text.length > MAX_PICTURE_URL || /[\s<>"'`\\]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host.startsWith('[') || IPV4.test(host) || /^\d+$/.test(host)) return null;
  if (!host.includes('.') || PRIVATE_SUFFIXES.some((x) => host === x || host.endsWith(`.${x}`))) return null;
  if (url.port !== '' && url.port !== '443') return null;
  return url.href.length > MAX_PICTURE_URL ? null : url.href;
}

/** What the app shows of a profile. */
export interface ProfileInfo {
  name: string | null;
  about: string | null;
  /** A safe https URL (`safeImageUrl`), or null. */
  picture: string | null;
}

/** A kind 0 event, read. */
export interface ParsedProfile extends ProfileInfo {
  id: Hex;
  pubkey: Hex;
  createdAt: number;
}

/** A kind 0 event's profile, or null when it is not kind 0 or its content is not a JSON object. */
export function parseProfile(ev: NostrEvent): ParsedProfile | null {
  if (ev.kind !== 0 || !isHex64(ev.pubkey)) return null;
  const meta = parseObject(ev.content);
  if (meta === null) return null;
  const about = typeof meta.about === 'string' ? cut(cleanText(meta.about), MAX_ABOUT) : '';
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    createdAt: ev.created_at,
    name: nameOf(meta),
    about: about === '' ? null : about,
    picture: safeImageUrl(meta.picture),
  };
}

/** The newer of two versions of one replaceable event: higher `created_at`, the lower id on a tie (NIP-01). */
export function newerProfile<T extends { createdAt: number; id: string }>(
  a: T | null,
  b: T | null,
): T | null {
  if (a === null) return b;
  if (b === null) return a;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? a : b;
  return a.id <= b.id ? a : b;
}

/** The newer of two kind 0 events, by the same rule. */
export function newerEvent(a: NostrEvent | null, b: NostrEvent | null): NostrEvent | null {
  if (a === null) return b;
  if (b === null) return a;
  const n = newerProfile({ createdAt: a.created_at, id: a.id }, { createdAt: b.created_at, id: b.id });
  return n?.id === a.id ? a : b;
}

/**
 * The player's edits: only the fields they changed. An absent field is kept exactly as published; an empty
 * string or null clears it.
 */
export interface ProfileChanges {
  name?: string;
  about?: string;
  picture?: string | null;
}

/**
 * A handle in `name` that differs from `display_name`: another app set it, so clearing the name here keeps it
 * (and it is then shown). Null when there is none.
 */
export function otherAppHandle(previous: string | null): string | null {
  const meta = previous === null ? null : parseObject(previous);
  if (meta === null || typeof meta.name !== 'string') return null;
  const handle = cleanText(meta.name);
  const shown = typeof meta.display_name === 'string' ? cleanText(meta.display_name) : '';
  return handle !== '' && shown !== '' && handle !== shown ? cut(handle, MAX_PROFILE_NAME) : null;
}

/**
 * The new kind 0 content: the published JSON with the player's edits. Fields the player did not change, and
 * unknown fields (`nip05`, `lud16`, `banner`…), are kept byte for byte. The name goes to `display_name`, and
 * to `name` when `name` is unset or equal to the old `display_name`; another app's handle is left alone. Clearing the name removes
 * `display_name` and also `name`, unless `name` is a different handle another app set (`otherAppHandle`).
 * A cleared about or picture is removed.
 */
export function mergeProfileContent(previous: string | null, changes: ProfileChanges): string {
  const meta: Record<string, unknown> = { ...((previous === null ? null : parseObject(previous)) ?? {}) };
  const set = (key: string, value: string | null) => {
    if (value === null || value === '') delete meta[key];
    else meta[key] = value;
  };
  if (changes.name !== undefined) {
    if (changes.name === '') {
      if (otherAppHandle(previous) === null) delete meta.name;
      delete meta.display_name;
    } else {
      // `name` follows when it is unset or was the same as `display_name` (this app wrote both), so a later
      // clear removes both; a different handle is left alone.
      const prevName = typeof meta.name === 'string' ? cleanText(meta.name) : '';
      const prevShown = typeof meta.display_name === 'string' ? cleanText(meta.display_name) : '';
      if (prevName === '' || prevName === prevShown) meta.name = changes.name;
      meta.display_name = changes.name;
    }
  }
  if (changes.about !== undefined) set('about', changes.about);
  if (changes.picture !== undefined) set('picture', changes.picture);
  return JSON.stringify(meta);
}

/**
 * The kind 0 template that replaces `previous` (tags kept). It is never older than `previous`, nor than
 * `newestKnown`, the newest `created_at` known for this author from any source (the cache, too).
 */
export function profileTemplate(
  previous: NostrEvent | null,
  changes: ProfileChanges,
  now: number,
  newestKnown: number | null = null,
): EventTemplate {
  return {
    kind: 0,
    created_at: Math.max(now, (previous?.created_at ?? -1) + 1, (newestKnown ?? -1) + 1),
    tags: previous === null ? [] : previous.tags.map((t) => [...t]),
    content: mergeProfileContent(previous?.content ?? null, changes),
  };
}

export interface ProfileForm {
  name: string;
  about: string;
  /** The picture URL, or '' for none. */
  picture: string;
}

export type ProfileField = keyof ProfileForm;

/** The form's values for the fields the player edited, and only those. */
export function editedFields(form: ProfileForm, edited: ReadonlySet<ProfileField>): Partial<ProfileForm> {
  const out: Partial<ProfileForm> = {};
  for (const f of edited) out[f] = form[f];
  return out;
}

export type ProfileFormCheck =
  | { ok: true; changes: ProfileChanges }
  | { ok: false; errors: { name?: string; about?: string; picture?: string } };

/**
 * The fields the player edited, cleaned, or what is wrong with them. Pass only edited fields: one left out
 * is not checked, cleaned or saved, so what another app published stays as it is.
 */
export function validateProfileForm(form: Partial<ProfileForm>): ProfileFormCheck {
  const errors: { name?: string; about?: string; picture?: string } = {};
  const changes: ProfileChanges = {};
  if (form.name !== undefined) {
    changes.name = cleanText(form.name);
    if (charCount(changes.name) > MAX_PROFILE_NAME)
      errors.name = `Use at most ${MAX_PROFILE_NAME} characters.`;
  }
  if (form.about !== undefined) {
    changes.about = cleanText(form.about);
    if (charCount(changes.about) > MAX_ABOUT) errors.about = `Use at most ${MAX_ABOUT} characters.`;
  }
  if (form.picture !== undefined) {
    const raw = form.picture.trim();
    changes.picture = raw === '' ? null : safeImageUrl(raw);
    if (raw !== '' && changes.picture === null)
      errors.picture = 'Use an image link starting with https:// on a public website.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, changes };
}

/* The profile cache: `bg:<profile>:profiles`, so a name shows at once on the next visit. */

/** The most profiles kept in the cache. */
export const PROFILE_CACHE_MAX = 200;
/** How long a cached profile is used without being seen again (s). */
export const PROFILE_CACHE_TTL_S = 24 * 3600;

export interface CachedProfile extends ParsedProfile {
  /** When it was last seen (Unix seconds). */
  seenAt: number;
}

const cacheKey = (profile: string): string => storageKey(profile, 'profiles');

function readCached(v: unknown): CachedProfile | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
  if (!isHex64(o.pubkey) || !isHex64(o.id)) return null;
  if (typeof o.createdAt !== 'number' || typeof o.seenAt !== 'number') return null;
  const name = str(o.name);
  const about = str(o.about);
  return {
    id: o.id,
    pubkey: o.pubkey,
    createdAt: o.createdAt,
    seenAt: o.seenAt,
    name: name === null ? null : cut(cleanText(name), MAX_PROFILE_NAME) || null,
    about: about === null ? null : cut(cleanText(about), MAX_ABOUT) || null,
    picture: safeImageUrl(o.picture),
  };
}

/** The cached profiles seen within the TTL, by pubkey. Malformed entries are skipped. */
export function loadProfileCache(
  store: KeyValueStore,
  profile: string,
  now: number,
): Map<Hex, CachedProfile> {
  const out = new Map<Hex, CachedProfile>();
  const v = readJson(store, cacheKey(profile));
  if (!Array.isArray(v)) return out;
  for (const raw of v) {
    const p = readCached(raw);
    if (p !== null && now - p.seenAt <= PROFILE_CACHE_TTL_S && p.seenAt <= now + 3600) out.set(p.pubkey, p);
  }
  return out;
}

/** Keep the `PROFILE_CACHE_MAX` most recently seen profiles within the TTL. */
export function pruneProfileCache(entries: Iterable<CachedProfile>, now: number): CachedProfile[] {
  return [...entries]
    .filter((p) => now - p.seenAt <= PROFILE_CACHE_TTL_S)
    .sort((a, b) => b.seenAt - a.seenAt || (a.pubkey < b.pubkey ? -1 : 1))
    .slice(0, PROFILE_CACHE_MAX);
}

export function saveProfileCache(
  store: KeyValueStore,
  profile: string,
  entries: Iterable<CachedProfile>,
  now: number,
): boolean {
  return writeJson(store, cacheKey(profile), pruneProfileCache(entries, now));
}

/** The Home nudge shows once the player's own profile has loaded without a name, until dismissed. */
export function profileNudgeVisible(
  me: { loaded: boolean; info: { name: string | null } | null },
  dismissed: boolean,
): boolean {
  return me.loaded && (me.info?.name ?? null) === null && !dismissed;
}
