import { expect, it } from 'vitest';
import { BRAND } from '../src/brand.ts';

it('has a platform name', () => {
  expect(BRAND.name.length).toBeGreaterThan(0);
});
