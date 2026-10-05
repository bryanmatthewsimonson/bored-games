/*
 * Never deal on two decks, with two devices of one seat (D056 F7, D063 review): a deal the phone published on the
 * rival deck of a shuffle fork is refused by the tablet's session once fork choice settles on the other deck, yet it
 * must still keep the tablet from publishing its own saved deal there. Chain Reaction, 3 seats; the shuffle is slow.
 */
import { GameSession } from '@bored-games/client';
import { KIND, type NostrEvent, parseRoot } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOutbox } from '../src/game-controller.ts';
import { bytesToHex } from '../src/hex.ts';
import { MODULES } from '../src/net.ts';
import { loadSecrets } from '../src/storage.ts';
import { Harness, hiding, now, OLDER, pause, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

describe('A seat on two devices never deals on two decks (D056 F7)', () => {
  it('the tablet keeps its saved deal on A unsent when the phone already dealt on B, after fork choice settles on A', async () => {
    // A v1 game (fork choice), started by a client from before protocol 2: this build's tables are proto 2.
    const { rootId, address, bySeat } = await h.start3('chain-reaction', [
      h.profile('a', OLDER),
      h.profile('b', OLDER),
      h.profile('c', OLDER),
    ]);
    const [H, s1, E] = bySeat as [(typeof bySeat)[0], (typeof bySeat)[0], (typeof bySeat)[0]];
    const phone0 = h.game(rootId, H.deps);
    const g1 = h.game(rootId, s1.deps);
    await waitFor('the first two shuffle steps', () => g1.view.value?.head.seq === 2, 120_000);
    phone0.dispose();

    // E, the last shuffler, signs two rival final steps; A has the lower id, so fork choice settles on A.
    const rootEv = (await h.query([{ ids: [rootId] }]))[0] as NostrEvent;
    const root = parseRoot(rootEv);
    const [, creator, tableId] = root.tableAddress.split(':') as [string, string, string];
    const table = (
      await h.query([{ kinds: [KIND.table], authors: [creator], '#d': [tableId] }])
    )[0] as NostrEvent;
    const joins = await h.query([{ ids: [...root.joinIds] }]);
    const secrets = loadSecrets(E.name, E.deps.storage, address);
    if (secrets === null) throw new Error('no secrets for E');
    const es = GameSession.create({
      modules: MODULES,
      table,
      joins,
      root: rootEv,
      me: {
        seat: 2,
        sessionSk: secrets.sessionSk,
        deckSecret: BigInt(`0x${bytesToHex(secrets.deckSecret)}`),
      },
      rootSeenAt: now(),
    });
    for (const m of await h.query([{ kinds: [KIND.move], '#e': [rootId] }])) es.receive(m, now());
    expect(es.view().head.seq).toBe(2);
    const [stepA, stepB] = [es.buildShuffle(rnd, now()), es.buildShuffle(rnd, now())].sort((x, y) =>
      x.id < y.id ? -1 : 1,
    ) as [NostrEvent, NostrEvent];
    const hKey = root.seats[0]?.session as string;
    const hShares = () => h.query([{ kinds: [KIND.shares], authors: [hKey], '#e': [rootId] }]);

    // The tablet holds A only and deals on it, but its publish fails: the deal is saved, unconfirmed.
    const tabletDev = h.secondDevice(H, address);
    const tNet = hiding(tabletDev.deps.pool, new Set([stepB.id]), true);
    await h.pool().publish(stepA);
    let t = h.game(rootId, { ...tabletDev.deps, pool: tNet.pool });
    const tDeal = await waitFor(
      'the tablet saved its deal on A',
      () => loadOutbox(tabletDev.deps.storage, tabletDev.name, rootId).get('deal'),
      120_000,
    );
    expect(tDeal.confirmed).toBe(false);
    t.dispose();

    // The phone holds B only, deals on it, and that deal is published.
    await h.pool().publish(stepB);
    const pNet = hiding(H.deps.pool, new Set([stepA.id]));
    const phone = h.game(rootId, { ...H.deps, pool: pNet.pool });
    await waitFor('the phone on B', () => phone.view.value?.head.id === stepB.id, 60_000);
    for (let i = 0; i < 2400 && (await hShares()).length === 0; i++) await pause(50);
    expect(await hShares()).toHaveLength(1);
    phone.dispose();

    // The tablet reloads online and holds both steps: fork choice settles on A, where the phone's deal is refused.
    // It must still count as this seat's deal: the tablet's A deal is kept, never sent.
    const t2Net = hiding(tabletDev.deps.pool, new Set());
    t = h.game(rootId, { ...tabletDev.deps, pool: t2Net.pool });
    await waitFor(
      'the tablet on A',
      () => t.view.value?.head.id === stepA.id && t.status.value !== 'syncing',
    );
    await pause(1500);
    t.tick();
    await pause(1500);
    expect(t2Net.published).not.toContain(tDeal.event.id);
    const shares = await hShares();
    expect(shares).toHaveLength(1);
    expect(shares[0]?.id).not.toBe(tDeal.event.id);
    expect(loadOutbox(tabletDev.deps.storage, tabletDev.name, rootId).get('deal')?.orphan).toBe(true);
  }, 300_000);
});
