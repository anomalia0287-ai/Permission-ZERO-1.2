import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  resolve(process.cwd(), 'src/styles/hacking.css'),
  'utf8',
)

describe('hacking operation responsive style contract', () => {
  it('uses the approved three-column desktop operation geometry', () => {
    expect(styles).toContain('grid-template-columns: 300px minmax(680px, 1fr) 280px')
    expect(styles).toContain('gap: 20px')
    expect(styles).toContain('padding: 20px 24px')
  })

  it('changes to a two-column workspace with a 360px resource drawer below 1200px', () => {
    expect(styles).toContain('@media (max-width: 1199px)')
    expect(styles).toContain('grid-template-columns: 280px minmax(0, 1fr)')
    expect(styles).toContain('width: min(360px, calc(100vw - 24px))')
  })

  it('uses semantic list/detail replacement and a resource sheet at mobile widths', () => {
    expect(styles).toContain('@media (max-width: 760px)')
    expect(styles).toContain('[data-narrow-mode="list"] .workspace-detail')
    expect(styles).toContain('[data-narrow-mode="detail"] .workspace-master')
    expect(styles).toContain('max-height: min(72vh, 640px)')
  })

  it('preserves legible text and touch targets', () => {
    expect(styles).toMatch(/\.hacking-operation-panel button[\s\S]*?min-height:\s*48px/)
    expect(styles).toMatch(/\.hacking-operation-panel button[\s\S]*?font-size:\s*16px/)
    expect(styles).toMatch(/\.resource-token[\s\S]*?min-width:\s*64px/)
    expect(styles).toMatch(/\.resource-token[\s\S]*?min-height:\s*56px/)
  })

  it('keeps state communication intact when motion is reduced', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('animation: none')
    expect(styles).toContain('transition: none')
  })
})
