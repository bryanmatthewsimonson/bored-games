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

/** Control and format characters (bidi overrides, zero-width characters) removed and whitespace collapsed. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\s/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/ +/g, ' ')
    .trim();
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
 *
 * A copy of `profileName` in game-controller.ts, which keeps its own until the game screen reads names from
 * the ProfileStore.
 */
export function profileName(content: string): string | null {
  const meta = parseObject(content);
  return meta === null ? null : nameOf(meta);
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * `raw` as an image URL that is safe to load: https only, no credentials, a public DNS name (no IP literal,
 * no localhost, no single-label host) and at most `MAX_PICTURE_URL` characters. Null otherwise.
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
  if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) return null;
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

/** The player's edits. Empty strings and null clear a field. */
export interface ProfileChanges {
  name: string;
  about: string;
  picture: string | null;
}

/**
 * The new kind 0 content: the published JSON with the player's edits. Unknown fields (`nip05`, `lud16`,
 * `banner`…) are kept. The name goes to `display_name`, and to `name` only when `name` is absent (other apps
 * use `name` as a handle). A cleared field is removed.
 */
export function mergeProfileContent(previous: string | null, changes: ProfileChanges): string {
  const meta: Record<string, unknown> = { ...((previous === null ? null : parseObject(previous)) ?? {}) };
  const set = (key: string, value: string | null) => {
    if (value === null || value === '') delete meta[key];
    else meta[key] = value;
  };
  set('display_name', changes.name);
  if (changes.name !== '' && typeof meta.name !== 'string') meta.name = changes.name;
  set('about', changes.about);
  set('picture', changes.picture);
  return JSON.stringify(meta);
}

/** The kind 0 template that replaces `previous` (tags kept), never older than it. */
export function profileTemplate(
  previous: NostrEvent | null,
  changes: ProfileChanges,
  now: number,
): EventTemplate {
  return {
    kind: 0,
    created_at: previous === null ? now : Math.max(now, previous.created_at + 1),
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

export type ProfileFormCheck =
  | { ok: true; changes: ProfileChanges }
  | { ok: false; errors: { name?: string; about?: string; picture?: string } };

/** The form's values, cleaned, or what is wrong with them. */
export function validateProfileForm(form: ProfileForm): ProfileFormCheck {
  const name = cleanText(form.name);
  const about = cleanText(form.about);
  const errors: { name?: string; about?: string; picture?: string } = {};
  if (charCount(name) > MAX_PROFILE_NAME) errors.name = `Use at most ${MAX_PROFILE_NAME} characters.`;
  if (charCount(about) > MAX_ABOUT) errors.about = `Use at most ${MAX_ABOUT} characters.`;
  const raw = form.picture.trim();
  const picture = raw === '' ? null : safeImageUrl(raw);
  if (raw !== '' && picture === null)
    errors.picture = 'Use an image link starting with https:// on a public website.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, changes: { name, about, picture } };
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
