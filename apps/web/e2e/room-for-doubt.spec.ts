import {
  BOARD_SIZE,
  CORRIDOR,
  DOORS,
  EXHIBITS,
  type ExhibitId,
  PARTIES,
  type PartyId,
  type RfdAction,
  SCENES,
  type SceneId,
  squareIndex,
} from '@bored-games/room-for-doubt';
import { COMPARE_BGG_ID, COMPARE_PHRASE } from '@bored-games/room-for-doubt/compare';
import { ROOM_FOR_DOUBT_THEME as THEME } from '@bored-games/room-for-doubt/theme';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';

/*
 * Room for Doubt end to end (D078): three players and a spectator, each in a browser context of its own, over
 * the dev relay. The case deck is shuffled in the browsers in two rounds (D076) and dealt; the table requires a
 * submission on entering a room. Every roll gathers a share from each open app (D058); a shown card goes to the
 * submitter alone (D077), and a rebuttal with one possible answer goes out by itself (ruling 7). The test driver
 * reads every player's screen: until it has seen a player choose which card to show and an answer sent with no
 * click, a submission names cards from the other hands to bring that about. Seat 0 then indicts naming a card it
 * holds, so the Verdict dismisses it; seat 1 indicts the three cards no hand holds, which it can read only through
 * seat 0's sealed shares, and wins. Privacy after the first show (for a late spectator too), a reload, 390 px at
 * four points, the deck audit and the signed result are checked. Run it with `pnpm e2e room-for-doubt.spec.ts`.
 */

const root = (p: Page) => p.getByTestId('rfd-game');
const url = (profile: string, from?: string) => {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  u.searchParams.set('relays', process.env.E2E_RELAY ?? 'ws://localhost:7777');
  return u.toString();
};
const seqOf = async (p: Page) => Number(await root(p).getAttribute('data-seq'));
const record = (p: Page) => root(p).locator('ol.rfd-record > li');

async function open(browser: Browser, profile: string, errors: string[], from?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${profile}] ${e.message}`));
  await page.goto(url(profile, from));
  return page;
}

/**
 * At 390 px the page never scrolls sideways; with `board`, not with the board enlarged either (the board scrolls
 * in its own frame).
 */
async function mobile(page: Page, file: string, board = false) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (board) {
    await root(page).getByRole('button', { name: 'Enlarge board', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await root(page).getByRole('button', { name: 'Fit board', exact: true }).click();
  }
  await page.screenshot({ path: `/tmp/rfd-${file}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
}

/** The enabled controls of `page` that send a move, as the actions they send. */
async function choices(page: Page): Promise<RfdAction[]> {
  return root(page)
    .locator('[data-action]')
    .evaluateAll((elements) =>
      elements
        .filter((e) => !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true')
        .map((e) => JSON.parse(e.getAttribute('data-action') ?? '{}') as RfdAction),
    );
}

const isRoom = (place: string): place is SceneId => (SCENES as readonly string[]).includes(place);
const isMarker = (a: RfdAction): boolean => a.type === 'show' && 'pos' in a;
/** A rebuttal with one possible answer, which the app sends without a click (ruling 7). */
const forced = (all: readonly RfdAction[]): boolean =>
  all.length === 1 && all[0] !== undefined && (all[0].type === 'none' || isMarker(all[0]));

/** Steps from each corridor square to the nearest doorstep: the walk heads for a room when none is in reach. */
const TO_DOOR: ReadonlyMap<number, number> = (() => {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const d of DOORS)
    if (!dist.has(d.step)) {
      dist.set(d.step, 0);
      queue.push(d.step);
    }
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as number;
    const x = at % BOARD_SIZE;
    const near = [at - BOARD_SIZE, at + BOARD_SIZE, x > 0 ? at - 1 : -1, x < BOARD_SIZE - 1 ? at + 1 : -1];
    for (const n of near)
      if (CORRIDOR.has(n) && !dist.has(n)) {
        dist.set(n, (dist.get(at) ?? 0) + 1);
        queue.push(n);
      }
  }
  return dist;
})();

/** The walk's square nearest a door, or null when there is no square to walk to. */
function nearestSquare(all: readonly RfdAction[]): RfdAction | null {
  let best: RfdAction | null = null;
  let steps = Number.POSITIVE_INFINITY;
  for (const a of all) {
    if (a.type !== 'move') continue;
    const square = squareIndex(a.to);
    const d = square === null ? undefined : TO_DOOR.get(square);
    if (d !== undefined && d < steps) {
      best = a;
      steps = d;
    }
  }
  return best;
}

/**
 * The simple policy's choice: a room to walk into, a card to show, none, a submission (the form's default Party
 * and Exhibit, unless the loop steers it), the roll (or stay, when walled in), the square nearest a door, the end
 * of the turn, the Verdict.
 */
function pick(all: readonly RfdAction[]): RfdAction | null {
  return (
    all.find((a) => a.type === 'move' && isRoom(a.to)) ??
    all.find(isMarker) ??
    all.find((a) => a.type === 'none') ??
    all.find((a) => a.type === 'submit') ??
    all.find((a) => a.type === 'roll' || a.type === 'stay') ??
    nearestSquare(all) ??
    all.find((a) => a.type === 'endTurn') ??
    all.find((a) => a.type === 'verdict') ??
    null
  );
}

/**
 * The Party and Exhibit a submission by `seat`, standing in `scene`, names to bring about a rebuttal the test has
 * not seen yet, reading every hand (`held`, by seat; three seats, asked in turn from the submitter's left):
 * - `choice`: the answering seat holds two or more named cards, so its player picks one to show (a click), best
 *   after a seat with none of them has passed;
 * - `forced`: an answer the app sends alone (ruling 7): a seat with none passes, or the answering seat holds one.
 * Null when no Party and Exhibit bring it about: the form's defaults are kept.
 */
function steer(
  held: readonly ReadonlySet<string>[],
  seat: number,
  scene: string,
  want: 'choice' | 'forced',
): { party: PartyId; exhibit: ExhibitId } | null {
  let best: { party: PartyId; exhibit: ExhibitId } | null = null;
  let bestScore = 0;
  for (const [i, party] of PARTIES.entries())
    for (const [j, exhibit] of EXHIBITS.entries()) {
      const named = [THEME.parties[i]?.name ?? '', THEME.exhibits[j] ?? '', scene];
      let passed = 0;
      let shown = 0;
      for (const k of [1, 2]) {
        shown = named.filter((card) => held[(seat + k) % 3]?.has(card) === true).length;
        if (shown > 0) break;
        passed++;
      }
      const score = want === 'choice' ? (shown >= 2 ? 1 + passed : 0) : passed > 0 || shown === 1 ? 1 : 0;
      if (score > bestScore) {
        best = { party, exhibit };
        bestScore = score;
      }
    }
  return best;
}

/** Click the control that sends `action`, then wait for the move to land on `page`. */
async function act(page: Page, action: RfdAction) {
  const before = await seqOf(page);
  await root(page)
    .locator(`[data-action=${JSON.stringify(JSON.stringify(action))}]`)
    .first()
    .click();
  await expect.poll(() => seqOf(page), { timeout: 120_000 }).toBeGreaterThan(before);
}

/** Each page's stage, turn, seq, pending seat and status line, for a failure message. */
async function snapshot(pages: readonly Page[]): Promise<string> {
  const rows = await Promise.all(
    pages.map(async (p) => {
      const r = root(p);
      if ((await r.count()) === 0) return `${p.url()}: no game screen`;
      const [seat, stage, turn, seq, pending] = await Promise.all(
        ['data-my-seat', 'data-stage', 'data-turn', 'data-seq', 'data-pending-seat'].map((k) =>
          r.getAttribute(k),
        ),
      );
      const status = await r.locator('.rfd-status').textContent();
      const meta = await r.locator('.rfd-meta').textContent();
      const options = JSON.stringify(await choices(p));
      return `seat ${seat}: ${stage} turn ${turn} seq ${seq} pending ${pending} | ${status} | ${meta} | ${options}`;
    }),
  );
  return rows.join('\n');
}

/** The names of the cards in `page`'s hand, once it knows all of them. */
async function handNames(page: Page): Promise<string[]> {
  const hand = root(page).locator('.rfd-hand');
  await expect(hand.locator('[data-kind="back"]')).toHaveCount(0, { timeout: 120_000 });
  return hand.locator('.rfd-card-name').allTextContents();
}

/** The indictment form's three lists, Party, Exhibit and Scene, in that order. */
const lists = (form: Locator) => [0, 1, 2].map((i) => form.locator('select').nth(i));

/** Open the indictment form, let `choose` fill it, confirm, and send the final "Indict". */
async function indict(page: Page, choose: (form: Locator) => Promise<void>): Promise<RfdAction> {
  const form = root(page).locator('details.rfd-indict');
  await form.locator('summary').click();
  await choose(form);
  await form.getByRole('button', { name: 'Indict…', exact: true }).click();
  const final = form.locator('[data-action]');
  await expect(final).toBeEnabled();
  const action = JSON.parse((await final.getAttribute('data-action')) ?? '{}') as RfdAction;
  const before = await seqOf(page);
  await final.click();
  await expect.poll(() => seqOf(page), { timeout: 120_000 }).toBeGreaterThan(before);
  return action;
}

test('three players play Room for Doubt to the end', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const errors: string[] = [];
  const pages: Page[] = [];
  for (const profile of ['rfd-a', 'rfd-b', 'rfd-c']) pages.push(await open(browser, profile, errors));
  const a = pages[0] as Page;

  // 1. The table: three seats, submissions required on entering a room.
  await a.getByLabel('Search games').fill('Room for Doubt');
  await a.getByRole('link', { name: 'Room for Doubt', exact: true }).click();
  await expect(a.getByRole('link', { name: COMPARE_PHRASE, exact: true })).toHaveAttribute(
    'href',
    `https://boardgamegeek.com/boardgame/${COMPARE_BGG_ID}`,
  );
  await a.getByLabel('Players', { exact: true }).selectOption('3');
  await a
    .getByRole('group', { name: 'Submissions on entering a room' })
    .getByRole('radio', { name: 'Required', exact: true })
    .check();
  await a.getByRole('button', { name: 'Create table', exact: true }).click();
  await a.getByRole('button', { name: 'Create anyway', exact: true }).click();
  const share = await a.getByLabel('Table link').inputValue();
  for (const [i, page] of pages.entries()) {
    if (i === 0) continue;
    await page.goto(url(['rfd-a', 'rfd-b', 'rfd-c'][i] as string, share));
    await page.getByRole('button', { name: 'Join this table', exact: true }).click();
    await page.getByRole('button', { name: 'Join anyway', exact: true }).click();
  }
  await expect(a.getByText('Every seat is taken.')).toBeVisible();
  await a.getByRole('button', { name: 'Start game', exact: true }).click();
  await a.getByRole('button', { name: 'Yes, start the game', exact: true }).click();
  const started = Date.now();
  for (const p of pages) await expect(root(p)).toBeVisible({ timeout: 600_000 });
  console.log(`[rfd] the game screen after ${Math.round((Date.now() - started) / 1000)} s of setup`);
  const players: Page[] = [];
  for (const p of pages) players[Number(await root(p).getAttribute('data-my-seat'))] = p;
  expect(players.filter((p) => p !== undefined)).toHaveLength(3);
  const spectator = await open(browser, 'rfd-s', errors, a.url());
  await expect(root(spectator)).toBeVisible({ timeout: 600_000 });
  await expect(root(spectator)).toHaveAttribute('data-my-seat', 'spectator');
  await expect(spectator.locator('.rfd-hand')).toHaveCount(0);
  const everyone = [...players, spectator];

  // 2. A phone at the start, the board enlarged and fitted again.
  await mobile(a, 'start', true);

  // 3. The turn loop.
  const done = new Map<string, number>();
  const starts = [0, 0, 0];
  const startSeqs = new Set<number>();
  const indicted: (RfdAction | null)[] = [null, null];
  let actions = 0;
  let firstShow: { line: number; submitter: Page; card: string } | null = null;
  let reloaded: Page | null = null;
  let lateSpectator = false;
  let required = 0;
  /** Show markers clicked: a player chose which of two or more cards to show. */
  let clicked = 0;
  /** Whether an answer has gone out with no click (ruling 7): a "none" (always forced), or a show not clicked. */
  const autoAnswered = async (): Promise<boolean> => {
    const lines = await record(spectator).allTextContents();
    const shows = lines.filter((line) => line.includes(' showed a card.')).length;
    return lines.some((line) => line.includes(' had none.')) || shows > clicked;
  };
  let finished = false;
  for (let step = 0; step < 400; step++) {
    // Wait for a seat with a decision to click, or the end: dice shares, forced rebuttals and Verdict shares go out
    // by themselves meanwhile, and only move `data-seq` on.
    const next: { page: Page | null; options: RfdAction[] } = { page: null, options: [] };
    try {
      await expect
        .poll(
          async () => {
            if ((await root(spectator).getAttribute('data-stage')) === 'over') return true;
            for (const p of players) {
              const r = root(p);
              if ((await r.getAttribute('data-pending-seat')) !== (await r.getAttribute('data-my-seat')))
                continue;
              const options = await choices(p);
              if (options.length === 0 || forced(options)) continue;
              next.page = p;
              next.options = options;
              return true;
            }
            return false;
          },
          { timeout: 300_000, intervals: [250, 500, 1000] },
        )
        .toBe(true);
    } catch (e) {
      console.log(`[rfd] stalled after ${actions} actions:\n${await snapshot(everyone)}`);
      throw e;
    }
    const page = next.page;
    if (page === null) {
      finished = true;
      break;
    }
    const seat = Number(await root(page).getAttribute('data-my-seat'));
    const stage = (await root(page).getAttribute('data-stage')) ?? '';
    const seq = await seqOf(page);
    // Nothing moves until this decision is made: every page and the spectator reach the same point.
    for (const p of everyone) await expect.poll(() => seqOf(p), { timeout: 120_000 }).toBe(seq);

    // 4. Privacy, at the first show (Review Focus 1). The record lists the submissions first, one line each.
    if (firstShow === null) {
      const lines = await record(spectator).allTextContents();
      const line = lines.findIndex((t) => t.includes('showed a card.'));
      if (line >= 0) {
        const texts = await Promise.all(players.map((p) => record(p).nth(line).textContent()));
        const submitters = players.filter((_, i) => texts[i]?.includes('showed you'));
        const showers = players.filter((_, i) => texts[i]?.includes('You showed'));
        expect(submitters).toHaveLength(1);
        expect(showers).toHaveLength(1);
        const submitter = submitters[0] as Page;
        const shower = showers[0] as Page;
        const third = players.find((p) => p !== submitter && p !== shower) as Page;
        expect(third).toBeDefined();
        // The submitter reads the card (its packet opened); the shower reads what it showed, to whom.
        await expect(record(submitter).nth(line)).toContainText(/ showed you the [^.]+\.$/);
        await expect(record(shower).nth(line)).toContainText(/You showed .+ the [^.]+\.$/);
        const told = (await record(submitter).nth(line).textContent())?.match(
          / showed you (the [^.]+)\.$/,
        )?.[1];
        const showed = (await record(shower).nth(line).textContent())?.match(/ (the [^.]+)\.$/)?.[1];
        expect(told).toBeDefined();
        expect(showed).toBe(told);
        // The third seat and the spectator read only that a card was shown, and mark nothing as shown.
        for (const other of [third, spectator]) {
          await expect(record(other).nth(line)).toContainText('showed a card.');
          await expect(record(other).nth(line)).not.toContainText('showed you');
          await expect(record(other).nth(line)).not.toContainText('You showed');
          await expect(root(other).locator('.rfd-mark-shown')).toHaveCount(0);
        }
        await expect(root(submitter).locator('.rfd-mark-shown')).toHaveCount(1);
        await expect(spectator.locator('.rfd-hand')).toHaveCount(0);
        firstShow = { line, submitter, card: told as string };
        console.log(`[rfd] privacy checked at the first show: "${told}", record line ${line + 1}`);
      }
    }

    // 5. The reload, after the 10th action: the first show's submitter if there was one, whose card stays named.
    if (actions >= 10 && reloaded === null) {
      reloaded = firstShow?.submitter ?? a;
      await reloaded.reload();
      await expect(root(reloaded)).toBeVisible({ timeout: 300_000 });
      await expect.poll(() => seqOf(reloaded as Page), { timeout: 300_000 }).toBe(seq);
      if (firstShow !== null)
        await expect(record(reloaded).nth(firstShow.line)).toContainText(` showed you ${firstShow.card}.`);
      await mobile(reloaded, 'mid');
      console.log(`[rfd] reloaded seat ${players.indexOf(reloaded)} at seq ${seq}`);
      // The loop looks again: the reloaded page's controls come back once it has caught up.
      continue;
    }

    // A spectator who joins after the first show folds it from the relay, and reads only that a card was shown.
    if (firstShow !== null && reloaded !== null && !lateSpectator) {
      const late = await open(browser, 'rfd-late', errors, a.url());
      await expect(root(late)).toBeVisible({ timeout: 300_000 });
      await expect.poll(() => seqOf(late), { timeout: 300_000 }).toBe(seq);
      const line = record(late).nth(firstShow.line);
      await expect(line).toContainText('showed a card.');
      await expect(line).not.toContainText('showed you');
      await expect(line).not.toContainText('You showed');
      await expect(late.locator('.rfd-hand')).toHaveCount(0);
      await expect(root(late).locator('.rfd-mark-shown')).toHaveCount(0);
      await late.context().close();
      lateSpectator = true;
      console.log(`[rfd] a late spectator reads the first show as "showed a card."`);
    }

    // The indictments: seat 0 at its third turn start, once the rebuttals above have been seen (later otherwise),
    // then seat 1 at its next start.
    if (stage === 'start' && !startSeqs.has(seq)) {
      startSeqs.add(seq);
      starts[seat] = (starts[seat] ?? 0) + 1;
    }
    if (
      stage === 'start' &&
      seat === 0 &&
      indicted[0] === null &&
      (starts[0] ?? 0) >= 3 &&
      lateSpectator &&
      clicked > 0 &&
      (await autoAnswered())
    ) {
      // A card the indicter holds is never in the Verdict, so this indictment is surely dismissed.
      indicted[0] = await indict(page, async (form) => {
        for (const list of lists(form)) {
          const held = await list.evaluate(
            (el) =>
              [...(el as HTMLSelectElement).options].find((o) => o.text.endsWith('(your card)'))?.value ??
              null,
          );
          if (held !== null) {
            await list.selectOption(held);
            return;
          }
        }
        throw new Error('seat 0 holds no card');
      });
      actions++;
      console.log(`[rfd] #${actions} seat 0 indicts ${JSON.stringify(indicted[0])}`);
      continue;
    }
    if (
      stage === 'start' &&
      seat === 1 &&
      indicted[0] !== null &&
      indicted[1] === null &&
      (starts[1] ?? 0) >= 3
    ) {
      // The Verdict is the one Party, Exhibit and Scene no hand holds: seat 1 names it and reads it to be sure.
      const held = new Set((await Promise.all(players.map(handNames))).flat());
      expect(held.size).toBe(18);
      const verdict = [
        THEME.parties.map((x) => x.name).filter((n) => !held.has(n)),
        THEME.exhibits.filter((n) => !held.has(n)),
        THEME.scenes.filter((n) => !held.has(n)),
      ].map((names) => {
        expect(names).toHaveLength(1);
        return names[0] as string;
      });
      indicted[1] = await indict(page, async (form) => {
        for (const [i, list] of lists(form).entries())
          await list.selectOption({ label: verdict[i] as string });
      });
      actions++;
      console.log(`[rfd] #${actions} seat 1 indicts ${JSON.stringify(indicted[1])}`);
      // Seat 0's sealed shares and seat 2's shares reach seat 1, which alone reads the three cards.
      await expect(root(page).locator('.rfd-verdict .rfd-card-name')).toHaveText(verdict, {
        timeout: 300_000,
      });
      for (const other of [players[2] as Page, spectator])
        await expect(root(other).locator('.rfd-verdict, .rfd-cards')).toHaveCount(0);
      continue;
    }

    let action = pick(next.options);
    if (action === null) throw new Error(`no choice among ${JSON.stringify(next.options)}`);
    if (action.type === 'verdict') {
      // The first indictment named a held card, the second the true Verdict.
      expect(action.upheld).toBe(seat === 1);
      await expect(root(page).locator('.rfd-verdict .rfd-card-name')).toHaveCount(3);
    }
    if (action.type === 'submit' && (clicked === 0 || !(await autoAnswered()))) {
      // Until both kinds of rebuttal have been seen, the submission names cards from the other hands to bring the
      // missing one about; then the form's defaults.
      const want = clicked === 0 ? 'choice' : 'forced';
      const title = (await root(page).locator('#rfd-submit-title').textContent()) ?? '';
      const held = await Promise.all(players.map(async (p) => new Set(await handNames(p))));
      const steered = steer(held, seat, title.replace(/^Submit in the /, ''), want);
      if (steered !== null) {
        const form = root(page).locator('form.rfd-submit');
        await form.locator('select').nth(0).selectOption(steered.party);
        await form.locator('select').nth(1).selectOption(steered.exhibit);
        const button = form.locator('button[type="submit"]');
        const sent = async () => JSON.parse((await button.getAttribute('data-action')) ?? '{}') as RfdAction;
        await expect.poll(sent).toEqual({ type: 'submit', actor: seat, ...steered });
        action = await sent();
        console.log(`[rfd] the submission names other players' cards, for a ${want} rebuttal`);
      }
    }
    await act(page, action);
    actions++;
    if (isMarker(action)) clicked++;
    const what = action.type === 'move' && isRoom(action.to) ? 'room' : action.type;
    done.set(what, (done.get(what) ?? 0) + 1);
    console.log(`[rfd] #${actions} seat ${seat} ${stage}: ${JSON.stringify(action)}`);
    if (what === 'room') {
      // Required submissions: the status line asks for one, and there is no "End turn" until it is made.
      await expect(root(page).locator('.rfd-status')).toHaveText(/^Your turn: submit in the [^.]+\.$/);
      await expect(root(page).locator('[data-action*="endTurn"]')).toHaveCount(0);
      required++;
    }
  }
  expect(finished).toBe(true);
  console.log(`[rfd] ${actions} actions: ${JSON.stringify(Object.fromEntries(done))}`);
  expect(firstShow).not.toBeNull();
  expect(reloaded).not.toBeNull();
  expect(lateSpectator).toBe(true);
  expect(required).toBeGreaterThan(0);
  expect(done.get('submit') ?? 0).toBeGreaterThan(0);
  expect(clicked).toBeGreaterThan(0);
  expect(await autoAnswered()).toBe(true);
  expect(indicted[0]).not.toBeNull();
  expect(indicted[1]).not.toBeNull();

  // 6. The end: seat 1's indictment was upheld after seat 0's was dismissed.
  for (const [seat, p] of everyone.entries()) {
    await expect(p.getByText('Deck audit passed.', { exact: true })).toBeVisible({ timeout: 300_000 });
    await expect(p.getByText('Result confirmed: signed by all 3 players.', { exact: true })).toBeVisible({
      timeout: 300_000,
    });
    await expect(root(p).locator('.rfd-status')).toHaveText(
      seat === 1 ? 'You win: the indictment is upheld.' : /. wins: the indictment is upheld\.$/,
    );
    await expect(root(p).locator('li.rfd-player[data-seat="1"] .rfd-place')).toHaveText('#1');
    await expect(root(p).locator('li.rfd-player[data-seat="0"]')).toContainText('dismissed');
    await expect(record(p).filter({ hasText: 'The indictment was dismissed.' })).toHaveCount(1);
    await expect(record(p).filter({ hasText: 'The indictment was upheld.' })).toHaveCount(1);
  }
  await a.screenshot({ path: '/tmp/rfd-end-1280.png', fullPage: true });
  await mobile(a, 'end');

  // 7. The rules page's online section.
  await a.goto(`${url('rfd-a')}#/rules/room-for-doubt/online`);
  await expect(a.getByRole('heading', { name: 'Playing on this site' })).toBeVisible();
  await mobile(a, 'rules');
  expect(errors).toEqual([]);
  for (const p of everyone) await p.context().close();
});
