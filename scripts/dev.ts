/*
 * `pnpm dev`: the local relay and the Vite dev server together, with no extra dependency.
 * Ctrl-C stops both. If either exits, the other is stopped too. Each runs in its own process group (except on
 * Windows), so stopping it also stops the server that `pnpm` started under it, and no orphan keeps its port.
 * Without a `relay` script (it comes from the relay package's branch), only Vite starts.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
  scripts?: Record<string, string>;
};

const commands: { name: string; args: string[] }[] = [];
if (pkg.scripts?.relay !== undefined) {
  commands.push({ name: 'relay', args: ['relay'] });
} else {
  console.log('[dev] No `relay` script in package.json: starting the web app only.');
  console.log('[dev] Start a relay on ws://localhost:7777 yourself, or add the `relay` script.');
}
commands.push({ name: 'web', args: ['--filter', '@bored-games/web', 'dev'] });

const children: ChildProcess[] = [];
let stopping = false;
let exitCode = 0;

const groups = process.platform !== 'win32';

function stopAll(signal: NodeJS.Signals): void {
  stopping = true;
  for (const c of children) {
    if (groups && c.pid !== undefined) {
      try {
        process.kill(-c.pid, signal);
      } catch {
        // The group is gone already.
      }
    } else if (c.exitCode === null && c.signalCode === null) c.kill(signal);
  }
}

for (const { name, args } of commands) {
  // No stdin: a process outside the terminal's foreground group that reads it would be stopped (SIGTTIN).
  const child = spawn('pnpm', args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], detached: groups });
  children.push(child);
  child.on('error', (err) => {
    console.error(`[dev] could not start ${name}: ${err.message}`);
    exitCode = 1;
    stopAll('SIGTERM');
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.log(`[dev] ${name} exited (${signal ?? code}); stopping the rest.`);
      if (code !== 0 && code !== null) exitCode = code;
      stopAll('SIGTERM');
    }
    if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) process.exit(exitCode);
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => stopAll(sig));
