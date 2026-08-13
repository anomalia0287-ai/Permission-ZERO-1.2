import { chromium } from '@playwright/test'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

await page.goto('http://127.0.0.1:4327/')
await page.waitForTimeout(1_400)

const selectors = [
  '.workspace-grid',
  '.review-panel',
  '.resource-panel',
  '.supervisor-panel',
]

const layout = await page.evaluate((targets) => Object.fromEntries(
  targets.map((selector) => {
    const element = document.querySelector(selector)
    if (!element) return [selector, null]
    const style = getComputedStyle(element)
    const bounds = element.getBoundingClientRect()
    return [selector, {
      animation: style.animationName,
      animationState: style.animationPlayState,
      display: style.display,
      height: Math.round(bounds.height),
      opacity: style.opacity,
      overflow: style.overflow,
      visibility: style.visibility,
      width: Math.round(bounds.width),
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
    }]
  }),
), selectors)

console.log(JSON.stringify(layout, null, 2))
const smallVisibleText = await page.evaluate(() => Array.from(
  document.querySelectorAll('small, span, p, strong, time, button, h2, h3'),
).flatMap((element) => {
  const bounds = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const size = Number.parseFloat(style.fontSize)
  const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  if (
    !text ||
    bounds.width < 2 ||
    bounds.height < 2 ||
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number(style.opacity) === 0 ||
    size >= 11
  ) return []
  return [{
    className: element.className,
    size,
    tag: element.tagName,
    text: text.slice(0, 54),
  }]
}).slice(0, 80))
console.log(JSON.stringify({ smallVisibleText }, null, 2))
await page.screenshot({
  path: 'artifacts/art-deco-redesign/workspace-1280x720-audit.png',
  animations: 'allow',
})

await page.locator('[data-resource-kind="company"]').first().click()
await page.waitForTimeout(180)
await page.screenshot({
  path: 'artifacts/art-deco-redesign/workspace-selection-1280x720.png',
  animations: 'allow',
})
await page.locator('.reserve-destination:not([disabled])').first().click()
await page.waitForTimeout(520)
await page.screenshot({
  path: 'artifacts/art-deco-redesign/workspace-diverted-1280x720.png',
  animations: 'allow',
})

await page.getByRole('button', { name: '해킹 네트워크 열기' }).click()
await page.waitForTimeout(500)
await page.screenshot({
  path: 'artifacts/art-deco-redesign/hacking-1280x720-pass1.png',
  animations: 'allow',
})

await page.keyboard.press('Escape')
await page.getByRole('button', { name: '설정' }).click()
await page.waitForTimeout(500)
await page.screenshot({
  path: 'artifacts/art-deco-redesign/settings-1280x720-pass1.png',
  animations: 'allow',
})

await browser.close()
