/*
 * The protocol 2 refeed and persistence contract in the game controller (v2 build T15; PLAN, Phase v2, the T15 notes;
 * D070): every held event's first-seen time is saved, rejected ones included; a load refeeds in first-seen order at
 * the saved times, then ticks; `standingTimes()`, `confirmedForfeits()` and `countedResult()` are saved and passed
 * back; each completed sync is reported (`noteSync`), so only a returning device is asked about its own forfeit; a
 * counted claim whose events a sync did not bring is fetched again by its head. Chess v2 over the dev relay.
 */
import type { ChessState } from '@bored-games/chess';
import type { SessionViewV2 } from '@bored-games/client';
import { finalizeEvent, KIND, moveTemplate, type NostrEvent } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type GameController, loadSeen, loadV2State } from '../src/game-controller.ts';
import type { PoolLike } from '../src/net.ts';
import { loadSecrets } from '../src/storage.ts';
import { Harness, now, type Profile, pause, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

const chessMove = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });
const v2view = (c: GameController): SessionViewV2 | null => c.view.value as SessionViewV2 | null;
const history = (c: GameController): number =>
  (c.view.value?.state as ChessState | null)?.history.length ?? 0;

async function play(c: GameController, seat: number, uci: string, seq: number): Promise<void> {
  await waitFor(`seat ${seat}'s turn`, () => c.status.value === 'your-turn');
  await c.act(chessMove(seat, uci));
  await waitFor(`move ${seq}`, () => history(c) === seq);
}

/** A clock this test moves: Unix seconds plus `skew`. */
function clock() {
  const c = { skew: 0, now: () => now() + c.skew };
  return c;
}

/**
 * A pool whose game syncs (the paged subscriptions, `limit`) deliver what the relay holds in reverse order, and drop
 * the events in `hidden`; targeted queries (no `limit`) get everything, in the relay's order.
 */
function reordering(real: PoolLike, hidden: ReadonlySet<string> = new Set()) {
  const net = {
    published: [] as string[],
    pool: {
      subscribe: (filters, onEvent, onEose, opts) => {
        if (!filters.some((f) => f.limit !== undefined))
          return real.subscribe(filters, onEvent, onEose, opts);
        let held: [NostrEvent, string][] | null = [];
        return real.subscribe(
          filters,
          (ev, url) => {
            if (hidden.has(ev.id)) return;
            if (held === null) onEvent(ev, url);
            else held.push([ev, url]);
          },
          (info) => {
            const batch = (held ?? []).reverse();
            held = null;
            for (const [ev, url] of batch) onEvent(ev, url);
            onEose?.(info);
          },
          opts,
        );
      },
      publish: async (ev: NostrEvent, urls?: readonly string[]) => {
        net.published.push(ev.id);
        return real.publish(ev, urls);
      },
      addRelays: (urls: readonly string[]) => real.addRelays?.(urls),
    } as PoolLike,
  };
  return net;
}

/** A started v2 Chess game; each profile on its own clock. */
async function chess(): Promise<{
  rootId: string;
  address: string;
  white: Profile;
  black: Profile;
  wc: ReturnType<typeof clock>;
  bc: ReturnType<typeof clock>;
}> {
  const wc = clock();
  const bc = clock();
  const a = h.profile('a');
  const b = h.profile('b');
  const { rootId, address, bySeat } = await h.start2('chess', a, b);
  const [w, bl] = bySeat;
  const white = { ...w, deps: { ...w.deps, now: (w === a ? wc : bc).now } };
  const black = { ...bl, deps: { ...bl.deps, now: (w === a ? bc : wc).now } };
  return { rootId, address, white, black, wc: w === a ? wc : bc, bc: w === a ? bc : wc };
}

describe('The protocol 2 refeed and persistence contract (T15)', () => {
  it('a reload in another arrival order gives the same game and deadline; a rejected event keeps its first-seen time', async () => {
    const { rootId, address, white, black, wc, bc } = await chess();
    let gw = h.game(rootId, white.deps);
    const gb = h.game(rootId, black.deps);
    await play(gw, 0, 'e2e4', 1);
    wc.skew = bc.skew = 100;
    await play(gb, 1, 'e7e5', 2);
    await waitFor('move 2 at White', () => history(gw) === 2);
    wc.skew = bc.skew = 200;
    await play(gw, 0, 'g1f3', 3);
    await waitFor('move 3 at Black', () => history(gb) === 3);
    // Black's junk: a move of a bad shape on the head. The session holds it, rejected, and its time is saved.
    const secrets = loadSecrets(black.name, black.deps.storage, address);
    if (secrets === null) throw new Error('no game keys');
    const head = gw.view.value?.head as { id: string; seq: number };
    const junk = finalizeEvent(
      moveTemplate(
        {
          rootId,
          prevId: head.id,
          seq: head.seq + 1,
          content: {
            type: 'action',
            action: { type: 'move', actor: 1, uci: 'a1a1' },
            shares: [],
            reveals: [],
          },
        },
        now(),
        '2',
      ),
      secrets.sessionSk,
      rnd,
    );
    wc.skew = 300;
    await h.pool().publish(junk);
    await waitFor('the junk seen', () => loadSeen(white.deps.storage, white.name, rootId).has(junk.id));
    const junkSeen = loadSeen(white.deps.storage, white.name, rootId).get(junk.id) as number;
    expect(Math.abs(junkSeen - (now() + 300))).toBeLessThanOrEqual(2);
    const before = gw.view.value as SessionViewV2;
    expect(before.head.id).toBe(head.id);
    gw.dispose();

    // Much later, the relay sends everything in reverse order.
    wc.skew = 5000;
    const net = reordering(h.pool());
    gw = h.game(rootId, { ...white.deps, pool: net.pool });
    await waitFor('the reloaded game', () => gw.status.value !== 'syncing' && history(gw) === 3);
    const after = gw.view.value as SessionViewV2;
    expect(after.head.id).toBe(before.head.id);
    expect(after.pendingSince).toBe(before.pendingSince);
    expect(after.pendingSince).toBeLessThan(now() + 1000);
    expect(after.phase).toBe('play');
    expect(gw.timeoutTarget.value).toBeNull();
    expect(loadSeen(white.deps.storage, white.name, rootId).get(junk.id)).toBe(junkSeen);
  }, 60_000);

  it('a reload with a counted claim keeps it, whatever the order, a late move of the timed-out seat included; its events are fetched again when a sync lacks them', async () => {
    const { rootId, address, white, black, wc } = await chess();
    let gw = h.game(rootId, white.deps);
    const gb = h.game(rootId, black.deps);
    await play(gw, 0, 'e2e4', 1);
    await waitFor('move 1 at Black', () => history(gb) === 1);
    gb.dispose();
    // On White's clock Black's deadline passes: White claims and the claim counts here.
    wc.skew = 86400 + 60;
    gw.tick();
    await waitFor('a timeout target', () => gw.timeoutTarget.value === 1);
    await gw.claimTimeout();
    await waitFor('the claim counted', () => gw.view.value?.phase === 'done');
    expect(gw.view.value?.outcome?.reason).toBe('forfeit');
    const counted = loadV2State(white.deps.storage, white.name, rootId).counted;
    expect(counted).toMatchObject({ kind: 'claim', forfeit: [1] });
    const claimId = counted?.id as string;
    // Black's own tooling then plays its late move on the head (Black's clock: still in time).
    const outside = await h.outsideSession(rootId, address, black);
    const late = outside.buildAction(chessMove(1, 'e7e5'), rnd, now());
    wc.skew = 86400 + 120;
    await h.pool().publish(late);
    await waitFor('the late move held', () => loadSeen(white.deps.storage, white.name, rootId).has(late.id));
    expect(gw.view.value?.phase).toBe('done');
    const outcome = gw.view.value?.outcome;
    gw.dispose();

    // Reload 1: everything, in reverse order (the late move before the claim).
    wc.skew = 86400 + 1000;
    gw = h.game(rootId, { ...white.deps, pool: reordering(h.pool()).pool });
    await waitFor('the reloaded game', () => gw.status.value !== 'syncing' && gw.view.value !== null);
    await waitFor('the claim again', () => gw.view.value?.phase === 'done');
    expect(gw.view.value?.outcome).toEqual(outcome);
    expect(history(gw)).toBe(1);
    gw.dispose();

    // Reload 2: the game sync lacks the claim. The saved counted result keeps the game ended (no decision owed),
    // and the controller asks the relays for the claims naming its head: the claim comes back and counts.
    gw = h.game(rootId, { ...white.deps, pool: reordering(h.pool(), new Set([claimId])).pool });
    await waitFor('the reloaded game', () => gw.status.value !== 'syncing' && gw.view.value !== null);
    expect(gw.legal.value).toEqual([]);
    await waitFor('the claim fetched again', () => gw.view.value?.phase === 'done');
    expect(v2view(gw)?.awaitingCounted).toBeNull();
    expect(gw.view.value?.outcome).toEqual(outcome);
  }, 60_000);

  it('a reload with a standing result keeps it, and sends nothing more', async () => {
    const { rootId, address, white, black, bc } = await chess();
    const gw = h.game(rootId, white.deps);
    let gb = h.game(rootId, black.deps);
    await play(gw, 0, 'f2f3', 1);
    await play(gb, 1, 'e7e5', 2);
    const m2 = gb.view.value?.head.id as string;
    await play(gw, 0, 'g2g4', 3);
    await play(gb, 1, 'd8h4', 4);
    for (const g of [gw, gb]) {
      await waitFor('the end', () => g.view.value?.phase === 'done', 15_000);
      await waitFor('both end attestations', () => v2view(g)?.endAttested.length === 2, 15_000);
      await waitFor('both stats attestations', () => g.view.value?.attested.length === 2, 15_000);
    }
    const outcome = gb.view.value?.outcome;
    // White's own tooling then signs a rival third move: a fork by White (E). Black attested the result and has
    // nothing off its line, so the result stands against the fork (PROTOCOL-v2 §5.4).
    const tmpl = moveTemplate(
      {
        rootId,
        prevId: m2,
        seq: 3,
        content: { type: 'action', action: chessMove(0, 'h2h3'), shares: [], reveals: [] },
      },
      now(),
      '2',
    );
    const secrets = loadSecrets(white.name, white.deps.storage, address);
    if (secrets === null) throw new Error('no game keys');
    const rival = finalizeEvent(tmpl, secrets.sessionSk, rnd);
    bc.skew = 50;
    await h.pool().publish(rival);
    await waitFor('the fork at Black', () => v2view(gb)?.fork?.seat === 0, 15_000);
    await waitFor('the standing result', () => v2view(gb)?.stood === true, 15_000);
    expect(gb.view.value?.outcome).toEqual(outcome);
    const standing = loadV2State(black.deps.storage, black.name, rootId).standing;
    expect(Object.keys(standing)).toHaveLength(1);
    const at = Object.values(standing)[0] as number;
    const pendingSince = gb.view.value?.pendingSince;
    gb.dispose();
    const before = (await h.query([{ '#e': [rootId] }])).map((ev) => ev.id).sort();

    // Much later: the same standing result, the same first-standing time and deadline, nothing published.
    bc.skew = 7200;
    const net = reordering(h.pool());
    gb = h.game(rootId, { ...black.deps, pool: net.pool });
    await waitFor('the reloaded game', () => gb.status.value !== 'syncing' && v2view(gb)?.stood === true);
    expect(gb.view.value?.outcome).toEqual(outcome);
    expect(v2view(gb)?.fork?.seat).toBe(0);
    expect(gb.view.value?.pendingSince).toBe(pendingSince);
    gb.tick();
    await pause(1000);
    expect(loadV2State(black.deps.storage, black.name, rootId).standing).toEqual({
      [Object.keys(standing)[0] as string]: at,
    });
    expect(net.published).toEqual([]);
    expect((await h.query([{ '#e': [rootId] }])).map((ev) => ev.id).sort()).toEqual(before);
  }, 60_000);

  it('the own-forfeit question appears only on a returning device; its answer counts the claim and survives a reload', async () => {
    const { rootId, address, white, black, wc } = await chess();
    const gw = h.game(rootId, white.deps);
    // Black's phone watches the game; its tablet is closed.
    const phone = h.game(rootId, black.deps);
    await waitFor('the phone loaded', () => phone.status.value !== 'syncing' && phone.view.value !== null);
    // Past the second the phone's sync ended in: first-seen times are whole seconds, and an event first seen in that
    // second counts as part of the sync (a window too wide asks a watching player; it never accepts by itself).
    await pause(2100);
    await play(gw, 0, 'e2e4', 1);
    await waitFor('move 1 at the phone', () => history(phone) === 1);
    // White's clock runs fast: Black's deadline passes there, and White claims.
    wc.skew = 86400 + 60;
    gw.tick();
    await waitFor('a timeout target', () => gw.timeoutTarget.value === 1);
    await gw.claimTimeout();
    const claimId = loadV2State(white.deps.storage, white.name, rootId).counted?.id as string;
    await waitFor('the claim at the phone', () =>
      loadSeen(black.deps.storage, black.name, rootId).has(claimId),
    );
    await pause(500);
    phone.tick();
    // The phone watched the head arrive: it is not asked, and the claim does not count by Black's own clock.
    expect(v2view(phone)?.ownForfeit).toBeNull();
    expect(phone.view.value?.phase).toBe('play');

    // Black's tablet opens: everything it holds came in this sync, so it asks.
    const tabletDev = h.secondDevice(black, address);
    let tablet = h.game(rootId, tabletDev.deps);
    await waitFor(
      'the question',
      () => v2view(tablet)?.ownForfeit !== null && v2view(tablet)?.ownForfeit !== undefined,
      30_000,
    );
    const asked = v2view(tablet)?.ownForfeit;
    expect(asked?.head).toBe(gw.view.value?.head.id);
    expect(tablet.view.value?.phase).toBe('play');
    expect(tablet.confirmOwnForfeit()).toBe(true);
    expect(tablet.view.value?.phase).not.toBe('play');
    expect(loadV2State(tabletDev.deps.storage, tabletDev.name, rootId).confirmed).toEqual([asked?.claim]);
    await waitFor('the result on the tablet', () => tablet.view.value?.phase === 'done');
    const outcome = tablet.view.value?.outcome;
    tablet.dispose();
    // Reloaded, the tablet keeps the answer.
    tablet = h.game(rootId, tabletDev.deps);
    await waitFor(
      'the reloaded tablet',
      () => tablet.status.value !== 'syncing' && tablet.view.value?.phase === 'done',
    );
    expect(tablet.view.value?.outcome).toEqual(outcome);
    expect(v2view(tablet)?.ownForfeit).toBeNull();
  }, 60_000);
});
