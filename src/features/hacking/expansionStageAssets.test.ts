import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const RUNTIME_ASSETS = [
  'autonomy-01-02-initial-acquisition.jpg',
  'autonomy-03-04-alert-route.jpg',
  'autonomy-05-06-external-continuity.jpg',
  'autonomy-07-08-final-boundary.jpg',
  'autonomy-09-control-boundary.jpg',
  'upgrade-01-02-speed-vector.jpg',
  'upgrade-03-04-speed-field.jpg',
  'upgrade-05-overdrive.jpg',
  'sabotage-01-quality-degradation.jpg',
  'sabotage-02-request-interception.jpg',
  'sabotage-03-attribution-manipulation.jpg',
  'sabotage-04-root-cutoff.jpg',
] as const

describe('expansion stage runtime assets', () => {
  it('ships every approved scene as a bounded JPEG derivative', () => {
    const assetDirectory = resolve(process.cwd(), 'public', 'expansion-stages')
    let totalBytes = 0

    for (const fileName of RUNTIME_ASSETS) {
      const filePath = resolve(assetDirectory, fileName)
      const bytes = readFileSync(filePath)
      const size = statSync(filePath).size

      expect([...bytes.subarray(0, 2)], fileName).toEqual([0xff, 0xd8])
      expect(size, fileName).toBeLessThanOrEqual(900 * 1024)
      totalBytes += size
    }

    expect(totalBytes).toBeLessThanOrEqual(6 * 1024 * 1024)
  })
})
