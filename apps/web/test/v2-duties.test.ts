/*
 * Protocol 2 games through the real controllers (v2 build T15): the automatic duties per protocol (the end
 * attestation signed by the session key with no prompt and saved before it is published, prompt releases debounced
 * about a second, roll contributions, the Secret reveal after a stop), and nothing of a seat's sent while its session
 * reports a fork, but what the session still asks for. The dev relay and the net harness; Chess is fast, Bank and
 * Chain Reaction (shuffle proofs) are slower.
 */
import type { BankState } from '@bored-games/bank';
import type { ChainReactionState } from '@bored-games/chain-reaction';
import type { ChessState } from '@bored-games/chess';
import type { SessionViewV2 } from '@bored-games/client';
import {
  finalizeEvent,
  getPublicKey,
  type Hex,
  KIND,
  type NostrEvent,
  parseAttestV2,
  parseRoot,
  parseSharesV2,
} from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type GameController, loadOutbox } from '../src/game-controller.ts';
import type { Signer } from '../src/identity.ts';
import type { PoolLike } from '../src/net.ts';
import { Harness, now, type Profile, pause, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

/** A local signer that records the kinds it signs: the npub's signatures (a NIP-07 prompt each in the browser). */
function countingSigner(): { signer: Signer; kinds: number[] } {
  const sk = rnd(32);
  const kinds: number[] = [];
  return {
    kinds,
    signer: {
      kind: 'local',
      pubkey: getPublicKey(sk),
      sign: async (t) => {
        kinds.push(t.kind);
        return finalizeEvent(t, sk, rnd);
      },
    },
  };
}

/**
 * A pool that records, by event id, when this device first received each event and when it published each one (ms),
 * and checks each publish with `onPublish` first.
 */
function recording(real: PoolLike, onPublish: (ev: NostrEvent) => void = () => {}) {
  const net = {
    arrived: new Map<string, number>(),
    published: new Map<string, number>(),
    pool: {
      subscribe: (filters, onEvent, onEose, opts) =>
        real.subscribe(
          filters,
          (ev, url) => {
            if (!net.arrived.has(ev.id)) net.arrived.set(ev.id, Date.now());
            onEvent(ev, url);
          },
          onEose,
          opts,
        ),
      publish: async (ev: NostrEvent, urls?: readonly string[]) => {
        onPublish(ev);
        if (!net.published.has(ev.id)) net.published.set(ev.id, Date.now());
        return real.publish(ev, urls);
      },
      addRelays: (urls: readonly string[]) => real.addRelays?.(urls),
    } as PoolLike,
  };
  return net;
}

/** Every event of the game on the dev relay. */
const gameEvents = (rootId: string): Promise<NostrEvent[]> => h.query([{ '#e': [rootId] }]);

/** The game's seats' session keys and npubs, by seat. */
async function seatsOf(rootId: string): Promise<{ session: Hex; npub: Hex }[]> {
  const root = parseRoot((await h.query([{ ids: [rootId] }]))[0]);
  return root.seats.map((s) => ({ session: s.session, npub: s.npub }));
}

/** Every event of a v2 game carries exactly one `["proto","2"]` tag (V2-01). */
function expectProto2(events: readonly NostrEvent[]): void {
  for (const ev of events) expect(ev.tags.filter((t) => t[0] === 'proto')).toEqual([['proto', '2']]);
}

const chessMove = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });

async function play(c: GameController, seat: number, uci: string, seq: number): Promise<void> {
  await waitFor(`seat ${seat}'s turn`, () => c.status.value === 'your-turn');
  await c.act(chessMove(seat, uci));
  await waitFor(`move ${seq}`, () => (c.view.value?.state as ChessState | null)?.history.length === seq);
}

const v2view = (c: GameController): SessionViewV2 | null => c.view.value as SessionViewV2 | null;

describe('Protocol 2 automatic duties in the game controller (T15)', () => {
  it('V2-37, V2-01: a Chess game to mate between two profiles: every event at proto 2, each end attestation signed by the session key with no prompt, saved before it is published, and built once', async () => {
    const wSigner = countingSigner();
    const bSigner = countingSigner();
    // Every end attestation this device publishes must already be in its saved outbox.
    const unsaved: string[] = [];
    const guard = (p: () => Profile) => (ev: NostrEvent) => {
      const q = p();
      if (ev.kind !== KIND.attest) return;
      const outbox = [...loadOutbox(q.deps.storage, q.name, rootOf.id).values()];
      // Only this seat's own: the device also rebroadcasts the other seat's (PROTOCOL-v2 §9.1).
      if (!outbox.some((e) => e.event.pubkey === ev.pubkey)) return;
      const saved = outbox.some((e) => e.event.id === ev.id);
      if (!saved && parseAttestV2(ev).variant === 'end') unsaved.push(ev.id);
    };
    const rootOf = { id: '' };
    let a: Profile = h.profile('a', { signer: wSigner.signer });
    let b: Profile = h.profile('b', { signer: bSigner.signer });
    const aNet = recording(
      a.deps.pool,
      guard(() => a),
    );
    const bNet = recording(
      b.deps.pool,
      guard(() => b),
    );
    a = { ...a, deps: { ...a.deps, pool: aNet.pool } };
    b = { ...b, deps: { ...b.deps, pool: bNet.pool } };
    const { rootId, bySeat } = await h.start2('chess', a, b);
    rootOf.id = rootId;
    const [white, black] = bySeat;
    const signedBefore = [wSigner.kinds.length, bSigner.kinds.length];
    const gw = h.game(rootId, white.deps);
    const gb = h.game(rootId, black.deps);
    // Fool's mate: Black wins at move 4.
    await play(gw, 0, 'f2f3', 1);
    await play(gb, 1, 'e7e5', 2);
    await play(gw, 0, 'g2g4', 3);
    await play(gb, 1, 'd8h4', 4);
    for (const g of [gw, gb]) {
      await waitFor('the end', () => g.view.value?.phase === 'done');
      await waitFor('both stats attestations', () => g.view.value?.attested.length === 2);
      expect(v2view(g)?.proto).toBe(2);
      expect(v2view(g)?.endAttested).toEqual([0, 1]);
      expect(g.view.value?.outcome?.places).toEqual([2, 1]);
    }
    const seats = await seatsOf(rootId);
    const events = await gameEvents(rootId);
    expectProto2(events);
    const attests = events.filter((ev) => ev.kind === KIND.attest);
    const ends = attests.filter((ev) => parseAttestV2(ev).variant === 'end');
    const stats = attests.filter((ev) => parseAttestV2(ev).variant === 'stats');
    // One end attestation per seat, by its session key; one stats attestation per seat, by its npub.
    expect(ends.map((ev) => ev.pubkey).sort()).toEqual(seats.map((s) => s.session).sort());
    expect(stats.map((ev) => ev.pubkey).sort()).toEqual(seats.map((s) => s.npub).sort());
    expect(unsaved).toEqual([]);
    // The only in-game event either npub signed is its stats attestation: the end attestation asked no prompt.
    expect(wSigner.kinds.slice(signedBefore[0])).toEqual([KIND.attest]);
    expect(bSigner.kinds.slice(signedBefore[1])).toEqual([KIND.attest]);

    // Built once per identity: reopened, a device sends no second end attestation.
    gw.dispose();
    const again = h.game(rootId, { ...white.deps, pool: h.pool() });
    await waitFor(
      'the reopened game',
      () => again.view.value?.phase === 'done' && again.status.value === 'done',
    );
    again.tick();
    await pause(1500);
    const later = (await gameEvents(rootId)).filter((ev) => ev.kind === KIND.attest);
    expect(later.map((ev) => ev.id).sort()).toEqual(attests.map((ev) => ev.id).sort());
  }, 90_000);

  it('two open devices of one seat, with clocks apart, sign one end attestation: its date and nonces come from the game, not the device', async () => {
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const gw = h.game(rootId, white.deps);
    const gb = h.game(rootId, black.deps);
    // The tablet's clock runs half a minute ahead, and its live feed lags on the phone's events, so it builds its own
    // end attestation: its date comes from shared events, not from the device, and both are one event.
    const tabletDev = h.secondDevice(black, address);
    const blackKey = (await seatsOf(rootId))[1]?.session as string;
    const real = tabletDev.deps.pool;
    const lag = {
      published: [] as string[],
      pool: {
        subscribe: (filters, onEvent, onEose, opts) =>
          real.subscribe(
            filters,
            (ev, url) => {
              if (!(ev.pubkey === blackKey && ev.kind === KIND.attest)) onEvent(ev, url);
            },
            onEose,
            opts,
          ),
        publish: async (ev: NostrEvent, urls?: readonly string[]) => {
          lag.published.push(ev.id);
          return real.publish(ev, urls);
        },
        addRelays: (urls: readonly string[]) => real.addRelays?.(urls),
      } as PoolLike,
    };
    const tablet = h.game(rootId, { ...tabletDev.deps, pool: lag.pool, now: () => now() + 30 });
    await play(gw, 0, 'f2f3', 1);
    await play(gb, 1, 'e7e5', 2);
    await play(gw, 0, 'g2g4', 3);
    await play(gb, 1, 'd8h4', 4);
    for (const g of [gw, gb, tablet]) {
      await waitFor('the end', () => g.view.value?.phase === 'done');
      await waitFor('both end attestations', () => v2view(g)?.endAttested.length === 2);
    }
    await waitFor("the tablet's own end attestation", () => lag.published.length > 0);
    await pause(1500);
    const seats = await seatsOf(rootId);
    const ends = (await gameEvents(rootId)).filter(
      (ev) => ev.kind === KIND.attest && parseAttestV2(ev).variant === 'end',
    );
    expect(ends.filter((ev) => ev.pubkey === seats[1]?.session)).toHaveLength(1);
    expect(ends.filter((ev) => ev.pubkey === seats[0]?.session)).toHaveLength(1);
  }, 90_000);

  it('V2-38, V2-37: a stop sends no end or stats attestation and nothing else of the seats; a cancelled game sends no attestation', async () => {
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const wNet = recording(white.deps.pool);
    const gw = h.game(rootId, { ...white.deps, pool: wNet.pool });
    const gb = h.game(rootId, black.deps);
    await play(gw, 0, 'e2e4', 1);
    const m1 = gw.view.value?.head.id as string;
    // Black's device plays e7e5; Black's own tooling signs a rival d7d5 on the same prev: a fork by Black (E).
    const outside = await h.outsideSession(rootId, address, black);
    const rival = outside.buildAction(chessMove(1, 'd7d5'), rnd, now());
    await play(gb, 1, 'e7e5', 2);
    await h.pool().publish(rival);
    for (const g of [gw, gb]) {
      await waitFor('the stop', () => v2view(g)?.stop !== null && v2view(g)?.stop !== undefined);
      expect(v2view(g)?.fork?.seat).toBe(1);
      expect(v2view(g)?.fork?.at).toBe(m1);
      expect(g.view.value?.outcome?.places).toEqual([1, 2]);
      expect(g.legal.value).toEqual([]);
      expect(g.canResign.value).toBe(false);
    }
    // What White signed that reached the relay (its device also rebroadcasts what it received, PROTOCOL-v2 §9.1).
    const w = (await seatsOf(rootId))[0] as { session: Hex; npub: Hex };
    const built = async (): Promise<string[]> =>
      (await h.query([{ authors: [w.session, w.npub], '#e': [rootId] }])).map((ev) => ev.id).sort();
    const before = await built();
    for (let i = 0; i < 3; i++) {
      gw.tick();
      gb.tick();
      await pause(300);
    }
    // White published nothing after the stop, and nobody end- or stats-attested it.
    expect(await built()).toEqual(before);
    expect((await gameEvents(rootId)).filter((ev) => ev.kind === KIND.attest)).toEqual([]);
    await expect(gw.act(chessMove(0, 'g1f3'))).rejects.toThrow();

    // A claim before the first game action cancels the game (v1 rule): no attestation at all.
    let skew = 0;
    const c1 = h.profile('c');
    const c2 = h.profile('d');
    const started = await h.start2('chess', c1, c2);
    const games = started.bySeat.map((p) => h.game(started.rootId, { ...p.deps, now: () => now() + skew }));
    await waitFor('White to move', () => games[0]?.status.value === 'your-turn');
    skew = 86400 + 60;
    for (const g of games) g.tick();
    const claimant = games[1] as GameController;
    await waitFor('a timeout target', () => claimant.timeoutTarget.value === 0);
    await claimant.claimTimeout();
    for (const g of games) await waitFor('the cancel', () => g.view.value?.phase === 'cancelled');
    for (let i = 0; i < 3; i++) {
      for (const g of games) g.tick();
      await pause(300);
    }
    const evs = await gameEvents(started.rootId);
    expectProto2(evs);
    expect(evs.filter((ev) => ev.kind === KIND.attest)).toEqual([]);
    expect(evs.filter((ev) => ev.kind === KIND.timeout)).toHaveLength(1);
  }, 90_000);

  it('V2-34: a Bank 0.2.0 game: every roll gets one contribution per seat, the roller after its Roll, each built once from its requesting move (two devices of a seat sign one event)', async () => {
    const { rootId, address, bySeat } = await h.start2('bank', h.profile('a'), h.profile('b'), {
      rulesVersion: 1,
      rounds: 5,
      banking: 'table',
      maxRollsPerRound: 30,
    });
    const games = bySeat.map((p) => h.game(rootId, p.deps));
    // A second device of seat 0, open throughout: it builds the same contributions, never a rival.
    const tablet = h.game(rootId, h.secondDevice(bySeat[0], address).deps);
    // Bank after two rolls when the pot holds something, else roll (or stay).
    const choose = (s: BankState, legal: readonly unknown[]): unknown => {
      const bank = legal.find((x) => (x as { type?: string }).type === 'bank');
      if (bank !== undefined && s.rolls >= 2 && s.pot > 0) return bank;
      return legal.find((x) => (x as { type?: string }).type !== 'bank') ?? legal[0];
    };
    const until = Date.now() + 240_000;
    while (games.some((g) => g.view.value?.phase !== 'done')) {
      if (Date.now() > until) throw new Error('the Bank game did not finish');
      for (const g of games) {
        if (g.status.value !== 'your-turn' || g.busy.value || g.legal.value.length === 0) continue;
        const s = g.view.value?.state as BankState;
        await g.act(choose(s, g.legal.value)).catch(() => {});
      }
      await pause(25);
    }
    await waitFor('the tablet at the end', () => tablet.view.value?.phase === 'done');
    for (const g of [...games, tablet])
      await waitFor('the stats attestations', () => g.view.value?.attested.length === 2);
    const seats = await seatsOf(rootId);
    const events = await gameEvents(rootId);
    expectProto2(events);
    const moves = new Map(events.filter((ev) => ev.kind === KIND.move).map((ev) => [ev.id, ev]));
    const rolls = events
      .filter((ev) => ev.kind === KIND.shares)
      .map((ev) => ({ ev, p: parseSharesV2(ev) }))
      .filter((x) => x.p.type === 'roll');
    // The requesting moves: every move some contribution names.
    const requested = new Set(rolls.map((x) => (x.p.type === 'roll' ? x.p.moveId : '')));
    expect(requested.size).toBeGreaterThan(2);
    for (const moveId of requested) {
      const move = moves.get(moveId) as NostrEvent;
      expect(move).toBeDefined();
      for (const [k, s] of seats.entries()) {
        const mine = rolls.filter(
          (x) => x.ev.pubkey === s.session && x.p.type === 'roll' && x.p.moveId === moveId,
        );
        // One event per seat and roll, whatever its devices did.
        expect(
          mine.map((x) => x.ev.id),
          `seat ${k} on ${moveId}`,
        ).toHaveLength(1);
        const anchor = (mine[0] as (typeof mine)[number]).p.anchorId;
        // Anchored on the requesting move or a later one: never before the move is on the chain.
        expect(anchor === moveId || moves.has(anchor)).toBe(true);
        if (move.pubkey === s.session) expect(anchor).toBe(moveId);
      }
    }
    for (const g of games) {
      expect(v2view(g)?.endAttested).toEqual([0, 1]);
      expect(g.view.value?.outcome).not.toBeNull();
    }
    expect(events.filter((ev) => ev.kind === KIND.attest)).toHaveLength(4);
  }, 300_000);

  it('V2-29, V2-25: Chain Reaction with 3 seats: each draw is released by the other seats in one Shares event about a second after its move, before the drawer’s next turn; after a fork nothing but the Secret reveals goes out', async () => {
    const ps = [h.profile('a'), h.profile('b'), h.profile('c')] as [Profile, Profile, Profile];
    const { rootId, address, bySeat } = await h.start3('chain-reaction', ps);
    const nets = bySeat.map((p) => recording(p.deps.pool));
    const games = bySeat.map((p, i) =>
      h.game(rootId, { ...p.deps, pool: (nets[i] as (typeof nets)[number]).pool }),
    );
    const seats = await seatsOf(rootId);
    const seatOfKey = new Map(seats.map((s, k) => [s.session, k]));
    const decisions: { id: string; seat: number }[] = [];
    // Four decisions (a placement, then ending the turn, which draws), each left to settle before the next.
    for (let d = 0; d < 4; d++) {
      const mover = await waitFor(
        'a decision',
        () => games.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
        240_000,
      );
      const seat = games.indexOf(mover);
      const s = mover.view.value?.state as ChainReactionState;
      // The drawer reads every tile of its hand before it decides: its last draw was released in time.
      expect(s.players[seat]?.hand.every((slot) => slot.tile !== null)).toBe(true);
      await mover.act(mover.legal.value[0]);
      const id = mover.view.value?.head.id as string;
      decisions.push({ id, seat });
      for (const g of games)
        await waitFor(
          'the move everywhere',
          () =>
            g.view.value?.head.id === id || (g.view.value?.head.seq ?? 0) > (mover.view.value?.head.seq ?? 0),
        );
      await pause(2500);
    }
    const events = await gameEvents(rootId);
    expectProto2(events);
    const releases = events
      .filter((ev) => ev.kind === KIND.shares)
      .map((ev) => ({ ev, p: parseSharesV2(ev) }))
      .filter((x) => x.p.type === 'shares');
    // A placement draws nothing; ending a turn draws a tile into the mover's hand: those moves are released.
    const drawing = decisions.filter(({ id }) => releases.some((x) => x.p.anchorId === id));
    expect(drawing.length).toBeGreaterThan(0);
    for (const { id, seat } of drawing) {
      for (const [k] of seats.entries()) {
        const on = releases.filter((x) => x.p.anchorId === id && seatOfKey.get(x.ev.pubkey) === k);
        if (k === seat) {
          // The drawer never releases its own draw.
          expect(on).toEqual([]);
          continue;
        }
        // One Shares event per other seat, anchored on the move, published after the debounce, within seconds.
        expect(on, `seat ${k} on the move of seat ${seat}`).toHaveLength(1);
        const net = nets[k] as (typeof nets)[number];
        const rel = (on[0] as (typeof on)[number]).ev;
        const delay = (net.published.get(rel.id) as number) - (net.arrived.get(id) as number);
        expect(delay).toBeGreaterThanOrEqual(900);
        expect(delay).toBeLessThan(10_000);
      }
    }
    // No card Shares event before the final deck: the deals are anchored on the last shuffle step (seq 3), nothing
    // earlier.
    const seqOf = new Map(
      events
        .filter((ev) => ev.kind === KIND.move)
        .map((ev) => [ev.id, Number(ev.tags.find((t) => t[0] === 'seq')?.[1])]),
    );
    for (const x of releases) expect(seqOf.get(x.p.anchorId) ?? 0).toBeGreaterThanOrEqual(3);

    // The next mover's own tooling signs a rival decision on the same head as its device's: a fork.
    const mover = await waitFor(
      'a decision',
      () => games.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 1),
      240_000,
    );
    const e = games.indexOf(mover);
    const outside = await h.outsideSession(rootId, address, bySeat[e] as Profile);
    const p = mover.view.value?.head.id as string;
    expect(outside.view().head.id).toBe(p);
    const rival = outside.buildAction(outside.legalActions()[1], rnd, now());
    const sharesBefore = new Set(
      (await gameEvents(rootId)).filter((ev) => ev.kind === KIND.shares).map((ev) => ev.id),
    );
    await mover.act(mover.legal.value[0]);
    const m = mover.view.value?.head.id as string;
    await h.pool().publish(rival);
    for (const g of games) await waitFor('the stop', () => v2view(g)?.stop != null, 60_000);
    // After the stop (the final deck exists at P), every seat reveals its secret (D067), and only that.
    for (const g of games) await waitFor('the secrets', () => g.view.value?.phase === 'done', 120_000);
    await pause(2500);
    const after = await gameEvents(rootId);
    const secrets = after.filter((ev) => ev.kind === KIND.reveal);
    expect(secrets.map((ev) => seatOfKey.get(ev.pubkey)).sort()).toEqual([0, 1, 2]);
    expect(after.filter((ev) => ev.kind === KIND.attest)).toEqual([]);
    expectProto2(after);
    // No Shares event at all since the fork: none on either side of it, none anywhere after the stop.
    const late = after.filter((ev) => ev.kind === KIND.shares && !sharesBefore.has(ev.id));
    expect(late).toEqual([]);
    expect(after.some((ev) => ev.id === m) && after.some((ev) => ev.id === rival.id)).toBe(true);
    for (const g of games) {
      expect(v2view(g)?.fork?.seat).toBe(e);
      expect(v2view(g)?.fork?.at).toBe(p);
      // E last; with 3 seats the result is unrated for the others.
      expect(g.view.value?.outcome?.places[e]).toBe(3);
    }
  }, 600_000);
});
