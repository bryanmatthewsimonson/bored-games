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

  it('audit F2: an honest seat on two devices never forks itself and never releases its own card, whether the tablet lags or saved its move offline', async () => {
    const { rootId, address, bySeat } = await h.start2('luster', h.profile('a'), h.profile('b'));
    const keys = await sessionKeys(rootId);
    const games = bySeat.map((p) => h.game(rootId, p.deps));
    const phone = await waitFor('the first decision', () => games.find(deciding), 300_000);
    const k = games.indexOf(phone);
    const player = bySeat[k] as Profile;
    const other = games[1 - k] as GameController;

    // 1. A lagging tablet: its live feed has not delivered the phone's moves yet.
    const tabletDev = h.secondDevice(player, address);
    const lag = laggingOwn(tabletDev.deps.pool, () => keys[k] as string);
    const tablet = h.game(rootId, { ...tabletDev.deps, pool: lag.pool });
    await waitFor('the tablet decision', () => deciding(tablet), 300_000);
    const top = stateOf(phone).decks['tier-1'].next;
    const p = physical('tier-1', top);
    await phone.act(blindOf(phone, 'tier-1'));
    const blind = phone.view.value?.head.id as Hex;
    await waitFor('the other seat holds the reservation', () => other.view.value?.head.id === blind);
    // The tablet tries a take on the same turn: the check before signing finds the phone's move instead.
    await expect(tablet.act(takeOf(tablet))).rejects.toThrow(ALREADY_MOVED);
    expect(tablet.view.value?.head.id).toBe(blind);
    expect(lag.built()).toEqual([]);
    // The other seat's app releases p; both devices read the card, and neither releases it.
    const cardAt = (c: GameController) =>
      stateOf(c).players[k]?.reserved.find((r) => r.deck === 'tier-1' && r.pos === top)?.card;
    await waitFor('the phone reads its card', () => typeof cardAt(phone) === 'number', 60_000);
    await waitFor('the tablet reads its card', () => cardAt(tablet) === cardAt(phone), 60_000);
    expect(cardAt(other)).toBeNull();
    tablet.dispose();

    // 2. A tablet whose publishing is down signs a take on the seat's next turn; the phone reserves blind instead.
    const g = other;
    await waitFor('the other seat to decide', () => deciding(g));
    await g.act(takeOf(g));
    const offDev = h.secondDevice(player, address);
    const off = offlinePool(offDev.deps.pool);
    const t2 = h.game(rootId, { ...offDev.deps, pool: off.pool });
    await waitFor('the second tablet decision', () => deciding(t2), 300_000);
    await waitFor('the phone decision', () => deciding(phone));
    await t2.act(takeOf(t2));
    const stale = [...loadOutbox(offDev.deps.storage, offDev.name, rootId)].find(
      ([slot, e]) => slot.startsWith('move:') && !e.confirmed,
    )?.[1].event as NostrEvent;
    const top2 = stateOf(phone).decks['tier-2'].next;
    const q = physical('tier-2', top2);
    off.offline = false;
    await phone.act(blindOf(phone, 'tier-2'));
    // The tablet discards its stale move at once and rebuilds with no fork; nothing of the seat is revealed.
    await waitFor(
      'the discard',
      () =>
        logged(t2, /A move saved on this device was never sent, and it was discarded: another move of yours/),
      60_000,
    );
    await waitFor(
      'no fork at the tablet',
      () => v2view(t2)?.fork === null && t2.view.value?.phase === 'play',
      60_000,
    );
    await waitFor(
      'the tablet reads the second card',
      () =>
        typeof stateOf(t2).players[k]?.reserved.find((r) => r.deck === 'tier-2' && r.pos === top2)?.card ===
        'number',
      60_000,
    );
    await pause(2000);
    expect(off.published).not.toContain(stale.id);
    expect(await h.query([{ kinds: [KIND.reveal], authors: [keys[k] as string], '#e': [rootId] }])).toEqual(
      [],
    );
    const own = (await releasesBy(rootId, keys[k] as Hex)).filter(
      (r) => r.positions.includes(p) || r.positions.includes(q),
    );
    expect(own).toEqual([]);
    for (const c of [phone, other, t2]) {
      expect(c.view.value?.equivocators).toEqual([]);
      expect(v2view(c)?.fork).toBeNull();
    }
  }, 900_000);

  it('audit F3: a release saved on the side of a fork its seat never saw played is discarded, never sent, though its card is now that seat’s own; the game stops on the forker', async () => {
    const { rootId, address, bySeat } = await h.start2('luster', h.profile('a'), h.profile('b'));
    const keys = await sessionKeys(rootId);
    const games = bySeat.map((p) => h.game(rootId, p.deps));
    const first = await waitFor('the first decision', () => games.find(deciding), 300_000);
    const e = games.indexOf(first);
    const hs = 1 - e;
    const H = bySeat[hs] as Profile;
    const E = bySeat[e] as Profile;
    const head = first.view.value?.head as { id: Hex; seq: number };
    // Both deals at the relay before E's app closes (an app folds its own deal before publishing it).
    await eventually(
      'both deals',
      async () =>
        new Set((await h.query([{ kinds: [KIND.shares], '#e': [rootId] }])).map((ev) => ev.pubkey)).size ===
        2,
    );
    for (const c of games) c.dispose();

    // E's own tooling signs two rival moves on the head: A reserves from the display (the market refills from the
    // top of tier 1, p, a public reveal), B takes gems.
    const es = await h.outsideSession(rootId, address, E);
    expect(es.view().head.id).toBe(head.id);
    const st = es.view().state as LusterState;
    const legal = es.legalActions() as Action[];
    const top = st.decks['tier-1'].next;
    const p = physical('tier-1', top);
    const A = es.buildAction(
      legal.find((a) => a.type === 'reserve' && a.deck === 'tier-1' && a.pos !== top),
      rnd,
      now(),
    );
    const B = es.buildAction(
      legal.find((a) => a.type === 'take'),
      rnd,
      now(),
    );

    // H's tablet, whose publishing is down, holds A: it saves its release of p, which no relay confirms.
    const tabletDev = h.secondDevice(H, address);
    const off = offlinePool(tabletDev.deps.pool);
    let tablet = h.game(rootId, { ...tabletDev.deps, pool: off.pool });
    await waitFor(
      'the tablet at the head',
      () => tablet.view.value?.head.id === head.id && tablet.status.value !== 'syncing',
      300_000,
    );
    // H's phone never receives A (E sent it where the phone does not read).
    const hidden = new Set<string>([A.id]);
    const net = hiding(H.deps.pool, hidden);
    await h.pool().publish(A);
    const slot = `release:${A.id}`;
    await waitFor('the saved release', () => outboxSlots(tabletDev, rootId).includes(slot), 60_000);
    tablet.dispose();

    // B arrives; on B it is H's turn, and H's phone reserves the top of tier 1 blind: p is H's own card there.
    await h.pool().publish(B);
    const phone = h.game(rootId, { ...H.deps, pool: net.pool });
    await waitFor('H to move on B', () => phone.view.value?.head.id === B.id && deciding(phone), 300_000);
    expect(blindOf(phone, 'tier-1').pos).toBe(top);
    await phone.act(blindOf(phone, 'tier-1'));
    const mine = phone.view.value?.head.id as Hex;

    // The tablet comes back online: it holds A, B and the phone's move, so the fork at the head stops the game on E;
    // its saved release of p is vetted and discarded, never sent.
    off.offline = false;
    tablet = h.game(rootId, { ...tabletDev.deps, pool: off.pool });
    await waitFor(
      'the discard',
      () => logged(tablet, /A card reveal saved on this device was never sent, and it was discarded/),
      60_000,
    );
    expect(outboxSlots(tabletDev, rootId)).not.toContain(slot);
    await waitFor('the stop on E', () => v2view(tablet)?.stop?.seat === e, 60_000);
    expect(v2view(tablet)?.stop).toEqual({ at: head.id, seat: e, cancelled: false });
    expect(v2view(tablet)?.fork?.certificate).toEqual([A.id, B.id].sort());
    expect(tablet.view.value?.outcome?.places[e]).toBe(2);
    expect(mine).not.toBe(head.id);
    await pause(2000);
    const sharesOfP = (await releasesBy(rootId, keys[hs] as Hex)).filter((r) => r.positions.includes(p));
    expect(sharesOfP).toEqual([]);
  }, 900_000);
});
