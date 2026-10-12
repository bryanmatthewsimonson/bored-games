import { COMPARE_BGG_ID, COMPARE_PHRASE } from '@bored-games/hazard/compare';
import { type Browser, expect, type Page, test } from '@playwright/test';

/*
 * Hazard end to end (D088): three players and a spectator, each in a browser context of its own, over the dev relay.
 * The table plays with automatic defence, so a battle waits on nobody's click. The charters are shuffled in the
 * browsers; every die is rolled by all the open apps together (D058). The driver plays the first-player roll, the
 * whole claim and placement by clicking the atlas, then musters and attacks with each player's biggest stack until
 * a province is taken and a charter drawn. That charter's face shows on its holder's page only, never on the other
 * players' or the spectator's, and again after a reload. At 390 px the page does not scroll sideways (the atlas
 * scrolls in its own frame). Run it with `pnpm e2e hazard.spec.ts`.
 */

const root = (p: Page) => p.getByTestId('hz-game');
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

/** The labels of the charter faces `page` shows: "Greatcanopy Horse charter", or "A hidden charter". */
const charterLabels = (p: Page) =>
  root(p)
    .locator('svg.hz-card')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
const faces = async (p: Page) => (await charterLabels(p)).filter((l) => l !== 'A hidden charter');

/** The provinces `page` may click now, with their troops read from their labels. */
async function clickable(
  p: Page,
  which = '[data-province][aria-disabled="false"]',
): Promise<{ id: string; troops: number; selected: boolean }[]> {
  return root(p)
    .locator(which)
    .evaluateAll((els) =>
      els.map((e) => {
        const label = e.getAttribute('aria-label') ?? '';
        const m = /(\d+) troops?$/.exec(label);
        return {
          id: e.getAttribute('data-province') ?? '',
          troops: m === null ? 0 : Number(m[1]),
          selected: e.getAttribute('aria-pressed') === 'true',
        };
      }),
    );
}

/** Click and wait for the move it sends to land on `page`. */
async function sends(p: Page, click: () => Promise<void>) {
  const before = await seqOf(p);
  await click();
  await expect.poll(() => seqOf(p), { timeout: 120_000 }).toBeGreaterThan(before);
}

const button = (p: Page, type: string) =>
  root(p).locator(`button[data-action*='"type":"${type}"']:not([disabled])`);

/** One decision on `p`, by a simple policy: roll, claim or place, muster on the biggest stack, attack, stop. */
async function decide(p: Page, attacking: { captured: boolean }): Promise<void> {
  if ((await button(p, 'roll').count()) > 0) return sends(p, () => button(p, 'roll').first().click());
  if ((await button(p, 'advance').count()) > 0) {
    attacking.captured = true;
    return sends(p, () => button(p, 'advance').first().click());
  }
  const stage = await root(p).getAttribute('data-stage');
  const open = await clickable(p);
  if (stage === 'claim' || stage === 'place') {
    const first = open[0];
    if (first === undefined) throw new Error(`no province to ${stage}`);
    return sends(p, () => root(p).locator(`[data-province="${first.id}"]`).click());
  }
  if (stage === 'muster') {
    if ((await button(p, 'cash').count()) > 0) return sends(p, () => button(p, 'cash').first().click());
    const best = [...open].sort((x, y) => y.troops - x.troops)[0];
    if (best === undefined) throw new Error('no province to muster on');
    return sends(p, () => root(p).locator(`[data-province="${best.id}"]`).click());
  }
  if (stage === 'attack') {
    if (attacking.captured) return sends(p, () => button(p, 'endAttack').first().click());
    // Pick the biggest stack, then its weakest target, then the most dice.
    const from = [...open].sort((x, y) => y.troops - x.troops)[0];
    if (from === undefined || from.troops < 2) return sends(p, () => button(p, 'endAttack').first().click());
    await root(p).locator(`[data-province="${from.id}"]`).click();
    const targets = await clickable(p, '[data-province].hz-prov-target');
    const to = [...targets].sort((x, y) => x.troops - y.troops)[0];
    if (to === undefined) return sends(p, () => button(p, 'endAttack').first().click());
    await root(p).locator(`[data-province="${to.id}"]`).click();
    const dice = button(p, 'attack');
    await expect(dice.first()).toBeVisible();
    return sends(p, () => dice.last().click());
  }
  if (stage === 'march') return sends(p, () => button(p, 'endTurn').first().click());
  throw new Error(`nothing to do at ${stage}`);
}

test('three players open a game of Hazard and fight until a charter is drawn', async ({ browser }) => {
  test.setTimeout(40 * 60_000);
  const errors: string[] = [];
  const profiles = ['hz-a', 'hz-b', 'hz-c'];
  const pages: Page[] = [];
  for (const profile of profiles) pages.push(await open(browser, profile, errors));
  const a = pages[0] as Page;

  // 1. The table: three seats, automatic defence.
  await a.getByLabel('Search games').fill('Hazard');
  await a.getByRole('link', { name: 'Hazard', exact: true }).click();
  await expect(a.getByRole('link', { name: COMPARE_PHRASE, exact: true })).toHaveAttribute(
    'href',
    `https://boardgamegeek.com/boardgame/${COMPARE_BGG_ID}`,
  );
  await a.getByLabel('Players', { exact: true }).selectOption('3');
  await a
    .getByRole('group', { name: 'Defending dice' })
    .getByRole('radio', { name: 'Defenders always roll the most dice', exact: true })
    .check();
  await a.getByRole('button', { name: 'Create table', exact: true }).click();
  await a.getByRole('button', { name: 'Create anyway', exact: true }).click();
  const share = await a.getByLabel('Table link').inputValue();
  for (const [i, page] of pages.entries()) {
    if (i === 0) continue;
    await page.goto(url(profiles[i] as string, share));
    await page.getByRole('button', { name: 'Join this table', exact: true }).click();
    await page.getByRole('button', { name: 'Join anyway', exact: true }).click();
  }
  await expect(a.getByText('Every seat is taken.')).toBeVisible();
  await a.getByRole('button', { name: 'Start game', exact: true }).click();
  await a.getByRole('button', { name: 'Yes, start the game', exact: true }).click();
  for (const p of pages) await expect(root(p)).toBeVisible({ timeout: 600_000 });
  const players: Page[] = [];
  for (const p of pages) players[Number(await root(p).getAttribute('data-my-seat'))] = p;
  expect(players.filter((p) => p !== undefined)).toHaveLength(3);
  const spectator = await open(browser, 'hz-s', errors, a.url());
  await expect(root(spectator)).toHaveAttribute('data-my-seat', 'spectator', { timeout: 600_000 });
  // 42 provinces drawn as buttons, none focusable for a spectator.
  await expect(root(spectator).locator('[data-province]')).toHaveCount(42);
  await expect(root(spectator).locator('[data-province][tabindex="0"]')).toHaveCount(0);

  // 2. The loop: whoever the spectator says is to decide clicks, until a charter is drawn.
  const turn = { captured: false };
  let drawn: { seat: number; label: string } | null = null;
  for (let step = 0; step < 600 && drawn === null; step++) {
    await expect
      .poll(
        async () => {
          const seat = await root(spectator).getAttribute('data-pending-seat');
          if (seat === null || seat === 'none') return false;
          const p = players[Number(seat)] as Page;
          const busy = await root(p)
            .locator('button[data-action]:not([disabled]), [data-province][aria-disabled="false"]')
            .count();
          return busy > 0;
        },
        { timeout: 180_000 },
      )
      .toBe(true);
    const seat = Number(await root(spectator).getAttribute('data-pending-seat'));
    const p = players[seat] as Page;
    if ((await root(p).getAttribute('data-stage')) === 'muster') turn.captured = false;
    await decide(p, turn);
    for (const [k, q] of players.entries()) {
      const shown = await faces(q);
      if (shown.length > 0) drawn = { seat: k, label: shown[0] as string };
    }
  }
  expect(drawn, 'no charter was drawn').not.toBeNull();
  const { seat, label } = drawn as { seat: number; label: string };

  // 3. Privacy: the face shows to its holder alone; others see the count, not the card.
  for (const [k, q] of players.entries()) if (k !== seat) expect(await faces(q)).toEqual([]);
  expect(await faces(spectator)).toEqual([]);
  await expect(root(spectator).locator('.hz-player').nth(seat)).toContainText('1 charter');

  // 4. A reload keeps the hand.
  const holder = players[seat] as Page;
  await holder.reload();
  await expect(root(holder)).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => faces(holder), { timeout: 120_000 }).toContain(label);

  // 5. A phone: the atlas scrolls in its frame, the page does not scroll sideways.
  await holder.setViewportSize({ width: 390, height: 844 });
  expect(await holder.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await holder.screenshot({ path: '/tmp/hazard-390.png', fullPage: true });

  expect(errors).toEqual([]);
});
