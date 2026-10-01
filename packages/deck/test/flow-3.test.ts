import { describe, it } from 'vitest';
import { runFlow } from './flow.ts';

describe('end-to-end deck flow', () => {
  it('3 seats: keys, shuffles, deal, private and public cards, audit', () => {
    runFlow(3, 'flow-3');
  });
});
