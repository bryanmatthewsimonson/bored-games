/*
 * Two devices of one seat in protocol 2 games (v2 build T16; PROTOCOL-v2 §9.1, §9.3, D073): across reloads they never
 * fork the seat; the check before signing and the session's fold adopt a Timeout claim or a claim or Resign result the
 * other device decided; the rebroadcast never publishes an own event still in the outbox; and it brings an event to a
 * client that missed it. Chess v2 over the dev relay (one more dev relay for the player's own relay).
 */
import type { ChessState } from '@bored-games/chess';
import type { SessionViewV2 } from '@bored-games/client';
import { startDevRelay } from '@bored-games/dev-relay';
import { KIND, type NostrEvent, parseRoot } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GAME_DECIDED, type GameController, loadOutbox } from '../src/game-controller.ts';
import type { PoolLike } from '../src/net.ts';
import { Harness, now, offlinePool, type Profile, pause, rnd, waitFor } from './net-harness.ts';

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

/** The session key of `seat` in the game. */
async function sessionKey(rootId: string, seat: number): Promise<string> {
  const root = (await h.query([{ ids: [rootId] }]))[0] as NostrEvent;
  return parseRoot(root).seats[seat]?.session as string;
}

const signed = (rootId: string, key: string, kind: number, url?: string): Promise<NostrEvent[]> =>
  h.query([{ kinds: [kind], authors: [key], '#e': [rootId] }], url);

/** At most one move by `key` on any parent: the seat never forked. */
async function expectNoFork(rootId: string, key: string): Promise<void> {
  const moves = await signed(rootId, key, KIND.move);
  const prevs = moves.map((ev) => ev.tags.find((t) => t[0] === 'e' && t[3] === 'prev')?.[1]);
  expect(new Set(prevs).size).toBe(prevs.length);
}

/** Wait until `get` resolves to true (a relay query, say). */
async function eventually(what: string, get: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await get())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await pause(100);
  }
}

/** A clock this test moves: Unix seconds plus `skew`. */
function clock() {
  const c = { skew: 0, now: () => now() + c.skew };
  return c;
}

/**
 * A pool that never delivers the events `hide` picks, on any subscription (`paged`: only on paged ones, the game feed
 * and whole-game queries); publishing is recorded.
 */
function hidingBy(real: PoolLike, hide: (ev: NostrEvent) => boolean, paged = false) {
  const net = {
    published: [] as string[],
    pool: {
      subscribe: (filters, onEvent, onEose, opts) => {
        const applies = !paged || filters.some((f) => f.limit !== undefined);
        return real.subscribe(
          filters,
          (ev, url) => (applies && hide(ev) ? undefined : onEvent(ev, url)),
          onEose,
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

describe('Two devices of one seat under protocol 2 (T16)', () => {
  it('V2-46: two devices of White take turns across reloads, each on what the other played; the seat never forks', async () => {
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const wKey = await sessionKey(rootId, 0);
    const tablet = h.secondDevice(white, address);
    const gb = h.game(rootId, black.deps);
    const plan = [
      ['e2e4', 'e7e5'],
      ['g1f3', 'b8c6'],
      ['f1c4', 'g8f6'],
      ['d2d3', 'f8c5'],
    ] as const;
    let seq = 0;
    for (const [i, [w, b]] of plan.entries()) {
      // White's devices alternate; each opens fresh (a reload) and the other is closed or still open, behind.
      const dev = i % 2 === 0 ? white : tablet;
      const other = i % 2 === 0 ? tablet : white;
      const g = h.game(rootId, dev.deps);
      const stays = i === 1 ? h.game(rootId, other.deps) : null;
      await play(g, 0, w, ++seq);
      await play(gb, 1, b, ++seq);
      await waitFor('the device sees the answer', () => history(g) === seq);
      if (stays !== null) {
        await waitFor('the other device follows', () => history(stays) === seq);
        // It cannot play the turn the first device already played.
        expect(stays.status.value).toBe('your-turn');
        stays.dispose();
      }
      g.dispose();
    }
    const last = h.game(rootId, tablet.deps);
    await waitFor('the tablet at the end', () => history(last) === seq);
    await pause(500);
    await expectNoFork(rootId, wKey);
    expect(v2view(last)?.fork).toBeNull();
    expect(last.view.value?.equivocators).toEqual([]);
    expect(gb.view.value?.equivocators).toEqual([]);
    expect([...loadOutbox(tablet.deps.storage, tablet.name, rootId).values()].every((e) => e.confirmed)).toBe(
      true,
    );
  }, 120_000);

  it('V2-46: a Timeout claim the phone made counts on the tablet before the tablet’s own deadline; a tablet that missed it adopts it in the check before signing and signs no second claim', async () => {
    const pc = clock();
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const wKey = await sessionKey(rootId, 0);
    const gb = h.game(rootId, black.deps);
    const phone = h.game(rootId, { ...white.deps, now: pc.now });
    // Tablet 1 is on time and watches live. Tablet 2's clock is also past the deadline, but its live feed drops the
    // seat's own Timeout claims and attestations (it lags); a targeted query gets them.
    const t1 = h.game(rootId, h.secondDevice(white, address).deps);
    const second = h.secondDevice(white, address);
    const lag = hidingBy(
      second.deps.pool,
      (ev) => ev.pubkey === wKey && (ev.kind === KIND.timeout || ev.kind === KIND.attest),
      true,
    );
    const t2 = h.game(rootId, { ...second.deps, now: pc.now, pool: lag.pool });
    await play(phone, 0, 'e2e4', 1);
    for (const g of [gb, t1, t2]) await waitFor('move 1 everywhere', () => history(g) === 1);
    gb.dispose();
    // Black stalls; on the phone's clock (and tablet 2's) its deadline passes.
    pc.skew = 86400 + 60;
    phone.tick();
    t2.tick();
    await waitFor('a timeout target', () => phone.timeoutTarget.value === 1);
    await waitFor('tablet 2 sees it too', () => t2.timeoutTarget.value === 1);
    expect(t1.timeoutTarget.value).toBeNull();
    await phone.claimTimeout();
    await waitFor('the claim counted', () => phone.view.value?.outcome?.reason === 'forfeit');
    // Tablet 1: its own deadline has not passed, but a claim of its seat on its head is accepted (§9.3).
    await waitFor('tablet 1 adopts the claim', () => t1.view.value?.outcome?.reason === 'forfeit');
    expect(t1.view.value?.outcome).toEqual(phone.view.value?.outcome);
    // Tablet 2 never got the claim live; claiming, its check before signing finds it and signs nothing.
    expect(t2.view.value?.outcome).toBeNull();
    await t2.claimTimeout();
    expect(t2.error.value).toContain(GAME_DECIDED);
    expect(t2.view.value?.outcome).toEqual(phone.view.value?.outcome);
    expect(await signed(rootId, wKey, KIND.timeout)).toHaveLength(1);
    expect(
      [...loadOutbox(second.deps.storage, second.name, rootId).keys()].some((s) => s.startsWith('timeout:')),
    ).toBe(false);
  }, 90_000);

  it('V2-46: a claim result the phone end-attested is adopted by a tablet that never got the claim: the game ends there, and a late move of the timed-out seat gets no answer', async () => {
    const pc = clock();
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const wKey = await sessionKey(rootId, 0);
    const gb = h.game(rootId, black.deps);
    const phone = h.game(rootId, { ...white.deps, now: pc.now });
    await play(phone, 0, 'e2e4', 1);
    await play(gb, 1, 'e7e5', 2);
    await play(phone, 0, 'g1f3', 3);
    await waitFor('move 3 at Black', () => history(gb) === 3);
    // Black's tooling prepares its (late) move on the head.
    const outside = await h.outsideSession(rootId, address, black);
    const late = outside.buildAction(chessMove(1, 'b8c6'), rnd, now());
    gb.dispose();
    // The tablet never receives Timeout claims (a relay that drops them for it), and its clock is on time.
    const tablet = h.secondDevice(white, address);
    const net = hidingBy(tablet.deps.pool, (ev) => ev.kind === KIND.timeout);
    const t = h.game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the tablet loaded', () => history(t) === 3);
    pc.skew = 86400 + 60;
    phone.tick();
    await waitFor('a timeout target', () => phone.timeoutTarget.value === 1);
    await phone.claimTimeout();
    await waitFor('the claim counted', () => phone.view.value?.outcome?.reason === 'forfeit');
    await eventually(
      'the phone end-attested it',
      async () => (await signed(rootId, wKey, KIND.attest)).length > 0,
    );
    // The tablet holds the phone's end attestation of (claim, move 3, [Black]): the game is over there.
    await waitFor('the tablet adopts the result', () => v2view(t)?.awaitingCounted != null);
    expect(v2view(t)?.awaitingCounted).toMatchObject({ kind: 'claim', forfeit: [1] });
    expect(t.view.value?.phase).not.toBe('play');
    // Black's late move arrives: the tablet asks White for no decision, and refuses one.
    await h.pool().publish(late);
    await waitFor('the late move at the tablet', () => t.view.value !== null && history(t) >= 3);
    await pause(1000);
    expect(t.legal.value).toEqual([]);
    expect(t.status.value).not.toBe('your-turn');
    await expect(t.act(chessMove(0, 'd2d4'))).rejects.toThrow();
    await expectNoFork(rootId, wKey);
    expect((await signed(rootId, wKey, KIND.move)).length).toBe(2);
  }, 90_000);

  it('V2-44, V2-46: a move the tablet folded in offline, then rivalled by the phone’s, is never rebroadcast: the tablet discards it and nobody holds a fork of White', async () => {
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const wKey = await sessionKey(rootId, 0);
    const gb = h.game(rootId, black.deps);
    const tablet = h.secondDevice(white, address);
    const off = offlinePool(tablet.deps.pool);
    const t = h.game(rootId, { ...tablet.deps, pool: off.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn');
    // The tablet's network is down when it moves: its move is saved and folded in there, not sent. The network comes
    // back before the tablet retries it (the next tick).
    await t.act(chessMove(0, 'd2d4'));
    const mine = loadOutbox(tablet.deps.storage, tablet.name, rootId).get(`move:1:${rootId}`)
      ?.event as NostrEvent;
    off.offline = false;
    // The phone plays that turn otherwise; the tablet now holds a fork of its own seat (its unsent move and the
    // phone's), and rebroadcasts what it holds: never its own unsent move, so no certificate goes out.
    const phone = h.game(rootId, white.deps);
    await play(phone, 0, 'e2e4', 1);
    await waitFor('the tablet holds the fork', () => v2view(t)?.fork != null);
    await pause(500);
    expect(off.published).not.toContain(mine.id);
    // Only the outbox ever tried to send it (once, when it was built), never the rebroadcast.
    expect(off.attempted.filter((id) => id === mine.id)).toHaveLength(1);
    // Its next tick vets the saved move against the relays: discarded, and the session rebuilt without it.
    t.tick();
    await waitFor('the tablet discards its move', () => t.log.value.length > 0);
    expect(t.log.value[0]).toMatch(/A move saved on this device was never sent, and it was discarded/);
    await waitFor('no fork at the tablet', () => v2view(t)?.fork === null);
    await play(gb, 1, 'e7e5', 2);
    await waitFor('the tablet follows', () => history(t) === 2);
    expect(off.published).not.toContain(mine.id);
    expect((await signed(rootId, wKey, KIND.move)).map((ev) => ev.id)).not.toContain(mine.id);
    for (const g of [phone, gb, t]) {
      expect(g.view.value?.equivocators).toEqual([]);
      expect(v2view(g)?.fork).toBeNull();
    }
  }, 60_000);

  it('V2-44, V2-47: the rebroadcast brings a client the events it missed, from the player’s own relay to the root’s and back; the clients converge', async () => {
    const own = await startDevRelay({ port: 0 });
    h.later(() => own.close());
    // P uses its own relay besides the root's; Q and the spectator only the root's.
    const p = h.profile('a', { extra: [own.url] });
    const { rootId, address, bySeat } = await h.start2('chess', p, h.profile('b'));
    const pSeat = bySeat.indexOf(p);
    const q = bySeat[1 - pSeat] as Profile;
    const qKey = await sessionKey(rootId, 1 - pSeat);
    const spectator = h.game(rootId, h.profile('s').deps);
    // To Q's turn, with P's app closed.
    if (pSeat === 0) {
      const gp = h.game(rootId, p.deps);
      await play(gp, 0, 'e2e4', 1);
      await waitFor('the spectator sees it', () => history(spectator) === 1);
      gp.dispose();
    }
    // Q's move reaches only P's own relay (Q's tooling, or a lossy relay): the root's relay lacks it.
    const outside = await h.outsideSession(rootId, address, q);
    const m = outside.buildAction(outside.legalActions()[0], rnd, now());
    await h.pool([own.url]).publish(m);
    expect((await signed(rootId, qKey, KIND.move)).map((ev) => ev.id)).not.toContain(m.id);
    // P opens the game: after its sync it asks each relay what it holds and sends the root's relay what it lacks.
    const gp = h.game(rootId, p.deps);
    await waitFor('the move at P', () => gp.view.value?.head.id === m.id);
    await eventually('the move at the root relay', async () =>
      (await signed(rootId, qKey, KIND.move)).some((ev) => ev.id === m.id),
    );
    await waitFor('the spectator converges', () => spectator.view.value?.head.id === m.id);
    // The other way, live: P moves, Q's next move goes to the root's relay only, and P sends it to its own relay.
    await waitFor('P to move', () => gp.status.value === 'your-turn');
    await gp.act(gp.legal.value[0]);
    const pm = gp.view.value?.head.id as string;
    await waitFor('the spectator sees P', () => spectator.view.value?.head.id === pm);
    const outside2 = await h.outsideSession(rootId, address, q);
    expect(outside2.view().head.id).toBe(pm);
    const m2 = outside2.buildAction(outside2.legalActions()[0], rnd, now());
    await h.pool().publish(m2);
    await waitFor('the move at P', () => gp.view.value?.head.id === m2.id);
    await eventually('the move at the own relay', async () =>
      (await signed(rootId, qKey, KIND.move, own.url)).some((ev) => ev.id === m2.id),
    );
    await waitFor('the spectator converges', () => spectator.view.value?.head.id === m2.id);
  }, 90_000);
});
