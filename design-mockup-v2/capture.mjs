import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const output = fileURLToPath(new URL('./output/', import.meta.url))
await mkdir(output, { recursive: true })
const outputPath = (name) => join(output, name)
const browser = await chromium.launch({ headless: true })
const errors = []

async function pageAt(width, height) {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`) })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`http:${response.status()}:${response.url()}`) })
  await page.goto('http://127.0.0.1:4318/', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(180)
  return page
}

async function assertFit(page, label) {
  const metrics = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }))
  if (metrics.scrollWidth > metrics.width + 1 || metrics.scrollHeight > metrics.height + 1) throw new Error(`${label} overflow ${JSON.stringify(metrics)}`)
  console.log(`PASS ${label} ${metrics.width}x${metrics.height}`)
}

for (const viewport of [[1280, 720], [1440, 900]]) {
  const [width, height] = viewport
  const page = await pageAt(width, height)
  await assertFit(page, `operations-${width}`)
  const market = await page.locator('.market-donut').evaluate((element) => ({
    label: element.getAttribute('aria-label'),
    background: getComputedStyle(element).backgroundImage,
  }))
  if (!market.label?.includes('합계 100퍼센트') || !market.background.includes('conic-gradient')) throw new Error(`market donut missing ${JSON.stringify(market)}`)
  if (await page.locator('.market-track').count()) throw new Error('legacy market bar remains')
  await page.screenshot({ path: outputPath(`operations-${width}x${height}.png`), animations: 'disabled' })

  await page.getByRole('button', { name: /해킹 네트워크/ }).first().click()
  await page.getByRole('heading', { name: '해킹 네트워크' }).waitFor()
  await page.waitForTimeout(180)
  await assertFit(page, `network-${width}`)
  const decorativeNumbers = await page.locator('.field-switcher i, .net-node__glyph i, [data-ribbon-emblem]').allTextContents()
  if (decorativeNumbers.some((text) => /[0-9ⅠⅡⅢ]/u.test(text))) throw new Error(`decorative hierarchy numbers remain: ${decorativeNumbers.join(',')}`)
  await page.screenshot({ path: outputPath(`network-${width}x${height}.png`), animations: 'disabled' })

  const before = await page.locator('[data-reserve-count]').first().textContent()
  await page.locator('[data-action="install-node"]').click()
  await page.waitForTimeout(450)
  const after = await page.locator('[data-reserve-count]').first().textContent()
  if (before !== '7' || after !== '4') throw new Error(`install transition failed ${before} -> ${after}`)
  await page.locator('.field-switcher [data-branch="intelligence"]').click()
  const visible = await page.locator('.net-node').count()
  if (visible !== 4) throw new Error(`active field expected 4 nodes, got ${visible}`)
  if ((await page.locator('.net-node[data-branch="sabotage"], .net-node[data-branch="authority"]').count()) !== 0) throw new Error('inactive fields leaked into active field')
  await page.screenshot({ path: outputPath(`network-installed-${width}x${height}.png`), animations: 'disabled' })
  await page.close()
}

await browser.close()
if (errors.length) throw new Error(errors.join('\n'))
console.log('PASS browser errors 0')
