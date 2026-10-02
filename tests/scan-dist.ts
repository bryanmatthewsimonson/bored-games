/*
 * `pnpm scan:dist [dir]`: scan an existing build (default apps/web/dist) for every restricted name and every
 * licensed pack string (D046), without building. Exits 1 and lists the files when anything is found, and when the
 * directory is missing or empty. The Pages workflow runs it between the build and the upload, so nothing it finds
 * can be deployed; `pnpm check` runs the same scan on a fresh public build (public-build.test.ts).
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { filesUnder, licensedPackStrings, scanDir } from './restricted-names.ts';

const root = join(import.meta.dirname, '..');
const dir = resolve(process.argv[2] ?? join(root, 'apps/web/dist'));

if (!existsSync(dir) || filesUnder(dir).length === 0) {
  console.error(`scan:dist: ${dir} is missing or empty; build it first (pnpm build:web).`);
  process.exit(1);
}
const strings = await licensedPackStrings(root);
if (strings.length === 0) {
  console.error('scan:dist: found no licensed pack strings to scan for; is a licensed/ directory missing?');
  process.exit(1);
}
const hits = scanDir(dir, strings);
if (hits.length > 0) {
  console.error(`scan:dist: restricted names in ${dir}. Do not deploy this build.`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(
  `scan:dist: ${filesUnder(dir).length} files in ${dir}: no restricted names (${strings.length} pack strings).`,
);
