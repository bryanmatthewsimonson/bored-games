/*
 * A deckless 2-player game (Chess, D045) through the real controllers in Node: the dev relay, real pools, local
 * signers and memory stores. No shuffle or deal, so these are fast. Covers play to mate, attestations and Resign.
 */
import type { ChessState } from '@bored-games/chess';
import { type DevRelay, startDevRelay } from '@bored-games/dev-relay';
import { finalizeEvent, getPublicKey, KIND, type NostrEvent } from '@bored-games/protocol';
import { type Filter, RelayPool } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platformTimers } from '../src/clock.ts';
import { GameController } from '../src/game-controller.ts';
import type { Signer } from '../src/identity.ts';
import { LobbyController } from '../src/lobby-controller.ts';
import { type ControllerDeps, MODULES } from '../src/net.ts';
import { attestLine, resignedSeats } from '../src/screens/game.tsx';
import { loadSecrets, memoryStorage, saveSecrets } from '../src/storage.ts';

const rnd = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const now = (): number => Math.floor(Date.now() / 1000);

let relay: DevRelay;
const pools: RelayPool[] = [];
const disposers: (() => void)[] = [];

interface Profile {
  name: string;
  deps: ControllerDeps;
}

function profile(name: string, extraRelays: readonly string[] = []): Profile {
  const sk = rnd(32);
  const signer: Signer = {
    kind: 'local',
    pubkey: getPublicKey(sk),
    sign: async (t) => finalizeEvent(t, sk, rnd),
  };
  const pool = new RelayPool([relay.url], { WebSocket });
  pools.push(pool);
  return {
    name,
    deps: {
      pool,
      signer,
      storage: memoryStorage(),
      profile: name,
      relays: () => [relay.url, ...extraRelays],
      rnd,
      now,
      modules: MODULES,
      timers: platformTimers,
    },
  };
}

function lobby(p: Profile): LobbyController {
  const c = new LobbyController(p.deps);
  disposers.push(() => c.dispose());
  c.listen();
  return c;
}

function game(rootId: string, p: Profile): GameController {
  const c = new GameController(rootId, p.deps);
  disposers.push(() => c.dispose());
  c.start();
  return c;
}

async function waitFor<T>(what: string, get: () => T | null | undefined | false, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== null && v !== undefined && v !== false) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function query(...filters: Filter[]): Promise<NostrEvent[]> {
  return queryAt(relay.url, ...filters);
}

function queryAt(url: string, ...filters: Filter[]): Promise<NostrEvent[]> {
  const p = new RelayPool([url], { WebSocket });
  pools.push(p);
  return new Promise((resolve) => {
    const got: NostrEvent[] = [];
    let stop = (): void => {};
    stop = p.subscribe(
      filters,
      (ev) => got.push(ev),
      () => {
        stop();
        resolve(got);
      },
    );
  });
}

/** A started 2-seat Chess game: the creator (White) and the joiner (Black), each with a game controller. */
async function startChess(whiteRelays: readonly string[] = []): Promise<{
  rootId: string;
  address: string;
  a: Profile;
  b: Profile;
  white: GameController;
  black: GameController;
}> {
  const a = profile('a', whiteRelays);
  const b = profile('b');
  const la = lobby(a);
  const lb = lobby(b);
  const address = await la.createTable({
    game: 'chess',
    seats: 2,
    deadline: 86400,
    invited: [],
    relays: [relay.url],
  });
  await waitFor('the open table', () => lb.openTables.value.find((t) => t.address === address));
  await lb.join(address);
  await waitFor('a full table', () => la.table(address).value?.full);
  const rootId = await la.start(address);
  await waitFor('the root', () => lb.table(address).value?.root?.id === rootId);
  return { rootId, address, a, b, white: game(rootId, a), black: game(rootId, b) };
}

const move = (seat: number, uci: string) => ({ type: 'move', actor: seat, uci });

async function play(c: GameController, seat: number, uci: string, seq: number): Promise<void> {
  await waitFor(`seat ${seat}'s turn`, () => c.status.value === 'your-turn');
  await c.act(move(seat, uci));
  await waitFor(`move ${seq}`, () => (c.view.value?.state as ChessState | null)?.history.length === seq);
}

beforeEach(async () => {
  relay = await startDevRelay({ port: 0 });
});
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  for (const p of pools.splice(0)) p.close();
  await relay.close();
});

describe('GameController with a deckless game (Chess)', () => {
  it("starts in play with no setup, plays Fool's mate, and both players attest the result", async () => {
    const { white, black } = await startChess();
    await waitFor('White to move', () => white.status.value === 'your-turn');
    expect(white.view.value).toMatchObject({ phase: 'play', shuffleSteps: 0, head: { seq: 0 } });
    expect(white.game.value).toBe('chess');
    expect(black.status.value).toBe('waiting');
    expect(white.canResign.value).toBe(true);
    await play(white, 0, 'f2f3', 1);
    await play(black, 1, 'e7e5', 2);
    await play(white, 0, 'g2g4', 3);
    await play(black, 1, 'd8h4', 4);
    for (const c of [white, black]) {
      await waitFor('both attestations', () => c.view.value?.attested.length === 2);
      expect(c.view.value).toMatchObject({
        phase: 'done',
        audit: 'pass',
        outcome: { places: [2, 1], reason: 'checkmate' },
      });
      expect(attestLine(c.view.value)).toMatch(/signed by both players/);
      await waitFor('done', () => c.status.value === 'done');
      expect(c.canResign.value).toBe(false);
    }
  }, 60_000);

  it('republishes a Resign that counted to its own relays too (D052, review M-b)', async () => {
    const other = await startDevRelay({ port: 0 });
    disposers.push(() => void other.close());
    const { rootId, white, black } = await startChess([other.url]);
    await play(white, 0, 'e2e4', 1);
    await waitFor("Black's turn", () => black.status.value === 'your-turn');
    // Black publishes only to the game's relay; White, which counts it, echoes it to its other relay.
    await black.resign();
    await waitFor('the resignation at White', () => white.view.value?.phase === 'done');
    expect(white.view.value?.resignId).not.toBeNull();
    let found: NostrEvent[] = [];
    for (let i = 0; i < 80 && found.length === 0; i++) {
      found = await queryAt(other.url, { kinds: [KIND.resign], '#e': [rootId] });
      if (found.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(found.map((e) => e.id)).toEqual([white.view.value?.resignId]);
  }, 60_000);

  it('resigns once: the game ends with the resigning seat last, and both attest', async () => {
    const { rootId, white, black } = await startChess();
    await play(white, 0, 'e2e4', 1);
    // Black resigns on its turn, having seen 1. e4: a resign is final on receipt (PROTOCOL §8.3), so one sent
    // before the move arrived would end Black's game at the root and White's after the move.
    await waitFor("Black's turn", () => black.status.value === 'your-turn');
    expect(black.canResign.value).toBe(true);
    await black.resign();
    expect(black.error.value).toBeNull();
    for (const c of [white, black]) {
      await waitFor('the resignation everywhere', () => c.view.value?.phase === 'done');
      expect(resignedSeats(c.view.value)).toEqual([1]);
      expect(c.view.value?.outcome).toMatchObject({ places: [1, 2], reason: 'resign' });
      await waitFor('both attestations', () => c.view.value?.attested.length === 2);
      expect(c.legal.value).toEqual([]);
      expect(c.canResign.value).toBe(false);
    }
    // A second call does nothing: the game is no longer live.
    await black.resign();
    expect(black.error.value).toMatch(/no longer live/);
    expect(await query({ kinds: [KIND.resign], '#e': [rootId] })).toHaveLength(1);
  }, 60_000);

  it('a seat recovered from saved game keys plays, resigns and never attests with the wrong key (D057)', async () => {
    const { rootId, address, b, white, black } = await startChess();
    black.dispose();
    // Black's player key is lost; this browser still holds Black's game keys for the table.
    const saved = loadSecrets(b.deps.profile, b.deps.storage, address);
    if (saved === null) throw new Error('no saved game keys');
    const b2 = profile('b-new');
    expect(saveSecrets(b2.deps.profile, b2.deps.storage, address, saved)).toBe(true);
    const black2 = game(rootId, b2);
    await waitFor('the recovered seat', () => black2.recovered.value);
    expect(black2.recovered.value).toEqual({ seat: 1, npub: b.deps.signer.pubkey });
    await play(white, 0, 'e2e4', 1);
    await play(black2, 1, 'e7e5', 2);
    await waitFor(
      'the move at White',
      () => (white.view.value?.state as ChessState | null)?.history.length === 2,
    );
    await play(white, 0, 'g1f3', 3);
    await waitFor("Black's turn", () => black2.status.value === 'your-turn');
    expect(black2.canResign.value).toBe(true);
    await black2.resign();
    expect(black2.error.value).toBeNull();
    for (const c of [white, black2]) await waitFor('the end', () => c.view.value?.phase === 'done');
    // White attests; the recovered seat does not, since an attestation is signed by the npub it joined with.
    await waitFor("White's attestation", () => black2.view.value?.attested.includes(0));
    await new Promise((r) => setTimeout(r, 500));
    expect(black2.status.value).toBe('done');
    expect(white.view.value?.attested).toEqual([0]);
    const attests = await query({ kinds: [KIND.attest], '#e': [rootId] });
    expect(attests.map((ev) => ev.pubkey)).not.toContain(b2.deps.signer.pubkey);
    expect(attests).toHaveLength(1);
  }, 60_000);
});
