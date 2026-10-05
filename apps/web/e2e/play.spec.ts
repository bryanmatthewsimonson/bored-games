/*
 * End to end: 3 players (up to 6, see E2E_SEATS) in as many browser contexts play a real game through the UI,
 * against the dev relay.
 *
 * - a creates a table with all the seats but hers open; b, c, ... join from the share link; a starts the game.
 * - Every client shuffles and deals automatically; all of them reach the play screen.
 * - Then whoever holds the decision answers it with the first legal option, for at least 2 full rounds.
 * - At the end every context shows the same board, turn number and state seq.
 * - Then c resigns (D052): every context shows "Ended early: … resigned · unrated", the same final places with c
 *   last, the results table, and the result signed by every player (unless E2E_FINISH plays to the end instead).
 *
 * Run it with `pnpm e2e` (apps/web/e2e/run.ts), which provides E2E_BASE_URL and E2E_RELAY. Options:
 * - E2E_SEATS: the number of players, 3 to 6 (default 3). The shuffle and deal, and the time allowed for them,
 *   grow with it.
 * - E2E_TURNS: play at least this many turns (default 2 full rounds and one more turn: 7 for 3 players).
 * - E2E_ONE_CONTEXT=1: one tab per player of one browser context instead (shared storage, as in docs/TESTING.md).
 * - E2E_RELAY=none: leave out `?relays=`, so the app uses its own relay settings (for a `pnpm dev` server).
 * - E2E_SCREENSHOTS=<dir>: save a full-page screenshot per player mid-game, as <dir>/e2e-<profile>.png, and
 *   one of a at phone width (e2e-a-phone.png).
 * - E2E_FINISH=1: then play on, declaring the end as soon as it is allowed, until every player sees the final
 *   results and a passed audit (the end-of-game secrets and attestations).
 */
import { BRAND } from '@bored-games/brand';
import { COMPARE_PHRASE, COMPARE_TITLE } from '@bored-games/chain-reaction/compare';
import { type Browser, type BrowserContext, expect, type Locator, test } from '@playwright/test';
import { decide, game, nextToAct, type Player, stateOf } from './cr-ui.ts';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const ONE_CONTEXT = process.env.E2E_ONE_CONTEXT === '1';
/** The number of players: E2E_SEATS clamped to 3 to 6, 3 by default. */
const SEATS = Math.min(6, Math.max(3, Math.trunc(Number(process.env.E2E_SEATS ?? 3)) || 3));
/** The players' profile names: a, b, c, ... */
const NAMES = 'abcdef'.slice(0, SEATS);
/** 2 full rounds by default (6 turns for 3 players): turns 1 to 6 done, turn 7 under way. E2E_TURNS plays longer. */
const UNTIL_TURN = Math.max(2 * SEATS + 1, Number(process.env.E2E_TURNS ?? 0) || 0);
/** Past UNTIL_TURN the game goes on until a merger disposal was answered, but not beyond this turn. */
const MAX_TURN = Math.max(UNTIL_TURN, 120);
/** Shuffle and deal proofs: 5 minutes for 3 players, in proportion to the seats (each player shuffles in turn). */
const SETUP_MS = (5 * 60_000 * SEATS) / 3;
/** One decision, including relay round trips. */
const MOVE_MS = 60_000;
const SHOTS = process.env.E2E_SCREENSHOTS;
const FINISH = process.env.E2E_FINISH === '1';

/** The app URL for a profile, pointed at the test relay; `from` keeps another URL's hash (a share link). */
function appUrl(profile: string, from?: string): string {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  if (RELAY !== 'none') u.searchParams.set('relays', RELAY);
  return u.toString();
}

let shared: BrowserContext | null = null;

async function open(browser: Browser, name: string, url: string): Promise<Player> {
  const fresh = () => browser.newContext({ viewport: { width: 1280, height: 1000 } });
  if (ONE_CONTEXT && shared === null) shared = await fresh();
  const context = ONE_CONTEXT && shared !== null ? shared : await fresh();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console error: ${m.text()}`);
  });
  await page.goto(url);
  return { name, page };
}

/** The public board, cell by cell: its kind and its label (chain letter or cell id). */
function boardOf(p: Player): Promise<string[]> {
  return p.page
    .getByRole('table', { name: 'Board' })
    .locator('.cr-cell')
    .evaluateAll((cells) =>
      cells.map((c) => {
        const kind = [...c.classList].find((k) => /^cr-cell-(empty|loose|chain|pending)$/.test(k)) ?? '?';
        const label = c.querySelector('.cr-cell-label, .cr-cell-id')?.textContent ?? '';
        return `${kind}:${label}`;
      }),
    );
}

test(`${SEATS} players set up a game and play it through the UI`, async ({ browser }) => {
  // playwright.config.ts allows 15 minutes for 3 players; more seats take proportionally longer.
  test.setTimeout((15 * 60_000 * SEATS) / 3);
  const started = Date.now();
  const log = (msg: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);

  // a creates a table from the game's page in the catalog: herself plus the other seats, open. She finds it by
  // the title of the published game it compares to (D053), which its card and page name only in that phrase.
  const a = await open(browser, 'a', appUrl('a'));
  await a.page.getByLabel('Search games').fill(COMPARE_TITLE);
  await expect(a.page.locator('.catalog-count')).toHaveText(/^1 of \d+ games$/);
  await expect(a.page.locator('.game-card-compare')).toHaveText(COMPARE_PHRASE);
  await a.page.getByRole('link', { name: 'Chain Reaction', exact: true }).click();
  await expect(a.page).toHaveURL(/#\/games\/chain-reaction$/);
  const compare = a.page.getByRole('link', { name: COMPARE_PHRASE, exact: true });
  await expect(compare).toHaveAttribute('href', 'https://boardgamegeek.com/boardgame/5');
  await expect(
    a.page.getByText(`${BRAND.name} is not affiliated with or endorsed by the makers of that game.`),
  ).toBeVisible();
  await expect(a.page.getByRole('link', { name: 'BoardGameGeek', exact: true })).toHaveCount(0);
  await expect(a.page.getByRole('heading', { name: 'New table' })).toBeVisible();
  await a.page.getByLabel('Players', { exact: true }).selectOption(String(SEATS));
  await expect(a.page.getByText(`${SEATS - 1} open seats`)).toBeVisible();
  await a.page.getByRole('button', { name: 'Create table' }).click();
  // A key never backed up is asked first (D057); a ticks "Don't ask again for this key".
  await a.page.getByLabel("Don't ask again for this key").check();
  await a.page.getByRole('button', { name: 'Create anyway' }).click();
  await expect(a.page).toHaveURL(/#\/t\/[0-9a-f]{64}\//);
  const share = await a.page.getByLabel('Table link').inputValue();
  expect(share).not.toContain('profile=');
  log(`table created: ${share}`);

  // The others join from the share link, each in a context of its own.
  const joiners: Player[] = [];
  for (const name of NAMES.slice(1)) joiners.push(await open(browser, name, appUrl(name, share)));
  const b = joiners[0] as Player;
  for (const p of joiners) {
    await p.page.getByRole('button', { name: 'Join this table' }).click();
    // A key never backed up is asked to copy its secret key first (D057): b copies it, the others join anyway.
    const prompt = p.page.getByRole('alertdialog', { name: 'Copy your secret key first?' });
    await expect(prompt).toBeVisible();
    if (p === b) {
      if (SHOTS !== undefined && SHOTS !== '')
        await p.page.screenshot({ path: `${SHOTS}/e2e-join-backup.png` });
      await p.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await prompt.getByRole('button', { name: 'Copy secret key' }).click();
      await expect(prompt.getByText(/^Copied\./)).toBeVisible();
      expect(await p.page.evaluate(() => navigator.clipboard.readText())).toMatch(/^nsec1/);
      await prompt.getByRole('button', { name: 'Join', exact: true }).click();
    } else {
      await prompt.getByRole('button', { name: 'Join anyway' }).click();
    }
    await expect(p.page.getByText('You are seated.')).toBeVisible();
    log(`${p.name} joined`);
  }
  // b's key is backed up now: the next join from b's browser would not ask again.
  await expect(b.page.getByRole('alertdialog')).toHaveCount(0);

  // a sees the full table and starts the game.
  await expect(a.page.getByText('Every seat is taken.')).toBeVisible();
  await a.page.getByRole('button', { name: 'Start game' }).click();
  await a.page.getByRole('button', { name: 'Yes, start the game' }).click();
  const startedGame = Date.now();
  log('game started');

  const players = [a, ...joiners];
  // Everyone is taken to the game, shuffles, deals, and reaches the play screen.
  for (const p of players) await expect(p.page).toHaveURL(/#\/g\/[0-9a-f]{64}$/, { timeout: 60_000 });

  // A browser that is not seated (a fresh key, as when a player reopens the game in another app or browser) is
  // told it is watching, and why, during the setup (D057). The players see whom the setup waits for.
  const w = await open(browser, 'w', appUrl('w', a.page.url()));
  await expect(w.page.getByText("You're watching this game.")).toBeVisible({ timeout: MOVE_MS });
  await expect(
    w.page.getByText("isn't one of its players. If you joined from another app or browser"),
  ).toBeVisible();
  await expect(
    w.page.getByText(/^Waiting for .* (to shuffle|to send their deal shares)\. Their apps? must be open/),
  )
    .toBeVisible({ timeout: MOVE_MS })
    .catch(() => log('w: the setup finished before a waiting line showed'));
  // At phone width the notice wraps: no horizontal scroll.
  await w.page.setViewportSize({ width: 390, height: 844 });
  expect(await w.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (SHOTS !== undefined && SHOTS !== '')
    await w.page.screenshot({ path: `${SHOTS}/e2e-watching-phone.png`, fullPage: true });
  await w.page.context().close();
  for (const p of players) await expect(p.page.getByText("You're watching this game.")).toHaveCount(0);
  log('an unseated browser saw "You\'re watching this game"');
  for (const p of players) await expect(game(p)).toBeVisible({ timeout: SETUP_MS });
  log(`all ${SEATS} on the play screen, ${((Date.now() - startedGame) / 1000).toFixed(1)}s after Start game`);
  expect(new Set(players.map((p) => p.page.url().split('#')[1])).size).toBe(1);

  // Play: whoever holds the decision answers it. At least 2 full rounds, then on until a merger disposal has
  // been answered (out of turn, by whoever held the shares), up to MAX_TURN. Mid-game, b reloads its tab and
  // must rebuild from the relays and its saved secrets.
  let moves = 0;
  let disposals = 0;
  let firstPlace = true;
  let reloaded = false;
  for (;;) {
    const states = await Promise.all(players.map(stateOf));
    const turn = Math.min(...states.map((s) => s.turn));
    if (turn >= UNTIL_TURN && (disposals > 0 || turn >= MAX_TURN)) break;
    if (!reloaded && turn >= 4) {
      reloaded = true;
      await b.page.reload();
      await expect(game(b)).toBeVisible({ timeout: MOVE_MS });
      log(`b reloaded at turn ${turn} and rebuilt the game`);
    }
    const actor = await nextToAct(players);
    if (moves === 0)
      log(`first decision ${((Date.now() - startedGame) / 1000).toFixed(1)}s after Start game`);
    const before = await stateOf(actor);
    const what = await decide(actor);
    moves++;
    if (what.endsWith('shares: Confirm')) disposals++;
    log(`${actor.name} turn ${before.turn} seq ${before.seq}: ${what}`);
    // The move is folded in locally first, then reaches the others through the relay.
    await expect
      .poll(async () => (await stateOf(actor)).seq, { timeout: MOVE_MS })
      .toBeGreaterThan(before.seq);
    if (firstPlace && what.startsWith('Place a tile')) {
      firstPlace = false;
      const tile = what.replace(/^.*Place /, '').trim();
      for (const p of players) {
        const cell = p.page
          .getByRole('table', { name: 'Board' })
          .getByText(`${tile}: empty`, { exact: true });
        await expect(cell).toHaveCount(0, { timeout: MOVE_MS });
      }
      log(`every player sees ${tile} on the board`);
    }
    if (moves > 10 * MAX_TURN) throw new Error(`no progress after ${moves} decisions`);
  }
  if (disposals === 0) log(`no merger by turn ${MAX_TURN}: the disposal form was not exercised`);

  // Everyone converges on the same state: seq, turn and board.
  const target = Math.max(...(await Promise.all(players.map(async (p) => (await stateOf(p)).seq))));
  for (const p of players)
    await expect.poll(async () => (await stateOf(p)).seq, { timeout: MOVE_MS }).toBe(target);
  const finals = await Promise.all(players.map(stateOf));
  const boards = await Promise.all(players.map(boardOf));
  log(`converged at seq ${target}, turn ${finals[0]?.turn}, after ${moves} decisions`);
  for (const s of finals) {
    expect(s.turn).toBe(finals[0]?.turn);
    expect(s.turn).toBeGreaterThanOrEqual(UNTIL_TURN);
  }
  for (const board of boards) expect(board).toEqual(boards[0]);
  expect(boards[0]?.filter((cell) => !cell.startsWith('cr-cell-empty')).length).toBeGreaterThanOrEqual(6);

  if (SHOTS !== undefined && SHOTS !== '') {
    for (const p of players) await p.page.screenshot({ path: `${SHOTS}/e2e-${p.name}.png`, fullPage: true });
    await a.page.setViewportSize({ width: 360, height: 780 });
    await a.page.screenshot({ path: `${SHOTS}/e2e-a-phone.png`, fullPage: true });
    await a.page.setViewportSize({ width: 1280, height: 1000 });
    log(`screenshots in ${SHOTS}`);
  }

  if (FINISH) {
    // Play on, declaring the end as soon as it is allowed.
    const results = (p: Player) => p.page.getByRole('heading', { name: 'Final results' });
    for (;;) {
      if ((await Promise.all(players.map((p) => results(p).count()))).some((n) => n > 0)) break;
      const actor = await Promise.any([
        nextToAct(players),
        ...players.map((p) =>
          results(p)
            .waitFor({ timeout: MOVE_MS })
            .then(() => null),
        ),
      ]);
      if (actor === null) break;
      const before = await stateOf(actor);
      const what = await decide(actor, true);
      moves++;
      if (what.includes('declaring the end')) log(`${actor.name} turn ${before.turn}: ${what}`);
      await expect
        .poll(async () => (await stateOf(actor)).seq, { timeout: MOVE_MS })
        .toBeGreaterThan(before.seq);
      if (moves > 20 * MAX_TURN) throw new Error(`no end after ${moves} decisions`);
    }
    for (const p of players) {
      await expect(results(p)).toBeVisible({ timeout: MOVE_MS });
      await expect(p.page.getByText('Audit passed')).toBeVisible({ timeout: SETUP_MS });
    }
    const tables = await Promise.all(players.map((p) => p.page.locator('.cr-results table').innerText()));
    for (const t of tables) expect(t).toBe(tables[0]);
    log(`game over after ${moves} decisions; every player sees the same results and a passed audit`);
    if (SHOTS !== undefined && SHOTS !== '')
      await a.page.screenshot({ path: `${SHOTS}/e2e-a-results.png`, fullPage: true });
  }

  if (!FINISH) {
    // c resigns (D052): the game ends for everyone, ranked as if it ended now, with c last, and unrated.
    const quitter = players[2] as Player;
    await quitter.page.getByRole('button', { name: 'Resign' }).click();
    await expect(quitter.page.getByText(/Resigning ends the game for everyone\./)).toBeVisible();
    await expect(quitter.page.getByText(/won't count toward ratings/)).toBeVisible();
    await quitter.page.getByRole('button', { name: 'Yes, resign' }).click();
    log(`${quitter.name} resigned`);
    const line = (p: Player): Locator => p.page.locator('.game-resigned');
    for (const p of players) {
      // The others publish their end-of-game secrets, the partial audit runs, then the places are known.
      await expect(line(p)).toHaveText(/^Ended early: .+ resigned · unrated\. Final places: 1\. /, {
        timeout: MOVE_MS,
      });
      await expect(p.page.getByRole('heading', { name: 'Final results' })).toBeVisible();
      await expect(p.page.getByText(/game ended early: final cash/)).toBeVisible();
      await expect(p.page.getByText(`Result confirmed: signed by all ${SEATS} players.`)).toBeVisible({
        timeout: MOVE_MS,
      });
    }
    const lines = await Promise.all(players.map((p) => line(p).innerText()));
    for (const l of lines) expect(l).toBe(lines[0]);
    const m = /^Ended early: (.+) resigned · unrated\. Final places: (.+)\.$/.exec(lines[0] ?? '');
    expect(m).not.toBeNull();
    // The resigning player is last, alone.
    expect(m?.[2]?.endsWith(`, ${SEATS}. ${m?.[1]}`)).toBe(true);
    const tables = await Promise.all(players.map((p) => p.page.locator('.cr-results table').innerText()));
    for (const t of tables) expect(t).toBe(tables[0]);
    const lastRow = a.page.locator('.cr-results tbody tr').last();
    await expect(lastRow.locator('td').first()).toHaveText(String(SEATS));
    await expect(a.page.locator('.cr-results tbody tr')).toHaveCount(SEATS);
    log(`every player sees the unrated result: ${lines[0]}`);
    if (SHOTS !== undefined && SHOTS !== '')
      await a.page.screenshot({ path: `${SHOTS}/e2e-a-resigned.png`, fullPage: true });
  }

  // a's Home lists the game.
  await a.page.goto(appUrl('a'));
  await expect(a.page.getByRole('link', { name: 'Open game' })).toBeVisible();
  for (const context of new Set(players.map((p) => p.page.context()))) await context.close();
});
