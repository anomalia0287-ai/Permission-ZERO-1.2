import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { publicAssetUrl } from './publicAssetUrl'

const SOURCE_ROOT = join(process.cwd(), 'src')

const ASSET_EXTENSIONS = 'png|jpg|jpeg|webp|svg|mp3|ogg|wav'
// A quoted path that starts at the domain root, e.g. '/player-ai-orange.png'.
const ROOT_ANCHORED_ASSET = new RegExp(
  `(['"\`])(/(?:[\\w.-]+/)*[\\w.-]+\\.(?:${ASSET_EXTENSIONS}))\\1`,
  'g',
)

// Presentation sources only.
//
// `src/game` is the save and rules layer, where a portrait path is an identity
// that stored campaigns are validated against by exact match — a value that
// moved with the build's base would mark every existing save corrupt. Those
// paths stay raw on purpose and are resolved where they are rendered, which
// `scripts/check-subpath-build.mjs` exercises against a real subpath. Tests may
// quote either shape deliberately, and this helper's own file documents both.
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (/\.test\.tsx?$/.test(entry)) return []
    if (path.startsWith(join(SOURCE_ROOT, 'assets'))) return []
    if (path.startsWith(join(SOURCE_ROOT, 'game'))) return []
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

describe('publicAssetUrl', () => {
  it('anchors a public file to the base the build was made with', () => {
    expect(publicAssetUrl('/player-ai-orange.png'))
      .toBe(`${import.meta.env.BASE_URL}player-ai-orange.png`)
    expect(publicAssetUrl('/music/kulakovka-space-283176.mp3'))
      .toBe(`${import.meta.env.BASE_URL}music/kulakovka-space-283176.mp3`)
  })

  it('accepts a path that is already free of a leading slash', () => {
    expect(publicAssetUrl('resource-targets/memory-blue.png'))
      .toBe(`${import.meta.env.BASE_URL}resource-targets/memory-blue.png`)
  })

  it('never doubles the separator, whatever leading slashes it is handed', () => {
    const base = import.meta.env.BASE_URL
    expect(publicAssetUrl('//a.png')).toBe(`${base}a.png`)
    expect(publicAssetUrl('///deep/a.mp3')).toBe(`${base}deep/a.mp3`)
    expect(publicAssetUrl('a.png')).toBe(`${base}a.png`)
  })

  // The regression this file exists for: a root-anchored asset string looks
  // correct on a server rooted at '/', and 404s under a subpath like GitHub
  // Pages' /Permission-ZERO-1.2/. A local run cannot reveal it, so the rule
  // is enforced here instead of by eye.
  it('is the only way the application names a file from public/', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(SOURCE_ROOT)) {
      const contents = readFileSync(file, 'utf8')
      for (const match of contents.matchAll(ROOT_ANCHORED_ASSET)) {
        const before = contents.slice(0, match.index ?? 0)
        // Inside publicAssetUrl(...) the leading slash is stripped, so those
        // literals are exactly what this helper is for.
        if (/publicAssetUrl\(\s*$/.test(before)) continue
        offenders.push(`${file.slice(SOURCE_ROOT.length + 1)}: ${match[2]}`)
      }
    }

    expect(offenders, [
      'These files name a public asset from the domain root, which 404s',
      'wherever the build is not served from `/`. Wrap them in',
      'publicAssetUrl() from src/assets/publicAssetUrl.ts.',
    ].join(' ')).toEqual([])
  })
})
