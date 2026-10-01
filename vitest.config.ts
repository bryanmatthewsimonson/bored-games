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
      { test: { name: 'deck', root: 'packages/deck', include: ['test/**/*.test.ts'] } },
      { test: { name: 'brand', root: 'packages/brand', include: ['test/**/*.test.ts'] } },
      { test: { name: 'repo', root: '.', include: ['tests/**/*.test.ts'] } },
      {
        test: { name: 'fuzz', root: 'tools/fuzz', include: ['test/**/*.test.ts'], testTimeout: 300_000 },
      },
    ],
  },
});
