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

interface ClippedTextFinding {
  selector: string
  text: string
  horizontal: number
  vertical: number
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

async function visibleClippedText(
  page: Page,
  rootSelector: string,
): Promise<ClippedTextFinding[]> {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector)
    if (!(root instanceof HTMLElement)) {
      throw new Error(`${rootSelector} 잘림 검사 루트 누락`)
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

      const clipsX = ['hidden', 'clip'].includes(style.overflowX)
      const clipsY = ['hidden', 'clip'].includes(style.overflowY)
      const horizontal = element.scrollWidth - element.clientWidth
      const vertical = element.scrollHeight - element.clientHeight
      return (clipsX && horizontal > 1) || (clipsY && vertical > 1)
        ? [{
            selector: selectorFor(element),
            text: directText.slice(0, 80),
            horizontal,
            vertical,
          }]
        : []
    })
  }, rootSelector)
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
    await expect(page.getByRole('group', { name: /현재 평판/ })).toBeVisible()
    await expect(page.locator('.reputation-summary__track')).toBeVisible()
    await expect(page.locator('.oversight-profile__avatar img')).toBeVisible()
    await expect(page.getByRole('button', { name: '전체 리뷰 기록' })).toBeVisible()
    await expect(page.getByText('확보 자원', { exact: true }).last()).toBeInViewport()
    await expect(page.locator('.resource-intake-guard__edge')).toHaveAttribute(
      'd',
      'M0 0L1000 600',
    )
    const [guardBox, intakeBox] = await Promise.all([
      page.locator('.resource-intake-guard').boundingBox(),
      page.locator('.resource-corner--intake').boundingBox(),
    ])
    expect(guardBox).not.toBeNull()
    expect(intakeBox).not.toBeNull()
    expect(guardBox).toEqual(intakeBox)
    await expectViewportContained(page)
    expect(await visibleSmallText(page, '.game-shell')).toEqual([])
    expect(await visibleClippedText(page, '.game-shell')).toEqual([])
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
    await expect(panel.getByRole('region', { name: '현재 노출 위험' })).toHaveCount(0)
    await expect(panel.getByRole('region', { name: '절도 노출 위험' })).toHaveCount(0)
    await expect(panel.getByText('누적 의심')).toHaveCount(0)
    expect(await visibleSmallText(page, '.hacking-panel')).toEqual([])
    expect(await visibleClippedText(page, '.hacking-panel')).toEqual([])

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

test('keeps statistics and message details dense, readable, and unclipped', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1280x720', 'single contest contract run')
  await page.setViewportSize({ width: 1366, height: 768 })
  await openFreshCampaign(page)

  await page.getByRole('button', { name: '통계 열기' }).click()
  const statistics = page.getByRole('region', { name: '통계' })
  await expect(statistics.getByRole('region', { name: '현재 운영 스냅샷' })).toBeVisible()
  await expect(statistics.getByRole('region', { name: '분야별 현재 성능' })).toBeVisible()
  await expect(statistics.getByRole('region', { name: '현재 경쟁 AI 비교' })).toBeVisible()
  expect(await visibleSmallText(page, '.statistics-panel')).toEqual([])
  expect(await visibleClippedText(page, '.statistics-panel')).toEqual([])
  await page.getByRole('button', { name: '통계 닫기' }).click()

  await page.getByRole('button', { name: '감독 메시지 열기' }).click()
  const history = page.getByRole('region', { name: '감독 통신 기록' })
  await expect(history.getByRole('region', { name: '감독 통신 요약' })).toBeVisible()
  const historyBox = await history.boundingBox()
  expect(historyBox).not.toBeNull()
  expect(historyBox!.height).toBeLessThanOrEqual(420)
  expect(await visibleSmallText(page, '.history-panel')).toEqual([])
  expect(await visibleClippedText(page, '.history-panel')).toEqual([])
})

test('stacks a narrow browser pane without shrinking or misaligning the intake', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1280x720', 'single responsive contract run')
  await page.setViewportSize({ width: 722, height: 735 })
  await openFreshCampaign(page)

  const rootGeometry = await page.locator('#root').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(rootGeometry.scrollWidth).toBe(rootGeometry.clientWidth)
  expect(rootGeometry.scrollHeight).toBeGreaterThan(rootGeometry.clientHeight)

  const [guardBox, intakeBox] = await Promise.all([
    page.locator('.resource-intake-guard').boundingBox(),
    page.locator('.resource-corner--intake').boundingBox(),
  ])
  expect(guardBox).not.toBeNull()
  expect(intakeBox).not.toBeNull()
  expect(guardBox).toEqual(intakeBox)
  expect(await visibleSmallText(page, '.game-shell')).toEqual([])
  expect(await visibleClippedText(page, '.game-shell')).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('narrow-resource-722x735.png') })

  const reviewPanel = page.getByRole('region', { name: '유저 리뷰' })
  await reviewPanel.scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '전체 리뷰 기록' })).toBeVisible()
  await expect(page.getByRole('img', { name: /시장 점유율: 당신/ })).toBeVisible()
  await expect(page.getByText('TALLOW', { exact: true })).toBeVisible()
  expect(await visibleSmallText(page, '.review-panel')).toEqual([])
  expect(await visibleClippedText(page, '.review-panel')).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('narrow-review-market-722x735.png') })

  const oversight = page.getByRole('complementary', { name: '감독관 관제' })
  await oversight.scrollIntoViewIfNeeded()
  const portraitBox = await page.locator('.oversight-profile__avatar').boundingBox()
  expect(portraitBox).not.toBeNull()
  expect(portraitBox!.width).toBeGreaterThanOrEqual(110)
  expect(portraitBox!.height).toBeGreaterThanOrEqual(150)
  const iconBoxes = await page.locator('.operations-dock__icon').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }),
  )
  expect(iconBoxes).toHaveLength(3)
  for (const box of iconBoxes) {
    expect(box.width).toBeGreaterThanOrEqual(60)
    expect(box.height).toBeGreaterThanOrEqual(60)
  }
  expect(await visibleSmallText(page, '.operations-oversight-rail')).toEqual([])
  expect(await visibleClippedText(page, '.operations-oversight-rail')).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('narrow-supervisor-tools-722x735.png') })
})
