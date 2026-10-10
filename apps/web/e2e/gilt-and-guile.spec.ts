import { COMPARE_PHRASE } from '@bored-games/gilt-and-guile/compare';
import { expect, test } from '@playwright/test';

const relay = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const url = (profile: string, from?: string) => {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  u.searchParams.set('relays', relay);
  return u.toString();
};
test('Gilt & Guile: rules, private hands, purchases, reshuffle and responsive table', async ({ browser }) => {
  const ca = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const cb = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const a = await ca.newPage();
  const b = await cb.newPage();
  a.setDefaultTimeout(60000);
  b.setDefaultTimeout(60000);
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
  try {
    await a.goto(`${url('gilt-a')}#/rules/gilt-and-guile`);
    await expect(a.getByRole('heading', { name: 'Gilt & Guile' })).toBeVisible();
    await expect(a.locator('.gg-rule-cards .gg-card')).toHaveCount(33);
    await expect(a.getByRole('link', { name: COMPARE_PHRASE })).toHaveAttribute(
      'href',
      'https://boardgamegeek.com/boardgame/36218',
    );
    await a.getByLabel('Show', { exact: true }).selectOption('company');
    await expect(a.locator('.gg-rule-cards .gg-card')).toHaveCount(26);
    await a.getByPlaceholder('Name or effect…').fill('Double Bill');
    await expect(a.locator('.gg-rule-cards .gg-card')).toHaveCount(1);
    await a.goto(`${url('gilt-a')}#/games/gilt-and-guile`);
    await a.getByLabel('Players', { exact: true }).selectOption('2');
    await a.getByLabel('Start with a curated set').selectOption('2');
    await a.getByText('Customize from all 26 company cards').click();
    await expect(a.locator('.gg-kingdom-picker input')).toHaveCount(26);
    await a.getByLabel('Stage Door · 5 coins').uncheck();
    await expect(a.getByRole('button', { name: 'Create table', exact: true })).toBeDisabled();
    await a.getByLabel('Start with a curated set').selectOption('1');
    await a.getByRole('button', { name: 'Create table', exact: true }).click();
    await a.getByRole('button', { name: 'Create anyway' }).click();
    const share = await a.getByLabel('Table link').inputValue();
    await b.goto(url('gilt-b', share));
    await b.getByRole('button', { name: 'Join this table' }).click();
    await b.getByRole('button', { name: 'Join anyway' }).click();
    await expect(b.getByText('You are seated.')).toBeVisible();
    await expect(a.getByText('Every seat is taken.')).toBeVisible();
    await a.getByRole('button', { name: 'Start game', exact: true }).click();
    await a.getByRole('button', { name: 'Yes, start the game' }).click();
    for (const p of [a, b]) {
      await expect(p.locator('.gg-game')).toBeVisible({ timeout: 240000 });
      await expect(p.locator('.gg-hand .gg-card')).toHaveCount(5, { timeout: 120000 });
      await expect(p.locator('.gg-market .gg-card')).toHaveCount(10);
      await expect(p.locator('.gg-market').getByRole('button', { name: /^Headliner,/ })).toBeVisible();
      await expect(p.locator('.gg-market').getByRole('button', { name: /^Repertoire,/ })).toBeVisible();
      await expect(p.locator('.gg-player')).toHaveCount(2);
    }
    const board = await a.locator('.gg-board').boundingBox();
    const sidebar = await a.locator('.gg-sidebar').boundingBox();
    expect(sidebar!.x).toBeGreaterThan(board!.x + board!.width);
    await a.screenshot({ path: '/tmp/gilt-and-guile-desktop.png', fullPage: true });
    for (const width of [390, 768, 1440]) {
      await a.setViewportSize({ width, height: 1000 });
      expect(await a.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await a.setViewportSize({ width: 390, height: 844 });
    await a.screenshot({ path: '/tmp/gilt-and-guile-mobile.png', fullPage: true });
    await a.setViewportSize({ width: 1440, height: 1100 });
    for (let turn = 0; turn < 4; turn++) {
      const p = turn % 2 === 0 ? a : b;
      await expect(p.getByRole('button', { name: 'Play treasures →' })).toBeEnabled({ timeout: 120000 });
      await p.getByRole('button', { name: 'Play treasures →' }).click();
      for (let i = 0; i < 5; i++) {
        const card = p.locator('.gg-hand .gg-card.gg-available').first();
        if (!(await card.count())) break;
        await card.click();
        await p.getByRole('button', { name: 'Play card', exact: true }).click();
        await expect(p.locator('.gg-dialog')).not.toBeVisible();
      }
      await p.getByRole('button', { name: 'Go to buying →' }).click();
      await expect(p.getByRole('button', { name: 'End turn →' })).toBeEnabled();
      if (turn === 0) {
        await p
          .locator('.gg-base')
          .getByRole('button', { name: /^Penny,/ })
          .click();
        await p.getByRole('button', { name: 'Buy for 0 coins' }).click();
        await expect(p.locator('.gg-dialog')).not.toBeVisible();
        await expect(p.locator('.gg-log')).toContainText('gained Penny', { timeout: 60000 });
      }
      await p.getByRole('button', { name: 'End turn →' }).click();
    }
    await expect(a.getByRole('button', { name: 'Play treasures →' })).toBeEnabled({ timeout: 180000 });
    await expect(a.locator('.gg-hand .gg-card')).toHaveCount(5);
    await expect(b.locator('.gg-hand .gg-card')).toHaveCount(5);
    expect(errors).toEqual([]);
  } finally {
    await ca.close();
    await cb.close();
  }
});
