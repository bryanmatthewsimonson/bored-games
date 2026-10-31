import { COMPARE_BGG_ID, COMPARE_PHRASE } from '@bored-games/fever-pitch/compare';
import { type Browser, expect, type Page, test } from '@playwright/test';

/*
 * Fever Pitch end to end (D096): two players, each in a browser context of its own, over the dev relay, on the
 * Gentle level. The one deck is shuffled in the browsers, and every card (the roles, the open hands, the nine opening
 * spread cards and each draw) turns up for everyone at once with no click. The driver then plays three turns by
 * simple clicks: the active player travels once by picking a city on the chart, then ends its actions; any relief
 * window is passed, any discard made, any Early Warning order kept. Both players see both hands. Then a reload, and
 * at 390 px the page does not scroll sideways. Run it with `pnpm e2e fever-pitch.spec.ts`.
 */

const root = (p: Page) => p.getByTestId('fp-game');
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

/** Click and wait for the move it sends to land on `p`. */
async function sends(p: Page, click: () => Promise<void>) {
  const before = await seqOf(p);
  await click();
  await expect.poll(() => seqOf(p), { timeout: 120_000 }).toBeGreaterThan(before);
}

const enabled = (p: Page, testid: string) => root(p).locator(`[data-testid="${testid}"]:not([disabled])`);
let travelled = 0;

/** One decision on `p`, by the decision its screen names. */
async function decide(p: Page): Promise<void> {
  const decision = await root(p).getAttribute('data-decision');
  switch (decision) {
    case 'relief':
      return sends(p, () => enabled(p, 'fp-pass').first().click());
    case 'discard':
      return sends(p, () => enabled(p, 'fp-discard').first().click());
    case 'arrange':
      return sends(p, () => enabled(p, 'fp-arrange').first().click());
    case 'act': {
      const turn = await root(p).getAttribute('data-turn');
      if (travelled < Number(turn)) {
        travelled = Number(turn);
        // Pick the first city the chart offers, then the first way there.
        await root(p).locator('.fp-city-target').first().click();
        return sends(p, () => enabled(p, 'fp-move').first().click());
      }
      return sends(p, () => enabled(p, 'fp-end').first().click());
    }
    default:
      throw new Error(`nothing to do at ${decision}`);
  }
}

test('two players play three turns of Fever Pitch', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const errors: string[] = [];
  const profiles = ['fp-a', 'fp-b'];
  const pages: Page[] = [];
  for (const profile of profiles) pages.push(await open(browser, profile, errors));
  const a = pages[0] as Page;

  // 1. The table: two seats, the Gentle level.
  await a.getByLabel('Search games').fill('Fever');
  await a.getByRole('link', { name: 'Fever Pitch', exact: true }).click();
  await expect(a.getByRole('link', { name: COMPARE_PHRASE, exact: true })).toHaveAttribute(
    'href',
    `https://boardgamegeek.com/boardgame/${COMPARE_BGG_ID}`,
  );
  await a.getByLabel('Gentle (4)').check();
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
  const watch = players[0] as Page;

  // 2. The setup turns up by itself: roles, open hands of four, nine cities with cases.
  await expect(root(watch)).toHaveAttribute('data-phase', 'actions', { timeout: 300_000 });
  await expect(root(watch).locator('.fp-history')).toContainText('Roles dealt');
  for (const p of players)
    for (const seat of [0, 1])
      await expect(root(p).getByTestId(`fp-seat-${seat}`).locator('.fp-hand .fp-card')).toHaveCount(4);

  // 3. The loop: whoever is to decide clicks, until turn 4 begins.
  for (let step = 0; step < 120; step++) {
    if (Number(await root(watch).getAttribute('data-turn')) >= 4) break;
    if ((await root(watch).getAttribute('data-phase')) === 'over') break;
    await expect
      .poll(
        async () => {
          if (Number(await root(watch).getAttribute('data-turn')) >= 4) return true;
          const seat = await root(watch).getAttribute('data-pending-seat');
          if (seat === null || seat === 'none') return false;
          const p = players[Number(seat)] as Page;
          return (await root(p).locator('[data-testid^="fp-"]:is(button):not([disabled])').count()) > 0;
        },
        { timeout: 180_000 },
      )
      .toBe(true);
    if (Number(await root(watch).getAttribute('data-turn')) >= 4) break;
    const seat = Number(await root(watch).getAttribute('data-pending-seat'));
    await decide(players[seat] as Page);
  }
  const log = root(watch).locator('.fp-history');
  await expect(log).toContainText('Turn 3');
  await expect(log).toContainText('travelled');
  await expect(log).toContainText('drew');
  await expect(log).toContainText('Spread:');

  // 4. A reload keeps the game.
  const p0 = players[0] as Page;
  const turn = await root(watch).getAttribute('data-turn');
  await p0.reload();
  await expect(root(p0)).toHaveAttribute('data-turn', turn ?? '', { timeout: 120_000 });

  // 5. A phone: the page does not scroll sideways.
  await p0.setViewportSize({ width: 390, height: 844 });
  expect(await p0.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await p0.screenshot({ path: '/tmp/fever-pitch-390.png', fullPage: true });

  expect(errors).toEqual([]);
});
