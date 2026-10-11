import { type Action, type Goods, type State, setup } from '@bored-games/driftwrights';
import { COMPARE_PHRASE } from '@bored-games/driftwrights/compare';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { chooseForTest } from '../../../packages/games/driftwrights/src/choices.ts';

const root = (p: Page) => p.getByTestId('driftwrights-game');
const url = (profile: string, from?: string) => {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  u.searchParams.set('relays', process.env.E2E_RELAY ?? 'ws://localhost:7777');
  return u.toString();
};
async function open(browser: Browser, profile: string, errors: string[], from?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url(profile, from));
  return page;
}
async function choices(page: Page) {
  return root(page)
    .locator('[data-action]')
    .evaluateAll((elements) =>
      elements
        .filter((e) => !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true')
        .map((e) => JSON.parse(e.getAttribute('data-action') ?? '{}') as Action),
    );
}
/** Reads the public map and the owning player's displayed resources, never a hidden client state. */
async function state(page: Page, seats: number): Promise<State> {
  const initial = setup(
    seats,
    Array.from({ length: 25 }, (_, i) => i),
  );
  if (!initial.ok) throw new Error(initial.error.message);
  const data = await root(page).evaluate((el) => {
    const ds = (el as HTMLElement).dataset;
    return {
      actor: Number(ds.actor),
      stage: ds.stage,
      terrain: ds.terrain?.split(',').map(Number),
      yields: ds.yields?.split(',').map(Number),
      buildings: ds.buildings?.split(',').map((x) => {
        if (!x) return null;
        const [seat, hub] = x.split(':').map(Number);
        return { seat: seat ?? 0, hub: hub === 1 };
      }),
      goods: el.querySelector<HTMLElement>('[data-goods]')?.dataset.goods?.split(',').map(Number),
    };
  });
  return {
    ...initial.value,
    ...data,
    stage: data.stage as State['stage'],
    terrain: data.terrain ?? [],
    yields: data.yields ?? [],
    buildings: data.buildings ?? [],
    players: initial.value.players.map((p, i) => ({
      ...p,
      goods: (i === data.actor ? data.goods : [0, 0, 0, 0, 0]) as unknown as Goods,
    })),
  };
}
async function act(page: Page, action: Action | { type: string }, seats: number, keyboard = false) {
  const before = Number(await root(page).getAttribute('data-seq'));
  if (action.type === 'discard') {
    const a = action as Extract<Action, { type: 'discard' }>;
    for (const [i, name] of ['Timber', 'Clay', 'Fiber', 'Grain', 'Metal'].entries())
      await page.getByLabel(`Discard ${name}`, { exact: true }).fill(String(a.goods[i]));
  }
  const target = page.locator(`[data-action=${JSON.stringify(JSON.stringify(action))}]`).first();
  if (keyboard) {
    await target.focus();
    await expect(target).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(target).not.toBeFocused();
    await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
    await page.keyboard.press('Space');
  } else await target.click();
  await expect(root(page)).not.toHaveAttribute('data-seq', String(before));
  expect(seats).toBeGreaterThan(2);
}

for (const seats of [3, 4])
  test(`${seats} independent guilds finish Driftwrights over the relay`, async ({ browser }) => {
    test.setTimeout(30 * 60_000);
    const errors: string[] = [];
    const pages: Page[] = [];
    for (let i = 0; i < seats; i++) pages.push(await open(browser, `drift-${seats}-${i}`, errors));
    const creator = pages[0] as Page;
    await creator.getByLabel('Search games').fill('Driftwrights');
    await creator.getByRole('link', { name: 'Driftwrights', exact: true }).click();
    await expect(creator.getByRole('link', { name: COMPARE_PHRASE, exact: true })).toHaveAttribute(
      'href',
      'https://boardgamegeek.com/boardgame/13',
    );
    await creator.getByLabel('Players', { exact: true }).selectOption(String(seats));
    await creator.getByRole('button', { name: 'Create table', exact: true }).click();
    await creator.getByRole('button', { name: 'Create anyway', exact: true }).click();
    const link = await creator.getByLabel('Table link').inputValue();
    for (const [i, p] of pages.entries())
      if (i) {
        await p.goto(url(`drift-${seats}-${i}`, link));
        await p.getByRole('button', { name: 'Join this table', exact: true }).click();
        await p.getByRole('button', { name: 'Join anyway', exact: true }).click();
      }
    await expect(creator.getByText('Every seat is taken.')).toBeVisible();
    await creator.getByRole('button', { name: 'Start game', exact: true }).click();
    await creator.getByRole('button', { name: 'Yes, start the game', exact: true }).click();
    for (const p of pages) await expect(root(p)).toBeVisible({ timeout: 120_000 });
    const assigned = await Promise.all(
      pages.map(async (page) => ({ page, seat: Number(await root(page).getAttribute('data-seat')) })),
    );
    pages.splice(0, pages.length, ...assigned.sort((a, b) => a.seat - b.seat).map((x) => x.page));
    const spectator = await open(browser, `drift-${seats}-watch`, errors, creator.url());
    await expect(root(spectator)).toBeVisible({ timeout: 120000 });
    await expect(spectator.getByTestId('drift-hand')).toHaveCount(0);
    await creator.setViewportSize({ width: 390, height: 844 });
    expect(await creator.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await creator.getByRole('button', { name: 'Enlarge map', exact: true }).click();
    expect(await creator.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await creator.getByRole('button', { name: 'Fit map', exact: true }).click();
    await creator.screenshot({ path: `/tmp/driftwrights-live-${seats}-390.png`, fullPage: true });
    await creator.setViewportSize({ width: 1280, height: 1000 });
    const tags = new Set<string>();
    let reload = false;
    let traded = false;
    let rejectedEmptyTrade = false;
    let focusChecked = false;
    for (let moves = 0; moves < 5000; moves++) {
      if ((await creator.getByTestId('drift-audit').count()) > 0) break;
      let acting: Page | undefined,
        options: Action[] = [];
      await expect
        .poll(
          async () => {
            for (const p of pages) {
              const available = await choices(p);
              if (available.length) {
                acting = p;
                options = available;
                return true;
              }
            }
            return (await creator.getByTestId('drift-audit').count()) > 0;
          },
          { timeout: 120000 },
        )
        .toBe(true);
      if (!acting) break;
      if (!traded && (await root(acting).getAttribute('data-stage')) === 'trade') {
        const actor = Number(await root(acting).getAttribute('data-seat'));
        if (!rejectedEmptyTrade) {
          await acting.getByLabel('Trading partner').selectOption(String((actor + 1) % seats));
          await acting.getByRole('button', { name: 'Offer trade', exact: true }).click();
          await expect(acting.getByText(/Your move was not sent:/)).toBeVisible();
          expect(await root(acting).getAttribute('data-stage')).toBe('trade');
          rejectedEmptyTrade = true;
        }
        const own =
          (await acting.getByTestId('drift-hand').getAttribute('data-goods'))?.split(',').map(Number) ?? [];
        for (const [seat, other] of pages.entries()) {
          if (seat === actor) continue;
          const their =
            (await other.getByTestId('drift-hand').getAttribute('data-goods'))?.split(',').map(Number) ?? [];
          const give = own.findIndex((n, i) => n > 0 && their.some((m, j) => m > 0 && i !== j));
          const receive = their.findIndex((n, i) => n > 0 && i !== give);
          if (give < 0 || receive < 0) continue;
          await acting.getByLabel('Trading partner').selectOption(String(seat));
          for (const [i, name] of ['Timber', 'Clay', 'Fiber', 'Grain', 'Metal'].entries()) {
            await acting.getByLabel(`Give ${name}`, { exact: true }).fill(i === give ? '1' : '0');
            await acting.getByLabel(`Receive ${name}`, { exact: true }).fill(i === receive ? '1' : '0');
          }
          const before = await root(acting).getAttribute('data-seq');
          await acting.getByRole('button', { name: 'Offer trade', exact: true }).click();
          await expect(root(acting)).not.toHaveAttribute('data-seq', before ?? '');
          tags.add('offer');
          traded = true;
          break;
        }
        if (traded) continue;
      }
      const first = options[0] as { type: string };
      let a = ['transfer', 'declare', 'requisition-payment'].includes(first.type)
        ? first
        : chooseForTest(await state(acting, seats), options);
      if (a.type === 'discard') {
        const s = await state(acting, seats);
        const goods = s.players[s.actor]?.goods ?? [0, 0, 0, 0, 0];
        let left = Math.floor(goods.reduce((n, v) => n + v, 0) / 2);
        a = {
          type: 'discard',
          actor: s.actor,
          goods: goods.map((n) => {
            const take = Math.min(n, left);
            left -= take;
            return take;
          }) as unknown as Goods,
        };
      }
      tags.add(a.type);
      const keyboard = !focusChecked && a.type === 'hearth';
      await act(acting, a, seats, keyboard);
      if (keyboard) focusChecked = true;
      if (moves % 50 === 0) console.log(`[driftwrights ${seats}] ${moves} decisions; ${a.type}`);
      if (!reload && tags.has('buy-venture') && tags.has('transfer')) {
        await expect(acting.getByTestId('drift-hand')).not.toContainText('Unseen venture', {
          timeout: 120000,
        });
        const hand = await acting.getByTestId('drift-hand').innerText();
        await acting.reload();
        await expect(root(acting)).toBeVisible({ timeout: 120000 });
        await expect(acting.getByTestId('drift-hand')).toHaveText(hand, {
          timeout: 120000,
          useInnerText: true,
        });
        reload = true;
      }
    }
    expect(tags.has('transfer')).toBe(true);
    expect(tags.has('buy-venture')).toBe(true);
    expect(tags.has('declare')).toBe(true);
    expect(reload).toBe(true);
    expect(traded).toBe(true);
    expect(rejectedEmptyTrade).toBe(true);
    expect(focusChecked).toBe(true);
    expect(tags.has('accept')).toBe(true);
    for (const p of [...pages, spectator])
      await expect(p.getByTestId('drift-audit')).toHaveText('Audit passed.', { timeout: 120000 });
    expect(errors).toEqual([]);
    await creator.screenshot({ path: `/tmp/driftwrights-live-${seats}-result.png`, fullPage: true });
  });
