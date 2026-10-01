import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const here = import.meta.dirname;
const rulesPath = join(here, '../../../../docs/games/tilestock/RULES.md');
const catalogDir = join(here, 'catalog');

it('every catalog entry in RULES.md has a named test, and every catalog test is documented', () => {
  const documented = [...readFileSync(rulesPath, 'utf8').matchAll(/^#### (C\d{2}) /gm)].map((m) => m[1]);
  const tested = readdirSync(catalogDir)
    .filter((f) => f.endsWith('.test.ts'))
    .flatMap((f) =>
      [...readFileSync(join(catalogDir, f), 'utf8').matchAll(/\bit\('(C\d{2}) /g)].map((m) => m[1]),
    );
  expect(documented.length).toBeGreaterThan(50);
  expect(new Set(documented).size).toBe(documented.length);
  expect(new Set(tested).size).toBe(tested.length);
  expect(documented.filter((id) => !tested.includes(id))).toEqual([]);
  expect(tested.filter((id) => !documented.includes(id))).toEqual([]);
});
