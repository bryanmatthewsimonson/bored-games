import { createRng } from '@bored-games/game-kit';
import {
  type CardSlot,
  type LusterAction,
  type LusterState,
  lusterRules,
  TIER_DECKS,
} from '@bored-games/luster';
import { LUSTER_THEME } from '@bored-games/luster/theme';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { LUSTER_POLICIES } from '../../../tools/fuzz/src/luster.ts';
import { tokenText } from '../src/games/luster/model.ts';

const url = (profile: string, from?: string) => {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  u.searchParams.set('relays', process.env.E2E_RELAY ?? 'ws://localhost:7777');
  return u.toString();
};
const board = (page: Page) => page.getByTestId('luster-game');
async function open(browser: Browser, profile: string, from?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url(profile, from));
  return page;
}
/** Reads only rendered information, including the current player's private reservation. */
async function stateOf(page: Page, seat: number): Promise<LusterState> {
  const seats = await page.locator('.luster-players > section').count();
  const init = lusterRules.setup({ rules: lusterRules.defaultRules(), seats, mode: 'view', viewer: seat });
  if (!init.ok) throw new Error(init.error.message);
  const snapshot = await board(page).evaluate((root) => {
    const slots = (parent: Element | null): CardSlot[] =>
      Array.from(parent?.querySelectorAll<HTMLElement>('.luster-card[data-deck]') ?? []).map((h) => ({
        deck: h.dataset.deck as CardSlot['deck'],
        pos: Number(h.dataset.pos),
        card: h.dataset.card === 'hidden' ? null : Number(h.dataset.card),
        private: h.dataset.private === 'true',
      }));
    const counts = (parent: Element | null) =>
      Array.from(parent?.querySelectorAll<HTMLElement>(':scope > .luster-counts > .luster-light') ?? []).map(
        (e) => Number(e.dataset.count),
      );
    const players = Array.from(root.querySelectorAll<HTMLElement>('.luster-players > section')).map((p) => ({
      tokens: p.dataset.tokens?.split(',').map(Number) ?? [],
      bought: slots(p.querySelector('details')),
      reserved: slots(p.querySelector(':scope > .luster-reservations')),
      patrons: [] as number[],
    }));
    const market = ['tier-1', 'tier-2', 'tier-3'].map((deck) =>
      Array.from(root.querySelectorAll<HTMLElement>(`.luster-market .luster-card[data-deck="${deck}"]`)).map(
        (h) => slots(h.parentElement).find((x) => x.pos === Number(h.dataset.pos) && x.deck === deck) ?? null,
      ),
    );
    const patrons = Array.from(root.querySelectorAll<HTMLElement>('.luster-patron')).map((p) => ({
      pos: Number(p.dataset.pos),
      card: p.dataset.card === undefined ? null : Number(p.dataset.card),
    }));
    return {
      players,
      market,
      patrons,
      supply: counts(root.querySelector('section.luster-panel')),
      turn: Number((root as HTMLElement).dataset.turn),
      startingSeat: Number((root as HTMLElement).dataset.startingSeat),
      phase: (root as HTMLElement).dataset.phase as LusterState['phase'],
      round: Number((root as HTMLElement).dataset.round),
      seq: Number((root as HTMLElement).dataset.seq),
    };
  });
  const all = [...snapshot.market.flat(), ...snapshot.players.flatMap((p) => [...p.reserved, ...p.bought])];
  const decks = { ...init.value.decks };
  for (const deck of TIER_DECKS)
    decks[deck] = {
      order: null,
      next: Math.max(3, ...all.flatMap((h) => (h?.deck === deck ? [h.pos] : []))) + 1,
    };
  return { ...init.value, ...snapshot, decks };
}
async function act(page: Page, a: LusterAction) {
  const before = Number(await board(page).getAttribute('data-seq'));
  if (a.type === 'take' || a.type === 'return') {
    const label = a.type === 'take' ? 'Take' : 'Return';
    for (let i = 0; i < (a.type === 'take' ? 5 : 6); i++)
      await page.getByLabel(`${label} ${LUSTER_THEME.colors[i]}`, { exact: true }).fill(String(a.tokens[i]));
    await page
      .getByRole('button', {
        name: a.type === 'take' ? 'Gather selected light' : 'Return selected light',
        exact: true,
      })
      .click();
  } else if (a.type === 'reserve') {
    const visible = page.locator(`.luster-market [data-deck="${a.deck}"][data-pos="${a.pos}"]`);
    if (await visible.count()) await visible.getByRole('button', { name: 'Reserve', exact: true }).click();
    else
      await page
        .getByRole('button', { name: `Reserve blind tier ${TIER_DECKS.indexOf(a.deck) + 1}`, exact: true })
        .click();
  } else if (a.type === 'buy') {
    await page
      .locator(`.luster-card[data-deck="${a.deck}"][data-pos="${a.pos}"]`)
      .getByRole('button', { name: 'Purchase', exact: true })
      .click();
    await page.getByLabel('Choose payment').selectOption({
      label: a.pay.every((n) => n === 0) ? 'Free — use workshop discounts' : tokenText(a.pay),
    });
    await page.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
  } else if (a.type === 'patron')
    await page.getByRole('button', { name: `Choose ${LUSTER_THEME.patrons[a.card]}`, exact: true }).click();
  else if (a.type === 'pass')
    await page.getByRole('button', { name: 'Pass — no main action available' }).click();
  await expect.poll(async () => Number(await board(page).getAttribute('data-seq'))).toBeGreaterThan(before);
}
async function mobile(page: Page, file: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `/tmp/luster-${file}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
}

for (const seats of [2, 3, 4]) {
  test(`Luster ${seats} players: random start, encrypted reservations, full game, spectator, reconnect and audit`, async ({
    browser,
  }) => {
    test.setTimeout(10 * 60_000);
    const pages: Page[] = [];
    for (let seat = 0; seat < seats; seat++) pages.push(await open(browser, `luster-${seats}-${seat}`));
    const a = pages[0];
    if (!a) throw new Error('Missing creator');
    await a.getByLabel('Search games').fill('Luster');
    await a.getByRole('link', { name: 'Luster', exact: true }).click();
    await a.getByLabel('Players', { exact: true }).selectOption(String(seats));
    await a.getByRole('button', { name: 'Create table', exact: true }).click();
    await a.getByRole('button', { name: 'Create anyway', exact: true }).click();
    const share = await a.getByLabel('Table link').inputValue();
    for (const [index, page] of pages.entries()) {
      if (index === 0) continue;
      await page.goto(url(`luster-${seats}-${index}`, share));
      await page.getByRole('button', { name: 'Join this table', exact: true }).click();
      await page.getByRole('button', { name: 'Join anyway', exact: true }).click();
    }
    await expect(a.getByText('Every seat is taken.')).toBeVisible();
    await a.getByRole('button', { name: 'Start game', exact: true }).click();
    await a.getByRole('button', { name: 'Yes, start the game', exact: true }).click();
    for (const p of pages) await expect(board(p)).toBeVisible({ timeout: 120_000 });
    const assigned = await Promise.all(
      pages.map(async (page) => ({
        page,
        seat: Number(
          await page
            .locator('.luster-players > section')
            .filter({ has: page.locator('h4').filter({ hasText: '(you)' }) })
            .getAttribute('data-seat'),
        ),
      })),
    );
    pages.splice(0, pages.length, ...assigned.sort((a, b) => a.seat - b.seat).map((p) => p.page));
    await expect(board(a)).not.toHaveAttribute('data-starting-seat', 'pending', { timeout: 120_000 });
    const startingSeat = Number(await board(a).getAttribute('data-starting-seat'));
    const first = pages[startingSeat];
    const other = pages[(startingSeat + 1) % seats];
    if (!first || !other) throw new Error('Invalid starting seat');
    for (const p of pages) {
      await expect(board(p)).toHaveAttribute('data-starting-seat', String(startingSeat));
      await expect(board(p)).toHaveAttribute('data-turn', String(startingSeat));
      await expect(p.getByText(/First player: .*chosen at random/)).toBeVisible();
    }
    await expect(first.getByRole('button', { name: 'Reserve blind tier 1', exact: true })).toBeEnabled({
      timeout: 120_000,
    });
    await expect(other.getByRole('button', { name: 'Reserve blind tier 1', exact: true })).toBeDisabled();
    await act(first, { type: 'reserve', actor: startingSeat, deck: 'tier-1', pos: 4 });
    const reservationSelector = `.luster-players [data-seat="${startingSeat}"] > .luster-reservations .luster-card`;
    const reservation = first.locator(reservationSelector);
    await expect(reservation).not.toHaveAttribute('data-card', 'hidden');
    for (const p of pages.filter((p) => p !== first))
      await expect(p.locator(reservationSelector)).toHaveAttribute('data-card', 'hidden');
    const spectator = await open(browser, `luster-${seats}-spectator`, a.url());
    await expect(board(spectator)).toBeVisible({ timeout: 120_000 });
    await expect(board(spectator)).toHaveAttribute('data-starting-seat', String(startingSeat));
    await expect(
      spectator.getByRole('button', { name: 'Gather selected light', exact: true }),
    ).toBeDisabled();
    await expect(spectator.locator(reservationSelector)).toHaveAttribute('data-card', 'hidden');
    await mobile(a, `${seats}-start`);
    const rng = createRng('luster-browser');
    let finished = false;
    for (let n = 0; n < 180; n++) {
      const turn = Number(await board(a).getAttribute('data-turn'));
      const page = pages[turn];
      if (!page) throw new Error('Invalid turn');
      // Public refill reveals are automatic and may advance seq without a player action.
      await expect(page.locator('.luster-market .luster-card[data-card="hidden"]')).toHaveCount(0);
      if ((await board(page).getAttribute('data-phase')) === 'over') {
        finished = true;
        break;
      }
      const phase = await board(page).getAttribute('data-phase');
      if (phase === 'patron') await expect(page.locator('.luster-patron button').first()).toBeEnabled();
      else await expect(page.locator('.luster-token-form')).toBeEnabled();
      const s = await stateOf(page, turn);
      const legal = lusterRules.legalActions(s, turn);
      const action = LUSTER_POLICIES[0]?.choose(s, turn, legal, rng) as LusterAction;
      await act(page, action);
      const seq = Number(await board(page).getAttribute('data-seq'));
      for (const other of [...pages, spectator])
        await expect
          .poll(async () => Number(await board(other).getAttribute('data-seq')))
          .toBeGreaterThanOrEqual(seq);
      if (n === 10) {
        await a.reload();
        await expect(board(a)).toBeVisible();
        await expect(board(a)).toHaveAttribute('data-starting-seat', String(startingSeat));
        await mobile(a, `${seats}-midgame`);
      }
    }
    expect(finished).toBe(true);
    for (const p of [...pages, spectator]) {
      await expect(p.getByText('Deck audit passed.', { exact: true })).toBeVisible({ timeout: 120_000 });
      await expect(
        p.getByText(
          seats === 2
            ? 'Result confirmed: signed by both players.'
            : `Result confirmed: signed by all ${seats} players.`,
          { exact: true },
        ),
      ).toBeVisible({ timeout: 120_000 });
      await expect(p.getByRole('button', { name: 'Gather selected light', exact: true })).toBeDisabled();
    }
    await a.screenshot({ path: `/tmp/luster-${seats}-result-1280.png`, fullPage: true });
    await mobile(a, `${seats}-result`);
    await a.goto(`${url(`luster-${seats}-0`)}#/rules/luster/ending`);
    await expect(a.getByRole('heading', { name: 'The final round', exact: true })).toBeVisible();
    await mobile(a, `${seats}-rules`);
    await expect(a.getByRole('heading', { name: 'How to play Luster' })).toBeVisible();
    for (const p of [...pages, spectator]) await p.context().close();
  });
}
