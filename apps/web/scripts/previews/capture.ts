/*
 * `pnpm previews`: the game-page screenshots (D086). For each game it plays one deterministic fuzz game with the
 * game's own policies (`tools/fuzz/src/previews.ts`), keeps seat 0's view at a few of its turns, renders each with
 * the real game screen in `harness.html` and saves a JPEG to `public/previews/<game>-<n>.jpg`. Same seeds, same
 * pictures: rerun it after a game's screen changes. `pnpm previews <game> …` redoes only those games.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import {
  type PreviewPlan,
  previewSnapshots,
  QUILL_PREVIEW_POLICY,
} from '../../../../tools/fuzz/src/previews.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const webDir = fileURLToPath(new URL('../..', import.meta.url));
const outDir = fileURLToPath(new URL('../../public/previews/', import.meta.url));

/** The game, seed and seat count behind each game's pictures, and how far into seat 0's turns each one is. */
export const PLANS: readonly PreviewPlan[] = [
  { game: 'chain-reaction', seed: 'preview-1', seats: 4, at: [0.25, 0.55, 0.85] },
  { game: 'chess', seed: 'preview-1', seats: 2, at: [0.25, 0.55, 0.85] },
  // Seed 1's random bankers let one pot run to five figures; seed 6 plays like a table.
  { game: 'bank', seed: 'preview-6', seats: 4, at: [0.25, 0.55, 0.85] },
  { game: 'luster', seed: 'preview-1', seats: 3, at: [0.25, 0.55, 0.85] },
  { game: 'right-of-way', seed: 'preview-1', seats: 4, at: [0.25, 0.55, 0.85] },
  { game: 'driftwrights', seed: 'preview-1', seats: 3, at: [0.25, 0.55, 0.85] },
  { game: 'holler', seed: 'preview-1', seats: 4, at: [0.25, 0.55, 0.85] },
  { game: 'room-for-doubt', seed: 'preview-1', seats: 4, at: [0.25, 0.55, 0.85] },
  // Real words: the fuzz policy lays any letters, which is right for testing and wrong for a picture.
  {
    game: 'quill-and-quarry',
    seed: 'preview-1',
    seats: 3,
    at: [0.35, 0.65, 0.95],
    policies: [QUILL_PREVIEW_POLICY],
  },
  { game: 'gilt-and-guile', seed: 'preview-1', seats: 3, at: [0.25, 0.55, 0.85] },
  // Early (the claim), the middle of the game, and late, with charters in hand.
  { game: 'hazard', seed: 'preview-1', seats: 4, at: [0.004, 0.5, 0.85] },
  // Placing in an early round, bringing people home mid-game, and a late round with a legacy built.
  // Dice shares go out by themselves, so they are not pictured.
  { game: 'sticks-and-stones', seed: 'preview-1', seats: 4, at: [0.12, 0.5, 0.88], skip: ['contribute'] },
  // Round 1's auction, a fuel purchase mid-game and wiring in Era III. Dice shares go out by themselves, so they
  // are not pictured.
  { game: 'current-affairs', seed: 'preview-1', seats: 4, at: [0.04, 0.54, 0.72], skip: ['contribute'] },
  // The opening turn, the middle of the game and a late, crowded board.
  { game: 'spread-thin', seed: 'preview-1', seats: 4, at: [0, 0.5, 0.9] },
];

const WIDTH = 1280;
const HEIGHT = 860;

const only = process.argv.slice(2);
const plans = only.length === 0 ? PLANS : PLANS.filter((p) => only.includes(p.game));
const shots = plans.flatMap((plan) =>
  previewSnapshots(plan).map((snap, n) => ({ snap, file: `${plan.game}-${n + 1}.jpg` })),
);
const snapshotsFile = `${here}snapshots.json`;
writeFileSync(snapshotsFile, JSON.stringify(shots.map((s) => s.snap)));
mkdirSync(outDir, { recursive: true });

const server = await createServer({
  root: webDir,
  logLevel: 'error',
  server: { port: 0, strictPort: false },
});
await server.listen();
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers'
    ? { executablePath: '/opt/pw-browsers/chromium' }
    : {},
);
try {
  if (url === undefined) throw new Error('the vite server has no local url');
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => console.error(`[previews] page error: ${e.message}`));
  for (const [i, shot] of shots.entries()) {
    await page.goto(`${url}scripts/previews/harness.html?i=${i}`);
    await page.waitForSelector('html[data-ready="1"]');
    await page.waitForTimeout(400);
    // The game screen's own extent, so the picture has no empty margin.
    const box = await page.evaluate(() => {
      const rects = [...(document.getElementById('main')?.children ?? [])].map((el) =>
        el.getBoundingClientRect(),
      );
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return { left, right, bottom };
    });
    const pad = 16;
    const x = Math.max(0, Math.floor(box.left - pad));
    const width = Math.min(WIDTH, Math.ceil(box.right + pad)) - x;
    const height = Math.min(HEIGHT, Math.ceil(box.bottom + pad));
    await page.screenshot({
      path: `${outDir}${shot.file}`,
      type: 'jpeg',
      quality: 82,
      clip: { x, y: 0, width, height },
    });
    console.log(`[previews] ${shot.file} (step ${shot.snap.step})`);
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(snapshotsFile, { force: true });
}
