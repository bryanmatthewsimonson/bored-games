import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'game-kit', root: 'packages/game-kit', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'chain-reaction',
          root: 'packages/games/chain-reaction',
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
    ],
  },
});
