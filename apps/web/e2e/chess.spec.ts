/*
 * End to end: two players play Chess (a deckless game, D045) through the UI, against the dev relay.
 *
 * - a picks Chess in the New table form and creates a 2-seat table; b joins from the share link; a starts it.
 * - There is no shuffle or deal: both reach the board at once. a (the creator) is White.
 * - They play Fool's mate (1. f3 e5 2. g4 Qh4#) by clicking squares. Both see the checkmate, the result and
 *   both attestations.
 * - A second game ends by resign: after 1. e4, b (Black) resigns through the confirm step. Both see the result
 *   and both attestations.
 *
 * Run it with `pnpm e2e` (all specs) or `pnpm e2e chess.spec.ts`. E2E_SCREENSHOTS=<dir> saves the Home picker,
 * the board mid-game and at mate, at 1280 and 390 px wide.
 */
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const SHOTS = process.env.E2E_SCREENSHOTS;
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

async function open(browser: Browser, name: string, url: string): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console error: ${m.text()}`);
  });
  await page.goto(url);
  return { name, page };
}

const board = (p: Player): Locator => p.page.getByTestId('chess-game');
const seqOf = async (p: Player): Promise<number> => Number(await board(p).getAttribute('data-seq'));

async function shoot(p: Player, file: string): Promise<void> {
  if (SHOTS === undefined || SHOTS === '') return;
  await p.page.setViewportSize({ width: 1280, height: 1000 });
  await p.page.screenshot({ path: `${SHOTS}/${file}-1280.png`, fullPage: true });
  await p.page.setViewportSize({ width: 390, height: 844 });
  await p.page.screenshot({ path: `${SHOTS}/${file}-390.png`, fullPage: true });
  await p.page.setViewportSize({ width: 1280, height: 1000 });
}

/** a creates a Chess table, b joins it, a starts it; both end up on the board. */
async function startChess(a: Player, b: Player, shot?: string): Promise<void> {
  await a.page.goto(appUrl('a'));
  await expect(a.page.getByRole('heading', { name: 'New table' })).toBeVisible();
  await a.page.getByLabel('Game', { exact: true }).selectOption('chess');
  await expect(a.page.getByLabel('Players', { exact: true })).toHaveValue('2');
  await expect(a.page.getByText('1 open seat')).toBeVisible();
  await expect(a.page.getByRole('link', { name: 'How to play' })).toHaveAttribute('href', '#/rules/chess');
  if (shot !== undefined) await shoot(a, shot);
  await a.page.getByRole('button', { name: 'Create table' }).click();
  await expect(a.page).toHaveURL(/#\/t\/[0-9a-f]{64}\//);
  await expect(a.page.getByRole('heading', { name: 'Chess' })).toBeVisible();
  const share = await a.page.getByLabel('Table link').inputValue();

  await b.page.goto(appUrl('b', share));
  await b.page.getByRole('button', { name: 'Join this table' }).click();
  await expect(b.page.getByText('You are seated.')).toBeVisible();
  await expect(a.page.getByText('Every seat is taken.')).toBeVisible();
  await a.page.getByRole('button', { name: 'Start game' }).click();
  await a.page.getByRole('button', { name: 'Yes, start the game' }).click();
  for (const p of [a, b]) {
    await expect(p.page).toHaveURL(/#\/g\/[0-9a-f]{64}$/, { timeout: MOVE_MS });
    await expect(board(p)).toBeVisible({ timeout: MOVE_MS });
    await expect(board(p)).toHaveAttribute('data-seq', '0');
  }
}

/** `p` moves from one square to another by clicking both; every player then sees the move. */
async function move(p: Player, from: string, to: string, everyone: readonly Player[]): Promise<void> {
  const before = await seqOf(p);
  await expect(p.page.getByText(/^Your move/)).toBeVisible({ timeout: MOVE_MS });
  await p.page.locator(`[data-square="${from}"]`).click();
  await expect(p.page.locator(`[data-square="${from}"]`)).toHaveAttribute('aria-pressed', 'true');
  await p.page.locator(`[data-square="${to}"]`).click();
  for (const q of everyone)
    await expect(board(q)).toHaveAttribute('data-seq', String(before + 1), { timeout: MOVE_MS });
}

test("two players play Fool's mate, then a second game ends by resign", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const a = await open(browser, 'a', appUrl('a'));
  const b = await open(browser, 'b', appUrl('b'));
  const both = [a, b];

  // Game 1: Fool's mate. a is White and sees the board from White's side.
  await startChess(a, b, 'chess-home-picker');
  await expect(a.page.getByText('Your move (White)')).toBeVisible({ timeout: MOVE_MS });
  await expect(b.page.locator('.chess-board button').first()).toHaveAttribute('data-square', 'h1');
  await move(a, 'f2', 'f3', both);
  await move(b, 'e7', 'e5', both);
  await move(a, 'g2', 'g4', both);
  await expect(b.page.getByRole('listitem').filter({ hasText: 'f3' })).toBeVisible();
  await shoot(b, 'chess-mid-game');
  await move(b, 'd8', 'h4', both);
  for (const p of both) {
    await expect(p.page.getByText(/^Checkmate: .* \(Black\) wins$/)).toBeVisible({ timeout: MOVE_MS });
    await expect(board(p)).toHaveAttribute('data-result', 'checkmate');
    await expect(p.page.getByText('Result confirmed: signed by all 2 players.')).toBeVisible({
      timeout: MOVE_MS,
    });
    await expect(p.page.getByRole('button', { name: 'Resign' })).toHaveCount(0);
  }
  await expect(a.page.getByText('Qh4#')).toBeVisible();
  await shoot(a, 'chess-mate');

  // Game 2: b resigns after 1. e4.
  await startChess(a, b);
  await move(a, 'e2', 'e4', both);
  await b.page.getByRole('button', { name: 'Resign' }).click();
  await expect(b.page.getByText(/Resign this game\?/)).toBeVisible();
  await b.page.getByRole('button', { name: 'Yes, resign' }).click();
  for (const p of both) {
    await expect(board(p)).toHaveAttribute('data-result', 'resign', { timeout: MOVE_MS });
    await expect(p.page.getByText(/\(Black\) resigned: .* \(White\) wins/)).toBeVisible();
    await expect(p.page.getByText(/has resigned\. Final places: 1\. /)).toBeVisible();
    await expect(p.page.getByText('Result confirmed: signed by all 2 players.')).toBeVisible({
      timeout: MOVE_MS,
    });
  }
  await shoot(b, 'chess-resigned');

  // The rules link in the game opens the Chess rules.
  await expect(a.page.getByRole('link', { name: /^Rules/ }).last()).toHaveAttribute('href', '#/rules/chess');
  for (const p of both) await p.page.context().close();
});
