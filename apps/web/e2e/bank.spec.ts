/*
 * End to end: three players play a short Bank game through the UI, against the dev relay.
 *
 * a creates a 3-seat table of 5 rounds with table banking. b and c join. The roller rolls, and the faces
 * appear on every screen with no further tap. Later rounds open on Roll again. All three see the same
 * winner line, the result is signed, and the rules page says the roll is the same for every player. 390px
 * does not scroll sideways.
 *
 * Run it with `pnpm e2e bank.spec.ts`.
 */
import { type Browser, expect, type Page, test } from '@playwright/test';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const MOVE_MS = 30_000;

interface Player {
  name: string;
  page: Page;
}

function appUrl(profile: string, from?: string): string {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  if (RELAY !== 'none') u.searchParams.set('relays', RELAY);
  return u.toString();
}

async function open(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console error: ${m.text()}`);
  });
  await page.goto(appUrl(name));
  return { name, page };
}

const SHOTS = process.env.E2E_SCREENSHOTS;

async function shoot(page: Page, file: string): Promise<void> {
  if (SHOTS === undefined || SHOTS === '') return;
  await page.screenshot({ path: `${SHOTS}/${file}.png`, fullPage: true });
}

async function noSideScroll(page: Page, file?: string): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (file !== undefined) await shoot(page, file);
  await page.setViewportSize({ width: 1280, height: 1000 });
}

const ACTIONS = ['Bank', 'Stay', 'Roll'] as const;

/** Enabled action labels on one screen. A DOM read, so a disappearing button cannot stall the test. */
async function enabledActions(page: Page): Promise<string[]> {
  return page.evaluate(
    (names) => {
      const wanted = new Set<string>(names);
      return [...document.querySelectorAll('button')]
        .filter((el) => !el.disabled && wanted.has(el.textContent?.trim() ?? ''))
        .map((el) => el.textContent?.trim() ?? '');
    },
    [...ACTIONS],
  );
}

/** Click `name` once if some player can, without waiting. */
async function clickNow(players: readonly Player[], name: string): Promise<boolean> {
  for (const p of players) {
    const clicked = await p.page.evaluate((label) => {
      const button = [...document.querySelectorAll('button')].find(
        (el) => el.textContent?.trim() === label && !el.disabled,
      );
      if (button === undefined) return false;
      button.click();
      return true;
    }, name);
    if (clicked) return true;
  }
  return false;
}

/** Click `name` on the one player who can. The engine asks one seat at a time. */
async function press(players: readonly Player[], name: string): Promise<void> {
  const deadline = Date.now() + MOVE_MS;
  while (Date.now() < deadline) {
    if (await clickNow(players, name)) return;
    await players[0]?.page.waitForTimeout(100);
  }
  throw new Error(`nobody could press ${name}`);
}

test('three players play five rounds of Bank and see one public roll', async ({ browser }) => {
  const a = await open(browser, 'a');
  const b = await open(browser, 'b');
  const c = await open(browser, 'c');
  const players = [a, b, c];

  await a.page.getByLabel('Search games').fill('bank');
  await a.page.getByRole('link', { name: 'Bank', exact: true }).click();
  await expect(a.page).toHaveURL(/#\/games\/bank$/);
  await expect(a.page.getByRole('heading', { name: 'New table' })).toBeVisible();
  await expect(a.page.getByText('Compare to', { exact: false })).toHaveCount(0);
  await a.page.getByLabel('Players', { exact: true }).selectOption('3');
  await a.page.getByLabel('Rounds').selectOption('5');
  await expect(a.page.getByRole('radio', { name: 'Everyone may bank' })).toBeChecked();
  await a.page.getByRole('button', { name: 'Create table' }).click();
  await a.page.getByRole('button', { name: 'Create anyway' }).click();
  await expect(a.page).toHaveURL(/#\/t\/[0-9a-f]{64}\//);
  const share = await a.page.getByLabel('Table link').inputValue();

  for (const p of [b, c]) {
    await p.page.goto(appUrl(p.name, share));
    await p.page.getByRole('button', { name: 'Join this table' }).click();
    await p.page.getByRole('button', { name: 'Join anyway' }).click();
    await expect(p.page.getByText('You are seated.')).toBeVisible();
  }
  await expect(a.page.getByText('Every seat is taken.')).toBeVisible();
  await a.page.getByRole('button', { name: 'Start game' }).click();
  await a.page.getByRole('button', { name: 'Yes, start the game' }).click();

  for (const p of players) {
    await expect(p.page.getByTestId('bank-game')).toBeVisible({ timeout: MOVE_MS });
    await expect(p.page.getByText('Round 1 of 5')).toBeVisible();
    await expect(p.page.getByTestId('bank-roll')).toHaveText('No rolls yet');
    await expect(p.page.getByTestId('bank-safe')).toContainText('3 safe rolls left');
    await expect(p.page.getByTestId('bank-guide')).toContainText('Next roll is safe');
    await expect(p.page.getByTestId('bank-guide')).toContainText('adds 70 → 70');
    await expect(p.page.getByTestId('bank-guide')).not.toContainText('A 7 wipes the pot');
  }

  // A round opens on the roller. Nobody is asked to bank or stay while the pot is empty.
  const opening: string[] = [];
  for (const p of players) opening.push(...(await enabledActions(p.page)));
  expect(opening).toEqual(['Roll']);
  const roll = a.page.getByRole('button', { name: 'Roll', exact: true });
  await expect(roll).toBeEnabled();
  await expect(roll).toHaveClass(/btn-primary/);
  await expect(roll).toHaveClass(/btn-only/);
  await expect(a.page.locator('.bank-status.mine')).toContainText('Your turn');
  await expect(a.page.locator('.bank-seat.to-play')).toContainText('To play');
  await expect(b.page.locator('.bank-status.mine')).toHaveCount(0);
  await expect(b.page.getByRole('button', { name: 'Roll', exact: true })).toBeDisabled();
  await shoot(a.page, 'opening-1280');
  await noSideScroll(a.page, 'opening-390');

  await press(players, 'Roll');

  // The other windows publish their share of the same roll. No seat is asked to show the dice.
  await expect
    .poll(
      async () => {
        expect(await a.page.getByRole('button', { name: 'Show the dice' }).count()).toBe(0);
        return (await a.page.getByTestId('bank-dice').getAttribute('data-faces')) ?? '';
      },
      { timeout: MOVE_MS },
    )
    .toMatch(/^[1-6],[1-6]$/);
  const faces = await a.page.getByTestId('bank-dice').getAttribute('data-faces');
  expect(faces).toMatch(/^[1-6],[1-6]$/);
  for (const p of players) {
    await expect(p.page.getByTestId('bank-dice')).toHaveAttribute('data-faces', faces ?? '');
    await expect(p.page.getByTestId('bank-roll')).toHaveText('1 roll this round');
    await expect(p.page.getByTestId('bank-guide')).toContainText('Next roll is safe');
    await expect(p.page.getByTestId('bank-guide')).toContainText('Banking now keeps');
  }
  await expect
    .poll(async () => {
      for (const p of players) {
        const bank = p.page.getByRole('button', { name: 'Bank', exact: true });
        if ((await bank.count()) > 0 && (await bank.isEnabled()))
          return (await bank.getAttribute('class')) ?? '';
      }
      return '';
    })
    .toContain('btn-bank');
  for (const p of players) {
    const bank = p.page.getByRole('button', { name: 'Bank', exact: true });
    if ((await bank.count()) > 0 && (await bank.isEnabled())) {
      await shoot(p.page, 'bank-turn-1280');
      break;
    }
  }
  await shoot(a.page, 'rolled-1280');
  await noSideScroll(a.page, 'rolled-390');

  const offered = async (): Promise<string> => {
    const parts: string[] = [];
    for (const p of players) parts.push((await enabledActions(p.page)).join(','));
    return parts.join('|');
  };
  // Stay through the safe rolls so the reference has to change, then bank to finish.
  let sawUnsafe = false;
  const done = Date.now() + 120_000;
  while (Date.now() < done) {
    if ((await a.page.getByTestId('bank-winner').count()) > 0) break;
    if (!sawUnsafe && (await a.page.getByTestId('bank-guide').count()) > 0) {
      const text = (await a.page.getByTestId('bank-guide').textContent()) ?? '';
      if (text.includes('can bust')) {
        sawUnsafe = true;
        await shoot(a.page, 'unsafe-1280');
        await noSideScroll(a.page, 'unsafe-390');
      }
    }
    const before = await offered();
    let clicked = false;
    const order = sawUnsafe ? ['Bank', 'Roll'] : ['Stay', 'Roll'];
    for (const label of order) {
      if (await clickNow(players, label)) {
        clicked = true;
        const until = Date.now() + 5_000;
        while (Date.now() < until && (await offered()) === before) {
          await a.page.waitForTimeout(50);
        }
        break;
      }
    }
    if (!clicked) await a.page.waitForTimeout(200);
  }
  expect(sawUnsafe).toBe(true);

  await expect(a.page.getByTestId('bank-guide')).toHaveCount(0);
  const winner = (await a.page.getByTestId('bank-winner').textContent({ timeout: 1_000 }))?.trim() ?? '';
  expect(winner.length).toBeGreaterThan(0);
  const endFaces = await a.page.getByTestId('bank-dice').getAttribute('data-faces');
  expect(endFaces).toMatch(/^[1-6],[1-6]$/);
  for (const p of players) {
    await expect(p.page.getByTestId('bank-winner')).toHaveText(winner);
    await expect(p.page.getByTestId('bank-dice')).toHaveAttribute('data-faces', endFaces ?? '');
    await expect(p.page.getByText('Result confirmed: signed by all 3 players.')).toBeVisible({
      timeout: MOVE_MS,
    });
  }

  await a.page.goto(`${appUrl('a')}#/rules/bank`);
  await expect(a.page.getByRole('heading', { name: 'How to play Bank' })).toBeVisible();
  await expect(a.page.getByRole('heading', { name: 'Playing on this site' })).toBeVisible();
  await expect(a.page.getByText('nothing to hide and no extra tap')).toBeVisible();
  await expect(a.page.getByText('Show the dice')).toHaveCount(0);
  await noSideScroll(a.page);

  for (const p of players) await p.page.context().close();
});
