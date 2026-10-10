import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'quill-and-quarry',
          root: 'packages/games/quill-and-quarry',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'gilt-and-guile',
          root: 'packages/games/gilt-and-guile',
          testTimeout: 60000,
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'driftwrights',
          root: 'packages/games/driftwrights',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'luster',
          root: 'packages/games/luster',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'right-of-way',
          root: 'packages/games/right-of-way',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'room-for-doubt',
          root: 'packages/games/room-for-doubt',
          include: ['test/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
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
        test: {
          name: 'holler',
          root: 'packages/games/holler',
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
          // The Holler session hook proves two opening decks after it searches for scripts.
          hookTimeout: 180_000,
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
