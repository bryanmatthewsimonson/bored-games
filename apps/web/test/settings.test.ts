import { describe, expect, it } from 'vitest';
import {
  createSettings,
  DEFAULT_RELAYS,
  DEV_RELAY,
  defaultRelays,
  parseRelayInput,
} from '../src/settings.ts';
import { memoryStorage } from '../src/storage.ts';

describe('defaultRelays', () => {
  it('lists the public relays in production', () => {
    expect(defaultRelays(false)).toEqual(['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band']);
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
