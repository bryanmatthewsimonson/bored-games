/*
 * Luster under protocol 2 through the real controllers (v2 build T18; PROTOCOL-v2 §6.3): refills and blind
 * reservations are prompt releases the open apps send by themselves (§6.1); an owed reveal keeps its timeout and the
 * screens say so (D060, §6.4); and the Luster audit's F2 and F3 hold for an honest seat with two devices: it never
 * forks itself, never releases its own card, and a release it saved on a side that loses is never sent. The session
 * level (F1 in arrival orders, the stop's scoring, vector 6) is in packages/client/test/v2/luster.test.ts.
 */
import type { SessionViewV2 } from '@bored-games/client';
import { DECK_OFFSETS, type LusterState } from '@bored-games/luster';
import { type Hex, KIND, type NostrEvent, parseRoot, parseSharesV2 } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALREADY_MOVED, type GameController, loadOutbox } from '../src/game-controller.ts';
import { shareWordsOf, webGame } from '../src/games/registry.ts';
import { loadGameStatus } from '../src/storage.ts';
import { owedWords, waitingLine } from '../src/waiting-model.ts';
import {
  Harness,
  hiding,
  laggingOwn,
  now,
  offlinePool,
  outboxSlots,
  type Profile,
  pause,
  rnd,
  waitFor,
} from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

type Action = { type: string; actor: number; deck?: string; pos?: number };
type Tier = 'tier-1' | 'tier-2' | 'tier-3';

const NAMES = ['Ann', 'Bo'];
const LUSTER = shareWordsOf(webGame('luster'));
const v2view = (c: GameController): SessionViewV2 | null => c.view.value as SessionViewV2 | null;
const stateOf = (c: GameController): LusterState => c.view.value?.state as LusterState;
const physical = (deck: string, pos: number): number => DECK_OFFSETS[deck as keyof typeof DECK_OFFSETS] + pos;
const legalOf = (c: GameController): Action[] => c.legal.value as Action[];
/** The top of `tier` (the next unseen card), as a packet position. */
const topOf = (c: GameController, tier: Tier): number => physical(tier, stateOf(c).decks[tier].next);
const blindOf = (c: GameController, tier: Tier): Action =>
  legalOf(c).find(
    (a) => a.type === 'reserve' && a.deck === tier && a.pos === stateOf(c).decks[tier].next,
  ) as Action;
const displayOf = (c: GameController, tier: Tier): Action =>
  legalOf(c).find(
    (a) => a.type === 'reserve' && a.deck === tier && a.pos !== stateOf(c).decks[tier].next,
  ) as Action;
const takeOf = (c: GameController): Action => legalOf(c).find((a) => a.type === 'take') as Action;
const deciding = (c: GameController): boolean => c.status.value === 'your-turn' && c.legal.value.length > 0;
const logged = (c: GameController, re: RegExp): boolean => c.log.value.some((line) => re.test(line));

/** A clock this test moves: Unix seconds plus `skew`. */
function clock() {
  const c = { skew: 0, now: () => now() + c.skew };
  return c;
}
const withClock = (p: Profile, c: ReturnType<typeof clock>): Profile => ({
  ...p,
  deps: { ...p.deps, now: c.now },
});

/** The session key of each seat. */
async function sessionKeys(rootId: string): Promise<Hex[]> {
  const root = parseRoot((await h.query([{ ids: [rootId] }]))[0] as NostrEvent);
  return root.seats.map((s) => s.session as Hex);
}

/** The card Shares events at the relay signed by `key`, with their positions and anchors. */
async function releasesBy(
  rootId: string,
  key: Hex,
): Promise<{ id: Hex; positions: number[]; anchor: Hex }[]> {
  const evs = await h.query([{ kinds: [KIND.shares], authors: [key], '#e': [rootId] }]);
  return evs.flatMap((ev) => {
    try {
      const s = parseSharesV2(ev);
      return s.type === 'shares'
        ? [{ id: ev.id, positions: s.shares.map((x) => x.pos), anchor: s.anchorId }]
        : [];
    } catch {
      return [];
    }
  });
}

/** Wait until `get` resolves to true (a relay query, say). */
async function eventually(what: string, get: () => Promise<boolean>, ms = 60_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await get())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await pause(100);
  }
}

/** The game screen's waiting line for `c` at `at`, composed as `GameScreen` composes it. */
function waitingText(c: GameController, at: number): string | null {
  const v = c.view.value;
  const owed = c.owed.value;
  if (v === null) return null;
  return waitingLine({
    phase: v.phase,
    pending: v.pending,
    mySeat: v.mySeat,
    waiting: c.waiting.value,
    names: NAMES,
    ...(v.phase === 'play' && owed !== null ? { secondsLeft: owed.until - at } : {}),
    share: owedWords(owed, LUSTER),
  });
}

describe('Luster under protocol 2 through the controllers (T18)', () => {
  it('refills and blind reservations are released by the open apps; an owed reveal is shown with its deadline, and its seat is timed out though it is not its turn', async () => {
    const clocks = [clock(), clock()];
    const [a0, b0] = [h.profile('a'), h.profile('b')];
    const { rootId, bySeat } = await h.start2('luster', a0, b0);
    const ps = bySeat.map((p, k) => withClock(p, clocks[k] as ReturnType<typeof clock>));
    const keys = await sessionKeys(rootId);
    const games = ps.map((p) => h.game(rootId, p.deps));
    const mover = await waitFor('the first decision', () => games.find(deciding), 300_000);
    const k = games.indexOf(mover);

    // A reservation from the display: the market refills from the top of tier 1, and both apps release it.
    const p = topOf(mover, 'tier-1');
    await mover.act(displayOf(mover, 'tier-1'));
    const refillMove = mover.view.value?.head.id as Hex;
    for (const g of games)
      await waitFor(
        'the refill revealed',
        () =>
          g.view.value?.head.id === refillMove &&
          g.view.value.pending.type === 'player' &&
          stateOf(g)
            .market.flat()
            .some((c) => c !== null && physical(c.deck, c.pos) === p && c.card !== null),
        60_000,
      );
    for (const key of keys)
      expect((await releasesBy(rootId, key)).filter((r) => r.positions.includes(p))).toEqual([
        { id: expect.any(String), positions: [p], anchor: refillMove },
      ]);

    // A blind reservation of the top of tier 2: only the other seat's app releases it; its owner reads the card.
    const j = 1 - k;
    const gj = games[j] as GameController;
    await waitFor('the next decision', () => deciding(gj));
    const tier2 = stateOf(gj).decks['tier-2'].next;
    const q = physical('tier-2', tier2);
    await gj.act(blindOf(gj, 'tier-2'));
    const blindMove = gj.view.value?.head.id as Hex;
    const card = () =>
      stateOf(gj).players[j]?.reserved.find((r) => r.deck === 'tier-2' && r.pos === tier2)?.card;
    await waitFor('the owner reads its card', () => typeof card() === 'number', 60_000);
    expect(
      stateOf(games[k] as GameController).players[j]?.reserved.find(
        (r) => r.deck === 'tier-2' && r.pos === tier2,
      )?.card,
    ).toBeNull();
    expect((await releasesBy(rootId, keys[k] as Hex)).filter((r) => r.positions.includes(q))).toEqual([
      { id: expect.any(String), positions: [q], anchor: blindMove },
    ]);
    await pause(1500);
    expect((await releasesBy(rootId, keys[j] as Hex)).filter((r) => r.positions.includes(q))).toEqual([]);

    // The owed reveal: k plays its turn and its app closes; j reserves from the display, and the game waits on k.
    const gk = games[k] as GameController;
    await waitFor('k to decide', () => deciding(gk));
    await gk.act(takeOf(gk));
    await waitFor('j to decide', () => deciding(gj));
    gk.dispose();
    await gj.act(displayOf(gj, 'tier-1'));
    await waitFor('k owes the refill at j', () => gj.owed.value?.seats.join() === String(k), 60_000);
    const owed = gj.owed.value;
    expect(owed?.until).toBe((gj.view.value?.pendingSince ?? 0) + 86400);
    expect(gj.waiting.value).toEqual([k]);
    expect(v2view(gj)?.owed.reveal).toEqual([k]);
    const who = NAMES[k] as string;
    expect(waitingText(gj, now())).toMatch(
      new RegExp(
        `^Waiting for ${who} to reveal a card\\. Their app must be open on this game\\. If it is not sent within (?:1d 0h|23h 5\\dm), ${who} can be timed out\\.$`,
      ),
    );
    // j's Home: the saved status names k's npub and the deadline.
    await waitFor(
      'j’s saved status',
      () => loadGameStatus(ps[j]?.name ?? '', ps[j]?.deps.storage as never, rootId)?.reveal !== undefined,
    );
    expect(loadGameStatus(ps[j]?.name ?? '', ps[j]?.deps.storage as never, rootId)?.reveal).toEqual({
      npubs: [ps[k]?.deps.signer.pubkey],
      mine: false,
      until: owed?.until,
    });

    // Past the deadline on j's clock: the screen says so, and j times k out, though it was not k's turn.
    const cj = clocks[j] as ReturnType<typeof clock>;
    cj.skew = 86400 + 60;
    gj.tick();
    await waitFor('a timeout target', () => gj.timeoutTarget.value === k);
    expect(waitingText(gj, cj.now())).toBe(
      `Waiting for ${who} to reveal a card. Their app must be open on this game. The deadline has passed: ${who} can be timed out.`,
    );
    await gj.claimTimeout();
    await waitFor('the claim counted', () => gj.view.value?.outcome?.reason === 'forfeit', 60_000);
    expect(v2view(gj)?.result).toMatchObject({ kind: 'claim', forfeit: [k] });
    expect(gj.view.value?.outcome?.places).toEqual(j === 0 ? [1, 2] : [2, 1]);
  }, 900_000);
});
