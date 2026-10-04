/*
 * Other keys (D041, D057, D065): every player key, other than the one in use, that this profile's tables or saved game
 * keys belong to, whether or not the key itself is kept in this browser. The D057 incident left a phone holding seat 3's
 * game keys (owner A) while key A itself was never stored: Home said "switch to it in Settings", and Settings listed
 * only kept keys, so there was nothing to switch to. A seat whose game keys are here plays without its key
 * (`seatForGameKeys`), so such an owner is listed too, with its games to open. Pure: reads the store it is given.
 */
import type { Hex } from '@bored-games/protocol';
import { npubEncode, shortNpub } from './bech32.ts';
import { keptKeys } from './identity.ts';
import { type KeyValueStore, loadGameStatus, loadSecrets, loadTableList, tableOwner } from './storage.ts';

/** A game in progress listed under another key. */
export interface OtherKeyGame {
  address: string;
  /** The game root's id once the game has started (as the saved game keys recorded it). */
  rootId: string | null;
  /** This browser holds the seat's game keys, so it can play the seat without the key. */
  savedKeys: boolean;
}

export interface OtherKey {
  pubkey: Hex;
  /** The key itself is kept in this browser (Settings → Other keys → Switch to). */
  kept: boolean;
  /** Its games in progress, oldest listed first. */
  games: OtherKeyGame[];
}

/**
 * The keys other than `current` that this profile kept or that its listed tables belong to: kept keys first (newest
 * first), then the others in the order their first table was listed. An owner that is not kept appears only with a
 * game in progress; a kept key appears even with none (it can be switched to).
 */
export function otherKeys(profile: string, store: KeyValueStore, current: Hex): OtherKey[] {
  const out = new Map<Hex, OtherKey>();
  for (const k of keptKeys(profile, store))
    if (k.pubkey !== current) out.set(k.pubkey, { pubkey: k.pubkey, kept: true, games: [] });
  for (const address of loadTableList(profile, store)) {
    const owner = tableOwner(profile, store, address);
    if (owner === null || owner === current) continue;
    const secrets = loadSecrets(profile, store, address);
    const rootId = secrets?.rootId ?? null;
    const status = rootId === null ? null : loadGameStatus(profile, store, rootId)?.status;
    if (status === 'done' || status === 'cancelled') continue;
    let entry = out.get(owner);
    if (entry === undefined) {
      entry = { pubkey: owner, kept: false, games: [] };
      out.set(owner, entry);
    }
    entry.games.push({ address, rootId, savedKeys: secrets !== null });
  }
  return [...out.values()];
}

/** What Home can know about a table listed under another key (`otherKeyDetail`). */
export interface OtherKeyFacts {
  /** The key the table is listed under. */
  owner: Hex;
  /** That key is kept in this browser. */
  kept: boolean;
  /** The saved game keys match a seat of the game's root (`MyTable.savedKeys`). */
  matched: boolean;
  /** This browser holds game keys for the table (matched or not yet checked). */
  savedKeys: boolean;
  /** The game has started (a root is known, or the table says so). */
  started: boolean;
  /** The key the table is listed under created it: only that key can start the game. */
  creator: boolean;
}

/** "Playable with saved game keys": another key's table whose seat this browser's saved game keys play (D057). */
export const SAVED_KEYS_DETAIL = 'Playable with saved game keys';

/**
 * The line Home shows for a table listed under another key. It never promises a switch that cannot happen: only a kept
 * key is offered the switch; otherwise it says what this browser's saved game keys still allow.
 */
export function otherKeyDetail(f: OtherKeyFacts): string {
  const who = shortNpub(npubEncode(f.owner));
  if (f.kept) return `Under another key (${who}): switch to it in Settings to play`;
  if (f.matched) return SAVED_KEYS_DETAIL;
  if (f.savedKeys && f.started)
    return `Under another key (${who}), not kept here: open the game to play it with this browser's saved game keys`;
  if (f.savedKeys && f.creator)
    return `Created with another key (${who}), not kept here: only that key can start the game`;
  if (f.savedKeys)
    return `Joined with another key (${who}), not kept here: once it starts, this browser's saved game keys play your seat`;
  return `Under another key (${who}), not kept in this browser`;
}
