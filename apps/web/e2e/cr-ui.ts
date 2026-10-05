/*
 * Shared by the Chain Reaction specs (play.spec.ts and v1.spec.ts): the play screen's attributes and the decision
 * form, answered with its first legal option.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** MOVE_MS: one decision, including relay round trips. */
const MOVE_MS = 60_000;

export interface Player {
  name: string;
  page: Page;
}

export const game = (p: Player): Locator => p.page.getByTestId('cr-game');

export async function stateOf(p: Player): Promise<{ seq: number; turn: number; phase: string }> {
  const g = game(p);
  return {
    seq: Number(await g.getAttribute('data-seq')),
    turn: Number(await g.getAttribute('data-turn')),
    phase: (await g.getAttribute('data-phase')) ?? '',
  };
}

/** The player's enabled decision form, if it is their decision now. */
export const openDecision = (p: Player): Locator => p.page.locator('.cr-decision fieldset:not([disabled])');

/** Wait until one of the players holds a decision; returns that player. */
export async function nextToAct(players: readonly Player[]): Promise<Player> {
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
export async function decide(p: Player, declare = false): Promise<string> {
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
