import type { Signal } from '@preact/signals';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Nip07, Signer } from './identity.ts';
import type { ControllerDeps } from './net.ts';
import type { Settings } from './settings.ts';
import type { KeyValueStore } from './storage.ts';

/** Everything the screens share. Built once in main.tsx. */
export interface AppContext {
  profile: string;
  /** The `?profile=` value when it was not a valid name and the default profile is used instead. */
  invalidProfile: string | null;
  store: KeyValueStore;
  /** Set when `window.nostr` is present: the Settings dialog then offers the extension. */
  nostr: Nip07 | undefined;
  /** Fixed for the life of the page: changing the signer reloads it. */
  signer: Signer;
  /** False when the identity key lives in memory only (site data blocked) and is lost on reload. */
  persistent: boolean;
  settings: Settings;
  /** Whether the Settings dialog is open. */
  settingsOpen: Signal<boolean>;
  /** What the lobby and game controllers are built from. */
  deps: ControllerDeps;
}

export const AppCtx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const ctx = useContext(AppCtx);
  if (ctx === null) throw new Error('useApp outside of <AppCtx.Provider>');
  return ctx;
}
