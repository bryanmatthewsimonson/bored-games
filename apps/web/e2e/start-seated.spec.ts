/*
 * End to end: the creator starts a table that is not full with the players seated (D092), against the dev relay.
 *
 * a creates a 4-seat Bank table (a deckless game, so no shuffle to wait for). b and c join; the fourth seat stays
 * empty. a sees "Start with 3 players", confirms "The empty seat closes …", and all three reach the game. The
 * Table page does not scroll sideways at 390 px with the extra button.
 *
 * Run it with `pnpm e2e start-seated.spec.ts`.
 */
import { type Browser, expect, type Page, test } from '@playwright/test';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const MOVE_MS = 30_000;

interface Player {
  name: string;
  page: Page;
}

function appUrl(profile: string, from?: string): string {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  if (RELAY !== 'none') u.searchParams.set('relays', RELAY);
  return u.toString();
}

async function open(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console error: ${m.text()}`);
  });
  await page.goto(appUrl(name));
  return { name, page };
}

test('the creator starts a 4-seat table with the 3 players seated', async ({ browser }) => {
  const a = await open(browser, 'a');
  const b = await open(browser, 'b');
  const c = await open(browser, 'c');

  await a.page.getByLabel('Search games').fill('bank');
  await a.page.getByRole('link', { name: 'Bank', exact: true }).click();
  await expect(a.page).toHaveURL(/#\/games\/bank$/);
  await a.page.getByLabel('Players', { exact: true }).selectOption('4');
  await a.page.getByRole('button', { name: 'Create table' }).click();
  await a.page.getByRole('button', { name: 'Create anyway' }).click();
  await expect(a.page).toHaveURL(/#\/t\/[0-9a-f]{64}\//);
  const share = await a.page.getByLabel('Table link').inputValue();

  // Bank needs 2 players: alone at the table, a cannot start yet.
  await expect(a.page.getByText('Waiting for 3 more players.')).toBeVisible();
  await expect(a.page.getByRole('button', { name: /^Start with/ })).toHaveCount(0);
  await b.page.goto(appUrl(b.name, share));
  await b.page.getByRole('button', { name: 'Join this table' }).click();
  await b.page.getByRole('button', { name: 'Join anyway' }).click();
  await expect(b.page.getByText('You are seated.')).toBeVisible();
  await expect(b.page.getByText(/sooner if the creator starts it with the players seated/)).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Start with 2 players' })).toBeVisible();

  await c.page.goto(appUrl(c.name, share));
  await c.page.getByRole('button', { name: 'Join this table' }).click();
  await c.page.getByRole('button', { name: 'Join anyway' }).click();
  await expect(c.page.getByText('You are seated.')).toBeVisible();

  await expect(a.page.getByText('Waiting for 1 more player.')).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Start game', exact: true })).toHaveCount(0);
  await a.page.setViewportSize({ width: 390, height: 844 });
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await a.page.setViewportSize({ width: 1280, height: 1000 });

  await a.page.getByRole('button', { name: 'Start with 3 players' }).click();
  await expect(a.page.getByRole('heading', { name: 'Start with the 3 players seated?' })).toBeVisible();
  await expect(
    a.page.getByText(
      'The empty seat closes and the game starts with the 3 players seated. Nobody can join afterwards.',
    ),
  ).toBeVisible();
  await a.page.getByRole('button', { name: 'Yes, start the game' }).click();

  for (const p of [a, b, c]) {
    await expect(p.page).toHaveURL(/#\/g\/[0-9a-f]{64}$/, { timeout: MOVE_MS });
    await expect(p.page.getByTestId('bank-game')).toBeVisible({ timeout: MOVE_MS });
  }
  expect(new Set([a, b, c].map((p) => p.page.url().split('#')[1])).size).toBe(1);
});
