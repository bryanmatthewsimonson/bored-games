/*
 * The outbox of a live tab in protocol 2 games (T21 web fixes, D073): an event this tab built whose first publish
 * failed is re-sent once every live counted relay answers, and is held under the hold cap and Send anyway otherwise
 * (F3); an own event becomes "first seen" when a relay first takes it, so a move sent late gives the next seat its
 * whole deadline (F2); and a fork made only by this seat's own unsent move is checked quietly, never shown as a stop,
 * and never re-queried in a loop (F1). Chess v2 over the dev relay.
 */
import type { ChessState } from '@bored-games/chess';
import type { SessionViewV2 } from '@bored-games/client';
import type { NostrEvent } from '@bored-games/protocol';
import { type EoseInfo, RelayPool } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKING_OWN_MOVE, type GameController, HOLD_CAP_S, loadOutbox } from '../src/game-controller.ts';
import type { PoolLike } from '../src/net.ts';
import { readJson, storageKey } from '../src/storage.ts';
import { Harness, now, offlinePool, pause, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

const chessMove = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });
const v2view = (c: GameController): SessionViewV2 | null => c.view.value as SessionViewV2 | null;
const history = (c: GameController): number =>
  (c.view.value?.state as ChessState | null)?.history.length ?? 0;

/** A clock this test moves: Unix seconds plus `skew`. */
function clock() {
  const c = { skew: 0, now: () => now() + c.skew };
  return c;
}

/** A relay URL that refuses connections: a root relay down for good. */
const DEAD = 'ws://127.0.0.1:9';

/** A relay of the player's that is connected but never answers while `silent` (D056); publishing is recorded. */
const SILENT = 'wss://silent.test';
function silencing(real: PoolLike) {
  const net = {
    silent: true,
    offline: false,
    published: [] as string[],
    pool: {
      subscribe: (filters, onEvent, onEose, opts) => {
        const silent = net.silent;
        return real.subscribe(
          filters,
          onEvent,
          onEose &&
            ((info: EoseInfo) =>
              onEose(
                silent
                  ? { ...info, relays: info.relays + 1, timedOut: true }
                  : { ...info, eosedUrls: [...(info.eosedUrls ?? []), SILENT] },
              )),
          opts,
        );
      },
      publish: async (ev: NostrEvent, urls?: readonly string[]) => {
        if (net.offline) return [{ url: 'offline', ok: false, message: 'offline' }];
        net.published.push(ev.id);
        return real.publish(
          ev,
          urls?.filter((u) => u !== SILENT),
        );
      },
      addRelays: (urls: readonly string[]) => real.addRelays?.(urls.filter((u) => u !== SILENT)),
    } as PoolLike,
  };
  return net;
}

describe('A live tab re-sends what its first publish missed (T21 web fixes, F3)', () => {
  it('V2-45: with a root relay down for good, a move whose first publish failed goes out on the next tick', async () => {
    const { rootId, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'), undefined, [
      h.relay.url,
      DEAD,
    ]);
    const [white, black] = bySeat;
    const gb = h.game(rootId, black.deps);
    // The pool reports the dead relay as dead quickly (the app's default is two minutes).
    const pool = new RelayPool([h.relay.url], { WebSocket, deadAfterMs: 300 });
    h.later(() => pool.close());
    const off = offlinePool(pool);
    off.offline = false;
    const gw = h.game(rootId, { ...white.deps, pool: off.pool });
    await waitFor('White to move', () => gw.status.value === 'your-turn', 60_000);
    await pause(1500);
    // The device is offline for a moment when it moves: the publish fails at every relay.
    off.offline = true;
    await gw.act(chessMove(0, 'e2e4'));
    await pause(300);
    off.offline = false;
    // The next tick re-sends it (before this fix, only a reload or a full answer from the dead relay did).
    gw.tick();
    await waitFor('the move at Black', () => history(gb) === 1, 15_000);
    expect(gw.canSendAnyway.value).toBe(false);
    expect([...loadOutbox(white.deps.storage, white.name, rootId).values()].every((e) => e.confirmed)).toBe(
      true,
    );
  }, 120_000);

  it('V2-45: with an own relay that never answers, the move is held, and Send anyway is offered past the hold cap and sends it', async () => {
    const wc = clock();
    const { rootId, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const gb = h.game(rootId, black.deps);
    const net = silencing(white.deps.pool);
    net.silent = false;
    const deps = { ...white.deps, now: wc.now, relays: () => [h.relay.url, SILENT], pool: net.pool };
    const gw = h.game(rootId, deps);
    await waitFor('White to move', () => gw.status.value === 'your-turn', 60_000);
    // The move's first publish fails; from then on the player's own relay is connected but silent.
    net.offline = true;
    await gw.act(chessMove(0, 'e2e4'));
    const move = loadOutbox(white.deps.storage, white.name, rootId).get(`move:1:${rootId}`)
      ?.event as NostrEvent;
    await pause(300);
    net.offline = false;
    net.silent = true;
    gw.tick();
    await pause(1000);
    expect(net.published).not.toContain(move.id);
    expect(gw.canSendAnyway.value).toBe(false);
    wc.skew = HOLD_CAP_S + 1;
    gw.tick();
    await waitFor('Send anyway offered', () => gw.canSendAnyway.value);
    gw.sendAnyway();
    await waitFor('the move sent anyway', () => net.published.includes(move.id));
    await waitFor('the move at Black', () => history(gb) === 1);
  }, 120_000);
});

describe('An own event is first seen when a relay first takes it (T21 web fixes, F2)', () => {
  it('V2-46: a move made offline and sent a day later gives the next seat its whole deadline; the seat’s devices play on with Black', async () => {
    const c = clock();
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const gb = h.game(rootId, { ...black.deps, now: c.now });
    const tablet = h.secondDevice(white, address);
    const off = offlinePool(tablet.deps.pool);
    const t = h.game(rootId, { ...tablet.deps, pool: off.pool, now: c.now });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn');
    await t.act(chessMove(0, 'e2e4'));
    // 25 hours pass for everyone (the deadline is 24 h); the tablet comes back and its move goes out.
    c.skew = 25 * 3600;
    off.offline = false;
    t.tick();
    gb.tick();
    await waitFor('Black sees the move', () => history(gb) === 1, 60_000);
    await waitFor('the tablet rebuilt with the move at its sending time', () => {
      t.tick();
      return t.timeoutTarget.value === null && history(t) === 1;
    });
    await pause(1000);
    t.tick();
    expect(t.timeoutTarget.value).toBeNull();
    expect(gb.status.value).toBe('your-turn');
    // The phone opens: no claim to adopt, it waits for Black like Black's own client.
    const phone = h.game(rootId, { ...white.deps, now: c.now });
    await waitFor('the phone loaded', () => history(phone) === 1);
    await pause(1500);
    expect(phone.view.value?.phase).toBe('play');
    expect(phone.view.value?.outcome).toBeNull();
    // Black really stalls: a full deadline after the move went out, the claim is offered on time, not later.
    c.skew += 86400 + 60;
    t.tick();
    await waitFor('the claim offered', () => {
      t.tick();
      return t.timeoutTarget.value === 1;
    });
  }, 180_000);
});

describe('A fork made only by an own unsent move is checked quietly (T21 web fixes, F1)', () => {
  it('V2-45: with a partial answer, the tablet queries the relays a few times, never shows a stop, and Send anyway resolves it', async () => {
    const tc = clock();
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white] = bySeat;
    const tablet = h.secondDevice(white, address);
    // A pool whose targeted queries get a partial answer (a root relay down) while `partial`; publishing can fail.
    const real = tablet.deps.pool;
    const net: { offline: boolean; partial: boolean; queries: number; pool: PoolLike } = {
      offline: true,
      partial: false,
      queries: 0,
      pool: {
        subscribe: (filters, onEvent, onEose, opts) => {
          const paged = filters.some((f) => f.limit !== undefined);
          if (!paged) net.queries++;
          return real.subscribe(
            filters,
            onEvent,
            (info: EoseInfo) => onEose?.(net.partial && !paged ? { ...info, eose: 0, eosedUrls: [] } : info),
            opts,
          );
        },
        publish: async (ev: NostrEvent, urls?: readonly string[]) =>
          net.offline ? [{ url: 'offline', ok: false, message: 'offline' }] : real.publish(ev, urls),
        addRelays: (urls: readonly string[]) => real.addRelays?.(urls),
      } as PoolLike,
    };
    const t = h.game(rootId, { ...tablet.deps, pool: net.pool, now: tc.now });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn');
    await t.act(chessMove(0, 'd2d4'));
    net.offline = false;
    net.partial = true;
    const phone = h.game(rootId, white.deps);
    await waitFor('the phone decision', () => phone.status.value === 'your-turn');
    await phone.act(chessMove(0, 'e2e4'));
    await waitFor('the tablet checks', () => t.notice.value === CHECKING_OWN_MOVE, 20_000);
    const before = net.queries;
    await pause(3000);
    expect(net.queries - before).toBeLessThanOrEqual(3);
    // No stop or loss shown, nothing offered, and Home's saved status is not a finished game.
    expect(v2view(t)?.fork ?? null).toBeNull();
    expect(t.view.value?.phase).toBe('play');
    expect(t.status.value).toBe('syncing');
    expect(t.legal.value).toEqual([]);
    const saved = readJson(tablet.deps.storage, storageKey(tablet.name, `gamestatus:${rootId}`)) as {
      status?: string;
    } | null;
    expect(saved?.status ?? null).not.toBe('done');
    // Past the hold cap, Send anyway vets on the answers held: the stale move is discarded, with no fork.
    tc.skew = HOLD_CAP_S + 1;
    t.tick();
    await waitFor('Send anyway offered', () => t.canSendAnyway.value);
    t.sendAnyway();
    await waitFor('the discard', () =>
      t.log.value.some((l) => /A move saved on this device was never sent, and it was discarded/.test(l)),
    );
    await waitFor('the tablet follows the phone', () => history(t) === 1 && t.status.value === 'waiting');
    expect(v2view(t)?.fork).toBeNull();
    expect(t.notice.value).not.toBe(CHECKING_OWN_MOVE);
  }, 120_000);
});
