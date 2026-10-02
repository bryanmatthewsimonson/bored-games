import { finalizeEvent, type NostrEvent } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { profileName as controllerProfileName } from '../src/game-controller.ts';
import {
  type CachedProfile,
  cleanText,
  editedFields,
  loadProfileCache,
  MAX_ABOUT,
  mergeProfileContent,
  newerEvent,
  newerProfile,
  otherAppHandle,
  PROFILE_CACHE_MAX,
  PROFILE_CACHE_TTL_S,
  parseProfile,
  profileName,
  profileNudgeVisible,
  profileTemplate,
  pruneProfileCache,
  safeImageUrl,
  saveProfileCache,
  validateProfileForm,
} from '../src/profile-model.ts';
import { memoryStorage, storageKey } from '../src/storage.ts';

const SK = new Uint8Array(32).fill(7);
const rnd = (n: number) => new Uint8Array(n).fill(1);

function kind0(content: string, created_at = 1000, tags: string[][] = []): NostrEvent {
  return finalizeEvent({ kind: 0, created_at, tags, content }, SK, rnd);
}

describe('profileName', () => {
  it('matches the game controller copy', () => {
    for (const c of [
      '{"display_name":"Ann","name":"ann"}',
      '{"name":"  Bo  \\u202e "}',
      '{"display_name":"","name":"Cy"}',
      `{"name":"${'x'.repeat(40)}"}`,
      '[]',
      'nope',
      '{"name":7}',
    ])
      expect(profileName(c), c).toBe(controllerProfileName(c));
  });
});

describe('safeImageUrl', () => {
  it('accepts https URLs on public hosts', () => {
    expect(safeImageUrl('https://blossom.primal.net/abc.webp')).toBe('https://blossom.primal.net/abc.webp');
    expect(safeImageUrl('  https://example.com/a.png?x=1  ')).toBe('https://example.com/a.png?x=1');
    expect(safeImageUrl('https://example.com:443/a.png')).toBe('https://example.com/a.png');
  });

  it('refuses other schemes, IP and local hosts, credentials, odd ports and long URLs', () => {
    for (const bad of [
      'http://example.com/a.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'https://127.0.0.1/a.png',
      'https://10.0.0.1/a.png',
      'https://[::1]/a.png',
      'https://localhost/a.png',
      'https://x.localhost/a.png',
      'https://intranet/a.png',
      'https://user:pw@example.com/a.png',
      'https://example.com:8443/a.png',
      'https://printer.local/a.png',
      'https://nas.localdomain/a.png',
      'https://box.localnet/a.png',
      'https://foo.internal/a.png',
      'https://nas.lan/a.png',
      'https://router.home/a.png',
      'https://box.home.arpa/a.png',
      'https://wiki.corp/a.png',
      'https://x.intranet/a.png',
      'https://a.test/a.png',
      'https://a.invalid/a.png',
      'https://a.example/a.png',
      'https://abcdefghijklmnop.onion/a.png',
      'https://a.localhost/a.png',
      'https://0x7f.1/a.png',
      'https://017700000001/a.png',
      'https://0x7f000001/a.png',
      'https://127.1/a.png',
      'https://2130706433/a.png',
      'https://example.com/a b.png',
      `https://example.com/${'a'.repeat(1100)}`,
      '',
      7,
      null,
    ])
      expect(safeImageUrl(bad), String(bad)).toBeNull();
  });
});

describe('parseProfile', () => {
  it('reads the name, about and a safe picture', () => {
    const ev = kind0(
      JSON.stringify({ display_name: 'Ann', about: 'Hi\nthere', picture: 'https://example.com/a.png' }),
    );
    expect(parseProfile(ev)).toEqual({
      id: ev.id,
      pubkey: ev.pubkey,
      createdAt: 1000,
      name: 'Ann',
      about: 'Hi there',
      picture: 'https://example.com/a.png',
    });
  });

  it('drops an unsafe picture and refuses non-objects and other kinds', () => {
    expect(parseProfile(kind0('{"picture":"http://example.com/a.png"}'))?.picture).toBeNull();
    expect(parseProfile(kind0('[1]'))).toBeNull();
    expect(parseProfile(kind0('nope'))).toBeNull();
    expect(parseProfile({ ...kind0('{}'), kind: 1 })).toBeNull();
  });
});

describe('newerProfile', () => {
  it('prefers the higher created_at, then the lower id', () => {
    const a = { createdAt: 5, id: 'b' };
    const b = { createdAt: 6, id: 'c' };
    const c = { createdAt: 6, id: 'a' };
    expect(newerProfile(a, b)).toBe(b);
    expect(newerProfile(b, a)).toBe(b);
    expect(newerProfile(b, c)).toBe(c);
    expect(newerProfile(c, b)).toBe(c);
    expect(newerProfile(null, a)).toBe(a);
    expect(newerProfile(a, null)).toBe(a);
  });

  it('does the same for events', () => {
    const old = kind0('{}', 10);
    const young = kind0('{}', 11);
    expect(newerEvent(old, young)).toBe(young);
    expect(newerEvent(young, old)).toBe(young);
    expect(newerEvent(null, old)).toBe(old);
  });
});

describe('mergeProfileContent', () => {
  it('keeps unknown fields, writes display_name, and sets name only when absent', () => {
    const prev = JSON.stringify({
      name: 'ann_handle',
      nip05: 'ann@example.com',
      lud16: 'ann@ln',
      banner: 'b',
    });
    const merged = JSON.parse(
      mergeProfileContent(prev, { name: 'Ann', about: 'Plays at night', picture: 'https://e.com/p.webp' }),
    );
    expect(merged).toEqual({
      name: 'ann_handle',
      nip05: 'ann@example.com',
      lud16: 'ann@ln',
      banner: 'b',
      display_name: 'Ann',
      about: 'Plays at night',
      picture: 'https://e.com/p.webp',
    });
    expect(JSON.parse(mergeProfileContent(null, { name: 'Bo', about: '', picture: null }))).toEqual({
      display_name: 'Bo',
      name: 'Bo',
    });
  });

  it('removes cleared fields and survives malformed content', () => {
    const prev = JSON.stringify({ display_name: 'Ann', about: 'x', picture: 'https://e.com/p.webp' });
    expect(JSON.parse(mergeProfileContent(prev, { name: '', about: '', picture: null }))).toEqual({});
    expect(JSON.parse(mergeProfileContent('not json', { name: 'Cy', about: '', picture: null }))).toEqual({
      display_name: 'Cy',
      name: 'Cy',
    });
  });
});

describe('saving only edited fields (I1)', () => {
  const published = JSON.stringify({
    display_name: 'A name that is much longer than thirty-two characters 👨‍👩‍👧',
    about: `Line one\nLine two\n${'x'.repeat(300)}`,
    picture: 'http://old.example.com:8080/me.png',
    nip05: 'me@e.com',
  });

  it('leaves the content byte for byte when nothing was edited', () => {
    const check = validateProfileForm({});
    expect(check).toEqual({ ok: true, changes: {} });
    if (check.ok) expect(mergeProfileContent(published, check.changes)).toBe(published);
  });

  it('passes on only the edited fields of the form', () => {
    const form = { name: 'Shown name', about: 'Shown about', picture: '' };
    expect(editedFields(form, new Set())).toEqual({});
    expect(editedFields(form, new Set(['picture']))).toEqual({ picture: '' });
    expect(editedFields(form, new Set(['name', 'about']))).toEqual({
      name: 'Shown name',
      about: 'Shown about',
    });
  });

  it('changes only the edited field: a new picture keeps the long name, the long about and nip05', () => {
    const check = validateProfileForm({ picture: 'https://blossom.primal.net/a.webp' });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.changes).toEqual({ picture: 'https://blossom.primal.net/a.webp' });
    expect(JSON.parse(mergeProfileContent(published, check.changes))).toEqual({
      ...JSON.parse(published),
      picture: 'https://blossom.primal.net/a.webp',
    });
  });
});

describe('clearing the name (I6)', () => {
  const shown = (content: string) => profileName(content);

  it('removes display_name and the name this app wrote with it', () => {
    const first = mergeProfileContent(null, { name: 'Bob' });
    expect(JSON.parse(first)).toEqual({ display_name: 'Bob', name: 'Bob' });
    const renamed = mergeProfileContent(first, { name: 'Robert' });
    expect(JSON.parse(renamed)).toEqual({ display_name: 'Robert', name: 'Robert' });
    const cleared = mergeProfileContent(renamed, { name: '' });
    expect(JSON.parse(cleared)).toEqual({});
    expect(shown(cleared)).toBeNull();
  });

  it('clears a name that was only in `name`, as shown in the field', () => {
    const cleared = mergeProfileContent(JSON.stringify({ name: 'bob', nip05: 'b@e.com' }), { name: '' });
    expect(JSON.parse(cleared)).toEqual({ nip05: 'b@e.com' });
    expect(shown(cleared)).toBeNull();
  });

  it('keeps a different handle another app set, and says so', () => {
    const prev = JSON.stringify({ display_name: 'Bob', name: 'bob_the_builder' });
    expect(otherAppHandle(prev)).toBe('bob_the_builder');
    expect(otherAppHandle(JSON.stringify({ display_name: 'Bob', name: 'Bob' }))).toBeNull();
    expect(otherAppHandle(JSON.stringify({ name: 'bob' }))).toBeNull();
    const cleared = mergeProfileContent(prev, { name: '' });
    expect(JSON.parse(cleared)).toEqual({ name: 'bob_the_builder' });
    // Renaming keeps the handle too, and the shown name follows display_name.
    const renamed = mergeProfileContent(prev, { name: 'Robert' });
    expect(JSON.parse(renamed)).toEqual({ display_name: 'Robert', name: 'bob_the_builder' });
    expect(shown(renamed)).toBe('Robert');
  });
});

describe('cleanText', () => {
  it('keeps zero-width joiners inside emoji sequences and drops blank-looking letters', () => {
    expect(cleanText('Ann 👨‍👩‍👧')).toBe('Ann 👨‍👩‍👧');
    expect(cleanText('\u200dAnn\u200d')).toBe('Ann');
    expect(cleanText('\u3164\u3164')).toBe('');
    expect(cleanText('\u2800 \u115f\u1160 \uffa0')).toBe('');
    expect(cleanText('A\u202eB\u200bC')).toBe('ABC');
  });
});

describe('profileTemplate', () => {
  it('keeps the tags and is never older than the previous version', () => {
    const prev = kind0('{"nip05":"a@b.c"}', 2000, [['i', 'github:ann', 'proof']]);
    const t = profileTemplate(prev, { name: 'Ann', about: '', picture: null }, 1500);
    expect(t.kind).toBe(0);
    expect(t.created_at).toBe(2001);
    expect(t.tags).toEqual([['i', 'github:ann', 'proof']]);
    expect(t.tags[0]).not.toBe(prev.tags[0]);
    expect(JSON.parse(t.content)).toEqual({ nip05: 'a@b.c', display_name: 'Ann', name: 'Ann' });
    expect(profileTemplate(null, { name: '', about: '', picture: null }, 1500)).toEqual({
      kind: 0,
      created_at: 1500,
      tags: [],
      content: '{}',
    });
  });
});

describe('validateProfileForm', () => {
  it('cleans the text and checks lengths and the picture', () => {
    expect(validateProfileForm({ name: '  Ann‮  ', about: ' a\tb ', picture: '' })).toEqual({
      ok: true,
      changes: { name: 'Ann', about: 'a b', picture: null },
    });
    const bad = validateProfileForm({
      name: 'x'.repeat(33),
      about: 'y'.repeat(MAX_ABOUT + 1),
      picture: 'http://a.b/c',
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['about', 'name', 'picture']);
    expect(validateProfileForm({ name: '😀'.repeat(32), about: '', picture: 'https://e.com/p.png' }).ok).toBe(
      true,
    );
  });
});

describe('profile cache', () => {
  const entry = (i: number, seenAt: number): CachedProfile => ({
    id: i.toString(16).padStart(64, '0'),
    pubkey: (i + 1).toString(16).padStart(64, '0'),
    createdAt: 1,
    seenAt,
    name: `P${i}`,
    about: null,
    picture: null,
  });

  it('round-trips under bg:<profile>:profiles and drops entries past the TTL', () => {
    const store = memoryStorage();
    const now = 100_000;
    expect(saveProfileCache(store, 'a', [entry(1, now), entry(2, now - PROFILE_CACHE_TTL_S - 1)], now)).toBe(
      true,
    );
    expect(store.getItem(storageKey('a', 'profiles'))).not.toBeNull();
    const back = loadProfileCache(store, 'a', now);
    expect([...back.values()]).toEqual([entry(1, now)]);
    expect(loadProfileCache(store, 'a', now + PROFILE_CACHE_TTL_S + 1).size).toBe(0);
    expect(loadProfileCache(store, 'b', now).size).toBe(0);
  });

  it('keeps the most recently seen entries, at most PROFILE_CACHE_MAX', () => {
    const now = 1_000_000;
    const all = Array.from({ length: PROFILE_CACHE_MAX + 20 }, (_, i) => entry(i, now - i));
    const kept = pruneProfileCache(all, now);
    expect(kept).toHaveLength(PROFILE_CACHE_MAX);
    expect(kept[0]?.name).toBe('P0');
    expect(kept.some((p) => p.name === `P${PROFILE_CACHE_MAX}`)).toBe(false);
  });

  it('skips malformed entries and re-checks pictures', () => {
    const store = memoryStorage();
    store.setItem(
      storageKey('a', 'profiles'),
      JSON.stringify([{ ...entry(1, 50), picture: 'http://e.com/p.png' }, { pubkey: 'x' }, 7]),
    );
    const back = [...loadProfileCache(store, 'a', 60).values()];
    expect(back).toHaveLength(1);
    expect(back[0]?.picture).toBeNull();
    store.setItem(storageKey('a', 'profiles'), 'not json');
    expect(loadProfileCache(store, 'a', 60).size).toBe(0);
  });
});

describe('profileNudgeVisible', () => {
  it('shows once the profile has loaded without a name, until dismissed', () => {
    expect(profileNudgeVisible({ loaded: false, info: null }, false)).toBe(false);
    expect(profileNudgeVisible({ loaded: true, info: null }, false)).toBe(true);
    expect(profileNudgeVisible({ loaded: true, info: { name: null } }, false)).toBe(true);
    expect(profileNudgeVisible({ loaded: true, info: { name: 'Ann' } }, false)).toBe(false);
    expect(profileNudgeVisible({ loaded: true, info: null }, true)).toBe(false);
  });
});
