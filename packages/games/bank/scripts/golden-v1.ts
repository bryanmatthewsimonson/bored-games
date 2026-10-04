/**
 * node packages/games/bank/scripts/golden-v1.ts
 *
 * Records the Bank 0.1.0 golden fixtures (protocol v2 build plan, T1 and D-C) into
 * packages/games/bank/test/golden-v1/bank-0.1.0.json, from the current engine: seeded games over every seat count,
 * with per-step hashes (see test/golden-v1/play.ts). Recorded once, before the Bank 0.2.0 refactor (T5), and never
 * regenerated during the v2 build: `golden-v1.test.ts` holds Bank 0.1.0 to them.
 */
import { writeFileSync } from 'node:fs';
import { bank } from '../src/index.ts';
import { type BankGolden, gameList, hashGame, playGame } from '../test/golden-v1/play.ts';

/** Seeds per seat count. */
const PER_SEATS = 4;

const games: BankGolden[] = gameList(PER_SEATS).map(({ seed, seats, rules }) => {
  const actions = playGame(bank, seed, seats, rules);
  const { setup, steps, outcome } = hashGame(bank, seats, rules, actions);
  return { seed, seats, rules, setup, actions, steps, outcome };
});
const lines = [
  '{',
  ` "version": ${JSON.stringify(bank.version)},`,
  ' "games": [',
  games
    .map((g) => {
      const { actions, steps, ...head } = g;
      return [
        `  {${JSON.stringify(head).slice(1, -1)},`,
        `   "actions": [${actions.map((a) => JSON.stringify(a)).join(', ')}],`,
        `   "steps": [${steps.map((s) => JSON.stringify(s)).join(', ')}]}`,
      ].join('\n');
    })
    .join(',\n'),
  ' ]',
  '}',
  '',
];
const text = lines.join('\n');
writeFileSync(new URL('../test/golden-v1/bank-0.1.0.json', import.meta.url), text);
const steps = games.reduce((n, g) => n + g.steps.length, 0);
console.log(`${games.length} games, ${steps} steps, ${(text.length / 1024).toFixed(0)} KiB`);
