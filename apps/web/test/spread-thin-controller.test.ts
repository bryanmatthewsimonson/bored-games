/*
 * Spread Thin through real controllers against the dev relay (D096): one move can owe several share duties in turn
 * (the drawn field cards, then each spread card), all at one head. The duty loop's guard once took the second for a
 * repeat of the first and stopped with "the duty is still due after its event was sent"; it now keys a share duty
 * by its positions too. Two controllers play until turn 3.
 */
import type { SpreadState } from '@bored-games/spread-thin';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Harness, pause, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

it('two controllers play through the draws and the spread to turn 3, each share sent once', {
  timeout: 600_000,
}, async () => {
  const { rootId, bySeat } = await h.start2('spread-thin', h.profile('a'), h.profile('b'));
  const games = bySeat.map((p) => h.game(rootId, p.deps));
  for (let step = 0; step < 60; step++) {
    const s = games[0]?.view.value?.state as SpreadState | null | undefined;
    if (s && s.turnNo >= 3) break;
    const g = await waitFor(
      `a decision at step ${step}`,
      () => {
        for (const x of games)
          if (x.error.value !== null)
            throw new Error(
              `controller error: ${x.error.value}; pending ${JSON.stringify(x.view.value?.pending)}; dealt ${JSON.stringify((x.view.value?.state as SpreadState | null)?.dealt?.slice(-4))}`,
            );
        return games.find((x) => x.legal.value.length > 0 && x.status.value === 'your-turn');
      },
      240_000,
    );
    const legal = g.legal.value as { type: string }[];
    const a = legal.find((x) => x.type === 'end') ?? legal.find((x) => x.type === 'pass') ?? legal[0];
    await g.act(a);
    await pause(50);
  }
  const s = games[0]?.view.value?.state as SpreadState;
  expect(s.turnNo).toBeGreaterThanOrEqual(3);
});
