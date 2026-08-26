import { defineConfig } from '@playwright/test'

/*
 * Records the submission demo reel. Separate from the test config because it
 * is not a test: it drives the shipped build for the camera and
 * keeps the video whether or not the run passes, on its own port so a full
 * E2E sweep can be running next to it.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'promo-capture.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Real-time combat on real RAF cadence can lose a round. The main suite
  // retries for the same reason; here a retry simply re-shoots the take.
  retries: 8,
  timeout: 6 * 60_000,
  reporter: [['list']],
  outputDir: './artifacts/promo-capture',
  use: {
    baseURL: 'http://127.0.0.1:4821',
    // A wrong selector should surface in seconds, not eat the whole timeout.
    actionTimeout: 15_000,
    // 1280x720 is 16:9 and is one of the three viewports the whole E2E suite
    // proves the game on — including the combat steering this reel drives.
    // A larger frame changes the arena geometry and the run walks into a wall.
    viewport: { width: 1280, height: 720 },
    video: { mode: 'on', size: { width: 1280, height: 720 } },
  },
  projects: [{ name: 'promo-1280x720', use: { browserName: 'chromium' } }],
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4821 --strictPort',
    url: 'http://127.0.0.1:4821',
    reuseExistingServer: false,
  },
})
