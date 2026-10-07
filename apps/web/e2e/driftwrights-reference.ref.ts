import { expect, test } from '@playwright/test';

for (const seats of [3, 4])
  test(`${seats} players finish a reference game through the board controls`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/e2e/fixtures/driftwrights.html?seats=${seats}`);
    await expect(page.getByTestId('driftwrights-board')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `/tmp/driftwrights-${seats}-390.png`, fullPage: true });
    await page.getByRole('button', { name: 'Enlarge map', exact: true }).click();
    await expect
      .poll(() => page.locator('.drift-map').evaluate((e) => e.getBoundingClientRect().width))
      .toBeGreaterThanOrEqual(760);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: 'Fit map', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 1000 });
    let moves = 0;
    while (moves < 4000 && !(await page.evaluate(() => window.driftReference.finished()))) {
      const next = await page.evaluate(() => JSON.stringify(window.driftReference.next()));
      const action = JSON.parse(next) as { type: string; goods?: number[] };
      if (action.type === 'discard')
        for (const [i, name] of ['Timber', 'Clay', 'Fiber', 'Grain', 'Metal'].entries())
          await page.getByLabel(`Discard ${name}`, { exact: true }).fill(String(action.goods?.[i] ?? 0));
      const old = await page.evaluate(() => window.driftReference.count());
      await page
        .locator(`[data-action=${JSON.stringify(next)}]`)
        .first()
        .click();
      await expect.poll(() => page.evaluate(() => window.driftReference.count())).toBeGreaterThan(old);
      moves++;
      if (moves === 30) {
        const before = await page.evaluate(() => window.driftReference.digest());
        await page.reload();
        await expect(page.getByTestId('driftwrights-board')).toBeVisible();
        expect(await page.evaluate(() => window.driftReference.digest())).toBe(before);
        await page.getByLabel('View', { exact: true }).selectOption('spectator');
        await expect(page.getByTestId('drift-hand')).toHaveCount(0);
        const actor = await page.getByTestId('drift-status').innerText();
        const match = /Player (\d+)/.exec(actor);
        if (!match) throw new Error('actor');
        await page.getByLabel('View', { exact: true }).selectOption(String(Number(match[1]) - 1));
      }
    }
    expect(await page.evaluate(() => window.driftReference.finished())).toBe(true);
    expect(errors).toEqual([]);
    await expect(page.getByTestId('drift-status')).toContainText('wins');
    await page.screenshot({ path: `/tmp/driftwrights-${seats}-result.png`, fullPage: true });
  });
