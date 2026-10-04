import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bank } from '../src/index.ts';
import { type BankGolden, gameList, hashGame } from './golden-v1/play.ts';

/*
 * Bank 0.1.0 golden fixtures (protocol v2 build plan, T1 and D-C): games recorded from the engine as it was before
 * Bank 0.2.0 (T5), replayed action by action. Every step must give the same hashes of the state, of what the session
 * reads from the engine, of the events and of the probe answers. Never regenerate the fixture to make this pass: a
 * difference means Bank 0.1.0, which v1 games in progress still fold with, has changed (V2-53).
 */

interface Fixture {
  version: string;
  games: BankGolden[];
}

const fixture = JSON.parse(
  readFileSync(new URL('./golden-v1/bank-0.1.0.json', import.meta.url), 'utf8'),
) as Fixture;

/** The engine the fixtures pin: Bank 0.1.0 (after T5, the 0.1.0 variant, not the current `bank`). */
const ENGINE = bank;

describe('Bank 0.1.0 golden fixtures', () => {
  it('cover every seat count from 2 to 6, with the recorded seeds and rules', () => {
    expect(fixture.version).toBe('0.1.0');
    expect(ENGINE.version).toBe(fixture.version);
    expect(fixture.games.map(({ seed, seats, rules }) => ({ seed, seats, rules }))).toEqual(gameList(4));
  });

  for (const g of fixture.games) {
    it(`V2-53 (v1 half) Bank 0.1.0 replays ${g.seed} (${g.seats} seats, ${g.rules.rounds} rounds, ${g.rules.banking}) step for step`, () => {
      const got = hashGame(ENGINE, g.seats, g.rules, g.actions);
      expect(got.setup).toBe(g.setup);
      expect(got.steps.length).toBe(g.steps.length);
      for (const [i, step] of g.steps.entries()) expect({ i, step: got.steps[i] }).toEqual({ i, step });
      expect(got.outcome).toEqual(g.outcome);
      expect(ENGINE.pending(got.state)).toEqual({ type: 'over' });
    });
  }
});
