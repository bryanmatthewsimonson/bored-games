import { COMPARE_BGG_ID, COMPARE_PHRASE } from '@bored-games/sticks-and-stones/compare';
import { type Browser, expect, type Page, test } from '@playwright/test';

/*
 * Sticks & Stones end to end (D089): two players and a spectator, each in a browser context of its own, over the dev
 * relay. The cards and tiles are shuffled in the browsers and every die is rolled by all the open apps together
 * (D058). The driver plays a whole round and into the next by simple clicks: everyone sends people to the hunt and
 * the grounds, brings them home with a roll each, and is fed. Then a reload, and at 390 px the page does not scroll
 * sideways. Run it with `pnpm e2e sticks-and-stones.spec.ts`.
 */

const root = (p: Page) => p.getByTestId('ss-game');
const url = (profile: string, from?: string) => {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  u.searchParams.set('relays', process.env.E2E_RELAY ?? 'ws://localhost:7777');
  return u.toString();
};
const seqOf = async (p: Page) => Number(await root(p).getAttribute('data-seq'));

async function open(browser: Browser, profile: string, errors: string[], from?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${profile}] ${e.message}`));
  await page.goto(url(profile, from));
  return page;
}

/** Click and wait for the move it sends to land on `page`. */
async function sends(p: Page, click: () => Promise<void>) {
  const before = await seqOf(p);
  await click();
  await expect.poll(() => seqOf(p), { timeout: 120_000 }).toBeGreaterThan(before);
}

const button = (p: Page, type: string) =>
  root(p).locator(`button[data-action*='"type":"${type}"']:not([disabled])`);

/** One decision on `p`: place on the hunt (all of them) or a ground, then roll, take tools, pick, feed. */
async function decide(p: Page): Promise<void> {
  const stage = await root(p).getAttribute('data-stage');
  if (stage === 'place') {
    // A count already asked for: send them all.
    if ((await button(p, 'place').count()) > 0) return sends(p, () => button(p, 'place').last().click());
    const hunt = root(p).locator('button[data-spot="hunt"]');
    const spot = (await hunt.count()) > 0 ? hunt : root(p).locator('button.ss-spot[data-spot]').first();
    // One count sends at the click; more ask how many, and all of them go.
    return sends(p, async () => {
      await spot.click();
      const chooser = button(p, 'place');
      await chooser
        .first()
        .waitFor({ timeout: 2000 })
        .catch(() => {});
      if ((await chooser.count()) > 0) await chooser.last().click();
    });
  }
  for (const type of ['use', 'tools', 'pick', 'skip', 'feed'])
    if ((await button(p, type).count()) > 0) return sends(p, () => button(p, type).first().click());
  throw new Error(`nothing to do at ${stage}`);
}

test('two players play a round of Sticks & Stones and start the next', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const errors: string[] = [];
  const profiles = ['ss-a', 'ss-b'];
  const pages: Page[] = [];
  for (const profile of profiles) pages.push(await open(browser, profile, errors));
  const a = pages[0] as Page;

  // 1. The table: two seats, the default scoring of duplicate symbols.
  await a.getByLabel('Search games').fill('Sticks');
  await a.getByRole('link', { name: 'Sticks & Stones', exact: true }).click();
  await expect(a.getByRole('link', { name: COMPARE_PHRASE, exact: true })).toHaveAttribute(
    'href',
    `https://boardgamegeek.com/boardgame/${COMPARE_BGG_ID}`,
  );
  await a.getByLabel('Players', { exact: true }).selectOption('2');
  await expect(a.getByRole('group', { name: 'Second copies of a culture symbol' })).toBeVisible();
  await a.getByRole('button', { name: 'Create table', exact: true }).click();
  await a.getByRole('button', { name: 'Create anyway', exact: true }).click();
  const share = await a.getByLabel('Table link').inputValue();
  const b = pages[1] as Page;
  await b.goto(url(profiles[1] as string, share));
  await b.getByRole('button', { name: 'Join this table', exact: true }).click();
  await b.getByRole('button', { name: 'Join anyway', exact: true }).click();
  await expect(a.getByText('Every seat is taken.')).toBeVisible();
  await a.getByRole('button', { name: 'Start game', exact: true }).click();
  await a.getByRole('button', { name: 'Yes, start the game', exact: true }).click();
  for (const p of pages) await expect(root(p)).toBeVisible({ timeout: 600_000 });
  const players: Page[] = [];
  for (const p of pages) players[Number(await root(p).getAttribute('data-my-seat'))] = p;
  expect(players.filter((p) => p !== undefined)).toHaveLength(2);
  const spectator = await open(browser, 'ss-s', errors, a.url());
  await expect(root(spectator)).toHaveAttribute('data-my-seat', 'spectator', { timeout: 600_000 });
  // The camp: eight spots, four discoveries, two monument sites; nothing to click for a spectator.
  await expect(root(spectator).locator('[data-spot]')).toHaveCount(14, { timeout: 120_000 });
  await expect(root(spectator).locator('button[data-spot]')).toHaveCount(0);
  await expect(root(spectator).locator('svg[aria-label^="Monument"]')).toHaveCount(2);

  // 2. The loop: whoever the spectator says is to decide clicks, until the second round starts.
  for (let step = 0; step < 200; step++) {
    if ((await root(spectator).getAttribute('data-round')) === '2') break;
    await expect
      .poll(
        async () => {
          if ((await root(spectator).getAttribute('data-round')) === '2') return true;
          const seat = await root(spectator).getAttribute('data-pending-seat');
          if (seat === null || seat === 'none') return false;
          const p = players[Number(seat)] as Page;
          return (
            (await root(p).locator('button[data-action]:not([disabled]), button[data-spot]').count()) > 0
          );
        },
        { timeout: 180_000 },
      )
      .toBe(true);
    if ((await root(spectator).getAttribute('data-round')) === '2') break;
    const seat = Number(await root(spectator).getAttribute('data-pending-seat'));
    await decide(players[seat] as Page);
  }
  await expect(root(spectator)).toHaveAttribute('data-round', '2');
  await expect(root(spectator).locator('.ss-log')).toContainText('rolls');
  await expect(root(spectator).locator('.ss-dice')).toBeVisible();

  // 3. A reload keeps the game.
  const p0 = players[0] as Page;
  await p0.reload();
  await expect(root(p0)).toHaveAttribute('data-round', '2', { timeout: 120_000 });

  // 4. A phone: the page does not scroll sideways.
  await p0.setViewportSize({ width: 390, height: 844 });
  expect(await p0.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await p0.screenshot({ path: '/tmp/sticks-and-stones-390.png', fullPage: true });

  expect(errors).toEqual([]);
});
