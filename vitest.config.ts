import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'game-kit', root: 'packages/game-kit', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'tilestock',
          root: 'packages/games/tilestock',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      { test: { name: 'brand', root: 'packages/brand', include: ['test/**/*.test.ts'] } },
      {
        test: { name: 'fuzz', root: 'tools/fuzz', include: ['test/**/*.test.ts'], testTimeout: 300_000 },
      },
    ],
  },
});
