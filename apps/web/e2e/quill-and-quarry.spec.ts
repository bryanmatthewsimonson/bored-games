import { expect, type Page, test } from '@playwright/test';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
function url(profile: string, from?: string) {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  u.searchParams.set('relays', RELAY);
  return u.toString();
}
async function fits(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}
async function active(pages: Page[]): Promise<Page> {
  let selected: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of pages)
          if (await page.getByRole('button', { name: 'Pass', exact: true }).isEnabled()) {
            selected = page;
            return true;
          }
        return false;
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  if (!selected) throw new Error('No active player');
  return selected;
}
test('original art, rules, playable word field, private racks, exchange and final audit', async ({
  browser,
}) => {
  test.setTimeout(9 * 60_000);
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1440, height: 1250 } }),
    browser.newContext({ viewport: { width: 1440, height: 1250 } }),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const a = pages[0],
    b = pages[1];
  if (!a || !b) throw new Error('Two pages are required');
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', (e) => errors.push(e.message));
  await a.goto(url('quill-a'));
  await a.getByLabel('Search games').fill('Quill');
  await a.getByRole('link', { name: 'Quill & Quarry', exact: true }).click();
  await expect(a.locator('.qq-cover-art')).toHaveCount(1);
  await a.getByRole('link', { name: 'How to play', exact: true }).click();
  await expect(a.getByRole('heading', { name: 'How to play Quill & Quarry' })).toBeVisible();
  await expect(
    a.getByText('It does not contain a word list or independently verify a dictionary ruling.'),
  ).toBeVisible();
  await fits(a, 390);
  await fits(a, 1440);
  await a.goto(`${url('quill-a')}#/games/quill-and-quarry`);
  await a.getByLabel('Players', { exact: true }).selectOption('2');
  await a.getByRole('button', { name: 'Create table', exact: true }).click();
  await a.getByRole('button', { name: 'Create anyway' }).click();
  await expect(a).toHaveURL(/#\/t\//);
  const link = await a.getByLabel('Table link').inputValue();
  await b.goto(url('quill-b', link));
  await b.getByRole('button', { name: 'Join this table' }).click();
  await b.getByRole('button', { name: 'Join anyway' }).click();
  await expect(a.getByText('Every seat is taken.')).toBeVisible();
  await a.getByRole('button', { name: 'Start game', exact: true }).click();
  await a.getByRole('button', { name: 'Yes, start the game' }).click();
  for (const page of pages) await expect(page.getByTestId('quill-game')).toBeVisible({ timeout: 180_000 });
  const player = await active(pages);
  const opponent = player === a ? b : a;
  await expect(player.locator('.qq-rack-tile')).toHaveCount(7);
  await expect(player.locator('.qq-cell')).toHaveCount(225);
  const board = await player.locator('.qq-board').boundingBox(),
    sidebar = await player.locator('.qq-sidebar').boundingBox();
  if (!sidebar || !board) throw new Error('Missing board or sidebar');
  expect(sidebar.x).toBeGreaterThan(board.x + board.width);
  await player.locator('.qq-rack-tile').nth(0).click();
  await player.locator('[data-cell="112"]').click();
  await player.locator('.qq-rack-tile').nth(1).click();
  await player.locator('[data-cell="113"]').click();
  await expect(player.locator('.qq-staged')).toHaveCount(2);
  await expect(opponent.locator('.qq-staged')).toHaveCount(0);
  await player.getByRole('button', { name: /Play word/ }).click();
  await expect(opponent.getByRole('button', { name: 'Accept play' })).toBeEnabled({ timeout: 60_000 });
  await opponent.getByRole('button', { name: 'Accept play' }).click();
  await expect(player.locator('.qq-rack-tile')).toHaveCount(7);
  await expect(player.locator('.qq-cell[data-occupied="true"]')).toHaveCount(2);
  await expect(player.locator('.qq-staged')).toHaveCount(0);
  const exchanging = await active(pages);
  await exchanging.getByRole('button', { name: 'Exchange', exact: true }).click();
  await exchanging.locator('.qq-rack-tile').nth(0).click();
  await exchanging.getByRole('button', { name: 'Exchange 1 tile', exact: true }).click();
  await expect.poll(async () => (await active(pages)) === player, { timeout: 180_000 }).toBe(true);
  await player.screenshot({ path: '/tmp/quill-desktop.png', fullPage: true });
  await fits(player, 390);
  await player.screenshot({ path: '/tmp/quill-mobile.png', fullPage: true });
  await fits(player, 1440);
  // One exchange followed by five passes supplies six scoreless turns.
  for (let i = 0; i < 5; i++) {
    const p = await active(pages);
    await p.getByRole('button', { name: 'Pass', exact: true }).click();
    await p.getByRole('button', { name: 'Yes, pass', exact: true }).click();
    const other = p === a ? b : a;
    if (i < 4)
      await expect(other.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled({ timeout: 60_000 });
  }
  let final: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of pages)
        if (await page.getByRole('button', { name: 'Finalize scores' }).isEnabled()) {
          final = page;
          return true;
        }
      return false;
    })
    .toBe(true);
  if (!final) throw new Error('Missing finalization player');
  await final.getByRole('button', { name: 'Finalize scores' }).click();
  for (const page of pages)
    await expect(page.getByText('Tile ownership and deal audit passed.', { exact: false })).toBeVisible({
      timeout: 180_000,
    });
  expect(errors).toEqual([]);
  for (const c of contexts) await c.close();
});
