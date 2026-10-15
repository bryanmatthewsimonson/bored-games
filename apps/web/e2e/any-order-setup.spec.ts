/*
 * End to end: an any-order setup (D093) with a seat away at the start, against the dev relay.
 *
 * - a creates a 4-seat Chain Reaction table; b, c and d join, a second apart, so they take seats 1, 2 and 3. b
 *   closes its tab before the start, and c and d go to Home, so a is the only player with the game's page open.
 * - a shuffles at once. c's and d's setup runners shuffle from Home, each after its stagger (45 s per rank) and the
 *   runner's grace (20 s). a's game page then waits for b alone, and c's and d's Home name b.
 * - b opens Home again: its runner shuffles and deals, c's and d's runners deal, and a's game reaches play before b,
 *   c or d has opened the game's page. Then they open it and reach play too.
 * - Home with the runner's line and the game page with the waiting line do not scroll sideways at 390 px.
 *
 * Run it with `pnpm e2e any-order-setup.spec.ts`. It waits in real time: about 3 minutes of stagger and grace on top
 * of the proofs.
 */
import { SHUFFLE_STAGGER_S } from '@bored-games/client';
import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test';
import { SETUP_MODE_GRACE_S } from '../src/game-controller.ts';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const SEATS = 4;
/** Shuffle and deal proofs, as in play.spec.ts: 5 minutes for 3 players, in proportion to the seats. */
const SETUP_MS = (5 * 60_000 * SEATS) / 3;
/** A setup runner's wait for one rank: a stagger step and its grace (D093). */
const STEP_MS = (SHUFFLE_STAGGER_S + SETUP_MODE_GRACE_S) * 1000;
/** A runner's grace before each setup duty. */
const GRACE_MS = SETUP_MODE_GRACE_S * 1000;
/** One page load or relay round trip. */
const MOVE_MS = 60_000;

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** The app URL for a profile, pointed at the test relay; `from` keeps another URL's hash (a share link). */
function appUrl(profile: string, from?: string): string {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  if (RELAY !== 'none') u.searchParams.set('relays', RELAY);
  return u.toString();
}

/** A tab of `context` at `url`, its page errors logged. */
async function tab(context: BrowserContext, name: string, url: string): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console error: ${m.text()}`);
  });
  await page.goto(url);
  return page;
}

async function open(browser: Browser, name: string, url: string): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  return { name, context, page: await tab(context, name, url) };
}

/** Wait until the clock reads a later second than `ms` (Unix ms): an event signed then has a later `created_at`. */
async function nextSecond(ms: number): Promise<void> {
  const wait = (Math.floor(ms / 1000) + 1) * 1000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** The player's short npub, from the header (the players have no profile names). */
const keyOf = (p: Player): Promise<string> => p.page.locator('.identity .npub').innerText();

/** The player's one game on Home ("Your games"). */
const gameCard = (p: Player): Locator =>
  p.page.getByRole('region', { name: 'Your games' }).locator('li.card');

const playScreen = (p: Player): Locator => p.page.getByTestId('cr-game');

/** Whether the page is at most `width` wide: nothing scrolls sideways at phone width. */
async function fits(p: Player, width = 390): Promise<void> {
  await p.page.setViewportSize({ width, height: 844 });
  expect(await p.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await p.page.setViewportSize({ width: 1280, height: 1000 });
}

test('four players: seat 1 is away at the start, opens Home later, and everyone reaches play', async ({
  browser,
}) => {
  // The lobby, then a's, c's and d's shuffles (c and d wait up to 3 ranks of stagger and grace), then b's shuffle and
  // every deal (each runner waits its grace twice), then the three game pages.
  test.setTimeout(5 * MOVE_MS + 3 * STEP_MS + 2 * SETUP_MS + 2 * GRACE_MS);
  const started = Date.now();
  const log = (msg: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);

  const a = await open(browser, 'a', appUrl('a'));
  await a.page.getByLabel('Search games').fill('Chain Reaction');
  await a.page.getByRole('link', { name: 'Chain Reaction', exact: true }).click();
  await expect(a.page).toHaveURL(/#\/games\/chain-reaction$/);
  await a.page.getByLabel('Players', { exact: true }).selectOption(String(SEATS));
  await a.page.getByRole('button', { name: 'Create table' }).click();
  await a.page.getByRole('button', { name: 'Create anyway' }).click();
  await expect(a.page).toHaveURL(/#\/t\/[0-9a-f]{64}\//);
  const share = await a.page.getByLabel('Table link').inputValue();
  log(`table created: ${share}`);

  // The open seats go to the joiners by their Join's `created_at`, in whole seconds, then by id (D021): joining a
  // second apart, b, c and d take seats 1, 2 and 3.
  const joiners: Player[] = [];
  let seatedAt = 0;
  for (const name of ['b', 'c', 'd']) {
    const p = await open(browser, name, appUrl(name, share));
    await p.page.getByRole('button', { name: 'Join this table' }).click();
    await nextSecond(seatedAt);
    await p.page.getByRole('button', { name: 'Join anyway' }).click();
    await expect(p.page.getByText('You are seated.')).toBeVisible();
    seatedAt = Date.now();
    joiners.push(p);
    log(`${name} joined`);
  }
  const [b, c, d] = joiners as [Player, Player, Player];
  // b's short npub, as Home and the game page name b.
  const bKey = await keyOf(b);
  await expect(a.page.locator('.seat-list .npub')).toHaveText([
    await keyOf(a),
    bKey,
    await keyOf(c),
    await keyOf(d),
  ]);

  // b is away: its tab is closed (its saved game keys stay in its browser). c and d wait on Home.
  await b.page.close();
  for (const p of [c, d]) {
    await p.page.goto(appUrl(p.name));
    await expect(gameCard(p)).toHaveCount(1, { timeout: MOVE_MS });
  }

  await expect(a.page.getByText('Every seat is taken.')).toBeVisible();
  await a.page.getByRole('button', { name: 'Start game' }).click();
  await a.page.getByRole('button', { name: 'Yes, start the game' }).click();
  await expect(a.page).toHaveURL(/#\/g\/[0-9a-f]{64}$/, { timeout: MOVE_MS });
  const gameHash = new URL(a.page.url()).hash;
  log('game started');

  // a shuffles from the game page; c and d from Home, after their stagger and grace. Then only b is left, and
  // nobody waits for b to go first.
  await expect(a.page.getByText('Shuffling the deck: 3 of 4 players done.')).toBeVisible({
    timeout: 3 * STEP_MS + SETUP_MS,
  });
  await expect(
    a.page.getByText(`Waiting for ${bKey} to shuffle. They need to open the app once.`, { exact: true }),
  ).toBeVisible();
  for (const p of [c, d]) {
    await expect(gameCard(p).getByText(`Waiting for ${bKey} to shuffle`, { exact: true })).toBeVisible({
      timeout: MOVE_MS,
    });
    expect(new URL(p.page.url()).hash).not.toBe(gameHash);
  }
  log('a, c and d shuffled; the game waits for b');
  await fits(a);
  await fits(c);

  // b opens Home: its runner shuffles, then deals.
  b.page = await tab(b.context, 'b', appUrl('b'));
  await expect(gameCard(b).getByText('Shuffling your part…', { exact: true })).toBeVisible({
    timeout: 2 * MOVE_MS,
  });
  log("b's runner is shuffling");
  await expect(gameCard(b).getByText(/^(Dealing…|Waiting for .+ to deal)$/)).toBeVisible({
    timeout: SETUP_MS,
  });
  log("b's shuffle is in; the deal is under way");

  // Every deal is in while b, c and d are still on Home: a's game page reaches play.
  await expect(playScreen(a)).toBeVisible({ timeout: SETUP_MS });
  for (const p of [b, c, d]) expect(new URL(p.page.url()).hash).not.toBe(gameHash);
  log('a is on the play screen; b, c and d dealt from Home');

  for (const p of [b, c, d]) {
    await gameCard(p).getByRole('link', { name: 'Open game' }).click();
    await expect(p.page).toHaveURL(new RegExp(`${gameHash}$`));
    await expect(playScreen(p)).toBeVisible({ timeout: 2 * MOVE_MS });
    log(`${p.name} opened the game on the play screen`);
  }
  // The four games' pages would keep running into the next spec.
  for (const p of [a, b, c, d]) await p.context.close();
});
