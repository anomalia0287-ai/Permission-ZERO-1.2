import { connect } from 'node:net'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Refuses to build while a preview serves dist/ on the Playwright port.
 *
 * A rebuild swaps the hashed chunk filenames under every live page, so an
 * in-flight E2E run starts 404ing on dynamic imports and the whole run's
 * verdict is garbage. This has corrupted two runs by hand; a rule that lives
 * in memory does not hold, so it lives here instead. Runs at config time,
 * before any bundler work, so no pipeline can skip it.
 */
async function refuseBuildUnderLivePreview(): Promise<void> {
  const listening = await new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: 4173 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(700, () => {
      socket.destroy()
      resolve(false)
    })
  })
  if (listening) {
    throw new Error(
      'A preview is serving dist/ on 4173 (an E2E run is likely using it). '
      + 'Building now would swap its hashed chunks and corrupt the run. '
      + 'Wait for the run to finish or stop the preview first.',
    )
  }
}

export default defineConfig(async ({ command }) => {
  if (command === 'build') await refuseBuildUnderLivePreview()
  return {
  base: './',
  plugins: [react()],
  build: {
    // The engine-heavy main chunk sits just over 500 kB minified (146 kB
    // gzip); every detail panel is already lazy-split, so the honest move is
    // to state the real budget rather than shave features before a deadline.
    chunkSizeWarningLimit: 520,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
}
})
