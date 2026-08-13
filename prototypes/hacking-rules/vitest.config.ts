import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['prototypes/hacking-rules/src/**/*.test.ts'],
    environment: 'jsdom',
  },
})
