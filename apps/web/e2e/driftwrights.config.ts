import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
/** Reference engine/UI fixture. This intentionally does not claim to exercise Nostr transport. */
export default defineConfig({
  testDir: '.',
  testMatch: 'driftwrights-reference.ref.ts',
  timeout: 300_000,
  workers: 1,
  outputDir: '../test-results/driftwrights-reference',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5187',
    actionTimeout: 10_000,
    viewport: { width: 1280, height: 1000 },
    launchOptions: { executablePath: process.env.E2E_CHROMIUM ?? '/usr/bin/chromium' },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: '../../node_modules/.bin/vite --host 127.0.0.1 --port 5187 --strictPort',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: false,
  },
});
