import { describe, expect, it } from 'vitest';
import {
  createSettings,
  DEFAULT_RELAYS,
  DEV_RELAY,
  defaultRelays,
  IGNORED_RELAYS_NOTICE,
  isLocalRelayUrl,
  parseRelayInput,
  relaysFromLocation,
} from '../src/settings.ts';
import { memoryStorage } from '../src/storage.ts';

describe('defaultRelays', () => {
  it('lists the default public relay in production', () => {
    expect(defaultRelays(false)).toEqual(['wss://relay.primal.net']);
    expect(DEFAULT_RELAYS).toEqual(defaultRelays(false));
  });

  it('puts the local dev relay first in development', () => {
    expect(defaultRelays(true)).toEqual([DEV_RELAY, ...DEFAULT_RELAYS]);
    expect(DEV_RELAY).toBe('ws://localhost:7777');
  });
});

describe('parseRelayInput', () => {
  it('accepts ws and wss URLs and trims', () => {
    expect(parseRelayInput('  wss://a.example  ')).toEqual({ ok: true, url: 'wss://a.example' });
    expect(parseRelayInput('ws://localhost:7777')).toEqual({ ok: true, url: 'ws://localhost:7777' });
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'https://a.example', 'a.example', 'wss://', 'wss://a b']) {
      expect(parseRelayInput(bad).ok, bad).toBe(false);
    }
  });
});

describe('settings', () => {
  it('starts with the defaults', () => {
    const s = createSettings('alice', memoryStorage(), false);
    expect(s.relays.value).toEqual(DEFAULT_RELAYS);
  });

  it('persists per profile', () => {
    const store = memoryStorage();
    createSettings('alice', store, false).setRelays(['wss://x.example']);
    expect(createSettings('alice', store, false).relays.value).toEqual(['wss://x.example']);
    expect(createSettings('bob', store, false).relays.value).toEqual(DEFAULT_RELAYS);
  });

  it('removes duplicates, drops invalid entries and keeps order', () => {
    const s = createSettings('alice', memoryStorage(), false);
    s.setRelays(['wss://b.example', 'nope', 'wss://a.example', 'wss://b.example']);
    expect(s.relays.value).toEqual(['wss://b.example', 'wss://a.example']);
  });

  it('never saves an empty list: it falls back to the defaults', () => {
    const s = createSettings('alice', memoryStorage(), false);
    s.setRelays([]);
    expect(s.relays.value).toEqual(DEFAULT_RELAYS);
  });

  it('ignores a corrupt stored list', () => {
    const store = memoryStorage();
    store.setItem('bg:alice:relays', '{"not":"a list"}');
    expect(createSettings('alice', store, false).relays.value).toEqual(DEFAULT_RELAYS);
    store.setItem('bg:alice:relays', 'garbage');
    expect(createSettings('alice', store, false).relays.value).toEqual(DEFAULT_RELAYS);
  });

  it('resets to the defaults and forgets the saved list', () => {
    const store = memoryStorage();
    const s = createSettings('alice', store, true);
    s.setRelays(['wss://x.example']);
    s.resetRelays();
    expect(s.relays.value).toEqual(defaultRelays(true));
    expect(store.getItem('bg:alice:relays')).toBeNull();
  });
});

describe('settings when storage fails', () => {
  it('applies the list for this visit and reports that it was not saved', () => {
    const store = memoryStorage();
    const s = createSettings('alice', store, false);
    store.setItem = () => {
      throw new Error('quota');
    };
    expect(s.setRelays(['wss://x.example'])).toBe(false);
    expect(s.relays.value).toEqual(['wss://x.example']);
  });

  it('reports a successful save', () => {
    const s = createSettings('alice', memoryStorage(), false);
    expect(s.setRelays(['wss://x.example'])).toBe(true);
    expect(s.resetRelays()).toBe(true);
  });
});

describe('isLocalRelayUrl', () => {
  it('accepts ws://localhost and ws://127.0.0.1, with or without a port', () => {
    for (const ok of ['ws://localhost', 'ws://localhost:7777', 'ws://127.0.0.1', 'ws://127.0.0.1:4000/']) {
      expect(isLocalRelayUrl(ok), ok).toBe(true);
    }
  });

  it('refuses every other relay, including look-alikes', () => {
    for (const bad of [
      'wss://localhost:7777',
      'ws://localhost.evil.example',
      'ws://localhost:7777@evil.example',
      'ws://user@localhost:7777',
      'ws://localhost:7777/path',
      'ws://127.0.0.2:7777',
      'ws://[::1]:7777',
      'wss://relay.example',
      'ws://LOCALHOST:7777 ',
      'ws://localhost:123456',
      'ws://localhost:99999',
    ]) {
      expect(isLocalRelayUrl(bad), bad).toBe(false);
    }
  });
});

describe('relaysFromLocation', () => {
  it('honours a comma-separated or repeated list of local relays, without duplicates', () => {
    expect(relaysFromLocation({ search: '?relays=ws://localhost:9,ws://127.0.0.1:8' }, true)).toEqual({
      kind: 'local',
      relays: ['ws://localhost:9', 'ws://127.0.0.1:8'],
    });
    expect(
      relaysFromLocation({ search: '?profile=b&relays=ws://localhost:9&relays=ws://localhost:9' }, true),
    ).toEqual({ kind: 'local', relays: ['ws://localhost:9'] });
    expect(
      relaysFromLocation({ search: `?relays=${encodeURIComponent('ws://localhost:7777')}` }, true),
    ).toEqual({
      kind: 'local',
      relays: ['ws://localhost:7777'],
    });
  });

  it('ignores the whole list when any entry is not a local relay', () => {
    expect(relaysFromLocation({ search: '?relays=wss://evil.example' }, true)).toEqual({ kind: 'ignored' });
    expect(relaysFromLocation({ search: '?relays=ws://localhost:9,wss://evil.example' }, true)).toEqual({
      kind: 'ignored',
    });
    expect(relaysFromLocation({ search: '?relays=ws://localhost:9&relays=bad' }, true)).toEqual({
      kind: 'ignored',
    });
    expect(relaysFromLocation({ search: '?relays=https://x.example' }, true)).toEqual({ kind: 'ignored' });
  });

  it('ignores even local relays when links may not set relays (a production build)', () => {
    expect(relaysFromLocation({ search: '?relays=ws://localhost:9' }, false)).toEqual({ kind: 'ignored' });
    expect(relaysFromLocation({ search: '?profile=a' }, false)).toEqual({ kind: 'absent' });
  });

  it('is absent without the parameter or with only empty entries', () => {
    expect(relaysFromLocation({ search: '' }, true)).toEqual({ kind: 'absent' });
    expect(relaysFromLocation({ search: '?profile=a' }, true)).toEqual({ kind: 'absent' });
    expect(relaysFromLocation({ search: '?relays=' }, true)).toEqual({ kind: 'absent' });
    expect(relaysFromLocation({ search: '?relays=,' }, true)).toEqual({ kind: 'absent' });
  });

  it('has a one-line notice for an ignored list', () => {
    expect(IGNORED_RELAYS_NOTICE).toBe('Ignored relays from the link; change relays in Settings.');
  });
});
