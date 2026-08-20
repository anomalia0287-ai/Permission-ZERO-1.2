import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const styleModules = [
  'operations-shell.css',
  'connected-details.css',
  'hacking.css',
  'statistics.css',
  'settings.css',
  'overlays.css',
  'retrofuture.css',
  'retro-modern-remodel.css',
] as const

describe('style module boundaries', () => {
  it('keeps major interface surfaces in dedicated stylesheets', () => {
    for (const moduleName of styleModules) {
      expect(
        existsSync(resolve(process.cwd(), 'src/styles', moduleName)),
        moduleName,
      ).toBe(true)
    }
  })

  it('loads extracted stylesheets in their original cascade order', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
    const expectedImports = styleModules.map(
      (moduleName) => `import './styles/${moduleName}'`,
    )
    const importOffsets = expectedImports.map((statement) =>
      mainSource.indexOf(statement),
    )

    expect(importOffsets.every((offset) => offset >= 0)).toBe(true)
    expect(importOffsets).toEqual([...importOffsets].sort((a, b) => a - b))
  })

  it('keeps extracted section markers out of the base stylesheet', () => {
    const globalSource = readFileSync(
      resolve(process.cwd(), 'src/styles/global.css'),
      'utf8',
    )

    expect(globalSource).not.toContain('/* Primary operations surface')
    expect(globalSource).not.toContain('/* Connected detail surfaces')
    expect(globalSource).not.toContain('/* Hacking network')
    expect(globalSource).not.toContain('/* Statistics')
    expect(globalSource).not.toContain('/* Settings and guide')
    expect(globalSource).not.toContain('/* Blocking events and save recovery')
  })

  it('finishes with the approved white operations palette and dark game islands', () => {
    const remodelSource = readFileSync(
      resolve(process.cwd(), 'src/styles/retro-modern-remodel.css'),
      'utf8',
    )
    const marker = '/* Approved white operations pass */'
    const approvedPass = remodelSource.slice(remodelSource.indexOf(marker))

    expect(approvedPass).toContain(marker)
    expect(approvedPass).toContain('--rm-panel: #ffffff;')
    expect(approvedPass).toContain('--operations-header: #ff6b3d;')
    expect(approvedPass).toContain('--compact-market: #eceef0;')
    expect(approvedPass).toContain('width: 148px;')
    expect(approvedPass).toContain('background: #f3ead7;')
    expect(approvedPass).toContain('.game-shell .resource-panel')
    expect(approvedPass).toContain('.hacking-panel')
    expect(approvedPass).toContain('background: #08090e;')
  })
})
