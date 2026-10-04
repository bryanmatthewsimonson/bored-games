/*
 * Two devices of one seat (D059 item 2, audit-bank F3): the check before signing and deterministic automatic builds.
 * Each device is a GameController with the same player key and game keys and storage of its own, against the real
 * dev relay. Chess and Bank are deckless, so these are fast.
 */

import { GameSession } from '@bored-games/client';
import { startDevRelay } from '@bored-games/dev-relay';
import { KIND, type NostrEvent, parseRoot } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALREADY_MOVED, type GameController, HOLD_CAP_S } from '../src/game-controller.ts';
import { bytesToHex } from '../src/hex.ts';
import { MODULES, type PoolLike } from '../src/net.ts';
import { loadSecrets } from '../src/storage.ts';
import { Harness, laggingOwn, now, outboxSlots, type Profile, pause, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

/** The session key of `seat` in the game. */
async function sessionKey(rootId: string, seat: number): Promise<string> {
  const root = (await h.query([{ ids: [rootId] }]))[0] as NostrEvent;
  return parseRoot(root).seats[seat]?.session as string;
}

/** Moves on `parent` signed by `key`. */
async function movesOn(parent: string, key: string): Promise<NostrEvent[]> {
  const evs = await h.query([{ kinds: [KIND.move], authors: [key], '#e': [parent] }]);
  return evs.filter((ev) => ev.tags.some((t) => t[0] === 'e' && t[1] === parent && t[3] === 'prev'));
}

describe('The check before signing (D059 item 2)', () => {
  it('a move this seat already made on another device is adopted, not answered with a rival', async () => {
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const wKey = await sessionKey(rootId, 0);
    const phone = h.game(rootId, white.deps);
    const blackGame = h.game(rootId, black.deps);
    // The tablet's live feed has not delivered the phone's moves yet (a lagging subscription).
    const tablet = h.secondDevice(white, address);
    const net = laggingOwn(tablet.deps.pool, () => wKey);
    const t = h.game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn');
    await waitFor('the phone decision', () => phone.status.value === 'your-turn');
    const root = t.view.value?.head.id as string;

    await phone.act({ type: 'move', actor: 0, uci: 'e2e4' });
    await waitFor('Black sees the move', () => blackGame.view.value?.head.seq === 1);
    expect(t.view.value?.head.seq).toBe(0);
    // The tablet plays another move on the same parent: the check finds the phone's and folds it in instead.
    await expect(t.act({ type: 'move', actor: 0, uci: 'd2d4' })).rejects.toThrow(ALREADY_MOVED);
    expect(t.view.value?.head.seq).toBe(1);
    expect(net.published).toEqual([]);
    expect(outboxSlots(tablet, rootId)).toEqual([]);
    expect(await movesOn(root, wKey)).toHaveLength(1);
    await pause(300);
    for (const g of [phone, blackGame, t]) expect(g.view.value?.equivocators).toEqual([]);
  }, 60_000);

  it("queries the player's own relays too: a move held only there is found (D059 item 2, F2)", async () => {
    const own = await startDevRelay({ port: 0 });
    h.later(() => own.close());
    const { rootId, address, bySeat } = await h.start2(
      'chess',
      h.profile('a', { extra: [own.url] }),
      h.profile('b'),
    );
    const [white] = bySeat;
    const wKey = await sessionKey(rootId, 0);
    // The phone's move reached only the player's own relay (the root's relay lost it, or never got it).
    const phonePool = h.pool([h.relay.url, own.url]);
    const phone = h.game(rootId, {
      ...white.deps,
      pool: {
        subscribe: (f, e, o, x) => phonePool.subscribe(f, e, o, x),
        publish: (ev) => phonePool.publish(ev, [own.url]),
        addRelays: (u) => phonePool.addRelays(u),
      },
    });
    const tablet = h.secondDevice(white, address, [own.url]);
    const net = laggingOwn(tablet.deps.pool, () => wKey);
    const t = h.game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn');
    await waitFor('the phone decision', () => phone.status.value === 'your-turn');
    await phone.act({ type: 'move', actor: 0, uci: 'e2e4' });
    let onOwn: NostrEvent[] = [];
    for (let i = 0; i < 200 && onOwn.length === 0; i++) {
      onOwn = await h.query([{ kinds: [KIND.move], authors: [wKey] }], own.url);
      if (onOwn.length === 0) await pause(25);
    }
    expect(onOwn).toHaveLength(1);
    expect(await h.query([{ kinds: [KIND.move], authors: [wKey] }])).toEqual([]);
    expect(t.view.value?.head.seq).toBe(0);

    await expect(t.act({ type: 'move', actor: 0, uci: 'd2d4' })).rejects.toThrow(ALREADY_MOVED);
    expect(t.view.value?.head.id).toBe(onOwn[0]?.id);
    expect(net.published).toEqual([]);
  }, 60_000);
});

describe('The check before signing is bounded (D059 item 2)', () => {
  it('holds a move while a live relay of the player stays silent, and stops waiting after the hold cap', async () => {
    const SILENT = 'wss://silent.test';
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white] = bySeat;
    let skew = 0;
    const dev = h.secondDevice(white, address, [SILENT]);
    const real = dev.deps.pool;
    // SILENT is one of the player's relays: alive (never reported dead) but it never answers.
    const pool: PoolLike = {
      publish: (ev, urls) => real.publish(ev, urls),
      subscribe: (f, onEvent, onEose, o) =>
        real.subscribe(f, onEvent, onEose && ((info) => onEose({ ...info, relays: info.relays + 1 })), o),
    };
    const t = h.game(rootId, { ...dev.deps, pool, now: () => now() + skew });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn');
    await expect(t.act({ type: 'move', actor: 0, uci: 'e2e4' })).rejects.toThrow(
      /not every relay has answered/,
    );
    expect(t.view.value?.head.seq).toBe(0);
    skew = HOLD_CAP_S + 1;
    await t.act({ type: 'move', actor: 0, uci: 'e2e4' });
    expect(t.view.value?.head.seq).toBe(1);
  }, 60_000);
});

describe('A deterministic build does not copy an implausible head date (D063)', () => {
  /** A 2-seat Bank game whose roller signs its Roll dated `at` outside any controller; the contributor's controller. */
  async function rollDated(at: number) {
    const { rootId, address, bySeat } = await h.start2('bank', h.profile('a'), h.profile('b'));
    const rootEv = (await h.query([{ ids: [rootId] }]))[0] as NostrEvent;
    const root = parseRoot(rootEv);
    const [, creator, tableId] = root.tableAddress.split(':') as [string, string, string];
    const table = (
      await h.query([{ kinds: [KIND.table], authors: [creator], '#d': [tableId] }])
    )[0] as NostrEvent;
    const joins = await h.query([{ ids: [...root.joinIds] }]);
    const sessions = bySeat.map((p, seat) => {
      const secrets = loadSecrets(p.name, p.deps.storage, address);
      if (secrets === null) throw new Error('no secrets');
      return GameSession.create({
        modules: MODULES,
        table,
        joins,
        root: rootEv,
        me: { seat, sessionSk: secrets.sessionSk, deckSecret: BigInt(`0x${bytesToHex(secrets.deckSecret)}`) },
        rootSeenAt: now(),
      });
    });
    const roller = sessions.findIndex((s) => s.legalActions().length > 0);
    const rs = sessions[roller] as GameSession;
    const roll = rs.legalActions().find((a) => (a as { type?: string }).type === 'roll');
    const ev = rs.buildAction(roll, rnd, at);
    const contributor = bySeat[1 - roller] as Profile;
    const g = h.game(rootId, contributor.deps);
    await waitFor('the contributor loaded', () => g.view.value !== null && g.status.value !== 'syncing');
    await h.pool().publish(ev);
    await waitFor('the contribution', () => g.view.value?.head.seq === 2);
    const key = root.seats[1 - roller]?.session as string;
    return (await movesOn(ev.id, key))[0] as NostrEvent;
  }

  it('a Roll dated an hour ahead, or in 1970, gets a contribution dated now', async () => {
    for (const at of [now() + 3600, 1]) {
      const before = now();
      const c = await rollDated(at);
      expect(c.created_at).toBeGreaterThanOrEqual(before);
      expect(c.created_at).toBeLessThanOrEqual(now());
    }
  }, 60_000);
});

describe('Bank: two devices of one seat contribute to a roll once (audit-bank F3)', () => {
  /** A 2-seat Bank game; returns the roller's and the contributor's profiles and their controllers. */
  async function bank() {
    const { rootId, address, bySeat } = await h.start2('bank', h.profile('a'), h.profile('b'));
    const games = bySeat.map((p) => h.game(rootId, p.deps));
    const roller = await waitFor('the first roll', () =>
      games.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
    );
    const rollerSeat = games.indexOf(roller);
    const other = 1 - rollerSeat;
    return { rootId, address, roller, rollerSeat, other, contributor: bySeat[other] as Profile, games };
  }

  const rollOf = (g: GameController) =>
    g.legal.value.find((a) => (a as { type?: string }).type === 'roll') as object | undefined;

  it('two open devices that both see the roll publish one contribution, and nobody is flagged', async () => {
    const { rootId, address, roller, other, contributor, games } = await bank();
    const key = await sessionKey(rootId, other);
    const tablet = h.secondDevice(contributor, address);
    const t = h.game(rootId, tablet.deps);
    await waitFor('the tablet loaded', () => t.status.value !== 'syncing' && t.view.value !== null);
    await roller.act(rollOf(roller));
    const rollId = roller.view.value?.head.id as string;
    // Both devices of the contributor build their share of the roll at once.
    for (const g of [...games, t])
      await waitFor('the roll resolved', () => (g.view.value?.head.seq ?? 0) >= 2);
    const contributions = await movesOn(rollId, key);
    expect(contributions).toHaveLength(1);
    await pause(300);
    for (const g of [...games, t]) {
      expect(g.view.value?.equivocators).toEqual([]);
      expect(g.view.value?.head.id).toBe(games[0]?.view.value?.head.id);
    }
  }, 60_000);

  it('a device that opens after the other device contributed adopts that contribution and signs nothing', async () => {
    const { rootId, address, roller, other, contributor, games } = await bank();
    const key = await sessionKey(rootId, other);
    await roller.act(rollOf(roller));
    const rollId = roller.view.value?.head.id as string;
    for (const g of games) await waitFor('the roll resolved', () => (g.view.value?.head.seq ?? 0) >= 2);
    expect(await movesOn(rollId, key)).toHaveLength(1);
    // The tablet opens with a lagging feed that has not delivered its own seat's contribution: the session owes it.
    const tablet = h.secondDevice(contributor, address);
    const net = laggingOwn(tablet.deps.pool, () => key);
    const t = h.game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet adopted the contribution', () => t.view.value?.head.seq === 2);
    await pause(500);
    expect(net.published).toEqual([]);
    expect(outboxSlots(tablet, rootId)).toEqual([]);
    expect(await movesOn(rollId, key)).toHaveLength(1);
    for (const g of [...games, t]) expect(g.view.value?.equivocators).toEqual([]);
  }, 60_000);
});
