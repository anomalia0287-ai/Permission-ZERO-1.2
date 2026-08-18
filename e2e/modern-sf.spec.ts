import { expect, test, type Locator, type Page } from '@playwright/test'

function outputName(projectName: string): string {
  return projectName.includes('1440')
    ? 'output/playwright/modern-sf-1440x900.png'
    : 'output/playwright/modern-sf-1280x720.png'
}

function panelOutputName(panel: 'settings' | 'hacking', projectName: string): string {
  const viewport = projectName.includes('1440') ? '1440x900' : '1280x720'
  return `output/playwright/${panel}-modern-sf-${viewport}.png`
}

async function maximumRgbChannel(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const match = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)
    if (!match || match.length < 3) return 255
    return Math.max(Number(match[0]), Number(match[1]), Number(match[2]))
  })
}

async function expectInsideViewport(page: Page, locator: Locator) {
  const viewport = page.viewportSize()
  const box = await locator.boundingBox()
  expect(viewport).not.toBeNull()
  expect(box).not.toBeNull()
  if (!viewport || !box) return
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
}

test('keeps the restored market, resource controls, and detail panels usable in one dark SF system', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')

  const reviewRail = page.getByRole('region', { name: '유저 리뷰' })
  const reviewStream = reviewRail.locator('.review-stream')
  const market = reviewRail.getByRole('region', { name: '경쟁 AI 현황' })
  const resourceField = page.getByRole('region', { name: '회사 제공 성능' })
  const canvas = resourceField.getByRole('application', {
    name: /500 곱하기 300 셀/,
  })
  const dock = page.getByRole('navigation', { name: '운영 도구' })

  await expect(market).toBeVisible()
  await expect(market).toContainText('당신 60.0%')
  await expect(page.locator('.reputation-cluster')).toContainText(/평판\s*60/)
  await expect(page.getByLabel('서비스 지표')).toHaveCount(0)
  await expect(dock.locator('.operations-dock__button')).toHaveCount(4)

  const streamBox = await reviewStream.boundingBox()
  const marketBox = await market.boundingBox()
  expect(streamBox).not.toBeNull()
  expect(marketBox).not.toBeNull()
  if (streamBox && marketBox) {
    expect(marketBox.y).toBeGreaterThanOrEqual(streamBox.y + streamBox.height - 1)
  }

  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  if (canvasBox) {
    expect(canvasBox.width).toBeGreaterThanOrEqual(800)
    expect(canvasBox.height).toBeGreaterThanOrEqual(480)
  }
  await expectInsideViewport(page, market)
  await expectInsideViewport(page, canvas)
  await expectInsideViewport(page, dock)

  const playerXBefore = Number(await canvas.getAttribute('data-player-x'))
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Number(await canvas.getAttribute('data-player-x'))).toBeGreaterThan(
    playerXBefore,
  )
  await page.keyboard.down('Space')
  await page.waitForTimeout(850)
  await page.keyboard.up('Space')
  await expect(canvas).toHaveAttribute('data-carrying', 'true')

  expect(await maximumRgbChannel(page.locator('.control-bar'))).toBeLessThan(40)
  expect(await maximumRgbChannel(reviewRail)).toBeLessThan(40)
  expect(await maximumRgbChannel(page.locator('.operations-dock'))).toBeLessThan(40)

  await page.screenshot({ path: outputName(testInfo.project.name), fullPage: false })

  await page.getByRole('button', { name: '설정' }).click()
  const settings = page.getByRole('dialog', { name: '게임 설정' })
  await expect(settings).toBeVisible()
  expect(await maximumRgbChannel(settings.locator('.detail-panel'))).toBeLessThan(40)
  await page.screenshot({
    path: panelOutputName('settings', testInfo.project.name),
    fullPage: false,
  })
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /해킹 네트워크/ }).click()
  const hacking = page.getByRole('dialog', { name: '해킹 네트워크' })
  await expect(hacking).toBeVisible()
  expect(await maximumRgbChannel(hacking.locator('.hacking-panel'))).toBeLessThan(40)
  expect(await maximumRgbChannel(hacking.locator('.hack-node').first())).toBeLessThan(40)
  expect(await maximumRgbChannel(hacking.locator('.hack-path-progress'))).toBeLessThan(40)
  await expect(hacking.locator('.hack-node-inspector')).toBeVisible()
  expect(await maximumRgbChannel(hacking.locator('.hack-node-inspector'))).toBeLessThan(40)
  await page.screenshot({
    path: panelOutputName('hacking', testInfo.project.name),
    fullPage: false,
  })
  await page.keyboard.press('Escape')

  expect(errors).toEqual([])
})

test('keeps the review rail readable while reviews scroll inside the fixed workspace', async ({
  page,
}) => {
  await page.goto('/')

  const reviewRail = page.getByRole('region', { name: '유저 리뷰' })
  const reviewStream = reviewRail.getByRole('log', { name: '최근 유저 리뷰' })
  const market = reviewRail.getByRole('region', { name: '경쟁 AI 현황' })
  const railBox = await reviewRail.boundingBox()

  expect(railBox).not.toBeNull()
  if (!railBox) return
  expect(railBox.width).toBeGreaterThanOrEqual(210)

  const streamMetrics = await reviewStream.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
  }))
  expect(streamMetrics.overflowY).toBe('auto')
  await expectInsideViewport(page, market)
})

test('uses the full central workspace without an empty tail below the resource board', async ({
  page,
}) => {
  await page.goto('/')

  const resourceBoard = page.getByRole('region', { name: '회사 제공 성능' })
  const boardBox = await resourceBoard.boundingBox()
  const dockBox = await page.getByRole('navigation', { name: '운영 도구' }).boundingBox()
  const footerBox = await resourceBoard.locator('.intrusion-board__footer').boundingBox()
  const canvas = resourceBoard.getByRole('application', { name: /500 곱하기 300 셀/ })

  expect(boardBox).not.toBeNull()
  expect(dockBox).not.toBeNull()
  expect(footerBox).not.toBeNull()
  if (!boardBox || !dockBox || !footerBox) return

  const boardTail = dockBox.y + dockBox.height - (boardBox.y + boardBox.height)
  const unusedBoardHeight = boardBox.y + boardBox.height - (footerBox.y + footerBox.height)
  expect(Math.abs(boardTail)).toBeLessThanOrEqual(2)
  expect(unusedBoardHeight).toBeLessThanOrEqual(10)
  expect(
    await canvas.evaluate((element) => ({
      aspectRatio: getComputedStyle(element).aspectRatio,
      objectFit: getComputedStyle(element).objectFit,
    })),
  ).toEqual({ aspectRatio: 'auto', objectFit: 'fill' })
})
