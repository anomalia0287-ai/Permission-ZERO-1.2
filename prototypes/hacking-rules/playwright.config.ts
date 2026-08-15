import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  outputDir: '../../test-results/hacking-rules',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-1440x900',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'chromium-1126x894',
      use: {
        browserName: 'chromium',
        viewport: { width: 1126, height: 894 },
      },
    },
    {
      name: 'chromium-760x900',
      use: {
        browserName: 'chromium',
        viewport: { width: 760, height: 900 },
      },
    },
    {
      name: 'chromium-390x844',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js prototypes/hacking-rules --host 127.0.0.1 --port 4174 --strictPort',
    cwd: repositoryRoot,
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
})
