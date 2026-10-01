/*
 * `pnpm e2e`: the end-to-end browser test, self-contained.
 *
 * 1. Starts the in-memory dev relay on a free port (in this process).
 * 2. Builds apps/web into apps/web/dist-e2e (with `VITE_ALLOW_LINK_RELAYS=1`, so it never lands in the deployable
 *    apps/web/dist) and serves it with `vite preview` on another free port.
 * 3. Runs Playwright (apps/web/playwright.config.ts) with E2E_BASE_URL and E2E_RELAY set.
 * 4. Stops both servers, whatever happened, and exits with Playwright's exit code.
 *
 * Extra arguments go to `playwright test` (for example `pnpm e2e --headed`). Set E2E_SKIP_BUILD=1 to reuse
 * an existing apps/web/dist-e2e.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { startDevRelay } from '../../../tools/dev-relay/src/server.ts';

const webDir = fileURLToPath(new URL('..', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: webDir, stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal !== null ? 1 : 0)));
  });
}

async function waitForHttp(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) throw new Error(`${url} did not answer within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Stop `child` and everything it started: `pnpm exec` does not pass a signal on to vite, so the child runs in its
 * own process group and the whole group is signalled.
 */
function stop(child: ChildProcess | null): Promise<void> {
  if (child === null || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const signal = (sig: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      // Already gone.
    }
  };
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    signal('SIGTERM');
    setTimeout(() => signal('SIGKILL'), 3000).unref();
  });
}

/** The e2e build's own output directory, under apps/web: a flag-enabled build must not replace dist. */
const OUT_DIR = 'dist-e2e';

const relay = await startDevRelay({ port: 0 });
console.log(`[e2e] dev relay on ${relay.url}`);
let preview: ChildProcess | null = null;
let code = 1;
try {
  if (process.env.E2E_SKIP_BUILD !== '1') {
    // The test points each page at the in-process relay with `?relays=`, which only such a build honours.
    const built = await run('pnpm', ['exec', 'vite', 'build', '--outDir', OUT_DIR, '--emptyOutDir'], {
      ...process.env,
      VITE_ALLOW_LINK_RELAYS: '1',
    });
    if (built !== 0) throw new Error(`the web build failed (exit ${built})`);
  }
  const port = await freePort();
  const baseUrl = `http://localhost:${port}/`;
  preview = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--outDir', OUT_DIR, '--port', String(port), '--strictPort'],
    {
      cwd: webDir,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    },
  );
  await waitForHttp(baseUrl, 30_000);
  console.log(`[e2e] app on ${baseUrl}`);
  code = await run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
    ...process.env,
    E2E_BASE_URL: baseUrl,
    E2E_RELAY: relay.url,
  });
} catch (e) {
  console.error(`[e2e] ${e instanceof Error ? e.message : String(e)}`);
  code = 1;
} finally {
  await stop(preview);
  await relay.close();
}
process.exit(code);
