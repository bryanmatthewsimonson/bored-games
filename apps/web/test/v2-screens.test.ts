/*
 * Protocol 2 screens through the real controllers (v2 build T17): what the game screen and Home say about a roll's
 * contributions owed (PROTOCOL-v2 §6.4) and about a stop (§5.6, §7.5), from the views and the saved statuses the
 * controllers produce. The lines themselves are pure (`waiting-model.ts`, `lobby-model.ts`, `screens/game.tsx`);
 * their render tests are in `game-screen.test.ts` and `waiting-model.test.ts`.
 */
import type { BankState } from '@bored-games/bank';
import type { SessionViewV2 } from '@bored-games/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npubEncode, shortNpub } from '../src/bech32.ts';
import type { GameController } from '../src/game-controller.ts';
import { shareWordsOf, webGame } from '../src/games/registry.ts';
import { revealDetail } from '../src/lobby-model.ts';
import { attestLine, stopLine } from '../src/screens/game.tsx';
import { loadGameStatus } from '../src/storage.ts';
import { owedWords, ownRevealLine, waitingLine } from '../src/waiting-model.ts';
import { Harness, now, offlinePool, type Profile, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

const NAMES = ['Ann', 'Bo', 'Cy'];
const v2view = (c: GameController): SessionViewV2 | null => c.view.value as SessionViewV2 | null;
const BANK = shareWordsOf(webGame('bank'));

/** The game screen's waiting line and own line for `c`, composed as `GameScreen` composes them. */
function screenLines(c: GameController, at: number): { waiting: string | null; own: string | null } {
  const v = c.view.value;
  const owed = c.owed.value;
  if (v === null) return { waiting: null, own: null };
  const share = owedWords(owed, BANK);
  return {
    waiting: waitingLine({
      phase: v.phase,
      pending: v.pending,
      mySeat: v.mySeat,
      waiting: c.waiting.value,
      names: NAMES,
      ...(v.phase === 'play' && owed !== null ? { secondsLeft: owed.until - at } : {}),
      share,
    }),
    own: ownRevealLine(owed, v.mySeat, at, share),
  };
}

const short = (p: Profile): string => shortNpub(npubEncode(p.deps.signer.pubkey));

describe('Protocol 2 screens through the controllers (T17)', () => {
  it('V2-49: a Bank 0.2.0 roll’s contributions owed: who owes one and when the deadline passes, on the game screen and on Home', async () => {
    const { rootId, bySeat } = await h.start2('bank', h.profile('a'), h.profile('b'), {
      rulesVersion: 1,
      rounds: 5,
      banking: 'table',
      maxRollsPerRound: 30,
    });
    const [ann, bo] = bySeat;
    // Bo's app opens, but cannot reach the relay: its contribution stays undelivered.
    const boNet = offlinePool(bo.deps.pool);
    const gb = h.game(rootId, { ...bo.deps, pool: boNet.pool });
    const ga = h.game(rootId, ann.deps);
    await waitFor('Ann to roll', () => ga.status.value === 'your-turn' && ga.legal.value.length > 0);
    await ga.act(ga.legal.value[0]);
    await waitFor(
      'the roll at Bo',
      () =>
        (gb.view.value?.state as BankState | null)?.rolls === 0 && gb.view.value?.pending.type === 'beacon',
    );

    // Ann's screen: Bo owes a contribution, with the deadline (Ann's own went out by itself).
    await waitFor('Bo owes at Ann', () => ga.owed.value?.seats.join() === '1');
    const owedA = ga.owed.value;
    expect(owedA?.kind).toBe('roll');
    expect(owedA?.until).toBe((ga.view.value?.pendingSince ?? 0) + 86400);
    const a = screenLines(ga, now());
    expect(a.waiting).toMatch(
      /^Waiting for Bo to send their contribution to the roll\. Their app must be open on this game\. If it is not sent within (?:1d 0h|23h 5\dm), Bo can be timed out\.$/,
    );
    expect(a.own).toBeNull();
    // Ann's Home: the saved status names Bo's npub and the deadline.
    await waitFor(
      'Ann’s saved status',
      () => loadGameStatus(ann.name, ann.deps.storage, rootId)?.reveal !== undefined,
    );
    const cachedA = loadGameStatus(ann.name, ann.deps.storage, rootId);
    expect(cachedA?.reveal).toEqual({ npubs: [bo.deps.signer.pubkey], mine: false, until: owedA?.until });
    expect(revealDetail(cachedA, now(), BANK)).toMatch(
      new RegExp(
        `^Waiting for ${short(bo).replace(/[.…]/g, '.')} to send their contribution to the roll \\((?:1d 0h|23h 5\\dm) left\\)\\.$`,
      ),
    );

    // Bo's screen and Home: Bo owes it, and must keep the game open.
    await waitFor('Bo owes at Bo', () => gb.owed.value?.seats.includes(1) === true);
    // Bo's session holds its own contribution (from its outbox); the controller adds Bo while it is undelivered, and
    // Bank's words name it (the registry's `owedWords`).
    expect(screenLines(gb, now()).own).toMatch(
      /^You owe a contribution to the roll: keep this game open until it is sent\. If it is not sent within (?:1d 0h|23h 5\dm), you can be timed out\.$/,
    );
    await waitFor(
      'Bo’s saved status',
      () => loadGameStatus(bo.name, bo.deps.storage, rootId)?.reveal?.mine === true,
    );
    expect(revealDetail(loadGameStatus(bo.name, bo.deps.storage, rootId), now(), BANK)).toMatch(
      /^Your app must be open: you owe a contribution to the roll \((?:1d 0h|23h 5\dm) left\)\.$/,
    );

    // Bo's app reaches the relay: the contribution goes out, the roll is derived, and nothing is owed.
    boNet.offline = false;
    for (let i = 0; i < 20 && ga.owed.value !== null; i++) {
      gb.tick();
      await new Promise((r) => setTimeout(r, 250));
    }
    await waitFor(
      'the roll derived at Ann',
      () => ga.owed.value === null && ga.view.value?.pending.type !== 'beacon',
    );
    expect(screenLines(ga, now()).waiting).toBeNull();
  }, 90_000);

  it('a 3-seat Bank stop: the forker last, unrated for the others, nothing attested', async () => {
    const { rootId, address, bySeat } = await h.start3('bank', [
      h.profile('a'),
      h.profile('b'),
      h.profile('c'),
    ]);
    const games = bySeat.map((p) => h.game(rootId, p.deps));
    const [g0, g1] = games as [GameController, GameController, GameController];
    await waitFor('seat 0 to roll', () => g0.status.value === 'your-turn' && g0.legal.value.length > 0);
    await g0.act(g0.legal.value[0]);
    // Seat 1 decides after the roll: its app plays one legal action, its own tooling signs another on the same prev.
    await waitFor('seat 1 to decide', () => g1.status.value === 'your-turn' && g1.legal.value.length > 1);
    const outside = await h.outsideSession(rootId, address, bySeat[1] as Profile);
    const [mine, other] = g1.legal.value;
    const rival = outside.buildAction(other, rnd, now());
    await g1.act(mine);
    await h.pool().publish(rival);
    for (const g of games) {
      await waitFor('the stop', () => v2view(g)?.stop != null);
      const v = v2view(g) as SessionViewV2;
      expect(v.stop).toMatchObject({ seat: 1, cancelled: false });
      expect(v.equivocators).toEqual([1]);
      // Nothing banked at the fork: the others share first, Bo (the forker) is last.
      expect(stopLine(v, NAMES)).toBe(
        'Stopped: Bo signed two rival moves for the same turn, so the game ended there. Final places: 1. Ann, 1. Cy, 3. Bo. Rated only for Bo, ranked last; unrated for the others.',
      );
      expect(attestLine(v)).toBeNull();
      expect(g.legal.value).toEqual([]);
      expect(g.canResign.value).toBe(false);
      expect(g.timeoutTarget.value).toBeNull();
    }
  }, 90_000);
});
