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
  'expansion-stage.css',
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
    expect(approvedPass).toMatch(
      /html,\s*body,\s*#root\s*\{[^}]*background:\s*#fff;/s,
    )
    expect(approvedPass).toContain('width: 148px;')
    expect(approvedPass).toContain('background: #f3ead7;')
    expect(approvedPass).toContain('.game-shell .resource-panel')
    expect(approvedPass).toContain('.hacking-panel')
    expect(approvedPass).toContain('background: #08090e;')
  })

  it('keeps the final shell refinements aligned with the resource dock and scoped to the review rail', () => {
    const remodelSource = readFileSync(
      resolve(process.cwd(), 'src/styles/retro-modern-remodel.css'),
      'utf8',
    )
    const startMarker = '/* Aurora-black operations shell */'
    const endMarker = '/* Approved white operations pass */'
    const refinements = remodelSource.slice(
      remodelSource.indexOf(startMarker),
      remodelSource.indexOf(endMarker),
    )

    expect(refinements).toContain('--review-rail-pastel: linear-gradient(')
    expect(refinements).toContain(
      'grid-template-columns: minmax(205px, 0.78fr) minmax(310px, 1fr) var(--operations-dock-width);',
    )
    expect(refinements).toContain('width: var(--operations-dock-width);')
    expect(refinements).toContain('transform: translateX(1px);')
    expect(refinements).toContain('.workspace-panel.resource-snake-board')
    expect(refinements).toContain('padding: 4px;')
    expect(refinements).toContain('border-color: #ffffff;')
    expect(refinements).toContain('background: #ffffff;')
    expect(refinements).toContain('.workspace-panel.review-panel')
    expect(refinements).toContain('background: var(--review-rail-pastel);')
    expect(refinements).toContain('.review-panel > .market-watch--compact')
    expect(refinements).toContain('scrollbar-color: #a9adb4 #eceef0;')
  })

  it('mounts detail overlays across the viewport and gives expansion an edge-to-edge surface', () => {
    const detailSource = readFileSync(
      resolve(process.cwd(), 'src/styles/connected-details.css'),
      'utf8',
    )

    expect(detailSource).toMatch(/\.detail-layer\s*\{[^}]*position:\s*fixed;/s)
    expect(detailSource).toMatch(/\.detail-layer\s*\{[^}]*inset:\s*0;/s)
    expect(detailSource).toMatch(
      /\.detail-layer--hacking \.detail-layer__content\s*\{[^}]*width:\s*100vw;[^}]*height:\s*100vh;/s,
    )

    const remodelSource = readFileSync(
      resolve(process.cwd(), 'src/styles/retro-modern-remodel.css'),
      'utf8',
    )
    const expansionMarker = '/* Expansion workspace — bright, full-screen, automatic-spend revision. */'
    const expansionPass = remodelSource.slice(remodelSource.indexOf(expansionMarker))

    expect(expansionPass).toMatch(
      /\.detail-layer \.hacking-panel\.hacking-panel--paper \.hacking-panel__identity h2,[\s\S]*\.hack-inspector-heading h3,[\s\S]*\.hack-inspector-section p,[\s\S]*\.hack-inspector-facts strong\s*\{[^}]*color:\s*var\(--hack-ink\);/,
    )
    expect(expansionPass).toMatch(
      /\.detail-layer \.hacking-panel\.hacking-panel--paper \.hack-resource-pocket > header p\s*\{[^}]*color:\s*var\(--hack-muted\);[^}]*background:\s*#f4f5f7;/s,
    )
  })

  it('defines the approved four-zone expansion layout and restrained scene motion', () => {
    const expansionSource = readFileSync(
      resolve(process.cwd(), 'src/styles/expansion-stage.css'),
      'utf8',
    )
    const mainSource = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')

    expect(mainSource.indexOf("import './styles/expansion-stage.css'"))
      .toBeGreaterThan(mainSource.indexOf("import './styles/retro-modern-remodel.css'"))
    expect(expansionSource).toContain('--expansion-stage-icon-size: 86px;')
    expect(expansionSource).toMatch(
      /\.expansion-stage-workspace\s*\{[^}]*grid-template-areas:\s*"scene side"\s*"rail rail";/s,
    )
    expect(expansionSource).toMatch(
      /\.expansion-stage-side\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);[^}]*border-left:\s*1px solid var\(--hack-line\);/s,
    )
    expect(expansionSource).toMatch(
      /\.expansion-stage-operations\s*\{[^}]*border-top:\s*1px solid var\(--hack-line\);/s,
    )
    expect(expansionSource).toMatch(
      /\.expansion-stage-scene img\s*\{[^}]*object-fit:\s*contain;/s,
    )
    expect(expansionSource).toMatch(
      /\.expansion-stage-rail\s*\{[^}]*overflow-x:\s*auto;/s,
    )
    expect(expansionSource).toMatch(/@media \(max-height: 720px\)/)
    expect(expansionSource).toMatch(/@media \(max-width: 900px\)/)
    expect(expansionSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.expansion-stage-scene[^}]*animation:\s*none;/,
    )

    const expansionRules = [...expansionSource.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => selector.includes('.expansion-stage'))
    for (const [selector, body] of expansionRules) {
      expect(body, selector).not.toMatch(/box-shadow\s*:/)
      expect(body, selector).not.toMatch(/filter\s*:\s*blur/)
      expect(body, selector).not.toMatch(/(?:linear|radial)-gradient\s*\(/)
    }
    const sceneImageRule = expansionRules.find(([selector]) =>
      selector.includes('.expansion-stage-scene img'),
    )
    expect(sceneImageRule?.[2]).not.toMatch(/border-radius\s*:/)
  })
})
