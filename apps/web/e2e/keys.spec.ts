/*
 * End to end: the same player key on a second device (D065, the owner's report of 2026-10-03).
 *
 * - a creates a Chess table, b joins, a starts it. a's browser backs up a's game keys (encrypted to a's npub) when it
 *   creates the table.
 * - A second browser context, "a's desktop", holds only a's nsec (the same profile name, its own storage) and opens
 *   the game: it restores the game keys from the backup, says so, and plays White's first move. a's own browser sees
 *   the move as its own and does not offer the turn again; b answers, and both of a's devices see it.
 *
 * Run it with `pnpm e2e keys.spec.ts`.
 */
import { type Browser, expect, type Page, test } from '@playwright/test';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const MOVE_MS = 30_000;

function appUrl(profile: string, from?: string): string {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  if (RELAY !== 'none') u.searchParams.set('relays', RELAY);
  return u.toString();
}

async function open(browser: Browser, name: string, init?: { key: string; value: string }): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  // A second device: the player's key is in this browser before the app first loads, as after an import.
  if (init !== undefined)
    await context.addInitScript(
      ([k, v]) => localStorage.setItem(k as string, v as string),
      [init.key, init.value],
    );
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error: ${e.message}`));
  return page;
}

const board = (p: Page) => p.getByTestId('chess-game');
const square = (p: Page, sq: string) => p.locator(`[data-square="${sq}"]`);

async function move(
  p: Page,
  from: string,
  to: string,
  everyone: readonly Page[],
  seq: number,
): Promise<void> {
  await expect(p.locator('.chess-status-line.mine')).toBeVisible({ timeout: MOVE_MS });
  await square(p, from).click();
  await square(p, to).click();
  for (const q of everyone)
    await expect(board(q)).toHaveAttribute('data-seq', String(seq), { timeout: MOVE_MS });
}

test("a second device with the player's key restores the game keys from the backup and plays", async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const a = await open(browser, 'a');
  const b = await open(browser, 'b');
  await a.goto(`${appUrl('a')}#/games/chess`);
  await a.getByRole('button', { name: 'Create table' }).click();
  await a.getByRole('button', { name: 'Create anyway' }).click();
  await expect(a).toHaveURL(/#\/t\/[0-9a-f]{64}\//);
  const share = await a.getByLabel('Table link').inputValue();
  await b.goto(appUrl('b', share));
  await b.getByRole('button', { name: 'Join this table' }).click();
  await b.getByRole('button', { name: 'Join anyway' }).click();
  await expect(b.getByText('You are seated.')).toBeVisible();
  await a.getByRole('button', { name: 'Start game' }).click();
  await a.getByRole('button', { name: 'Yes, start the game' }).click();
  for (const p of [a, b]) {
    await expect(p).toHaveURL(/#\/g\/[0-9a-f]{64}$/, { timeout: MOVE_MS });
    await expect(board(p)).toHaveAttribute('data-seq', '0', { timeout: MOVE_MS });
  }
  const gameUrl = a.url();

  // a's desktop: only a's nsec, nothing else.
  const sk = await a.evaluate(() => localStorage.getItem('bg:a:sk'));
  expect(sk).toMatch(/^[0-9a-f]{64}$/);
  const desk = await open(browser, 'a-desktop', { key: 'bg:a:sk', value: sk as string });
  await desk.goto(gameUrl);
  await expect(desk.getByText(/Your game keys were restored from your backup/)).toBeVisible({
    timeout: MOVE_MS,
  });
  await expect(desk.getByText("You're watching this game")).toHaveCount(0);
  await expect(desk.getByText('Your move (White)')).toBeVisible({ timeout: MOVE_MS });

  // The desktop plays White's move; the phone takes it as its own, and Black answers.
  await move(desk, 'e2', 'e4', [desk, a, b], 1);
  await expect(a.locator('.chess-status-line.mine')).toHaveCount(0);
  await move(b, 'e7', 'e5', [desk, a, b], 2);
  for (const p of [a, desk]) await expect(p.getByText('Your move (White)')).toBeVisible({ timeout: MOVE_MS });
  for (const p of [a, b, desk]) await expect(p.getByText(/signed two rival moves/)).toHaveCount(0);
});
