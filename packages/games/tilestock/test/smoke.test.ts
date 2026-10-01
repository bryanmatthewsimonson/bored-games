import { expect, it } from 'vitest';
import { kit } from '../src/index.ts';

it('smoke', () => {
  expect(kit).toBe('0.0.0');
});
