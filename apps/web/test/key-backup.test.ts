/*
 * The encrypted self-backup of a seat's game keys (D065), against the real dev relay: a Join publishes it, another
 * device with the same player key restores it and plays the seat (as one more device of the seat, D063), and a
 * backup that is not exactly this seat's is refused. The owner's report: the desktop, with the phone's nsec, only
 * watched a Chain Reaction game during the deal.
 */
import type { ChainReactionState } from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { startDevRelay } from '@bored-games/dev-relay';
import {
  encodeKeyBackup,
  finalizeEvent,
  getPublicKey,
  KIND,
  keyBackupTemplate,
  type NostrEvent,
  type ParsedRoot,
  parseRoot,
} from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platformTimers } from '../src/clock.ts';
import { ALREADY_MOVED, type GameController } from '../src/game-controller.ts';
import { handTiles } from '../src/games/chain-reaction/model.ts';
import { bytesToHex } from '../src/hex.ts';
import { localNip44, type Signer } from '../src/identity.ts';
import {
  BACKUP_NO_NIP44,
  backupRecordKey,
  backupUnavailable,
  loadBackupRecord,
  restoreKeyBackup,
} from '../src/key-backup.ts';
import { loadSecrets, loadTableList, memoryStorage } from '../src/storage.ts';
import { Harness, laggingOwn, type Profile, pause, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
type Args = Parameters<typeof restoreKeyBackup>;
const restore = (s: Args[0], r: Args[1], e: Args[2]) => restoreKeyBackup(s, r, e, platformTimers);
beforeEach(() => h.setup());
afterEach(() => h.teardown());

async function rootOf(rootId: string): Promise<ParsedRoot> {
  return parseRoot((await h.query([{ ids: [rootId] }]))[0] as NostrEvent);
}

/** The player's key backups on the dev relay, waiting until there is at least one. */
async function backupsOf(pubkey: string): Promise<NostrEvent[]> {
  for (let i = 0; i < 400; i++) {
    const evs = await h.query([{ kinds: [KIND.backup], authors: [pubkey] }]);
    if (evs.length > 0) return evs;
    await pause(25);
  }
  throw new Error('no backup was published');
}

/** A local key with its signer, with and without NIP-44. */
function keyPair(): { plain: Signer; full: Signer } {
  const sk = rnd(32);
  const plain: Signer = {
    kind: 'local',
    pubkey: getPublicKey(sk),
    sign: async (t) => finalizeEvent(t, sk, rnd),
  };
  return { plain, full: { ...plain, nip44: localNip44(sk, rnd) } };
}

/** The same player on another device: the same signer, storage of its own with nothing in it. */
const otherDevice = (p: Profile, signer: Signer = p.deps.signer): Profile =>
  h.profile(p.name, { store: memoryStorage(), signer });

describe('The key backup (D065)', () => {
  it('a Join publishes an encrypted backup that restores only the seat it belongs to', async () => {
    const a = h.profile('a', { nip44: true });
    const b = h.profile('b', { nip44: true });
    const { rootId, address } = await h.start2('chess', a, b);
    const root = await rootOf(rootId);
    const A = a.deps.signer.pubkey;
    const seatA = root.seats.findIndex((s) => s.npub === A);
    const mine = loadSecrets('a', a.deps.storage, address);
    const theirs = loadSecrets('b', b.deps.storage, address);
    if (mine === null || theirs === null) throw new Error('no game keys');
    const evs = await backupsOf(A);
    expect(evs).toHaveLength(1);
    const ev = evs[0] as NostrEvent;
    expect(ev.tags).toEqual([['d', `bored-games/keys/${address}`]]);
    expect(ev.content).not.toContain(bytesToHex(mine.sessionSk));
    expect(loadBackupRecord('a', a.deps.storage, address)).not.toBeNull();

    // Round trip.
    const ok = await restore(a.deps.signer, root, evs);
    expect(ok).toMatchObject({ kind: 'restored', seat: seatA });
    if (ok.kind !== 'restored') throw new Error('not restored');
    expect(ok.secrets.sessionSk).toEqual(mine.sessionSk);
    expect(ok.secrets.deckSecret).toEqual(mine.deckSecret);
    expect(ok.secrets.owner).toBe(A);

    // The wrong key: A's npub, B's NIP-44 (another conversation key): nothing decrypts.
    const wrong = { pubkey: A, nip44: b.deps.signer.nip44 as NonNullable<Signer['nip44']> };
    expect(await restore(wrong, root, evs)).toEqual({ kind: 'unreadable' });
    // Another player's backup is not A's.
    expect(await restore(a.deps.signer, root, await backupsOf(b.deps.signer.pubkey))).toEqual({
      kind: 'none',
    });

    // Tampered content: re-signed, the MAC fails; not re-signed, the event is invalid.
    const flipped = ev.content.slice(0, 40) + (ev.content[40] === 'A' ? 'B' : 'A') + ev.content.slice(41);
    const resigned = await a.deps.signer.sign(keyBackupTemplate(address, flipped, ev.created_at + 1));
    expect(await restore(a.deps.signer, root, [resigned])).toEqual({ kind: 'unreadable' });
    expect(await restore(a.deps.signer, root, [{ ...ev, content: flipped }])).toEqual({
      kind: 'none',
    });

    // A backup A really made, but of B's keys, or of another root: not A's seat here.
    const forge = async (keys: typeof mine, rootIdOf: string): Promise<NostrEvent> => {
      const text = encodeKeyBackup({
        table: address,
        sessionSk: bytesToHex(keys.sessionSk),
        deckSecret: bytesToHex(keys.deckSecret),
        rootId: rootIdOf,
        seat: 0,
      });
      const content = await (a.deps.signer.nip44 as NonNullable<Signer['nip44']>).encrypt(A, text);
      return a.deps.signer.sign(keyBackupTemplate(address, content, ev.created_at + 2));
    };
    expect(await restore(a.deps.signer, root, [await forge(theirs, rootId)])).toEqual({
      kind: 'mismatch',
    });
    expect(await restore(a.deps.signer, root, [await forge(mine, 'ee'.repeat(32))])).toEqual({
      kind: 'mismatch',
    });
    // The newest backup that checks out wins over a newer one that does not.
    expect(await restore(a.deps.signer, root, [await forge(theirs, rootId), ev])).toMatchObject({
      kind: 'restored',
      seat: seatA,
    });
  }, 60_000);

  it('a second device with the same player key restores the seat and plays; the joining device adopts its move', async () => {
    const { rootId, address, bySeat } = await h.start2(
      'chess',
      h.profile('a', { nip44: true }),
      h.profile('b', { nip44: true }),
    );
    const [white, black] = bySeat;
    await backupsOf(white.deps.signer.pubkey);
    const root = await rootOf(rootId);
    const wKey = root.seats[0]?.session as string;
    // The phone that joined, with a live feed that lags behind the other device's moves.
    const net = laggingOwn(white.deps.pool, () => wKey);
    const phone = h.game(rootId, { ...white.deps, pool: net.pool });
    const blackGame = h.game(rootId, black.deps);
    // The desktop: the same nsec, nothing in storage.
    const desktop = otherDevice(white);
    const d = h.game(rootId, desktop.deps);
    await waitFor('the restore', () => d.restore.value === 'restored');
    await waitFor('the desktop decision', () => d.status.value === 'your-turn');
    expect(d.view.value?.mySeat).toBe(0);
    expect(d.recovered.value).toBeNull();
    // Saved like keys made here: the next load plays at once, Home lists the game, and no second backup is made.
    const saved = loadSecrets(white.name, desktop.deps.storage, address);
    expect(saved?.sessionSk).toEqual(loadSecrets(white.name, white.deps.storage, address)?.sessionSk);
    expect(saved?.owner).toBe(white.deps.signer.pubkey);
    expect(loadTableList(white.name, desktop.deps.storage)).toContain(address);
    await waitFor('the backup checked', () => d.backup.value === 'done');
    expect(await h.query([{ kinds: [KIND.backup], authors: [white.deps.signer.pubkey] }])).toHaveLength(1);

    // Two live devices of the seat (D063): the desktop moves; the phone's check before signing adopts it.
    await waitFor('the phone decision', () => phone.status.value === 'your-turn');
    await d.act({ type: 'move', actor: 0, uci: 'e2e4' });
    await waitFor('Black sees the move', () => blackGame.view.value?.head.seq === 1);
    await expect(phone.act({ type: 'move', actor: 0, uci: 'd2d4' })).rejects.toThrow(ALREADY_MOVED);
    expect(phone.view.value?.head.seq).toBe(1);
    expect(net.published).toEqual([]);
    const moves = await h.query([{ kinds: [KIND.move], authors: [wKey], '#e': [rootId] }]);
    expect(moves).toHaveLength(1);
    // Black answers; both devices of White see it and agree.
    await waitFor('Black to move', () => blackGame.status.value === 'your-turn');
    await blackGame.act({ type: 'move', actor: 1, uci: 'e7e5' });
    for (const g of [phone, d]) await waitFor('White to move again', () => g.view.value?.head.seq === 2);
    await pause(200);
    for (const g of [phone, d, blackGame]) expect(g.view.value?.equivocators).toEqual([]);
  }, 90_000);

  it('a game joined before backups existed: the joining device backs up when it opens it; Try again restores', async () => {
    const keys = keyPair();
    // Joined with an app that made no backup.
    const { rootId, address, bySeat } = await h.start2(
      'chess',
      h.profile('a', { signer: keys.plain }),
      h.profile('b'),
    );
    const white = bySeat.find((p) => p.deps.signer.pubkey === keys.plain.pubkey) as Profile;
    const seat = bySeat.indexOf(white);
    expect(await h.query([{ kinds: [KIND.backup], authors: [keys.plain.pubkey] }])).toEqual([]);
    const desktop = otherDevice(white, keys.full);
    const d = h.game(rootId, desktop.deps);
    await waitFor('the restore to give up', () => d.restore.value === 'none');
    await waitFor('the spectator view', () => d.view.value !== null);
    expect(d.view.value?.mySeat).toBeNull();
    expect(d.error.value).toBeNull();

    // The phone, on the new app: opening the game backs the keys up by itself (a local key needs no prompt).
    const phone = h.game(rootId, { ...white.deps, signer: keys.full });
    await waitFor('the phone backup', () => phone.backup.value === 'done');
    expect(loadBackupRecord(white.name, white.deps.storage, address)).not.toBeNull();
    d.retryRestore();
    await waitFor('the restore', () => d.restore.value === 'restored');
    await waitFor('the seat', () => d.view.value?.mySeat === seat);
  }, 60_000);

  it('an extension without NIP-44 can neither back up nor restore; one with it is offered the button', async () => {
    const keys = keyPair();
    const bare: Signer = { ...keys.plain, kind: 'nip07' };
    expect(backupUnavailable(bare)).toBe(BACKUP_NO_NIP44);
    const { rootId, address, bySeat } = await h.start2(
      'chess',
      h.profile('a', { signer: bare }),
      h.profile('b'),
    );
    const player = bySeat.find((p) => p.deps.signer.pubkey === bare.pubkey) as Profile;
    const phone = h.game(rootId, player.deps);
    await waitFor('the phone backup state', () => phone.backup.value === 'unavailable');
    const desktop = h.game(rootId, otherDevice(player).deps);
    await waitFor('the desktop restore state', () => desktop.restore.value === 'unavailable');

    // With NIP-44, the extension is not asked by itself on the game screen: the player taps the button.
    const ext: Signer = { ...keys.full, kind: 'nip07' };
    player.deps.storage.removeItem(backupRecordKey(player.name, address));
    const withExt = h.game(rootId, { ...player.deps, signer: ext });
    await waitFor('the offer', () => withExt.backup.value === 'due');
    await pause(300);
    expect(await h.query([{ kinds: [KIND.backup], authors: [ext.pubkey] }])).toEqual([]);
    await withExt.backupKeys();
    expect(withExt.backup.value).toBe('done');
    expect(await backupsOf(ext.pubkey)).toHaveLength(1);
  }, 60_000);

  it('the owner’s report: a seat whose phone joined is played from the desktop through the shuffle and the deal', async () => {
    const ps = [
      h.profile('a', { nip44: true }),
      h.profile('b', { nip44: true }),
      h.profile('c', { nip44: true }),
    ];
    const { rootId, bySeat } = await h.start3('chain-reaction', ps as [Profile, Profile, Profile]);
    const [p0, p1, p2] = bySeat as [Profile, Profile, Profile];
    await backupsOf(p2.deps.signer.pubkey);
    // Seat 2's phone never opens the game; its desktop has the same nsec and nothing else.
    const games: GameController[] = [h.game(rootId, p0.deps), h.game(rootId, p1.deps)];
    const desktop = h.game(rootId, otherDevice(p2).deps);
    games.push(desktop);
    for (const g of games) await waitFor('the play phase', () => g.view.value?.phase === 'play', 180_000);
    expect(desktop.restore.value).toBe('restored');
    expect(desktop.view.value?.mySeat).toBe(2);
    const state = desktop.view.value?.state as ChainReactionState;
    expect(handTiles(CHAIN_REACTION_THEME, state, 2).every((t) => t.tile !== null)).toBe(true);
    // Every viewer sees its own hand; the board and the head agree.
    const other = games[0]?.view.value?.state as ChainReactionState;
    expect(state.board).toEqual(other.board);
    expect(desktop.view.value?.head.id).toBe(games[0]?.view.value?.head.id);
  }, 240_000);

  it("review M1: a backup recorded here but missing from the game's relays is published again; only a game relay counts", async () => {
    const own = await startDevRelay({ port: 0 });
    h.later(() => own.close());
    const keys = keyPair();
    // The Join's backup reached only the player's own relay: no game relay took it, so nothing is recorded.
    const a = h.profile('a', { signer: keys.full, extra: [own.url] });
    const real = a.deps.pool;
    const lobbyDeps = {
      ...a.deps,
      pool: {
        subscribe: real.subscribe.bind(real),
        addRelays: real.addRelays?.bind(real),
        publish: (ev: NostrEvent, urls?: readonly string[]) =>
          ev.kind === KIND.backup ? real.publish(ev, [own.url]) : real.publish(ev, urls),
      } as typeof real,
    };
    const { rootId, address } = await h.start2('chess', { ...a, deps: lobbyDeps }, h.profile('b'));
    // The game screen of the same device, with its full network.
    const player = a;
    for (let i = 0; i < 200; i++) {
      if ((await h.query([{ kinds: [KIND.backup], authors: [keys.full.pubkey] }], own.url)).length > 0) break;
      await pause(25);
    }
    expect(await h.query([{ kinds: [KIND.backup], authors: [keys.full.pubkey] }])).toEqual([]);
    expect(loadBackupRecord('a', player.deps.storage, address)).toBeNull();
    // An older app recorded it anyway (any relay counted): the game screen does not trust the mark.
    player.deps.storage.setItem(backupRecordKey('a', address), JSON.stringify({ at: 1, rootId: null }));
    const phone = h.game(rootId, player.deps);
    await waitFor('the backup checked and published again', () => phone.backup.value === 'done');
    const onRoot = await backupsOf(keys.full.pubkey);
    expect(onRoot).toHaveLength(1);
    expect(loadBackupRecord('a', player.deps.storage, address)?.id).toBe(onRoot[0]?.id);
    // A device with other Settings relays (only the game's) now restores.
    const desk = h.game(rootId, h.profile('a', { store: memoryStorage(), signer: keys.full }).deps);
    await waitFor('the restore', () => desk.restore.value === 'restored');
  }, 60_000);

  it("review M1: a backup of the wrong keys on the game's relays is replaced when the joining device opens the game", async () => {
    const a = h.profile('a', { nip44: true });
    const b = h.profile('b', { nip44: true });
    const { rootId, address, bySeat } = await h.start2('chess', a, b);
    const A = a.deps.signer.pubkey;
    const [first] = await backupsOf(A);
    const theirs = loadSecrets('b', b.deps.storage, address);
    if (first === undefined || theirs === null) throw new Error('no backup');
    // A newer backup by A of other keys (as a lost double-Join race would leave) replaces the good one.
    const text = encodeKeyBackup({
      table: address,
      sessionSk: bytesToHex(theirs.sessionSk),
      deckSecret: bytesToHex(theirs.deckSecret),
      rootId,
      seat: 0,
    });
    const content = await (a.deps.signer.nip44 as NonNullable<Signer['nip44']>).encrypt(A, text);
    const bad = await a.deps.signer.sign(keyBackupTemplate(address, content, first.created_at + 1));
    await a.deps.pool.publish(bad, [h.relay.url]);
    const root = await rootOf(rootId);
    expect(await restore(a.deps.signer, root, await backupsOf(A))).toEqual({ kind: 'mismatch' });
    await pause(1100); // so the new backup is dated after the bad one
    const player = bySeat.find((p) => p.deps.signer.pubkey === A) as Profile;
    const phone = h.game(rootId, player.deps);
    await waitFor('the backup replaced', () => phone.backup.value === 'done');
    const now = await backupsOf(A);
    expect(now.map((e) => e.id)).not.toContain(bad.id);
    expect(await restore(a.deps.signer, root, now)).toMatchObject({ kind: 'restored' });
  }, 60_000);

  it("review M1: with an extension, the recorded backup found on the game's relays is done without a decrypt prompt", async () => {
    const keys = keyPair();
    let decrypts = 0;
    const ext: Signer = {
      ...keys.full,
      kind: 'nip07',
      nip44: {
        encrypt: (keys.full.nip44 as NonNullable<Signer['nip44']>).encrypt,
        decrypt: async (pk, payload) => {
          decrypts++;
          return (keys.full.nip44 as NonNullable<Signer['nip44']>).decrypt(pk, payload);
        },
      },
    };
    const { rootId, address, bySeat } = await h.start2(
      'chess',
      h.profile('a', { signer: ext }),
      h.profile('b'),
    );
    const player = bySeat.find((p) => p.deps.signer.pubkey === ext.pubkey) as Profile;
    const [ev] = await backupsOf(ext.pubkey);
    await waitFor('the record', () => loadBackupRecord('a', player.deps.storage, address)?.id === ev?.id);
    const before = decrypts; // the one decrypt that confirmed the ciphertext before publishing (review L2)
    const phone = h.game(rootId, player.deps);
    await waitFor('the backup checked', () => phone.backup.value === 'done');
    expect(decrypts).toBe(before);
  }, 60_000);

  it('review R1: a root relay that stays dead does not stop a local key from publishing its missing backup', async () => {
    const keys = keyPair();
    const dead = 'ws://127.0.0.1:9';
    // Joined with an app that made no backup, at a table whose relays include one that never answers.
    const { rootId, address, bySeat } = await h.start2(
      'chess',
      h.profile('a', { signer: keys.plain }),
      h.profile('b'),
      undefined,
      [h.relay.url, dead],
    );
    const player = bySeat.find((p) => p.deps.signer.pubkey === keys.plain.pubkey) as Profile;
    // An older app recorded a backup anyway.
    player.deps.storage.setItem(backupRecordKey('a', address), JSON.stringify({ at: 1, rootId: null }));
    const phone = h.game(rootId, { ...player.deps, signer: keys.full });
    await waitFor('the backup published', () => phone.backup.value === 'done', 60_000);
    expect(await backupsOf(keys.full.pubkey)).toHaveLength(1);
  }, 90_000);

  it('review R2: an extension with no recorded backup id is offered the button, even with a backup on the relays', async () => {
    const keys = keyPair();
    const ext: Signer = { ...keys.full, kind: 'nip07' };
    const { rootId, address, bySeat } = await h.start2(
      'chess',
      h.profile('a', { signer: ext }),
      h.profile('b'),
    );
    const player = bySeat.find((p) => p.deps.signer.pubkey === ext.pubkey) as Profile;
    await backupsOf(ext.pubkey);
    // A record without an id (an older app, or a restore): nothing says the backup there is this device's.
    player.deps.storage.setItem(backupRecordKey('a', address), JSON.stringify({ at: 1, rootId: null }));
    const phone = h.game(rootId, player.deps);
    await waitFor('the offer', () => phone.backup.value === 'due');
    await phone.backupKeys();
    expect(phone.backup.value).toBe('done');
  }, 60_000);
});
