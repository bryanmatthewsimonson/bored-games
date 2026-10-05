/*
 * The protocol 2 outbox rule in the game controller (v2 build T16; PROTOCOL-v2 §9.2, D071, D073): every event this
 * seat saved and no relay confirmed goes through `GameSessionV2.vetSaved` after a full answer from every counted
 * relay (D056's hold, its cap and Send anyway), and is sent, kept waiting or discarded and logged. Chess v2 is fast;
 * one Chain Reaction game covers a saved card reveal and a saved Secret reveal.
 */
import type { ChainReactionState } from '@bored-games/chain-reaction';
import { chainReaction } from '@bored-games/chain-reaction';
import type { ChessState } from '@bored-games/chess';
import type { SessionViewV2 } from '@bored-games/client';
import { type Ciphertext, makeShare } from '@bored-games/deck';
import {
  cardSharesTemplate,
  finalizeEvent,
  type Hex,
  KIND,
  moveTemplate,
  type NostrEvent,
  parseMove,
  parseRoot,
  secretTemplate,
} from '@bored-games/protocol';
import type { EoseInfo } from '@bored-games/relay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type GameController, HOLD_CAP_S, loadOutbox, outboxKey } from '../src/game-controller.ts';
import { bytesToHex } from '../src/hex.ts';
import type { PoolLike } from '../src/net.ts';
import { loadSecrets } from '../src/storage.ts';
import { Harness, now, offlinePool, outboxSlots, type Profile, pause, rnd, waitFor } from './net-harness.ts';

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

/** Events of the game on the dev relay signed by `key`, of `kind`. */
const signed = (rootId: string, key: string, kind: number): Promise<NostrEvent[]> =>
  h.query([{ kinds: [kind], authors: [key], '#e': [rootId] }]);

/** Write `events` into `p`'s saved outbox for the game, by slot, unconfirmed. */
function saveOutbox(p: Profile, rootId: string, events: Record<string, NostrEvent>): void {
  const key = outboxKey(p.name, rootId);
  const all = JSON.parse(p.deps.storage.getItem(key) ?? '{}') as Record<string, unknown>;
  for (const [slot, event] of Object.entries(events)) all[slot] = { event, confirmed: false, orphan: false };
  p.deps.storage.setItem(key, JSON.stringify(all));
}

/** Wait until `get` resolves to true (a relay query, say). */
async function eventually(what: string, get: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await get())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await pause(100);
  }
}

const logged = (c: GameController, re: RegExp): boolean => c.log.value.some((line) => re.test(line));

/** A clock this test moves: Unix seconds plus `skew`. */
function clock() {
  const c = { skew: 0, now: () => now() + c.skew };
  return c;
}

/** A relay of the player's that is alive but never answers while `silent` is set (D056). */
const SILENT = 'wss://silent.test';
function silencing(real: PoolLike) {
  const net = {
    silent: true,
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

describe('The protocol 2 outbox rule in the controller (T16)', () => {
  it('V2-45: a move saved offline on a tablet, after the phone played that turn, is discarded on reload and never sent; nobody is flagged', async () => {
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const wKey = await sessionKey(rootId, 0);
    const tablet = h.secondDevice(white, address);
    const off = offlinePool(tablet.deps.pool);
    let t = h.game(rootId, { ...tablet.deps, pool: off.pool });
    await waitFor('the tablet decision', () => t.status.value === 'your-turn');
    await t.act(chessMove(0, 'd2d4'));
    const stale = loadOutbox(tablet.deps.storage, tablet.name, rootId).get(`move:1:${rootId}`);
    expect(stale?.confirmed).toBe(false);
    t.dispose();

    // The phone plays that turn otherwise, and Black answers.
    const phone = h.game(rootId, white.deps);
    const gb = h.game(rootId, black.deps);
    await play(phone, 0, 'e2e4', 1);
    await play(gb, 1, 'e7e5', 2);

    // The tablet comes back online: its saved move is vetted against what the relays hold, and discarded.
    const on = offlinePool(tablet.deps.pool);
    on.offline = false;
    t = h.game(rootId, { ...tablet.deps, pool: on.pool });
    await waitFor('the discard', () =>
      logged(t, /A move saved on this device was never sent, and it was discarded: another move of yours/),
    );
    await waitFor('the tablet follows the game', () => history(t) === 2);
    expect(on.published).not.toContain(stale?.event.id);
    expect(outboxSlots(tablet, rootId)).toEqual([]);
    expect((await signed(rootId, wKey, KIND.move)).map((ev) => ev.id)).not.toContain(stale?.event.id);
    await pause(300);
    for (const g of [phone, gb, t]) {
      expect(g.view.value?.equivocators).toEqual([]);
      expect(v2view(g)?.fork).toBeNull();
    }
  }, 60_000);

  it('V2-45: a saved move built on a saved move the outbox discards is discarded with it, not kept waiting for ever', async () => {
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white] = bySeat;
    const secrets = loadSecrets(white.name, white.deps.storage, address);
    if (secrets === null) throw new Error('no game keys');
    // The tablet saved a move on the root and one more on top of it (as in a game where a seat moves twice), offline.
    const tablet = h.secondDevice(white, address);
    const build = (prevId: string, seq: number, uci: string) =>
      finalizeEvent(
        moveTemplate(
          {
            rootId,
            prevId,
            seq,
            content: { type: 'action', action: chessMove(0, uci), shares: [], reveals: [] },
          },
          now(),
          '2',
        ),
        secrets.sessionSk,
        rnd,
      );
    const m1 = build(rootId, 1, 'd2d4');
    const m2 = build(m1.id, 2, 'g1f3');
    saveOutbox(tablet, rootId, { [`move:1:${rootId}`]: m1, [`move:2:${m1.id}`]: m2 });
    // Meanwhile the phone played that turn otherwise.
    const phone = h.game(rootId, white.deps);
    await play(phone, 0, 'e2e4', 1);

    const on = offlinePool(tablet.deps.pool);
    on.offline = false;
    const t = h.game(rootId, { ...tablet.deps, pool: on.pool });
    await waitFor('both discarded', () => outboxSlots(tablet, rootId).length === 0);
    expect(logged(t, /discarded: another move of yours on that position is held/)).toBe(true);
    expect(logged(t, /discarded: it follows a saved move that was discarded/)).toBe(true);
    expect(on.published).not.toContain(m1.id);
    expect(on.published).not.toContain(m2.id);
    expect(t.canSendAnyway.value).toBe(false);
  }, 60_000);

  it('V2-45: an end attestation saved offline is discarded once a fork is held; nothing of the seat goes out under the fork', async () => {
    const wc = clock();
    const a = h.profile('a');
    const b = h.profile('b');
    const { rootId, address, bySeat } = await h.start2('chess', a, b);
    const [w, black] = bySeat;
    const white = { ...w, deps: { ...w.deps, now: wc.now } };
    const wKey = await sessionKey(rootId, 0);
    const net = offlinePool(white.deps.pool);
    net.offline = false;
    let gw = h.game(rootId, { ...white.deps, pool: net.pool });
    const gb = h.game(rootId, black.deps);
    await play(gw, 0, 'e2e4', 1);
    // Black's own tooling signs a rival to its next move (published later: a fork at move 1).
    const outside = await h.outsideSession(rootId, address, black);
    const rival = outside.buildAction(chessMove(1, 'd7d5'), rnd, now());
    await play(gb, 1, 'e7e5', 2);
    await play(gw, 0, 'g1f3', 3);
    await waitFor('move 3 at Black', () => history(gb) === 3);
    gb.dispose();
    // White's network drops; on White's clock Black's deadline passes, White claims, and end-attests the claim.
    net.offline = true;
    wc.skew = 86400 + 60;
    gw.tick();
    await waitFor('a timeout target', () => gw.timeoutTarget.value === 1);
    await gw.claimTimeout();
    await waitFor('the claim counted', () => gw.view.value?.outcome?.reason === 'forfeit');
    const endSlot = await waitFor('the end attestation saved', () =>
      [...loadOutbox(white.deps.storage, white.name, rootId).keys()].find((s) => s.startsWith('end:')),
    );
    gw.dispose();
    expect(await signed(rootId, wKey, KIND.attest)).toEqual([]);

    // Black forks at move 1; White reloads online and holds the fork: the saved attestation is discarded.
    await h.pool().publish(rival);
    const on = offlinePool(white.deps.pool);
    on.offline = false;
    gw = h.game(rootId, { ...white.deps, pool: on.pool });
    await waitFor('the fork', () => v2view(gw)?.fork != null);
    await waitFor('the discard', () =>
      logged(
        gw,
        /An end attestation saved on this device was never sent, and it was discarded: a fork is held/,
      ),
    );
    expect(loadOutbox(white.deps.storage, white.name, rootId).has(endSlot)).toBe(false);
    for (let i = 0; i < 3; i++) {
      gw.tick();
      await pause(300);
    }
    // Nothing White signed went out under the fork: no attestation, no claim.
    expect(await signed(rootId, wKey, KIND.attest)).toEqual([]);
    expect(await signed(rootId, wKey, KIND.timeout)).toEqual([]);
  }, 90_000);

  it('V2-45: a Resign saved offline is vetted and published after a reload', async () => {
    const { rootId, address, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [white, black] = bySeat;
    const wKey = await sessionKey(rootId, 0);
    const gb = h.game(rootId, black.deps);
    const net = offlinePool(white.deps.pool);
    net.offline = false;
    let gw = h.game(rootId, { ...white.deps, pool: net.pool });
    await play(gw, 0, 'e2e4', 1);
    net.offline = true;
    await waitFor('the resign button', () => gw.canResign.value);
    await gw.resign();
    const saved = loadOutbox(white.deps.storage, white.name, rootId).get('resign');
    expect(saved?.confirmed).toBe(false);
    gw.dispose();
    expect(await signed(rootId, wKey, KIND.resign)).toEqual([]);
    void address;

    const on = offlinePool(white.deps.pool);
    on.offline = false;
    gw = h.game(rootId, { ...white.deps, pool: on.pool });
    await waitFor('the Resign published', () => on.published.includes(saved?.event.id as string));
    await waitFor('Black sees it', () => gb.view.value?.outcome?.reason === 'resign');
    expect(await signed(rootId, wKey, KIND.resign)).toHaveLength(1);
    expect(gw.log.value).toEqual([]);
  }, 60_000);

  it('V2-45: a Timeout claim saved offline waits for every counted relay, Send anyway sends it past the hold cap, and the end and stats attestations follow', async () => {
    const wc = clock();
    const { rootId, bySeat } = await h.start2('chess', h.profile('a'), h.profile('b'));
    const [w, black] = bySeat;
    const white = { ...w, deps: { ...w.deps, now: wc.now } };
    const wKey = await sessionKey(rootId, 0);
    const gb = h.game(rootId, black.deps);
    const net = offlinePool(white.deps.pool);
    net.offline = false;
    let gw = h.game(rootId, { ...white.deps, pool: net.pool });
    await play(gw, 0, 'e2e4', 1);
    await waitFor('move 1 at Black', () => history(gb) === 1);
    gb.dispose();
    net.offline = true;
    wc.skew = 86400 + 60;
    gw.tick();
    await waitFor('a timeout target', () => gw.timeoutTarget.value === 1);
    await gw.claimTimeout();
    await waitFor('the claim counted', () => gw.view.value?.outcome?.reason === 'forfeit');
    const claimSlot = [...loadOutbox(white.deps.storage, white.name, rootId).keys()].find((s) =>
      s.startsWith('timeout:'),
    ) as string;
    const claim = loadOutbox(white.deps.storage, white.name, rootId).get(claimSlot)?.event as NostrEvent;
    await waitFor('the end attestation saved', () =>
      [...loadOutbox(white.deps.storage, white.name, rootId).keys()].some((s) => s.startsWith('end:')),
    );
    gw.dispose();

    // Online again, with an own relay that stays silent: the claim is held, unpublished, until the hold cap.
    const silent = silencing(white.deps.pool);
    const deps = { ...white.deps, relays: () => [h.relay.url, SILENT], pool: silent.pool };
    gw = h.game(rootId, deps);
    await waitFor('the game loaded', () => gw.view.value !== null && gw.status.value !== 'syncing');
    // The claim was fed at the load: the game is over here.
    expect(gw.view.value?.outcome?.reason).toBe('forfeit');
    gw.tick();
    await pause(500);
    expect(silent.published).toEqual([]);
    expect(gw.canSendAnyway.value).toBe(false);
    wc.skew += HOLD_CAP_S + 1;
    gw.tick();
    await waitFor('Send anyway offered', () => gw.canSendAnyway.value);
    gw.sendAnyway();
    await waitFor('the claim sent anyway', () => silent.published.includes(claim.id));
    await eventually(
      'the end attestation sent',
      async () => (await signed(rootId, wKey, KIND.attest)).length > 0,
    );
    expect(await signed(rootId, wKey, KIND.timeout)).toHaveLength(1);
  }, 90_000);
});

describe('The protocol 2 outbox rule on card reveals and the Secret reveal (T16, Chain Reaction)', () => {
  it('V2-45: a saved card reveal of a tile now in its own seat’s hand is discarded, never sent; a saved Secret reveal waits while the game is live', async () => {
    const ps = [h.profile('a'), h.profile('b'), h.profile('c')] as [Profile, Profile, Profile];
    const { rootId, address, bySeat } = await h.start3('chain-reaction', ps);
    const games = bySeat.map((p) => h.game(rootId, p.deps));
    const mover = await waitFor(
      'a decision',
      () => games.find((g) => g.status.value === 'your-turn' && g.legal.value.length > 0),
      240_000,
    );
    await mover.act(mover.legal.value[0]);
    const anchor = mover.view.value?.head.id as Hex;
    // Seat j: any seat. Its tablet saved, on that move, a reveal of a tile in its own hand, and its Secret reveal.
    const j = (games.indexOf(mover) + 1) % 3;
    const player = bySeat[j] as Profile;
    const secrets = loadSecrets(player.name, player.deps.storage, address);
    if (secrets === null) throw new Error('no game keys');
    const deckSecret = BigInt(`0x${bytesToHex(secrets.deckSecret)}`);
    const state = games[j]?.view.value?.state as ChainReactionState;
    const deckId = chainReaction.decks(chainReaction.defaultRules())[0]?.id as string;
    const own = chainReaction.dealt(state).find((d) => d.deck === deckId && d.to === j)?.pos as number;
    const steps = await h.query([{ kinds: [KIND.move], '#e': [rootId] }]);
    const last = steps.find((ev) => ev.tags.some((t) => t[0] === 'seq' && t[1] === '3')) as NostrEvent;
    const content = parseMove(last, 108, '2').content;
    if (content.type !== 'shuffle') throw new Error('not a shuffle step');
    const share = makeShare(deckSecret, content.deck[own] as Ciphertext, { rootId, deckId, pos: own }, rnd);
    const release = finalizeEvent(
      cardSharesTemplate({ rootId, anchorId: anchor, shares: [{ pos: own, share }] }, now()),
      secrets.sessionSk,
      rnd,
    );
    const secret = finalizeEvent(secretTemplate({ rootId, deckSecret }, now(), '2'), secrets.sessionSk, rnd);
    const tablet = h.secondDevice(player, address);
    saveOutbox(tablet, rootId, { [`release:${anchor}`]: release, secret });
    const net = offlinePool(tablet.deps.pool);
    net.offline = false;
    const t = h.game(rootId, { ...tablet.deps, pool: net.pool });
    await waitFor('the reveal discarded', () =>
      logged(
        t,
        /A card reveal saved on this device was never sent, and it was discarded: it would reveal your own card/,
      ),
    );
    for (let i = 0; i < 3; i++) {
      t.tick();
      await pause(300);
    }
    expect(net.published).not.toContain(release.id);
    expect(net.published).not.toContain(secret.id);
    const key = parseRoot((await h.query([{ ids: [rootId] }]))[0]).seats[j]?.session as string;
    expect(await signed(rootId, key, KIND.reveal)).toEqual([]);
    expect((await signed(rootId, key, KIND.shares)).map((ev) => ev.id)).not.toContain(release.id);
    // The Secret stays saved, unsent, while the game is live.
    expect(loadOutbox(tablet.deps.storage, tablet.name, rootId).get('secret')?.confirmed).toBe(false);
    expect(t.view.value?.phase).toBe('play');
  }, 600_000);
});
