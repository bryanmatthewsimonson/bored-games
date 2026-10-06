import { COMPARE_PHRASE } from '@bored-games/right-of-way/compare';
import { type Browser, expect, type Page, test } from '@playwright/test';

/*
 * Right of Way end to end: a table for N players, the encrypted 580-card packet shuffled in the browsers, then a
 * whole game played through the UI (claim the first highlighted route, else draw), with a spectator and a reload.
 * At the end every charter is revealed, the deck audit passes and every player signs the result.
 */

const url = (profile: string, from?: string) => {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  u.searchParams.set('relays', process.env.E2E_RELAY ?? 'ws://localhost:7777');
  return u.toString();
};
const game = (page: Page) => page.getByTestId('row-game');
const seqOf = async (page: Page) => Number(await game(page).getAttribute('data-seq'));

async function open(browser: Browser, profile: string, from?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url(profile, from));
  return page;
}

async function mobile(page: Page, file: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `/tmp/row-${file}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
}

/** Wait until `page` (the seat to act) can do something, then do the first thing the simple policy allows. */
async function play(page: Page): Promise<string> {
  const phase = await game(page).getAttribute('data-phase');
  if (phase === 'keep' || phase === 'charters') {
    const boxes = page.locator('.row-keep input[type="checkbox"]');
    await expect(boxes.first()).toBeEnabled({ timeout: 120_000 });
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).check();
    await page.locator('.row-keep .row-primary').click();
    return 'keep';
  }
  const claim = page.locator('[role="button"][aria-label^="Lay track"]');
  const blind = page.getByRole('button', { name: 'Draw blind from the pile' });
  const yard = page.locator('.row-yard-card:enabled');
  const charters = page.getByRole('button', { name: /^Draw charters/ });
  const pass = page.getByRole('button', { name: /^Pass/ });
  await expect
    .poll(
      async () =>
        (await claim.count()) > 0 ||
        (await blind.isEnabled()) ||
        (await yard.count()) > 0 ||
        (await charters.isEnabled()) ||
        ((await pass.count()) > 0 && (await pass.isEnabled())),
      { timeout: 120_000 },
    )
    .toBe(true);
  if (phase === 'turn' && (await claim.count()) > 0) {
    await claim.first().click({ timeout: 30_000 });
    await page.locator('.row-claim .row-primary').first().click({ timeout: 30_000 });
    return 'claim';
  }
  if (await blind.isEnabled()) {
    await blind.click({ timeout: 30_000 });
    return 'blind';
  }
  if ((await yard.count()) > 0) {
    await yard.first().click({ timeout: 30_000 });
    return 'take';
  }
  if (await charters.isEnabled()) {
    await charters.click({ timeout: 30_000 });
    return 'charters';
  }
  await pass.click({ timeout: 30_000 });
  return 'pass';
}

for (const seats of [2, 3]) {
  test(`Right of Way ${seats} players: encrypted packet, full game, spectator, reload, reveal and audit`, async ({
    browser,
  }) => {
    test.setTimeout(30 * 60_000);
    const pages: Page[] = [];
    for (let seat = 0; seat < seats; seat++) pages.push(await open(browser, `row-${seats}-${seat}`));
    const a = pages[0] as Page;
    await a.getByLabel('Search games').fill('Right of Way');
    await a.getByRole('link', { name: 'Right of Way', exact: true }).click();
    // "Compare to" the published game, linked to its BoardGameGeek entry, and no entry of its own (D066).
    await expect(a.getByRole('link', { name: COMPARE_PHRASE, exact: true })).toHaveAttribute(
      'href',
      'https://boardgamegeek.com/boardgame/9209',
    );
    await a.getByLabel('Players', { exact: true }).selectOption(String(seats));
    await a.getByRole('button', { name: 'Create table', exact: true }).click();
    await a.getByRole('button', { name: 'Create anyway', exact: true }).click();
    const share = await a.getByLabel('Table link').inputValue();
    for (const [index, page] of pages.entries()) {
      if (index === 0) continue;
      await page.goto(url(`row-${seats}-${index}`, share));
      await page.getByRole('button', { name: 'Join this table', exact: true }).click();
      await page.getByRole('button', { name: 'Join anyway', exact: true }).click();
    }
    await expect(a.getByText('Every seat is taken.')).toBeVisible();
    await a.getByRole('button', { name: 'Start game', exact: true }).click();
    await a.getByRole('button', { name: 'Yes, start the game', exact: true }).click();
    for (const p of pages) await expect(game(p)).toBeVisible({ timeout: 600_000 });
    const bySeat = new Map<number, Page>();
    for (const p of pages) bySeat.set(Number(await game(p).getAttribute('data-my-seat')), p);
    expect([...bySeat.keys()].sort()).toEqual(Array.from({ length: seats }, (_, i) => i));
    await expect(game(a)).not.toHaveAttribute('data-starting-seat', 'pending', { timeout: 300_000 });
    const start = Number(await game(a).getAttribute('data-starting-seat'));
    for (const p of pages) await expect(game(p)).toHaveAttribute('data-starting-seat', String(start));

    const spectator = await open(browser, `row-${seats}-spectator`, a.url());
    await expect(game(spectator)).toBeVisible({ timeout: 600_000 });
    await expect(spectator.locator('.row-hand')).toHaveCount(0);
    await a.screenshot({ path: `/tmp/row-${seats}-start-1280.png`, fullPage: true });
    await mobile(a, `${seats}-start`);

    const done = new Map<string, number>();
    let finished = false;
    for (let n = 0; n < 1500; n++) {
      const phase = await game(a).getAttribute('data-phase');
      if (phase === 'over') {
        finished = true;
        break;
      }
      if (phase === 'reveal' || phase === 'setup' || phase === 'sift') {
        await expect
          .poll(async () => (await game(a).getAttribute('data-phase')) !== phase, { timeout: 120_000 })
          .toBe(true);
        continue;
      }
      const turn = Number(await game(a).getAttribute('data-turn'));
      const page = bySeat.get(turn) as Page;
      await expect(game(page)).toHaveAttribute('data-turn', String(turn), { timeout: 120_000 });
      const before = await seqOf(page);
      const what = await play(page);
      done.set(what, (done.get(what) ?? 0) + 1);
      await expect.poll(() => seqOf(page), { timeout: 120_000 }).toBeGreaterThan(before);
      const seq = await seqOf(page);
      for (const other of [...pages, spectator])
        await expect.poll(() => seqOf(other), { timeout: 120_000 }).toBeGreaterThanOrEqual(seq);
      if (n === 30) {
        // A reload mid-game restores the seat from its saved keys and the relays.
        await a.reload();
        await expect(game(a)).toBeVisible({ timeout: 300_000 });
        await expect.poll(() => seqOf(a), { timeout: 120_000 }).toBeGreaterThanOrEqual(seq);
        await mobile(a, `${seats}-midgame`);
        // A spectator never sees a hand.
        await expect(spectator.locator('.row-hand')).toHaveCount(0);
      }
    }
    expect(finished).toBe(true);
    expect(done.get('claim') ?? 0).toBeGreaterThan(5);
    for (const p of [...pages, spectator]) {
      await expect(p.getByText('Deck audit passed.', { exact: true })).toBeVisible({ timeout: 300_000 });
      await expect(
        p.getByText(
          seats === 2
            ? 'Result confirmed: signed by both players.'
            : `Result confirmed: signed by all ${seats} players.`,
          { exact: true },
        ),
      ).toBeVisible({ timeout: 300_000 });
      await expect(p.locator('.row-place').first()).toBeVisible();
    }
    await a.screenshot({ path: `/tmp/row-${seats}-result-1280.png`, fullPage: true });
    await mobile(a, `${seats}-result`);
    await a.goto(`${url(`row-${seats}-0`)}#/rules/right-of-way/scoring`);
    await expect(a.getByRole('heading', { name: 'How to play Right of Way' })).toBeVisible();
    await expect(a.getByRole('heading', { name: 'Scoring', exact: true })).toBeVisible();
    await mobile(a, `${seats}-rules`);
    for (const p of [...pages, spectator]) await p.context().close();
  });
}
