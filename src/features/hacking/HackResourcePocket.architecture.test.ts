import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('HackResourcePocket architecture', () => {
  it('keeps hacking resources ordered and draggable without an idle physics loop', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/hacking/HackResourcePocket.tsx'),
      'utf8',
    )

    expect(source).not.toContain('useResourceMotion')
    expect(source).not.toContain('requestAnimationFrame')
    expect(source).not.toContain('ResizeObserver')
    expect(source).not.toContain('registerBody')
  })
})
