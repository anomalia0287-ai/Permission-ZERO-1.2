import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const baseUrl = process.env.PZ_MOCKUP_URL ?? 'http://127.0.0.1:4317'
const outputDir = fileURLToPath(new URL('../output/playwright/', import.meta.url))
await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const errors = []

async function openPage(viewport, screen = '') {
  const page = await browser.newPage({ viewport })
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`console:${message.type()}:${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`))
  await page.goto(`${baseUrl}/${screen ? `?screen=${screen}` : ''}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  return page
}

async function assertViewport(page, name) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }))
  if (metrics.scrollWidth > metrics.clientWidth + 1 || metrics.scrollHeight > metrics.clientHeight + 1) {
    throw new Error(`${name} overflow: ${JSON.stringify(metrics)}`)
  }
  process.stdout.write(`PASS ${name} ${metrics.clientWidth}x${metrics.clientHeight}\n`)
}

const title = await openPage({ width: 1280, height: 720 })
await title.screenshot({ path: join(outputDir, 'title-final-1280x720.png'), animations: 'disabled' })
await assertViewport(title, 'title')
await title.close()

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  const workspace = await openPage(viewport, 'workspace')
  await workspace.screenshot({ path: join(outputDir, `workspace-final-${viewport.width}x${viewport.height}.png`), animations: 'disabled' })
  await assertViewport(workspace, `workspace-${viewport.width}`)

  if (viewport.width === 1280) {
    await workspace.locator('[data-screen="workspace"] [data-action="settings"]').click()
    await workspace.getByRole('dialog', { name: '설정' }).waitFor()
    await workspace.screenshot({ path: join(outputDir, 'settings-final-1280x720.png'), animations: 'disabled' })
    await workspace.getByRole('button', { name: '닫기' }).click()

    await workspace.locator('[data-action="open-review"]').first().click()
    await workspace.getByRole('dialog').waitFor()
    await workspace.screenshot({ path: join(outputDir, 'review-detail-final-1280x720.png'), animations: 'disabled' })
  }
  await workspace.close()
}

const hacking = await openPage({ width: 1280, height: 720 }, 'hacking')
await hacking.screenshot({ path: join(outputDir, 'hacking-final-1280x720.png'), animations: 'disabled' })
await assertViewport(hacking, 'hacking')
await hacking.locator('[data-action="purchase-hack-node"]').click()
await hacking.getByRole('button', { name: '설치 완료' }).waitFor()
await hacking.screenshot({ path: join(outputDir, 'hacking-installed-final-1280x720.png'), animations: 'disabled' })
await hacking.close()

await browser.close()
if (errors.length) throw new Error(errors.join('\n'))
process.stdout.write('PASS browser console and page errors: 0\n')
