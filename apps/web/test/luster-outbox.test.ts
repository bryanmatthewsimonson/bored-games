/*
 * Luster's saved prompt shares are vetted like moves (D056, audit-luster F3). A Shares event carries no head, so one
 * built on a branch that later lost fork choice still verifies on the winner, where its card may be undrawn or this
 * very seat's own blind reservation. Real controllers against the dev relay; the shuffle makes this slow.
 */
import { GameSession } from '@bored-games/client';
import type { LusterState } from '@bored-games/luster';
import { KIND, type NostrEvent, parseRoot, parseShares } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameController } from '../src/game-controller.ts';
import { bytesToHex } from '../src/hex.ts';
import { MODULES } from '../src/net.ts';
import { loadGameStatus, loadSecrets } from '../src/storage.ts';
import { Harness, now, offlinePool, outboxSlots, pause, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

type Action = { type: string; deck?: string; pos?: number };

describe('Luster: saved card reveals are vetted before they are published (D056, audit-luster F3)', () => {
  it('a stale reveal after a fork switch is discarded, and a reveal of the seat’s own blind reservation is never sent', async () => {
    const { rootId, address, bySeat } = await h.start2('luster', h.profile('a'), h.profile('b'));
    const games = bySeat.map((p) => h.game(rootId, p.deps));
    const first = await waitFor(
      'the first decision',
      () => games.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      240_000,
    );
    const e = games.indexOf(first);
    const hs = 1 - e;
    const H = bySeat[hs] as (typeof bySeat)[number];
    const E = bySeat[e] as (typeof bySeat)[number];
    const x = first.view.value?.head as { id: string; seq: number };
    for (const g of games) g.dispose();

    // E's own session, outside any controller, to sign two rival moves on one parent.
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
        seat: e,
        sessionSk: secrets.sessionSk,
        deckSecret: BigInt(`0x${bytesToHex(secrets.deckSecret)}`),
      },
      rootSeenAt: now(),
    });
    for (const ev of await h.query([{ kinds: [KIND.move, KIND.shares], '#e': [rootId] }]))
      es.receive(ev, now());
    expect(es.view().head.id).toBe(x.id);
    const state = es.view().state as LusterState;
    const legal = es.legalActions() as Action[];
    const marketTier1 = new Set((state.market[0] ?? []).flatMap((c) => (c === null ? [] : [c.pos])));
    // A: reserve a face-up tier-1 card, so the market refills from the top of tier 1 (a public reveal of p).
    const reserveA = legal.find(
      (a) => a.type === 'reserve' && a.deck === 'tier-1' && marketTier1.has(a.pos ?? -1),
    );
    // B: take gems; nothing is drawn, so the top of tier 1 stays unseen.
    const take = legal.find((a) => a.type === 'take');
    if (reserveA === undefined || take === undefined) throw new Error('no reserve or take for E');
    const p = state.decks['tier-1'].next; // tier 1 sits at offset 0 of the packet: the physical position too.
    const A = es.buildAction(reserveA, rnd, now());
    let B = es.buildAction(take, rnd, now());
    for (let t = 1; B.id >= A.id; t++) B = es.buildAction(take, rnd, now() + t);

    // H's tablets, with no network for publishing: T1 stays open, T2 is reloaded later.
    const t1Dev = h.secondDevice(H, address);
    const t2Dev = h.secondDevice(H, address);
    const n1 = offlinePool(t1Dev.deps.pool);
    const n2 = offlinePool(t2Dev.deps.pool);
    const t1 = h.game(rootId, { ...t1Dev.deps, pool: n1.pool });
    let t2: GameController = h.game(rootId, { ...t2Dev.deps, pool: n2.pool });
    for (const t of [t1, t2]) await waitFor('a tablet at the head', () => t.view.value?.head.id === x.id);

    // A arrives: both tablets owe their share of p at once, and save it unsent.
    await h.pool().publish(A);
    const slot = `share:${p}`;
    for (const dev of [t1Dev, t2Dev])
      await waitFor('the saved reveal', () => outboxSlots(dev, rootId).includes(slot), 60_000);
    // Both seats owe that reveal now (D060): E has not sent its share, and T1's is saved but on no relay. The game
    // screen and Home name them, with the deadline.
    await waitFor('the owed reveal', () => t1.owed.value?.seats.length === 2);
    expect(t1.owed.value?.until).toBe((t1.view.value?.pendingSince ?? 0) + 86400);
    const cached = loadGameStatus(t1Dev.name, t1Dev.deps.storage, rootId);
    expect(cached?.reveal).toEqual({
      npubs: [root.seats[e]?.npub],
      mine: true,
      until: t1.owed.value?.until,
    });
    t2.dispose();

    // B, with the lower id, arrives: fork choice moves to B, where p is not drawn.
    await h.pool().publish(B);
    await waitFor('T1 on B', () => t1.view.value?.head.id === B.id);
    const hKey = root.seats[hs]?.session as string;
    const sharesOfP = async () =>
      (await h.query([{ kinds: [KIND.shares], authors: [hKey], '#e': [rootId] }])).filter((ev) =>
        parseShares(ev).shares.some((s) => s.pos === p),
      );

    // T1 reconnects: the saved reveal is vetted and discarded (p is not drawn on B), and never published.
    n1.offline = false;
    t1.tick();
    await waitFor('the T1 discard', () => t1.log.value.length === 1);
    expect(t1.log.value[0]).toMatch(/card reveal saved on this device was never sent.*not drawn/);
    expect(outboxSlots(t1Dev, rootId)).not.toContain(slot);
    expect(await sharesOfP()).toEqual([]);

    // On B, H blind-reserves the top of tier 1 from its phone: p is now H's own private card.
    const phone = h.game(rootId, H.deps);
    await waitFor('H to move on B', () => phone.status.value === 'your-turn' && phone.legal.value.length > 0);
    const blind = (phone.legal.value as Action[]).find(
      (a) => a.type === 'reserve' && a.deck === 'tier-1' && a.pos === p,
    );
    if (blind === undefined) throw new Error('no blind reserve of p');
    await phone.act(blind);
    await waitFor('T1 sees it', () => t1.view.value?.head.seq === x.seq + 2);

    // T2 comes back online: its saved reveal of p would hand out H's own layer; it is discarded, never sent.
    n2.offline = false;
    t2 = h.game(rootId, { ...t2Dev.deps, pool: n2.pool });
    await waitFor('the T2 discard', () => t2.log.value.length === 1, 60_000);
    expect(t2.log.value[0]).toMatch(/card reveal saved on this device was never sent.*your own private card/);
    expect(outboxSlots(t2Dev, rootId)).not.toContain(slot);
    await pause(500);
    expect(n2.published).toEqual([]);
    expect(n1.published).toEqual([]);
    expect(await sharesOfP()).toEqual([]);
  }, 400_000);
});
