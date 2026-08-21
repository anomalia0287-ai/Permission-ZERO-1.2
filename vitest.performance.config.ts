import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/features/resources/resourceSnakePlanner.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testNamePattern: /keeps the 96-candidate external p95 at or below 3ms/,
    env: {
      RESOURCE_SNAKE_PERF_ACCEPTANCE: '1',
      RESOURCE_SNAKE_PERF_REPORT: '1',
    },
  },
})
