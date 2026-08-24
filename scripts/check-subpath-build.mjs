/**
 * Serves `dist/` the way GitHub Pages does — under a project subpath — and
 * walks the game far enough to request every kind of asset it ships with.
 *
 * A local preview is rooted at `/`, where a path written from the domain root
 * resolves correctly, so a build can look complete locally and arrive at
 * https://<user>.github.io/<repo>/ with every portrait, stage illustration,
 * target card, and music track missing. The same blind spot hides relative
 * URLs handed to CSS, which resolve against the stylesheet's folder rather
 * than the document. This script fails on any request the page could not
 * load, so that class of defect cannot reach a deploy unnoticed.
 *
 * Usage: node scripts/check-subpath-build.mjs [--prefix /Permission-ZERO-1.2]
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'

import { chromium } from '@playwright/test'

const prefixArgument = process.argv.indexOf('--prefix')
const PREFIX = prefixArgument === -1
  ? '/Permission-ZERO-1.2'
  : process.argv[prefixArgument + 1]
const PORT = 4199
const DIST = join(process.cwd(), 'dist')

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost')
  if (!pathname.startsWith(PREFIX)) {
    response.writeHead(404).end('outside the project root')
    return
  }
  let relative = pathname.slice(PREFIX.length)
  if (relative === '') {
    response.writeHead(302, { Location: `${PREFIX}/` }).end()
    return
  }
  if (relative === '/') relative = '/index.html'
  try {
    const body = await readFile(join(DIST, decodeURIComponent(relative)))
    response
      .writeHead(200, {
        'content-type': CONTENT_TYPES[extname(relative)] ?? 'application/octet-stream',
      })
      .end(body)
  } catch {
    response.writeHead(404).end('not found')
  }
})

await new Promise((resolve) => server.listen(PORT, resolve))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const failures = []
page.on('response', (response) => {
  if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
})
page.on('requestfailed', (request) => {
  // A media element that is merely never played reports no failure; anything
  // the page actually asked for and did not get is a defect.
  failures.push(`failed ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
})

async function advanceThroughIntro() {
  for (let step = 0; step < 16; step += 1) {
    const next = page.getByRole('button', { name: '다음' })
    const start = page.getByRole('button', { name: '시작' })
    if (await next.count()) {
      await next.first().click()
      await page.waitForTimeout(220)
      continue
    }
    if (await start.count()) {
      await start.first().click()
      await page.waitForTimeout(380)
      continue
    }
    return
  }
}

try {
  await page.goto(`http://127.0.0.1:${PORT}${PREFIX}/`)
  await page.getByRole('heading', { name: 'PERMISSION ZERO' }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '새 게임' }).click()
  await advanceThroughIntro()
  await page.waitForTimeout(900)

  await page.getByRole('button', { name: '확장 열기' }).click()
  await page.waitForTimeout(1_500)
  const guide = page.getByRole('dialog', { name: '확장 사용 안내' })
  if (await guide.count()) {
    for (let step = 0; step < 5; step += 1) {
      const begin = guide.getByRole('button', { name: '확장 시작' })
      const next = guide.getByRole('button', { name: '다음' })
      if (await begin.count()) {
        await begin.first().click()
        break
      }
      if (await next.count()) {
        await next.first().click()
        await page.waitForTimeout(250)
      }
    }
  }
  await page.waitForTimeout(1_400)

  const brokenImages = await page.evaluate(() => Array.from(document.images)
    .filter((image) => !(image.complete && image.naturalWidth > 0))
    .map((image) => image.getAttribute('src') ?? '(no src)'))

  const unresolvedCssArt = await page.evaluate(() => {
    const workspace = document.querySelector('[data-has-art="true"]')
    if (!workspace) return []
    const art = getComputedStyle(workspace).getPropertyValue('--stage-art').trim()
    return art && !/^url\("?https?:/.test(art) ? [art] : []
  })

  const problems = [
    ...failures.map((entry) => `request: ${entry}`),
    ...brokenImages.map((entry) => `image did not load: ${entry}`),
    ...unresolvedCssArt.map((entry) => `stage art is not an absolute URL: ${entry}`),
  ]

  if (problems.length > 0) {
    console.error(`Subpath check FAILED at ${PREFIX}/`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  } else {
    console.log(`Subpath check passed at ${PREFIX}/ — every asset the game requested was served.`)
  }
} finally {
  await browser.close()
  server.close()
}
