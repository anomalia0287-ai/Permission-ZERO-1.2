import { expect, test, type Page } from '@playwright/test'

async function openFreshCampaign(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
}

interface SmallTextFinding {
  selector: string
  text: string
  fontSize: number
}

async function visibleSmallText(
  page: Page,
  rootSelector: string,
  minimumFontSize = 14,
): Promise<SmallTextFinding[]> {
  return page.evaluate(
    ({ rootSelector, minimumFontSize }) => {
      const root = document.querySelector(rootSelector)
      if (!(root instanceof HTMLElement)) {
        throw new Error(`${rootSelector} 가독성 검사 루트 누락`)
      }

      const selectorFor = (element: Element): string => {
        if (element.id) return `#${element.id}`
        const className = [...element.classList].slice(0, 3).join('.')
        return `${element.tagName.toLowerCase()}${className ? `.${className}` : ''}`
      }

      return [...root.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
        if (
          element.closest('.visually-hidden, [hidden], [aria-hidden="true"]') ||
          element.matches('svg, path')
        ) {
          return []
        }
        const directText = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '')
          .filter(Boolean)
          .join(' ')
        if (!/[A-Za-z가-힣0-9]{2,}/u.test(directText)) return []

        const style = getComputedStyle(element)
        const box = element.getBoundingClientRect()
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0 &&
          box.width >= 1 &&
          box.height >= 1 &&
          box.right > 0 &&
          box.bottom > 0 &&
          box.left < window.innerWidth &&
          box.top < window.innerHeight
        if (!visible) return []

        const fontSize = Number.parseFloat(style.fontSize)
        return fontSize + 0.01 < minimumFontSize
          ? [{ selector: selectorFor(element), text: directText.slice(0, 80), fontSize }]
          : []
      })
    },
    { rootSelector, minimumFontSize },
  )
}

async function expectViewportContained(page: Page) {
  const geometry = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    shell: (() => {
      const element = document.querySelector('.game-shell')
      if (!(element instanceof HTMLElement)) throw new Error('game shell 누락')
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        transform: style.transform,
        zoom: style.zoom,
      }
    })(),
  }))

  expect(geometry.document).toEqual(geometry.viewport)
  expect(geometry.shell.left).toBeGreaterThanOrEqual(-1)
  expect(geometry.shell.top).toBeGreaterThanOrEqual(-1)
  expect(geometry.shell.right).toBeLessThanOrEqual(geometry.viewport.width + 1)
  expect(geometry.shell.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1)
  expect(geometry.shell.transform).toBe('none')
  expect(geometry.shell.zoom).toBe('1')
}

test('enforces the Game Builders Seoul readability gate on the main cockpit', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1280x720', 'single contest contract run')

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1918, height: 912 },
  ]) {
    await page.setViewportSize(viewport)
    await openFreshCampaign(page)
    await expect(page.getByRole('region', { name: '유저 리뷰' })).toBeVisible()
    await expect(page.getByRole('region', { name: '회사 제공 성능' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: '감독관 관제' })).toBeVisible()
    await expectViewportContained(page)
    expect(await visibleSmallText(page, '.game-shell')).toEqual([])
    await page.screenshot({
      path: testInfo.outputPath(`main-cockpit-${viewport.width}x${viewport.height}.png`),
    })
  }
})

test('enforces readable frontier-only information in the hacking network', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1280x720', 'single contest contract run')
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1918, height: 912 },
  ]) {
    await page.setViewportSize(viewport)
    await openFreshCampaign(page)
    await page.getByRole('button', { name: '해킹 네트워크 열기' }).click()

    const panel = page.getByRole('region', { name: '해킹 네트워크' })
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-node-status="concealed"]')).toHaveCount(0)
    await expect(panel.locator('[data-node-status="frontier"]')).toHaveCount(1)
    const costVector = panel.getByRole('region', { name: /해금 요구 추론/ })
    const splitDecision = panel.locator('[aria-label="해금과 실행 분리 단계"]')
    const currentAction = panel.getByRole('button', { name: /구매 준비/ })
    await expect(costVector).toBeVisible()
    await expect(splitDecision).toBeVisible()
    await expect(splitDecision).toBeInViewport()
    await expect(currentAction).toBeVisible()
    await expect(currentAction).toBeInViewport()
    await expect(splitDecision.getByText('해금', { exact: true })).toBeVisible()
    await expect(splitDecision.getByText('실행', { exact: true })).toBeVisible()
    expect(await visibleSmallText(page, '.hacking-panel')).toEqual([])

    const criticalBoxes = await Promise.all([
      costVector.boundingBox(),
      splitDecision.boundingBox(),
      currentAction.boundingBox(),
    ])
    for (const box of criticalBoxes) {
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(-1)
      expect(box!.y).toBeGreaterThanOrEqual(-1)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
    }

    const panelBox = await panel.boundingBox()
    expect(panelBox).not.toBeNull()
    expect(panelBox!.x).toBeGreaterThanOrEqual(-1)
    expect(panelBox!.y).toBeGreaterThanOrEqual(-1)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport.height + 1)
    await page.screenshot({
      path: testInfo.outputPath(`hacking-frontier-${viewport.width}x${viewport.height}.png`),
    })
  }
})
