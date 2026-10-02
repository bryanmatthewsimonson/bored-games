/*
 * End to end: two players play Chess (a deckless game, D045) through the UI, against the dev relay.
 *
 * - a picks Chess in the New table form and creates a 2-seat table; b joins from the share link; a starts it.
 * - There is no shuffle or deal: both reach the board at once. a (the creator) is White.
 * - They play Fool's mate (1. f3 e5 2. g4 Qh4#) by clicking squares. Both see the checkmate, the result and
 *   both attestations.
 * - A second game ends by resign: after 1. e4 f6 2. Qh5+, b (Black) is in check and resigns through the confirm
 *   step. Both see the result and both attestations.
 * - A third game uses the other ways to move and ends by agreement: a moves with the keyboard, b drags a piece,
 *   a promotes through the promotion dialog with a draw offer on the move, and b accepts the draw.
 * - Finally the rules page and the credits page (the piece set's license) open.
 *
 * Run it with `pnpm e2e` (all specs) or `pnpm e2e chess.spec.ts`. E2E_SCREENSHOTS=<dir> saves the Home picker,
 * the start, a selected piece with its targets, check, the promotion dialog, mate, a draw offer, the draw, the
 * resignation, the rules page and the credits page, at 1280 and 390 px wide.
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

/**
 * Checks the phone layout at 390 px on every run: no horizontal page scroll, and a square board when one is
 * shown. With E2E_SCREENSHOTS set, also saves the page at 1280 and 390 px.
 */
async function shoot(p: Player, file: string): Promise<void> {
  const save = SHOTS !== undefined && SHOTS !== '';
  if (save) await p.page.screenshot({ path: `${SHOTS}/${file}-1280.png`, fullPage: true });
  await p.page.setViewportSize({ width: 390, height: 844 });
  expect(await p.page.evaluate(() => document.documentElement.scrollWidth), file).toBeLessThanOrEqual(390);
  const grid = p.page.locator('.chess-board');
  if ((await grid.count()) > 0) {
    const box = await grid.boundingBox();
    if (box === null) throw new Error('no board');
    expect(Math.abs(box.width - box.height), file).toBeLessThanOrEqual(1);
    expect(box.width, file).toBeGreaterThan(300);
  }
  if (save) await p.page.screenshot({ path: `${SHOTS}/${file}-390.png`, fullPage: true });
  await p.page.setViewportSize({ width: 1280, height: 1000 });
}

/** a creates a Chess table, b joins it, a starts it; both end up on the board. */
async function startChess(a: Player, b: Player, shot?: string): Promise<void> {
  await a.page.goto(appUrl('a'));
  // Find Chess in the catalog by searching, and open its page.
  await a.page.getByLabel('Search games').fill('chess');
  await expect(a.page.locator('.catalog-count')).toHaveText(/^1 of \d+ games$/);
  await a.page.getByRole('link', { name: 'Chess', exact: true }).click();
  await expect(a.page).toHaveURL(/#\/games\/chess$/);
  await expect(a.page.getByRole('heading', { name: 'New table' })).toBeVisible();
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

const square = (p: Player, sq: string): Locator => p.page.locator(`[data-square="${sq}"]`);

/** Waits until every player has seen move number `seq`. */
async function seen(everyone: readonly Player[], seq: number): Promise<void> {
  for (const q of everyone)
    await expect(board(q)).toHaveAttribute('data-seq', String(seq), { timeout: MOVE_MS });
}

/** Waits until `p` may move: the status line is marked as theirs only once the board accepts a move. */
async function myTurn(p: Player): Promise<void> {
  await expect(p.page.locator('.chess-status-line.mine')).toBeVisible({ timeout: MOVE_MS });
}

/** `p` moves from one square to another by clicking both; every player then sees the move. */
async function move(p: Player, from: string, to: string, everyone: readonly Player[]): Promise<void> {
  const before = await seqOf(p);
  await myTurn(p);
  await square(p, from).click();
  await expect(square(p, from)).toHaveAttribute('aria-pressed', 'true');
  await square(p, to).click();
  await seen(everyone, before + 1);
}

/** `p` drags a piece with the mouse from one square to another. */
async function drag(p: Player, from: string, to: string, everyone: readonly Player[]): Promise<void> {
  const before = await seqOf(p);
  await myTurn(p);
  const a = await square(p, from).boundingBox();
  const b = await square(p, to).boundingBox();
  if (a === null || b === null) throw new Error('no square');
  await p.page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.page.mouse.down();
  await p.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await p.page.mouse.up();
  await seen(everyone, before + 1);
}

test("two players play Fool's mate, a game ended by resign and one by an agreed draw", async ({
  browser,
}) => {
  test.setTimeout(8 * 60_000);
  const a = await open(browser, 'a', appUrl('a'));
  const b = await open(browser, 'b', appUrl('b'));
  const both = [a, b];

  // Game 1: Fool's mate. a is White and sees the board from White's side.
  await startChess(a, b, 'chess-home-picker');
  await expect(a.page.getByText('Your move (White)')).toBeVisible({ timeout: MOVE_MS });
  await expect(b.page.locator('.chess-board button').first()).toHaveAttribute('data-square', 'h1');
  await expect(square(a, 'g1')).toHaveAccessibleName('g1, white knight');
  await expect(square(a, 'e4')).toHaveAccessibleName('e4, empty');
  await shoot(a, 'chess-start');
  await move(a, 'f2', 'f3', both);
  // The opponent's move is announced in the live region.
  await expect(b.page.getByTestId('chess-live')).toHaveText(/\(White\) played pawn to f3\.$/);
  await expect(a.page.getByTestId('chess-live')).toHaveText('');
  await move(b, 'e7', 'e5', both);
  await move(a, 'g2', 'g4', both);
  await expect(b.page.getByRole('listitem').filter({ hasText: 'f3' })).toBeVisible();
  await shoot(b, 'chess-mid-game');
  await move(b, 'd8', 'h4', both);
  for (const p of both) {
    await expect(p.page.getByText(/^Checkmate: .* \(Black\) wins$/)).toBeVisible({ timeout: MOVE_MS });
    await expect(p.page.getByText('0–1', { exact: true })).toBeVisible();
    await expect(board(p)).toHaveAttribute('data-result', 'checkmate');
    await expect(p.page.getByText('Result confirmed: signed by both players.')).toBeVisible({
      timeout: MOVE_MS,
    });
    await expect(p.page.getByRole('button', { name: 'Resign' })).toHaveCount(0);
  }
  await expect(a.page.getByText('Qh4#')).toBeVisible();
  await expect(square(a, 'e1')).toHaveAccessibleName('e1, white king, in check');
  await expect(a.page.getByTestId('chess-live')).toHaveText(
    /\(Black\) played queen to h4, checkmate\. Game over, 0–1: Checkmate: .* \(Black\) wins\.$/,
  );
  await shoot(a, 'chess-mate');

  // Game 2: 1. e4 f6 2. Qh5+, and b resigns in check.
  await startChess(a, b);
  await move(a, 'e2', 'e4', both);
  await move(b, 'f7', 'f6', both);
  await move(a, 'd1', 'h5', both);
  await expect(b.page.getByText('Your move (Black): check')).toBeVisible();
  await expect(square(b, 'e8')).toHaveAccessibleName('e8, black king, in check');
  await shoot(b, 'chess-check');
  await b.page.getByRole('button', { name: 'Resign' }).click();
  await expect(b.page.getByText(/Resign this game\?/)).toBeVisible();
  await b.page.getByRole('button', { name: 'Yes, resign' }).click();
  for (const p of both) {
    await expect(board(p)).toHaveAttribute('data-result', 'resign', { timeout: MOVE_MS });
    await expect(p.page.locator('.chess-result-text')).toHaveText(/\(Black\) resigned: .* \(White\) wins$/);
    // The score comes from the places: a resign leaves the outcome's scores at 1–1 (D048).
    await expect(p.page.getByText('1–0', { exact: true })).toBeVisible();
    await expect(p.page.getByText(/has resigned\. Final places: 1\. /)).toBeVisible();
    await expect(p.page.getByText('Result confirmed: signed by both players.')).toBeVisible({
      timeout: MOVE_MS,
    });
  }
  await shoot(b, 'chess-resigned');

  // The rules link in the game opens the Chess rules.
  await expect(a.page.getByRole('link', { name: /^Rules/ }).last()).toHaveAttribute('href', '#/rules/chess');

  // Game 3: keyboard, drag, a promotion with a draw offer, and an agreed draw.
  await startChess(a, b);
  await myTurn(a);
  await square(a, 'a2').focus();
  await a.page.keyboard.press('Enter');
  await expect(square(a, 'a2')).toHaveAttribute('aria-pressed', 'true');
  await a.page.keyboard.press('ArrowUp');
  await a.page.keyboard.press('ArrowUp');
  await expect(square(a, 'a4')).toBeFocused();
  await expect(square(a, 'a4')).toHaveAccessibleName('a4, empty, legal move');
  await a.page.keyboard.press('Enter');
  await seen(both, 1);
  await drag(b, 'b7', 'b5', both);
  await move(a, 'a4', 'b5', both);
  await move(b, 'a7', 'a6', both);
  await move(a, 'b5', 'a6', both);
  await move(b, 'c8', 'b7', both);
  await move(a, 'a6', 'b7', both);
  await move(b, 'b8', 'c6', both);
  await myTurn(a);
  await square(a, 'b7').click();
  await expect(square(a, 'a8')).toHaveAccessibleName('a8, black rook, capture');
  await expect(square(a, 'b8')).toHaveAccessibleName('b8, empty, legal move, last move');
  await shoot(a, 'chess-selected');
  await a.page.getByLabel('Offer a draw with this move').check();
  // Escape closes the promotion dialog without moving, and focus returns to the board.
  await square(a, 'a8').click();
  const dialog = a.page.getByRole('dialog', { name: 'Promote the pawn to' });
  await expect(dialog).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(square(a, 'a8')).toBeFocused();
  await expect(square(a, 'b7')).toHaveAttribute('aria-pressed', 'true');
  await expect(board(a)).toHaveAttribute('data-seq', '8');
  await square(a, 'a8').click();
  await expect(dialog).toBeVisible();
  await shoot(a, 'chess-promotion');
  await dialog.getByRole('button', { name: 'Queen' }).click();
  await seen(both, 9);
  await expect(b.page.getByText('bxa8=Q')).toBeVisible();
  await expect(b.page.getByText(/\(White\) offers a draw\. Accept it/)).toBeVisible();
  await expect(b.page.getByTestId('chess-live')).toHaveText(
    /\(White\) played pawn takes rook on a8, promotes to queen, and offers a draw\.$/,
  );
  await expect(a.page.getByText(/You offered a draw with your last move/)).toBeVisible();
  await shoot(b, 'chess-draw-offer');
  await b.page.getByRole('button', { name: 'Accept draw' }).click();
  for (const p of both) {
    await expect(board(p)).toHaveAttribute('data-result', 'agreement', { timeout: MOVE_MS });
    await expect(p.page.getByText('Draw by agreement', { exact: true })).toBeVisible();
    await expect(p.page.getByText('½–½', { exact: true })).toBeVisible();
    await expect(p.page.getByText('Result confirmed: signed by both players.')).toBeVisible({
      timeout: MOVE_MS,
    });
  }
  await shoot(a, 'chess-draw');

  // The rules page and the credits page, linked from the footer.
  await a.page.goto(`${appUrl('a')}#/rules/chess`);
  await expect(a.page.getByRole('heading', { name: 'How to play Chess' })).toBeVisible();
  await expect(a.page.getByRole('heading', { name: 'Offering a draw' })).toBeVisible();
  await shoot(a, 'chess-rules');
  await a.page.getByRole('contentinfo').getByRole('link', { name: 'Credits' }).click();
  await expect(a.page.getByRole('heading', { name: 'Credits', level: 1 })).toBeVisible();
  await expect(a.page.getByText('Copyright (c) 2006, Colin M. L. Burnett')).toBeVisible();
  await shoot(a, 'chess-credits');
  for (const p of both) await p.page.context().close();
});
