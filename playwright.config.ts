import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // The snake journeys depend on real RAF cadence and real keyboard events.
  // Serial browser execution keeps other viewports from starving those input loops.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Real RAF/input combat can land on a neighboring fixed-step boundary even
  // with deterministic campaign state; retry only replays the same public UI journey.
  retries: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-1280x720',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'chromium-1366x650',
      use: { browserName: 'chromium', viewport: { width: 1366, height: 650 } },
    },
    {
      name: 'chromium-1440x900',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
