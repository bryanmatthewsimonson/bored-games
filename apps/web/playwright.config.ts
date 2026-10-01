/*
 * Playwright config for the end-to-end test. Run it through `pnpm e2e` (apps/web/e2e/run.ts), which starts the
 * dev relay and `vite preview` and passes their URLs in E2E_RELAY and E2E_BASE_URL.
 *
 * The browser is the Chromium build that matches the pinned @playwright/test (`pnpm --filter @bored-games/web
 * exec playwright install chromium` fetches it). E2E_CHROMIUM points at another Chromium binary instead.
 */
import { defineConfig, devices } from '@playwright/test';

const chromium = process.env.E2E_CHROMIUM;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  // One game, three players, shuffle and deal proofs: minutes, not seconds.
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(chromium !== undefined && chromium !== '' ? { launchOptions: { executablePath: chromium } } : {}),
  },
});
