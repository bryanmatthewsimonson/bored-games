/*
 * End to end: a protocol 1 Chain Reaction game still opens and plays in this build (PROTOCOL-v2 §2, the rollout:
 * "v1 games in progress must keep working").
 *
 * Every new table the app makes is protocol 2, so `relay-node.ts` publishes the protocol 1 Table with the protocol's
 * own templates, signed by a's key. Then, through the UI:
 * - a (holding that key) and b, c join from the share link and a starts the game; the Table and the Root keep
 *   `proto` 1 on the relay;
 * - everyone shuffles, deals and reaches the play screen; the players answer their decisions for a few turns, and b
 *   reloads and rebuilds the game from the relays;
 * - every context shows the same state and board.
 *
 * Run it with `pnpm e2e v1.spec.ts`.
 */
import { randomBytes } from 'node:crypto';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { decide, game, nextToAct, type Player, stateOf } from './cr-ui.ts';
import { latestTable, rootsOf, seedV1ChainReactionTable, tagOf } from './relay-node.ts';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const NAMES = ['v1a', 'v1b', 'v1c'];
/** Turn 4 under way: three players' first full round and one more. */
const UNTIL_TURN = 4;
const SETUP_MS = 5 * 60_000;
const MOVE_MS = 60_000;

const appUrl = (profile: string, hash: string): string => {
  const u = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  u.searchParams.set('relays', RELAY);
  u.hash = hash;
  return u.toString();
};

async function open(
  browser: Browser,
  name: string,
  url: string,
  storage: Array<[string, string]> = [],
): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  // The creator's key and game secrets are in this browser before the app first loads, as after an import.
  if (storage.length > 0)
    await context.addInitScript((entries) => {
      for (const [k, v] of entries) localStorage.setItem(k as string, v as string);
    }, storage);
  const page: Page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error: ${e.message}`));
  await page.goto(url);
  return { name, page };
}

async function join(p: Player): Promise<void> {
  await p.page.getByRole('button', { name: 'Join this table' }).click();
  await p.page.getByRole('button', { name: 'Join anyway' }).click();
  await expect(p.page.getByText('You are seated.')).toBeVisible();
}

test('a protocol 1 Chain Reaction table opens, starts and plays a few turns', async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const sk = randomBytes(32);
  const table = await seedV1ChainReactionTable(RELAY, new Uint8Array(sk));
  const seeded = await latestTable(RELAY, table.address);
  expect(seeded === null ? null : tagOf(seeded, 'proto')).toBe('1');

  const [name0, name1, name2] = NAMES as [string, string, string];
  const a = await open(browser, name0, appUrl(name0, table.hash), table.storage(name0));
  const b = await open(browser, name1, appUrl(name1, table.hash));
  const c = await open(browser, name2, appUrl(name2, table.hash));
  const players = [a, b, c];
  // The creator's Join is already on the relay (the seeding made it); the others join from the link.
  await expect(a.page.getByText('Waiting for 2 more players.')).toBeVisible({ timeout: MOVE_MS });
  for (const p of [b, c]) await join(p);
  await expect(a.page.getByText('Every seat is taken.')).toBeVisible({ timeout: MOVE_MS });
  await a.page.getByRole('button', { name: 'Start game' }).click();
  await a.page.getByRole('button', { name: 'Yes, start the game' }).click();
  for (const p of players) await expect(p.page).toHaveURL(/#\/g\/[0-9a-f]{64}$/, { timeout: MOVE_MS });
  for (const p of players) await expect(game(p)).toBeVisible({ timeout: SETUP_MS });

  // The game is protocol 1 on the relay: the Table (started) and the Root.
  const started = await latestTable(RELAY, table.address);
  expect(started === null ? null : tagOf(started, 'status')).toBe('started');
  expect(started === null ? null : tagOf(started, 'proto')).toBe('1');
  const roots = await rootsOf(RELAY, table.creator, table.address);
  expect(roots).toHaveLength(1);
  expect(tagOf(roots[0] as (typeof roots)[number], 'proto')).toBe('1');

  let reloaded = false;
  for (let moves = 0; ; moves++) {
    const turn = Math.min(...(await Promise.all(players.map(async (p) => (await stateOf(p)).turn))));
    if (turn >= UNTIL_TURN) break;
    if (!reloaded && turn >= 2) {
      reloaded = true;
      await b.page.reload();
      await expect(game(b)).toBeVisible({ timeout: MOVE_MS });
    }
    const actor = await nextToAct(players);
    const before = await stateOf(actor);
    await decide(actor);
    await expect
      .poll(async () => (await stateOf(actor)).seq, { timeout: MOVE_MS })
      .toBeGreaterThan(before.seq);
    if (moves > 60) throw new Error(`no progress after ${moves} decisions`);
  }
  expect(reloaded).toBe(true);
  const target = Math.max(...(await Promise.all(players.map(async (p) => (await stateOf(p)).seq))));
  for (const p of players)
    await expect.poll(async () => (await stateOf(p)).seq, { timeout: MOVE_MS }).toBe(target);
  for (const p of players) await expect(p.page.getByText(/signed two rival moves/)).toHaveCount(0);
  for (const p of players) await p.page.context().close();
});
