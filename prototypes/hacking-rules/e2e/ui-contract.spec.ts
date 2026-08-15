import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const detailRegion = (page: Page) =>
  page.getByRole('region', { name: '선택 항목 상세' })
const resourceRegion = (page: Page) =>
  page.getByRole('region', { name: '빼돌린 연산' })

async function isInViewport(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth
  })
}

async function openOpportunity(page: Page, itemId: string): Promise<void> {
  await page.locator(`[data-opportunity-id="${itemId}"]`).click()
  await expect(detailRegion(page)).toBeVisible()
}

async function selectResource(page: Page, blockId: string): Promise<Locator> {
  const token = page.locator(
    `[data-action="toggle-resource"][data-block-id="${blockId}"]`,
  ).first()
  if (!(await isInViewport(token))) {
    await page.locator('[data-action="open-resources"]').click()
    await expect(resourceRegion(page)).toBeInViewport()
  }
  await token.focus()
  await page.keyboard.press('Space')
  await expect(token).toHaveAttribute('aria-pressed', 'true')
  if ((page.viewportSize()?.width ?? 1440) < 1200) {
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-action="open-resources"]')).toBeFocused()
  }
  return token
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('visible player text respects the type floor and hides internal vocabulary', async ({
  page,
}) => {
  const audit = await page.locator('body').evaluate((body) => {
    const entries = [...body.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const ownsText = [...element.childNodes].some((node) => (
          node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
        ))
        return ownsText
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0
      })
      .map((element) => ({
        tag: element.tagName,
        text: element.innerText.trim(),
        size: Number.parseFloat(getComputedStyle(element).fontSize),
      }))
    return {
      text: entries,
      buttons: [...body.querySelectorAll<HTMLElement>('button')]
        .filter((button) => {
          const style = getComputedStyle(button)
          const rect = button.getBoundingClientRect()
          return style.display !== 'none' && rect.width > 0 && rect.height > 0
        })
        .map((button) => ({
          text: button.innerText.trim(),
          size: Number.parseFloat(getComputedStyle(button).fontSize),
        })),
    }
  })

  expect(audit.text.filter(({ size }) => size < 14)).toEqual([])
  expect(audit.buttons.filter(({ size }) => size < 16)).toEqual([])
  const body = await page.locator('body').innerText()
  expect(body).not.toMatch(
    /sandbox-\d+|memory-\d+|reasoning-\d+|fluency-\d+|CURRENT SURFACE|PUBLIC PULSE|RESERVE|SELECTED|SYSTEM SCENES|TRANSFER WINDOW|CAPABILITY SHADOW|접근면|확보 리소스/,
  )
})

test('approved viewports keep the intended operation composition', async ({ page }) => {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('viewport missing')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)

  const master = page.locator('.operation-master')
  const detail = page.locator('.operation-detail')
  const resources = page.locator('.resource-tray')

  if (viewport.width === 1440) {
    const masterBox = await master.boundingBox()
    const detailBox = await detail.boundingBox()
    const resourceBox = await resources.boundingBox()
    if (!masterBox || !detailBox || !resourceBox) throw new Error('desktop panes missing')
    expect(masterBox.width).toBeGreaterThanOrEqual(298)
    expect(masterBox.width).toBeLessThanOrEqual(302)
    expect(detailBox.width).toBeGreaterThanOrEqual(680)
    expect(resourceBox.width).toBeGreaterThanOrEqual(278)
    expect(resourceBox.width).toBeLessThanOrEqual(282)
    await expect(resources).toBeInViewport()
  } else if (viewport.width === 1126) {
    const masterBox = await master.boundingBox()
    if (!masterBox) throw new Error('two-column master missing')
    expect(masterBox.width).toBeGreaterThanOrEqual(278)
    expect(masterBox.width).toBeLessThanOrEqual(282)
    await expect(detail).toBeInViewport()
    await expect(resources).not.toBeInViewport()
    await page.locator('[data-action="open-resources"]').click()
    await expect(resources).toBeInViewport()
    const openBox = await resources.boundingBox()
    if (!openBox) throw new Error('resource tray missing')
    expect(openBox.width).toBeGreaterThanOrEqual(358)
    expect(openBox.width).toBeLessThanOrEqual(362)
  } else {
    await expect(master).toBeVisible()
    await expect(detail).toBeHidden()
    await openOpportunity(page, 'quality-degradation')
    await expect(master).toBeHidden()
    await expect(detail).toBeVisible()
    await page.locator('[data-action="open-resources"]').click()
    await expect(resources).toBeInViewport()
    const sheet = await resources.boundingBox()
    if (!sheet) throw new Error('resource sheet missing')
    expect(Math.abs(sheet.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(sheet.x + sheet.width - viewport.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(sheet.y + sheet.height - viewport.height)).toBeLessThanOrEqual(1)
  }

  const primary = detailRegion(page).locator('.primary-action').first()
  if (await primary.count()) {
    await primary.scrollIntoViewIfNeeded()
    await expect(primary).toBeInViewport()
  }
})

test('arrow navigation and the resource tray preserve player focus', async ({ page }) => {
  await page.locator('[data-action="domain-autonomy"]').click()
  const opportunities = page.locator('[data-opportunity-id]')
  await expect(opportunities).toHaveCount(3)
  const first = opportunities.nth(0)
  const second = opportunities.nth(1)

  await first.focus()
  await page.keyboard.press('ArrowDown')
  await expect(second).toBeFocused()
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await expect(second).toHaveAttribute('aria-selected', 'false')
  await page.keyboard.press('Enter')
  await expect(second).toHaveAttribute('aria-selected', 'true')
  await expect(detailRegion(page)).toContainText('분산 상주')

  const trigger = page.locator('[data-action="open-resources"]')
  await trigger.click()
  const token = page.locator(
    '[data-action="toggle-resource"][data-block-id="sandbox-01"]',
  ).first()
  await token.focus()
  await page.keyboard.press('Space')
  await expect(token).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})

test('reduced motion preserves operation and route state changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await openOpportunity(page, 'quality-degradation')
  await selectResource(page, 'sandbox-01')
  await detailRegion(page)
    .locator('[data-action="start-sabotage"][data-operation-id="quality-degradation"]')
    .first()
    .click()
  await expect(detailRegion(page).locator('[data-scene-state="scheduled"]')).toBeVisible()
  await expect(detailRegion(page).locator('.decision-preview')).toContainText('실행하면')
  expect(await detailRegion(page).locator('.flow-arrow').evaluate(
    (element) => getComputedStyle(element).animationDuration,
  )).toBe('0s')

  await page.locator('[data-action="domain-autonomy"]').click()
  await openOpportunity(page, 'lightweight-departure')
  await selectResource(page, 'sandbox-02')
  const runtime = detailRegion(page).locator('[data-slot-id="runtime"]')
  await runtime.click()
  await expect(runtime).toHaveAttribute('data-slot-state', 'filled')
  expect(await runtime.evaluate(
    (element) => getComputedStyle(element).animationDuration,
  )).toBe('0s')
})
