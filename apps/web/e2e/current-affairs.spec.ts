import { COMPARE_BGG_ID, COMPARE_PHRASE } from '@bored-games/current-affairs/compare';
import { type Browser, expect, type Page, test } from '@playwright/test';

/*
 * Current Affairs end to end (D091): three players, each in a browser context of its own, over the dev relay. The
 * game is deckless: the regions, the first order and every station drawn from the stack come from dice that all the
 * open apps roll together (D058), with no click. The driver plays the first round by simple clicks: everyone puts up
 * the lowest station it can (the others fold), buys the fuel to fire it, wires one city and fires at payday. Then a
 * reload, and at 390 px the page does not scroll sideways. Run it with `pnpm e2e current-affairs.spec.ts`.
 */

const root = (p: Page) => p.getByTestId('ca-game');
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

/** What the round's driver did, to check that each phase was played. */
const done = { bought: 0, fuel: 0, wired: 0, fired: 0 };

/** One decision on `p`, by the decision its screen names. */
async function decide(p: Page): Promise<void> {
  const decision = await root(p).getAttribute('data-decision');
  switch (decision) {
    case 'open':
      // Pick the lowest station on offer, then put it up at its number.
      return sends(p, async () => {
        await root(p).locator('button[data-station]:not([disabled])').first().click();
        await button(p, 'open').first().click();
        done.bought++;
      });
    case 'bid':
      return sends(p, () => button(p, 'fold').first().click());
    case 'scrap':
      return sends(p, () => button(p, 'scrap').first().click());
    case 'fuel':
      if ((await button(p, 'fuel').count()) > 0) {
        done.fuel++;
        return sends(p, () => button(p, 'fuel').first().click());
      }
      return sends(p, () => button(p, 'done').first().click());
    case 'build': {
      const mine = await root(p).getAttribute('data-my-seat');
      const wired = await root(p)
        .locator(`.ca-company[data-seat="${mine}"] .ca-stats div:nth-child(2) dd`)
        .innerText();
      if (Number.parseInt(wired, 10) === 0 && (await button(p, 'build').count()) > 0) {
        done.wired++;
        return sends(p, () => button(p, 'build').first().click());
      }
      return sends(p, () => button(p, 'done').first().click());
    }
    case 'power':
      done.fired++;
      return sends(p, () => button(p, 'power').first().click());
    default:
      throw new Error(`nothing to do at ${decision}`);
  }
}

test('three players play the first round of Current Affairs', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const errors: string[] = [];
  const profiles = ['ca-a', 'ca-b', 'ca-c'];
  const pages: Page[] = [];
  for (const profile of profiles) pages.push(await open(browser, profile, errors));
  const a = pages[0] as Page;

  // 1. The table: three seats, no rule options.
  await a.getByLabel('Search games').fill('Current');
  await a.getByRole('link', { name: 'Current Affairs', exact: true }).click();
  await expect(a.getByRole('link', { name: COMPARE_PHRASE, exact: true })).toHaveAttribute(
    'href',
    `https://boardgamegeek.com/boardgame/${COMPARE_BGG_ID}`,
  );
  await a.getByLabel('Players', { exact: true }).selectOption('3');
  await a.getByRole('button', { name: 'Create table', exact: true }).click();
  await a.getByRole('button', { name: 'Create anyway', exact: true }).click();
  const share = await a.getByLabel('Table link').inputValue();
  for (const [i, p] of pages.slice(1).entries()) {
    await p.goto(url(profiles[i + 1] as string, share));
    await p.getByRole('button', { name: 'Join this table', exact: true }).click();
    await p.getByRole('button', { name: 'Join anyway', exact: true }).click();
  }
  await expect(a.getByText('Every seat is taken.')).toBeVisible();
  await a.getByRole('button', { name: 'Start game', exact: true }).click();
  await a.getByRole('button', { name: 'Yes, start the game', exact: true }).click();
  for (const p of pages) await expect(root(p)).toBeVisible({ timeout: 600_000 });
  const players: Page[] = [];
  for (const p of pages) players[Number(await root(p).getAttribute('data-my-seat'))] = p;
  expect(players.filter((p) => p !== undefined)).toHaveLength(3);
  const watch = players[0] as Page;

  // 2. The opening rolls (the regions, then the order) go through by themselves: the first auction opens.
  await expect(root(watch)).toHaveAttribute('data-phase', 'auction', { timeout: 300_000 });
  await expect(root(watch).locator('.ca-log')).toContainText('The regions in play');
  await expect(root(watch).locator('.ca-log')).toContainText('Player order');
  await expect(root(watch).locator('.ca-market')).toBeVisible();

  // 3. The loop: whoever is to decide clicks, until the second round starts.
  for (let step = 0; step < 200; step++) {
    if ((await root(watch).getAttribute('data-round')) === '2') break;
    await expect
      .poll(
        async () => {
          if ((await root(watch).getAttribute('data-round')) === '2') return true;
          const seat = await root(watch).getAttribute('data-pending-seat');
          if (seat === null || seat === 'none') return false;
          const p = players[Number(seat)] as Page;
          return (
            (await root(p)
              .locator('button[data-action]:not([disabled]), button[data-station]:not([disabled])')
              .count()) > 0
          );
        },
        { timeout: 180_000 },
      )
      .toBe(true);
    if ((await root(watch).getAttribute('data-round')) === '2') break;
    const seat = Number(await root(watch).getAttribute('data-pending-seat'));
    await decide(players[seat] as Page);
  }
  await expect(root(watch)).toHaveAttribute('data-round', '2');
  expect(done.bought).toBeGreaterThanOrEqual(3);
  expect(done.fuel).toBeGreaterThan(0);
  expect(done.wired).toBeGreaterThan(0);
  const log = root(watch).locator('.ca-log');
  await expect(log).toContainText('buys station');
  await expect(log).toContainText(/buys \d+ \w+.* for \$\d+/);
  await expect(log).toContainText('wires');
  await expect(log).toContainText('is paid');
  await expect(log).toContainText('Round 2 begins');
  // Everyone sees the city wired on the map.
  await expect(
    root(players[1] as Page)
      .locator('.ca-company')
      .first(),
  ).toBeVisible();

  // 4. A reload keeps the game.
  const p0 = players[0] as Page;
  await p0.reload();
  await expect(root(p0)).toHaveAttribute('data-round', '2', { timeout: 120_000 });

  // 5. A phone: the page does not scroll sideways.
  await p0.setViewportSize({ width: 390, height: 844 });
  expect(await p0.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await p0.screenshot({ path: '/tmp/current-affairs-390.png', fullPage: true });

  expect(errors).toEqual([]);
});
