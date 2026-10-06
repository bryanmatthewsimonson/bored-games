/*
 * End to end: Holler's compare line, the rules-page suit patterns, and a dealt hand on a phone.
 *
 * The rules page shows one card of each suit and the active-suit control. Two players then deal a hand.
 * 390px does not scroll sideways. Run it with `pnpm e2e holler.spec.ts`.
 */
import { BRAND } from '@bored-games/brand';
import { COMPARE_PHRASE, COMPARE_TITLE } from '@bored-games/holler/compare';
import { type Browser, expect, type Page, test } from '@playwright/test';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const WORDS: Record<string, string> = {
  chevron: 'chevrons',
  wave: 'waves',
  seed: 'seeds',
  diamond: 'diamonds',
};
const SUITS: Record<string, string> = { notch: 'Notch', tide: 'Tide', seed: 'Seed', kiln: 'Kiln' };

function appUrl(profile: string, from?: string): string {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  if (RELAY !== 'none') u.searchParams.set('relays', RELAY);
  return u.toString();
}

async function open(browser: Browser, name: string, from?: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`[${name}] page error: ${err.message}`));
  await page.goto(appUrl(name, from));
  return page;
}

async function fits(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

test('the compare line and the four suit patterns fit a phone', async ({ browser }) => {
  const page = await open(browser, 'holler-rules');
  await page.getByLabel('Search games').fill(COMPARE_TITLE);
  await expect(page.locator('.game-card-compare')).toHaveText(COMPARE_PHRASE);
  await page.getByRole('link', { name: 'Holler', exact: true }).click();
  await expect(page).toHaveURL(/#\/games\/holler$/);
  const compare = page.getByRole('link', { name: COMPARE_PHRASE, exact: true });
  await expect(compare).toHaveAttribute('href', 'https://boardgamegeek.com/boardgame/2223');
  await expect(
    page.getByText(`${BRAND.name} is not affiliated with or endorsed by the makers of that game.`),
  ).toBeVisible();
  await fits(page, 1280, 1000);
  await fits(page, 390, 844);

  await page.getByRole('link', { name: 'How to play', exact: true }).click();
  await expect(page).toHaveURL(/#\/rules\/holler$/);
  await expect(page.getByRole('heading', { name: 'How to play Holler' })).toBeVisible();
  const found = await page
    .locator('[data-pattern]')
    .evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-pattern')))].sort());
  expect(found).toEqual(['chevron', 'diamond', 'seed', 'wave']);
  const active = page.getByTestId('holler-active-suit');
  await expect(active).toHaveAttribute('data-pattern', 'wave');
  await expect(active).toHaveAttribute('data-suit', 'tide');
  await expect(active).toHaveAccessibleName('Tide, waves');
  await fits(page, 1280, 1000);
  await fits(page, 390, 844);
});

test('two players deal a hand and the table fits a phone', async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const a = await open(browser, 'holler-a');
  const b = await open(browser, 'holler-b');
  await a.getByLabel('Search games').fill('Holler');
  await a.getByRole('link', { name: 'Holler', exact: true }).click();
  await a.getByLabel('Players', { exact: true }).selectOption('2');
  await a.getByRole('button', { name: 'Create table' }).click();
  await a.getByRole('button', { name: 'Create anyway' }).click();
  await expect(a).toHaveURL(/#\/t\/[0-9a-f]{64}\//);
  const share = await a.getByLabel('Table link').inputValue();
  await b.goto(appUrl('holler-b', share));
  await b.getByRole('button', { name: 'Join this table' }).click();
  await b.getByRole('button', { name: 'Join anyway' }).click();
  await expect(b.getByText('You are seated.')).toBeVisible();
  await expect(a.getByText('Every seat is taken.')).toBeVisible();
  await a.getByRole('button', { name: 'Start game' }).click();
  await a.getByRole('button', { name: 'Yes, start the game' }).click();

  await expect(a.getByTestId('holler-game')).toBeVisible({ timeout: 120_000 });
  await expect(b.getByTestId('holler-game')).toBeVisible({ timeout: 120_000 });
  await expect(a.getByTestId('holler-hand')).toBeVisible();
  await fits(a, 1280, 1000);
  await fits(a, 390, 844);
  await a.setViewportSize({ width: 1280, height: 1000 });

  const active = a.getByTestId('holler-active-suit');
  if ((await active.count()) > 0) {
    const suit = (await active.getAttribute('data-suit')) ?? '';
    const pattern = (await active.getAttribute('data-pattern')) ?? '';
    await expect(active).toHaveAccessibleName(`${SUITS[suit]}, ${WORDS[pattern]}`);
  }
});
