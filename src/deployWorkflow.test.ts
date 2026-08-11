import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/deploy-pages.yml'),
  'utf8',
)

function indentation(line: string): number {
  return line.length - line.trimStart().length
}

function mappingAtPath(path: string[]): Record<string, string> {
  const lines = workflow.split(/\r?\n/)
  let blockStart = 0
  let blockEnd = lines.length
  let parentIndent = -2

  for (const key of path) {
    const targetIndent = parentIndent + 2
    const entryIndex = lines.findIndex((line, index) =>
      index >= blockStart &&
      index < blockEnd &&
      indentation(line) === targetIndent &&
      line.trim() === `${key}:`,
    )
    if (entryIndex < 0) throw new Error(`workflow mapping 누락: ${path.join('.')}`)

    blockStart = entryIndex + 1
    blockEnd = lines.findIndex((line, index) =>
      index >= blockStart &&
      line.trim().length > 0 &&
      !line.trimStart().startsWith('#') &&
      indentation(line) <= targetIndent,
    )
    if (blockEnd < 0) blockEnd = lines.length
    parentIndent = targetIndent
  }

  return Object.fromEntries(
    lines.slice(blockStart, blockEnd).flatMap((line) => {
      if (indentation(line) !== parentIndent + 2) return []
      const match = line.trim().match(/^([^:]+):\s*(\S+)$/)
      return match ? [[match[1], match[2]]] : []
    }),
  )
}

function pinnedActions() {
  return workflow.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(
      /^uses:\s+([^@\s]+)@([0-9a-f]{40})\s+#\s+(v\d+)$/,
    )
    return match ? [{ action: match[1], sha: match[2], tag: match[3] }] : []
  })
}

describe('Pages deployment workflow security boundary', () => {
  it('grants configure-pages read access without broadening build or deploy', () => {
    expect(mappingAtPath(['permissions'])).toEqual({ contents: 'read' })
    expect(mappingAtPath(['jobs', 'build', 'permissions'])).toEqual({
      contents: 'read',
      pages: 'read',
    })
    expect(mappingAtPath(['jobs', 'deploy', 'permissions'])).toEqual({
      pages: 'write',
      'id-token': 'write',
    })
  })

  it('keeps every action on its approved immutable release commit', () => {
    expect(pinnedActions()).toEqual([
      {
        action: 'actions/checkout',
        sha: 'd23441a48e516b6c34aea4fa41551a30e30af803',
        tag: 'v6',
      },
      {
        action: 'pnpm/action-setup',
        sha: 'b906affcce14559ad1aafd4ab0e942779e9f58b1',
        tag: 'v4',
      },
      {
        action: 'actions/setup-node',
        sha: '249970729cb0ef3589644e2896645e5dc5ba9c38',
        tag: 'v6',
      },
      {
        action: 'actions/configure-pages',
        sha: '983d7736d9b0ae728b81ab479565c72886d7745b',
        tag: 'v5',
      },
      {
        action: 'actions/upload-pages-artifact',
        sha: '7b1f4a764d45c48632c6b24a0339c27f5614fb0b',
        tag: 'v4',
      },
      {
        action: 'actions/deploy-pages',
        sha: 'd6db90164ac5ed86f2b6aed7e0febac5b3c0c03e',
        tag: 'v4',
      },
    ])
  })
})
