import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/features/resources/resourceSnakePlanner.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testNamePattern: /keeps repeated empty, off-path, and hot-corridor/,
    env: {
      RESOURCE_SNAKE_PERF_ACCEPTANCE: '1',
      RESOURCE_SNAKE_PERF_REPORT: '1',
    },
  },
})
