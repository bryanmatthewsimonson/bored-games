import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'game-kit', root: 'packages/game-kit', include: ['test/**/*.test.ts'] } },
      { test: { name: 'dice', root: 'packages/dice', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'chain-reaction',
          root: 'packages/games/chain-reaction',
          // licensed/: the tests that name the licensed pack's contents (D046).
          include: ['test/**/*.test.ts', 'licensed/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'chess',
          root: 'packages/games/chess',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'bank',
          root: 'packages/games/bank',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: { name: 'deck', root: 'packages/deck', include: ['test/**/*.test.ts'], testTimeout: 60_000 },
      },
      {
        test: {
          name: 'protocol',
          root: 'packages/protocol',
          include: ['test/**/*.test.ts'],
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'client',
          root: 'packages/client',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      { test: { name: 'relay', root: 'packages/relay', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'dev-relay',
          root: 'tools/dev-relay',
          include: ['test/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      { test: { name: 'web', root: 'apps/web', include: ['test/**/*.test.ts'] } },
      { test: { name: 'brand', root: 'packages/brand', include: ['test/**/*.test.ts'] } },
      { test: { name: 'repo', root: '.', include: ['tests/**/*.test.ts'] } },
      {
        test: { name: 'fuzz', root: 'tools/fuzz', include: ['test/**/*.test.ts'], testTimeout: 300_000 },
      },
      {
        test: {
          name: 'protocol-model',
          root: 'tools/protocol-model',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
