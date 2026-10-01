import { describe, it } from 'vitest';
import { runFlow } from './flow.ts';

describe('end-to-end deck flow', () => {
  // About 28 s on the dev container, close to the project's 60 s default under load, so it keeps its own limit.
  it('6 seats: keys, shuffles, deal, private and public cards, audit', { timeout: 180_000 }, () => {
    runFlow(6, 'flow-6');
  });
});
