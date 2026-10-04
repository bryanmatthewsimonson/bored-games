import { createRng } from '@bored-games/game-kit';
import {
  type CardSlot,
  type LusterAction,
  type LusterState,
  lusterRules,
  TIER_DECKS,
  workshop,
} from '@bored-games/luster';
import { COMPARE_PHRASE } from '@bored-games/luster/compare';
import { LUSTER_THEME } from '@bored-games/luster/theme';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { LUSTER_POLICIES } from '../../../tools/fuzz/src/luster.ts';

const url = (profile: string, from?: string) => {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  u.searchParams.set('relays', process.env.E2E_RELAY ?? 'ws://localhost:7777');
  return u.toString();
};
const board = (page: Page) => page.getByTestId('luster-game');
const goldPaymentsChecked = new Set<number>();
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
  const snapshot = await board(page).evaluate((root, seat) => {
    const slots = (parent: Element | null): CardSlot[] =>
      Array.from(parent?.querySelectorAll<HTMLElement>('.luster-card[data-deck]') ?? []).map((h) => ({
        deck: h.dataset.deck as CardSlot['deck'],
        pos: Number(h.dataset.pos),
        card: h.dataset.card === 'hidden' ? null : Number(h.dataset.card),
        private: h.dataset.private === 'true',
      }));
    const players = Array.from(root.querySelectorAll<HTMLElement>('.luster-players > section')).map((p) => ({
      tokens: p.dataset.tokens?.split(',').map(Number) ?? [],
      bought: slots(p.querySelector('details')),
      reserved: slots(
        Number(p.dataset.seat) === seat
          ? root.querySelector('.luster-your-hand > .luster-reservations')
          : p.querySelector(':scope > .luster-reservations'),
      ),
      patrons: p.dataset.patrons?.split(',').filter(Boolean).map(Number) ?? [],
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
      supply: root.querySelector<HTMLElement>('.luster-bank')?.dataset.supply?.split(',').map(Number) ?? [],
      turn: Number((root as HTMLElement).dataset.turn),
      startingSeat: Number((root as HTMLElement).dataset.startingSeat),
      phase: (root as HTMLElement).dataset.phase as LusterState['phase'],
      round: Number((root as HTMLElement).dataset.round),
      seq: Number((root as HTMLElement).dataset.seq),
    };
  }, seat);
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
      for (let n = 0; n < (a.tokens[i] ?? 0); n++)
        await page.getByRole('button', { name: `${label} ${LUSTER_THEME.colors[i]}`, exact: true }).click();
    await page
      .getByRole('button', {
        name: a.type === 'take' ? 'Take gems' : 'Return gems',
        exact: true,
      })
      .click();
  } else if (a.type === 'reserve') {
    const visible = page.locator(`.luster-market [data-deck="${a.deck}"][data-pos="${a.pos}"]`);
    if (await visible.count()) await visible.getByRole('button').click();
    else
      await page
        .getByRole('button', { name: `Reserve blind tier ${TIER_DECKS.indexOf(a.deck) + 1}`, exact: true })
        .click();
    await page.getByRole('button', { name: /^Reserve card/ }).click();
  } else if (a.type === 'buy') {
    await page
      .locator(`.luster-card[data-deck="${a.deck}"][data-pos="${a.pos}"]`)
      .getByRole('button', { name: /^Select / })
      .click();
    const seats = await page.locator('.luster-players > section').count();
    const swap = page.locator('.luster-payment-row button:enabled[aria-label^="Use gold instead"]');
    if (!goldPaymentsChecked.has(seats) && (await swap.count())) {
      const paymentBefore = await page.locator('[data-payment]').getAttribute('data-payment');
      const label = await swap.first().getAttribute('aria-label');
      await swap.first().click();
      await expect(page.locator('[data-payment]')).not.toHaveAttribute('data-payment', paymentBefore ?? '');
      await page
        .getByRole('button', {
          name: `Use ${label?.replace('Use gold instead of ', '')} instead of gold`,
          exact: true,
        })
        .click();
      await expect(page.locator('[data-payment]')).toHaveAttribute('data-payment', paymentBefore ?? '');
      goldPaymentsChecked.add(seats);
    }
    for (let color = 0; color < 5; color++) {
      let current =
        (await page.locator('[data-payment]').getAttribute('data-payment'))?.split(',').map(Number) ?? [];
      while ((current[color] ?? 0) !== a.pay[color]) {
        const name =
          (current[color] ?? 0) > (a.pay[color] ?? 0)
            ? `Use gold instead of ${LUSTER_THEME.colors[color]}`
            : `Use ${LUSTER_THEME.colors[color]} instead of gold`;
        await page.getByRole('button', { name, exact: true }).click();
        current =
          (await page.locator('[data-payment]').getAttribute('data-payment'))?.split(',').map(Number) ?? [];
      }
    }
    await expect(page.locator('[data-payment]')).toHaveAttribute('data-payment', a.pay.join(','));
    await page.getByRole('button', { name: 'Buy card', exact: true }).click();
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
    // "Compare to" the published game, linked to its BoardGameGeek entry by id, and no entry of its own (D060).
    await expect(a.getByRole('link', { name: COMPARE_PHRASE, exact: true })).toHaveAttribute(
      'href',
      'https://boardgamegeek.com/boardgame/148228',
    );
    await expect(a.getByRole('link', { name: 'BoardGameGeek', exact: true })).toHaveCount(0);
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
    await expect(first.locator('.luster-bank')).toHaveAttribute(
      'data-supply',
      Array(5)
        .fill(seats === 2 ? 4 : seats === 3 ? 5 : 7)
        .concat(5)
        .join(','),
    );
    await expect(board(first).getByRole('spinbutton')).toHaveCount(0);
    expect(
      await first
        .locator('.luster-landscape stop')
        .first()
        .evaluate((stop) => getComputedStyle(stop).stopColor),
    ).not.toBe('rgb(0, 0, 0)');
    await expect(first.getByRole('region', { name: 'Your resources', exact: true })).toBeVisible();
    const diamond = first.getByRole('button', { name: 'Take Diamond', exact: true });
    await expect(diamond).toBeEnabled();
    await diamond.click();
    await diamond.click();
    await expect(first.getByRole('button', { name: 'Remove selected Diamond' })).toHaveCount(2);
    await expect(first.getByRole('button', { name: 'Take Sapphire', exact: true })).toBeDisabled();
    await diamond.click();
    await expect(first.getByRole('button', { name: 'Remove selected Diamond' })).toHaveCount(0);
    for (const name of ['Diamond', 'Sapphire', 'Emerald'])
      await first.getByRole('button', { name: `Take ${name}`, exact: true }).click();
    await expect(first.getByRole('button', { name: 'Take Ruby', exact: true })).toBeDisabled();
    await first.getByRole('button', { name: 'Remove selected Emerald', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Take Ruby', exact: true })).toBeEnabled();
    await first.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Take Gold', exact: true })).toBeDisabled();
    const face = first.locator('.luster-market .luster-card-face').first();
    await face.focus();
    await face.press('Enter');
    await expect(first.getByRole('dialog')).toBeVisible();
    await expect(first.getByRole('button', { name: 'Buy card', exact: true })).toBeDisabled();
    await mobile(first, `${seats}-card`);
    await first.keyboard.press('Escape');
    await expect(first.getByRole('dialog')).toHaveCount(0);
    await expect(face).toBeFocused();
    await expect(first.getByRole('button', { name: 'Reserve blind tier 1', exact: true })).toBeEnabled({
      timeout: 120_000,
    });
    await expect(other.getByRole('button', { name: 'Reserve blind tier 1', exact: true })).toBeDisabled();
    await act(first, { type: 'reserve', actor: startingSeat, deck: 'tier-1', pos: 4 });
    const reservationSelector = `.luster-players [data-seat="${startingSeat}"] > .luster-reservations .luster-card`;
    const reservation = first.locator('.luster-your-hand .luster-card');
    await expect(reservation).not.toHaveAttribute('data-card', 'hidden');
    await expect(first.locator(reservationSelector)).toHaveAttribute('data-card', 'hidden');
    for (const p of pages.filter((p) => p !== first))
      await expect(p.locator(reservationSelector)).toHaveAttribute('data-card', 'hidden');
    const spectator = await open(browser, `luster-${seats}-spectator`, a.url());
    await expect(board(spectator)).toBeVisible({ timeout: 120_000 });
    await expect(board(spectator)).toHaveAttribute('data-starting-seat', String(startingSeat));
    await expect(spectator.getByRole('button', { name: 'Take gems', exact: true })).toBeDisabled();
    await expect(spectator.locator(reservationSelector)).toHaveAttribute('data-card', 'hidden');
    await expect(spectator.locator('.luster-your-hand')).toHaveCount(0);
    await a.evaluate(() => window.scrollTo(0, 0));
    const mainBox = await a.locator('.luster-table-main').boundingBox();
    const sideBox = await a.getByRole('complementary', { name: 'Players' }).boundingBox();
    expect(mainBox).not.toBeNull();
    expect(sideBox).not.toBeNull();
    expect(sideBox?.x).toBeGreaterThan((mainBox?.x ?? 0) + (mainBox?.width ?? 0));
    expect(Math.abs((sideBox?.y ?? 0) - (mainBox?.y ?? 0))).toBeLessThan(1);
    expect(
      await first.locator(reservationSelector).evaluate((card) => getComputedStyle(card).backgroundColor),
    ).toBe('rgb(70, 104, 86)');
    await a.screenshot({ path: `/tmp/luster-${seats}-start-1280.png`, fullPage: true });
    await mobile(a, `${seats}-start`);
    // Collect the full colored price while keeping the reservation's gold. This deliberately
    // exercises optional gold substitution even when the player owns all the colored gems.
    const initial = await stateOf(first, startingSeat);
    const goal = initial.market[0]
      ?.filter((slot): slot is CardSlot => slot !== null && slot.card !== null)
      .sort((a, b) => {
        const total = (slot: CardSlot) =>
          workshop(slot.deck, slot.card ?? 0)?.cost.reduce((x, y) => x + y, 0) ?? 99;
        return total(a) - total(b);
      })[0];
    if (!goal) throw new Error('No development for payment exercise');
    const price = workshop(goal.deck, goal.card ?? 0)?.cost ?? [];
    let publicReservationChecked = false;
    for (let preparation = 0; preparation < seats * 5; preparation++) {
      const turn = Number(await board(a).getAttribute('data-turn'));
      const page = pages[turn];
      if (!page) throw new Error('Invalid turn');
      await expect(page.locator('.luster-market .luster-card[data-card="hidden"]')).toHaveCount(0);
      await expect(page.locator('.luster-token-form')).toBeEnabled();
      const state = await stateOf(page, turn);
      const actions = lusterRules.legalActions(state, turn) as readonly LusterAction[];
      if (turn === startingSeat) {
        const missing = price.map((n, i) => Math.max(0, n - (state.players[turn]?.tokens[i] ?? 0)));
        if (missing.every((n) => n === 0)) {
          await expect(
            page.locator(`.luster-market .luster-card[data-deck="${goal.deck}"][data-pos="${goal.pos}"]`),
          ).toHaveClass(/luster-card-affordable/);
          const purchase = actions.find(
            (action) =>
              action.type === 'buy' &&
              action.deck === goal.deck &&
              action.pos === goal.pos &&
              action.pay[5] === 1,
          );
          if (!purchase) throw new Error('No optional gold payment');
          await act(page, purchase);
          break;
        }
        const take = actions
          .filter(
            (action): action is Extract<LusterAction, { type: 'take' }> =>
              action.type === 'take' && action.tokens.every((n, i) => n <= (missing[i] ?? 0)),
          )
          .sort((x, y) => y.tokens.reduce((a, b) => a + b, 0) - x.tokens.reduce((a, b) => a + b, 0))[0];
        if (!take) throw new Error('Cannot collect the payment exercise gems');
        await act(page, take);
      } else {
        const publicCard = !publicReservationChecked ? state.market[2]?.[0] : undefined;
        const publicReserve = publicCard
          ? actions.find(
              (action) =>
                action.type === 'reserve' && action.deck === publicCard.deck && action.pos === publicCard.pos,
            )
          : undefined;
        const idle =
          publicReserve ??
          actions.find(
            (action) =>
              action.type === 'reserve' &&
              action.deck === 'tier-3' &&
              action.pos === state.decks['tier-3'].next,
          ) ??
          actions.find(
            (action) =>
              action.type === 'take' && action.tokens.every((n, i) => n === 0 || (price[i] ?? 0) === 0),
          );
        if (!idle) throw new Error('No preparation move');
        await act(page, idle);
        if (publicReserve && publicCard) {
          const ownCard = `.luster-your-hand .luster-card[data-deck="${publicCard.deck}"][data-pos="${publicCard.pos}"]`;
          await expect(page.locator(ownCard)).toHaveAttribute('data-card', String(publicCard.card));
          const back = `.luster-players [data-seat="${turn}"] > .luster-reservations .luster-card[data-deck="${publicCard.deck}"][data-pos="${publicCard.pos}"]`;
          for (const viewer of [...pages, spectator]) {
            await expect(viewer.locator(back)).toHaveAttribute('data-card', 'hidden');
            await expect(viewer.locator(back).locator('svg, button, .luster-card-cost')).toHaveCount(0);
          }
          await page.reload();
          await expect(page.locator(ownCard)).toHaveAttribute('data-card', String(publicCard.card), {
            timeout: 120_000,
          });
          await expect(page.locator(back)).toHaveAttribute('data-card', 'hidden');
          publicReservationChecked = true;
        }
      }
      const seq = Number(await board(page).getAttribute('data-seq'));
      for (const other of pages)
        await expect
          .poll(async () => Number(await board(other).getAttribute('data-seq')))
          .toBeGreaterThanOrEqual(seq);
    }
    expect(publicReservationChecked).toBe(true);
    expect(goldPaymentsChecked.has(seats)).toBe(true);
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
    expect(goldPaymentsChecked.has(seats)).toBe(true);
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
      await expect(p.getByRole('button', { name: 'Take gems', exact: true })).toBeDisabled();
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
