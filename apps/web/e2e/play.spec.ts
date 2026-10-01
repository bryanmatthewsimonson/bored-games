/*
 * End to end: three players in three browser contexts play a real game through the UI, against the dev relay.
 *
 * - a creates a 3-seat table with 2 open seats; b and c join from the share link; a starts the game.
 * - Every client shuffles and deals automatically; all three reach the play screen.
 * - Then whoever holds the decision answers it with the first legal option, for at least 2 full rounds.
 * - At the end every context shows the same board, turn number and state seq.
 *
 * Run it with `pnpm e2e` (apps/web/e2e/run.ts), which provides E2E_BASE_URL and E2E_RELAY. Options:
 * - E2E_TURNS: play at least this many turns (default 7).
 * - E2E_ONE_CONTEXT=1: three tabs of one browser context instead (shared storage, as in docs/TESTING.md).
 * - E2E_RELAY=none: leave out `?relays=`, so the app uses its own relay settings (for a `pnpm dev` server).
 * - E2E_SCREENSHOTS=<dir>: save a full-page screenshot per player mid-game, as <dir>/e2e-<profile>.png, and
 *   one of a at phone width (e2e-a-phone.png).
 * - E2E_FINISH=1: then play on, declaring the end as soon as it is allowed, until every player sees the final
 *   results and a passed audit (the end-of-game secrets and attestations).
 */
import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const ONE_CONTEXT = process.env.E2E_ONE_CONTEXT === '1';
/** 2 full rounds of 3 players by default: turns 1 to 6 done, turn 7 under way. E2E_TURNS plays longer. */
const UNTIL_TURN = Math.max(7, Number(process.env.E2E_TURNS ?? 7) || 7);
/** Past UNTIL_TURN the game goes on until a merger disposal was answered, but not beyond this turn. */
const MAX_TURN = Math.max(UNTIL_TURN, 120);
/** Shuffle and deal proofs for 3 players. */
const SETUP_MS = 5 * 60_000;
/** One decision, including relay round trips. */
const MOVE_MS = 60_000;
const SHOTS = process.env.E2E_SCREENSHOTS;
const FINISH = process.env.E2E_FINISH === '1';

interface Player {
  name: string;
  page: Page;
}

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

const game = (p: Player): Locator => p.page.getByTestId('cr-game');

async function stateOf(p: Player): Promise<{ seq: number; turn: number; phase: string }> {
  const g = game(p);
  return {
    seq: Number(await g.getAttribute('data-seq')),
    turn: Number(await g.getAttribute('data-turn')),
    phase: (await g.getAttribute('data-phase')) ?? '',
  };
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

/** The player's enabled decision form, if it is their decision now. */
const openDecision = (p: Player): Locator => p.page.locator('.cr-decision fieldset:not([disabled])');

/** Wait until one of the players holds a decision; returns that player. */
async function nextToAct(players: readonly Player[]): Promise<Player> {
  const ac = players.map((p) =>
    openDecision(p)
      .first()
      .waitFor({ state: 'visible', timeout: MOVE_MS })
      .then(() => p),
  );
  return Promise.any(ac);
}

/**
 * Answer the open decision with its first legal option: the first radio (tile, chain, order) when nothing is
 * picked yet, keep all shares in a disposal, and at the end of a turn buy one share of the first chain on
 * offer when that is allowed (otherwise none). With `declare`, end the game when that is allowed. Returns a
 * description of what was done.
 */
async function decide(p: Player, declare = false): Promise<string> {
  const form = openDecision(p).first();
  const legend = (await form.locator('legend').first().innerText()).trim();
  const submit = form.locator('button[type="submit"]');
  const radios = form.getByRole('radio');
  if ((await radios.count()) > 0 && (await form.getByRole('radio', { checked: true }).count()) === 0)
    await radios.first().check();
  let detail = '';
  if (legend.startsWith('Buy shares')) {
    const buy = form.locator('input[type="number"]:enabled');
    if ((await buy.count()) > 0) {
      await buy.first().fill('1');
      if (await submit.isDisabled()) await buy.first().fill('0');
      else
        detail = ` (${(await buy.first().getAttribute('aria-label'))?.replace(' to buy', '') ?? 'shares'}: 1)`;
    }
    const end = form.getByRole('checkbox', { name: /Declare the end of the game/ });
    if (declare && (await end.count()) > 0) {
      await end.check();
      detail += ', declaring the end';
    }
  }
  const label = (await submit.innerText()).trim();
  await expect(submit).toBeEnabled();
  await submit.click();
  return `${legend}: ${label}${detail}`.replace(/\s+/g, ' ');
}

test('three players set up a game and play it through the UI', async ({ browser }) => {
  const started = Date.now();
  const log = (msg: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);

  // a creates a 3-seat table: herself plus 2 open seats.
  const a = await open(browser, 'a', appUrl('a'));
  await expect(a.page.getByRole('heading', { name: 'New table' })).toBeVisible();
  await a.page.getByLabel('Players', { exact: true }).selectOption('3');
  await expect(a.page.getByText('2 open seats')).toBeVisible();
  await a.page.getByRole('button', { name: 'Create table' }).click();
  await expect(a.page).toHaveURL(/#\/t\/[0-9a-f]{64}\//);
  const share = await a.page.getByLabel('Table link').inputValue();
  expect(share).not.toContain('profile=');
  log(`table created: ${share}`);

  // b and c join from the share link.
  const b = await open(browser, 'b', appUrl('b', share));
  const c = await open(browser, 'c', appUrl('c', share));
  for (const p of [b, c]) {
    await p.page.getByRole('button', { name: 'Join this table' }).click();
    await expect(p.page.getByText('You are seated.')).toBeVisible();
    log(`${p.name} joined`);
  }

  // a sees the full table and starts the game.
  await expect(a.page.getByText('Every seat is taken.')).toBeVisible();
  await a.page.getByRole('button', { name: 'Start game' }).click();
  await a.page.getByRole('button', { name: 'Yes, start the game' }).click();
  log('game started');

  const players = [a, b, c];
  // Everyone is taken to the game, shuffles, deals, and reaches the play screen.
  for (const p of players) await expect(p.page).toHaveURL(/#\/g\/[0-9a-f]{64}$/, { timeout: 60_000 });
  for (const p of players) await expect(game(p)).toBeVisible({ timeout: SETUP_MS });
  log('all three on the play screen');
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

  // a's Home lists the game.
  await a.page.goto(appUrl('a'));
  await expect(a.page.getByRole('link', { name: 'Open game' })).toBeVisible();
  for (const context of new Set(players.map((p) => p.page.context()))) await context.close();
});
