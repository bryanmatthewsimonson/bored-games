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
import { memoryStorage } from '../src/storage.ts';

const rnd = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const now = (): number => Math.floor(Date.now() / 1000);

let relay: DevRelay;
const pools: RelayPool[] = [];
const disposers: (() => void)[] = [];

interface Profile {
  name: string;
  deps: ControllerDeps;
}

function profile(name: string): Profile {
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
      relays: () => [relay.url],
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
  const p = new RelayPool([relay.url], { WebSocket });
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
async function startChess(): Promise<{ rootId: string; white: GameController; black: GameController }> {
  const a = profile('a');
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
  return { rootId, white: game(rootId, a), black: game(rootId, b) };
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
});
