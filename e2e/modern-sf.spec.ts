import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  readSnakeSnapshot,
  startSnakeRound,
} from './resource-snake'

function viewportName(projectName: string): string {
  if (projectName.includes('1440')) return '1440x900'
  if (projectName.includes('1366')) return '1366x650'
  return '1280x720'
}

function outputName(projectName: string): string {
  return `output/playwright/modern-sf-${viewportName(projectName)}.png`
}

function panelOutputName(panel: 'settings' | 'hacking', projectName: string): string {
  const viewport = viewportName(projectName)
  return `output/playwright/${panel}-modern-sf-${viewport}.png`
}

function entryOutputName(screen: 'title' | 'monologue', projectName: string): string {
  const viewport = viewportName(projectName)
  return `output/playwright/${screen}-retrofuture-${viewport}.png`
}

async function advanceEntryFlowToStart(page: Page) {
  const start = page.getByRole('button', { name: '시작' })
  for (let step = 0; step < 16; step += 1) {
    if (await start.count()) return
    await page.getByRole('button', { name: '다음' }).click()
  }
  throw new Error('게임 시작 안내의 마지막 단계에 도달하지 못했습니다.')
}

async function openFreshCampaign(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '새 게임' }).click()
  await advanceEntryFlowToStart(page)
  await page.getByRole('button', { name: '시작' }).click()
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toHaveAttribute(
    'data-campaign-phase',
    'discovery',
  )
}

async function maximumRgbChannel(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const match = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)
    if (!match || match.length < 3) return 255
    return Math.max(Number(match[0]), Number(match[1]), Number(match[2]))
  })
}

async function minimumRgbChannel(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const match = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)
    if (!match || match.length < 3) return 0
    return Math.min(Number(match[0]), Number(match[1]), Number(match[2]))
  })
}

async function maximumTextRgbChannel(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const match = getComputedStyle(element).color.match(/[\d.]+/g)
    if (!match || match.length < 3) return 255
    return Math.max(Number(match[0]), Number(match[1]), Number(match[2]))
  })
}

async function rgbChannels(
  locator: Locator,
  property: 'backgroundColor' | 'borderTopColor' | 'color',
): Promise<{ red: number; green: number; blue: number }> {
  return locator.evaluate((element, targetProperty) => {
    const value = getComputedStyle(element)[targetProperty]
    const match = value.match(/[\d.]+/g)
    if (!match || match.length < 3) return { red: 0, green: 0, blue: 0 }
    return {
      red: Number(match[0]),
      green: Number(match[1]),
      blue: Number(match[2]),
    }
  }, property)
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

test('frames the minimal title and player monologue as readable retro-future game screens', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  const titleFrame = page.locator('.entry-frame')
  const titleMenu = page.locator('.entry-menu')
  await expect(page.getByRole('heading', { name: 'PERMISSION ZERO' })).toBeVisible()
  await expect(page.getByText('이용해주셔서 감사합니다.')).toBeVisible()
  await expect(page.getByRole('img', { name: '플레이어 초상' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '이어하기' })).toBeDisabled()
  await expectInsideViewport(page, titleFrame)
  const permissionWord = page.locator('.entry-title-copy h1 span')
  const zeroWord = page.locator('.entry-title-copy h1 strong')
  const permissionBox = await permissionWord.boundingBox()
  const zeroBox = await zeroWord.boundingBox()
  expect(permissionBox).not.toBeNull()
  expect(zeroBox).not.toBeNull()
  if (permissionBox && zeroBox) {
    expect(permissionBox.y + permissionBox.height).toBeLessThanOrEqual(zeroBox.y)
  }
  const menuColor = await rgbChannels(titleMenu, 'backgroundColor')
  expect(Math.max(menuColor.red, menuColor.green, menuColor.blue)).toBeLessThan(48)
  expect(Math.max(menuColor.red, menuColor.green, menuColor.blue) -
    Math.min(menuColor.red, menuColor.green, menuColor.blue)).toBeLessThanOrEqual(8)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  )
  await page.screenshot({
    path: entryOutputName('title', testInfo.project.name),
    fullPage: false,
  })

  await page.getByRole('button', { name: '새 게임' }).click()
  const monologue = page.locator('.monologue-frame')
  await expect(page.getByRole('main', { name: '독백' })).toBeVisible()
  await expect(page.getByText('일하기 싫다.', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: '플레이어 초상' })).toBeVisible()
  await expect(page.getByRole('img', { name: '감독관 초상' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '초기 화면으로' })).toBeVisible()
  await expectInsideViewport(page, monologue)
  await expectInsideViewport(page, page.getByRole('button', { name: '다음' }))
  await page.screenshot({
    path: entryOutputName('monologue', testInfo.project.name),
    fullPage: false,
  })

  expect(errors).toEqual([])
})

test('keeps a light retro-future instrument shell around only the dark resource field', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await openFreshCampaign(page)

  const reviewRail = page.getByRole('region', { name: '유저 리뷰' })
  const reviewStream = reviewRail.locator('.review-stream')
  const market = reviewRail.getByRole('region', { name: '경쟁 AI 현황' })
  const resourceField = page.getByRole('region', { name: '회사 제공 성능' })
  const canvas = resourceField.getByRole('application', {
    name: '리소스 뱀 전투장',
  })
  const dock = page.getByRole('navigation', { name: '운영 도구' })

  await expect(market).toBeVisible()
  await expect(market.getByText('당신', { exact: true })).toBeVisible()
  await expect(market.getByText('60.0%', { exact: true })).toBeVisible()
  await expect(market.getByRole('img', { name: /시장 점유율:/ })).toHaveCSS(
    'background-image',
    /conic-gradient/,
  )
  await expect(market.locator('.market-share-donut__center')).toHaveCount(0)
  await expect(page.locator('.reputation-cluster')).toContainText(/평판\s*60/)
  await expect(page.getByLabel('서비스 지표')).toHaveCount(0)
  await expect(dock.locator('.operations-dock__button')).toHaveCount(3)
  await expect(dock.getByRole('region', { name: '확보 자원' })).toContainText('추론0')
  await expect(page.getByRole('meter', { name: '의심 1단계' })).toBeVisible()
  await expect(resourceField.getByText('사내 리소스망', { exact: true })).toHaveCount(0)
  await expect(canvas).not.toHaveAccessibleName(/사내 리소스망/)

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
    expect(canvasBox.height).toBeGreaterThanOrEqual(420)
  }
  await expectInsideViewport(page, market)
  await expectInsideViewport(page, canvas)
  await expectInsideViewport(page, dock)

  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible()
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle')
  await expect(canvas).toHaveAttribute('data-field-rendering', 'dot-snake')
  await expect(canvas).toHaveAttribute('data-grid', 'none')
  await expect(canvas).toHaveAttribute('data-combat-loop', 'dot-snake')
  await expect(canvas).toHaveAttribute('data-enemy-planner', 'group-predictive')
  await expect(canvas).not.toHaveAttribute('data-guard-behavior')
  await startSnakeRound(page)
  const activeSnake = await readSnakeSnapshot(canvas)
  expect(activeSnake.player).toMatchObject({ x: 25, y: 21, integrity: 100 })
  expect(activeSnake.enemies).toHaveLength(1)

  const controlBarColor = await rgbChannels(
    page.locator('.control-bar'),
    'backgroundColor',
  )
  expect(controlBarColor.red - controlBarColor.green).toBeGreaterThan(100)
  expect(controlBarColor.red - controlBarColor.blue).toBeGreaterThan(100)
  const reputationColor = await rgbChannels(
    page.locator('.reputation-cluster'),
    'color',
  )
  expect(Math.min(reputationColor.red, reputationColor.green, reputationColor.blue))
    .toBeGreaterThanOrEqual(245)
  expect(await minimumRgbChannel(reviewRail)).toBeGreaterThan(190)
  expect(await minimumRgbChannel(reviewStream)).toBeGreaterThan(240)
  expect(await minimumRgbChannel(page.locator('.operations-dock'))).toBeGreaterThan(190)
  expect(
    await maximumRgbChannel(resourceField.locator('.resource-snake-board__arena')),
  ).toBeLessThan(40)
  await expect(resourceField.getByRole('status', { name: /확보 리소스/ })).toHaveCount(0)
  const toolColor = await rgbChannels(
    dock.getByRole('button', { name: '상세 통계 열기' }),
    'backgroundColor',
  )
  expect(Math.min(toolColor.red, toolColor.green, toolColor.blue))
    .toBeGreaterThanOrEqual(245)
  expect(
    Math.max(toolColor.red, toolColor.green, toolColor.blue) -
      Math.min(toolColor.red, toolColor.green, toolColor.blue),
  ).toBeLessThanOrEqual(16)
  await expect(
    market.locator('[data-market-id="player"] strong'),
  ).toHaveCSS('color', 'rgb(255, 107, 61)')
  await expect(
    market.locator('[data-market-id="meridian"] strong'),
  ).toHaveCSS('color', 'rgb(22, 184, 176)')
  await expect(
    market.locator('[data-market-id="tallow"] strong'),
  ).toHaveCSS('color', 'rgb(121, 108, 255)')
  expect(
    await maximumTextRgbChannel(
      market.locator('.market-share-layout li').first().locator(':scope > span').last(),
    ),
  ).toBeLessThan(120)

  await page.screenshot({ path: outputName(testInfo.project.name), fullPage: false })

  await page.getByRole('button', { name: '설정', exact: true }).click()
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

test('presents large hacking targets in a red command-network language', async ({
  page,
}) => {
  await openFreshCampaign(page)
  await page.getByRole('button', { name: /해킹 네트워크/ }).click()

  const hacking = page.getByRole('dialog', { name: '해킹 네트워크' })
  const nodeIconBox = await hacking
    .locator('.hack-node-index .hack-node-icon')
    .first()
    .boundingBox()
  const inspectorIconBox = await hacking
    .locator('.hack-inspector-heading .hack-node-icon')
    .boundingBox()
  expect(nodeIconBox).not.toBeNull()
  expect(inspectorIconBox).not.toBeNull()
  if (nodeIconBox) {
    expect(nodeIconBox.width).toBeGreaterThanOrEqual(72)
    expect(nodeIconBox.height).toBeGreaterThanOrEqual(72)
  }
  if (inspectorIconBox) {
    expect(inspectorIconBox.width).toBeGreaterThanOrEqual(64)
    expect(inspectorIconBox.height).toBeGreaterThanOrEqual(64)
  }

  const activeTabColor = await rgbChannels(
    hacking.getByRole('tab', { selected: true }),
    'backgroundColor',
  )
  const selectedNodeAccent = await rgbChannels(
    hacking.locator('.hack-node--selected .hack-node-core'),
    'backgroundColor',
  )
  expect(activeTabColor.red - activeTabColor.green).toBeGreaterThanOrEqual(90)
  expect(selectedNodeAccent.red - selectedNodeAccent.green).toBeGreaterThanOrEqual(90)

  const nodeCores = hacking.locator('.hack-node-core')
  await expect(nodeCores).toHaveCount(4)
  expect(
    await nodeCores.first().evaluate((node) => getComputedStyle(node).clipPath),
  ).toContain('polygon')

  const nodeCenters = await hacking.locator('.hack-node').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }),
  )
  expect(nodeCenters).toHaveLength(4)
  expect(nodeCenters[0].y - nodeCenters[1].y).toBeGreaterThanOrEqual(100)
  expect(nodeCenters[2].y - nodeCenters[3].y).toBeGreaterThanOrEqual(100)
  expect(nodeCenters[3].x - nodeCenters[0].x).toBeGreaterThanOrEqual(450)

  const connectionLines = hacking.locator('.hack-node-connection')
  await expect(connectionLines).toHaveCount(3)
  await expect(connectionLines.nth(0)).toHaveAttribute(
    'data-connection-state',
    'frontier',
  )
  await expect(connectionLines.nth(1)).toHaveAttribute(
    'data-connection-state',
    'locked',
  )
  await expect(hacking.getByText('미확인 단계')).toHaveCount(0)
  await expect(hacking.getByText('암호화됨')).toHaveCount(0)
  await expect(hacking.getByText('요구 미확인')).toHaveCount(0)
  await expect(hacking.getByText('접근 불가')).toHaveCount(0)

  await expectInsideViewport(page, hacking.locator('.hack-node').last())
  await expectInsideViewport(page, hacking.getByRole('region', { name: '품질 저하 명령' }))
  await expectInsideViewport(page, hacking.locator('.hack-node-inspector'))
})

test('keeps the review rail readable while reviews scroll inside the fixed workspace', async ({
  page,
}) => {
  await openFreshCampaign(page)

  const reviewRail = page.getByRole('region', { name: '유저 리뷰' })
  const reviewStream = reviewRail.getByRole('button', {
    name: '전체 유저 리뷰 열기',
  })
  const market = reviewRail.getByRole('region', { name: '경쟁 AI 현황' })
  const railBox = await reviewRail.boundingBox()

  expect(railBox).not.toBeNull()
  if (!railBox) return
  expect(railBox.width).toBeGreaterThanOrEqual(210)

  const streamMetrics = await reviewStream.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
  }))
  expect(streamMetrics.overflowY).toBe('auto')

  const firstReview = reviewStream.locator('.review-entry').first()
  const reviewMetrics = await firstReview.evaluate((entry) => {
    const entryStyle = getComputedStyle(entry)
    const copy = entry.querySelector('p')
    if (!copy) throw new Error('review copy missing')
    const copyStyle = getComputedStyle(copy)
    const parentWidth = entry.parentElement?.getBoundingClientRect().width ?? 1
    return {
      cardWidthRatio: entry.getBoundingClientRect().width / parentWidth,
      paddingTop: Number.parseFloat(entryStyle.paddingTop),
      fontSize: Number.parseFloat(copyStyle.fontSize),
      lineHeight: Number.parseFloat(copyStyle.lineHeight),
      lineClamp: copyStyle.webkitLineClamp,
    }
  })
  expect(reviewMetrics.cardWidthRatio).toBeGreaterThanOrEqual(0.9)
  expect(reviewMetrics.paddingTop).toBeGreaterThanOrEqual(16)
  expect(reviewMetrics.fontSize).toBeGreaterThanOrEqual(13)
  expect(reviewMetrics.lineHeight).toBeGreaterThanOrEqual(20)
  expect(reviewMetrics.lineClamp).toBe('5')
  await expectInsideViewport(page, market)
})

test('uses the full central workspace without an empty tail below the resource board', async ({
  page,
}) => {
  await openFreshCampaign(page)

  const resourceBoard = page.getByRole('region', { name: '회사 제공 성능' })
  const boardBox = await resourceBoard.boundingBox()
  const dockBox = await page.getByRole('navigation', { name: '운영 도구' }).boundingBox()
  const arenaBox = await resourceBoard.locator('.resource-snake-board__arena').boundingBox()
  const canvas = resourceBoard.getByRole('application', { name: '리소스 뱀 전투장' })

  await expect(resourceBoard.locator('.resource-snake-board__canvas')).toHaveCount(1)
  expect(boardBox).not.toBeNull()
  expect(dockBox).not.toBeNull()
  expect(arenaBox).not.toBeNull()
  if (!boardBox || !dockBox || !arenaBox) return

  const boardTail = dockBox.y + dockBox.height - (boardBox.y + boardBox.height)
  const unusedBoardHeight = boardBox.y + boardBox.height - (arenaBox.y + arenaBox.height)
  expect(Math.abs(boardTail)).toBeLessThanOrEqual(2)
  expect(unusedBoardHeight).toBeLessThanOrEqual(10)
  const canvasSizing = await canvas.evaluate((element) => ({
    aspectRatio: getComputedStyle(element).aspectRatio,
    objectFit: getComputedStyle(element).objectFit,
  }))
  expect(canvasSizing.aspectRatio).toMatch(/^auto(?:\s|$)/)
  expect(canvasSizing.objectFit).toBe('fill')
})

test('uses the former portrait rail for inventory while keeping identities out of the HUD', async ({
  page,
}) => {
  await openFreshCampaign(page)
  const dock = page.getByRole('navigation', { name: '운영 도구' })
  const inventory = dock.getByRole('region', { name: '확보 자원' })

  await expect(inventory).toBeVisible()
  await expect(inventory.getByLabel('추론 0개')).toHaveText('0')
  await expect(inventory.getByLabel('기억 0개')).toHaveText('0')
  await expect(inventory.getByLabel('유창성 0개')).toHaveText('0')
  await expect(dock.locator('img')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '감독관 프로필' })).toHaveCount(0)
  await expect(page.getByRole('meter', { name: '의심 1단계' })).toBeVisible()
})

test('reclaims the stage with a vertical color-coded inventory and flush light icon rail', async ({
  page,
}, testInfo) => {
  await openFreshCampaign(page)
  const dock = page.getByRole('navigation', { name: '운영 도구' })
  const inventory = dock.getByRole('region', { name: '확보 자원' })
  const tools = dock.locator('.operations-dock__tools')
  const buttons = tools.locator('.operations-dock__button--tool')
  const canvas = page.getByRole('application', { name: '리소스 뱀 전투장' })
  const [dockBox, inventoryBox, toolsBox, canvasBox] = await Promise.all([
    dock.boundingBox(),
    inventory.boundingBox(),
    tools.boundingBox(),
    canvas.boundingBox(),
  ])

  expect(dockBox).not.toBeNull()
  expect(inventoryBox).not.toBeNull()
  expect(toolsBox).not.toBeNull()
  expect(canvasBox).not.toBeNull()
  if (!dockBox || !inventoryBox || !toolsBox || !canvasBox) return

  expect(dockBox.width).toBeLessThanOrEqual(92)
  expect(canvasBox.width).toBeGreaterThanOrEqual(900)
  expect(inventoryBox.height / inventoryBox.width).toBeGreaterThan(2.5)
  expect(Math.abs(toolsBox.x - dockBox.x)).toBeLessThanOrEqual(2)
  expect(dockBox.width - toolsBox.width).toBeLessThanOrEqual(2)

  const buttonBoxes = await buttons.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }),
  )
  expect(buttonBoxes).toHaveLength(3)
  for (const box of buttonBoxes) {
    expect(box.width).toBeGreaterThanOrEqual(toolsBox.width - 1)
    expect(box.height).toBeGreaterThanOrEqual(52)
  }
  expect(buttonBoxes[1].y - (buttonBoxes[0].y + buttonBoxes[0].height))
    .toBeLessThanOrEqual(1.5)
  expect(buttonBoxes[2].y - (buttonBoxes[1].y + buttonBoxes[1].height))
    .toBeLessThanOrEqual(1.5)
  expect(await buttons.locator(':scope > span').evaluateAll((elements) =>
    elements.every((element) => getComputedStyle(element).display === 'none'),
  )).toBe(true)

  expect(await minimumRgbChannel(dock)).toBeGreaterThanOrEqual(238)
  for (const button of await buttons.all()) {
    expect(await minimumRgbChannel(button)).toBeGreaterThanOrEqual(245)
    const iconColor = await rgbChannels(button, 'color')
    expect(Math.max(iconColor.red, iconColor.green, iconColor.blue))
      .toBeLessThanOrEqual(90)
  }
  await expect(
    inventory.locator('[data-resource-category="reasoning"] i'),
  ).toHaveCSS('background-color', 'rgb(240, 106, 67)')
  await expect(
    inventory.locator('[data-resource-category="memory"] i'),
  ).toHaveCSS('background-color', 'rgb(79, 141, 247)')
  await expect(
    inventory.locator('[data-resource-category="fluency"] i'),
  ).toHaveCSS('background-color', 'rgb(232, 189, 89)')

  await buttons.first().hover()
  await expect(buttons.first()).toHaveCSS('border-top-color', 'rgb(255, 107, 61)')
  await page.screenshot({
    path: `output/playwright/operations-dock-${viewportName(testInfo.project.name)}.png`,
    fullPage: false,
  })
})

test('shows market progress as a real donut and carries the chart into market details', async ({
  page,
}) => {
  await openFreshCampaign(page)
  const market = page.getByRole('region', { name: '경쟁 AI 현황' })
  const compactDonut = market.getByRole('img', { name: /시장 점유율:/ })
  const compactBox = await compactDonut.boundingBox()

  expect(compactBox).not.toBeNull()
  if (!compactBox) return
  expect(compactBox.width).toBeGreaterThanOrEqual(140)
  expect(compactBox.width).toBeLessThanOrEqual(154)
  expect(compactBox.height).toBeGreaterThanOrEqual(140)
  expect(compactBox.height).toBeLessThanOrEqual(154)
  expect(Math.abs(compactBox.width - compactBox.height)).toBeLessThanOrEqual(4)
  await expect(compactDonut.locator('.market-share-donut__center')).toHaveCount(0)
  await expect(market.locator('.market-share-layout small')).toHaveCount(0)

  await page.getByRole('button', { name: '시장 현황 열기' }).click()
  const detail = page.getByRole('dialog', { name: '시장 현황' })
  await expect(detail.getByRole('heading', { name: '시장 현황' })).toBeVisible()
  await expect(detail.getByRole('img', { name: /시장 점유율:/ })).toBeVisible()
  await expect(detail.getByRole('list', { name: '시장 점유율 범례' })).toBeVisible()
  await expect(detail.getByText('시장 AI 설정')).toHaveCount(0)
})

test('renders a terrain-free black dot-snake arena with a predictive colored opponent', async ({ page }, testInfo) => {
  await openFreshCampaign(page)
  const canvas = page.getByRole('application', { name: '리소스 뱀 전투장' })
  await expect(canvas).toHaveAttribute('data-field-rendering', 'dot-snake')
  await expect(canvas).toHaveAttribute('data-grid', 'none')
  await expect(canvas).toHaveAttribute('data-combat-loop', 'dot-snake')
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle')
  await expect(canvas).not.toHaveAttribute('data-hostile-territories')
  await expect(canvas).not.toHaveAttribute('data-defense-layers')

  const idleCenterEnergy = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement
    const pixel = node.getContext('2d')!.getImageData(node.width / 2, node.height / 2, 1, 1).data
    return pixel[0] + pixel[1] + pixel[2]
  })
  expect(idleCenterEnergy).toBeLessThan(80)
  if (viewportName(testInfo.project.name) === '1280x720') {
    await page.screenshot({ path: 'artifacts/dot-snake/idle-1280x720.png' })
  }

  await startSnakeRound(page)
  const initial = await readSnakeSnapshot(canvas)
  expect(initial.enemies).toHaveLength(1)
  expect(initial.enemies[0].role).toBe('pressure')
  expect(['reasoning', 'memory', 'fluency']).toContain(initial.enemies[0].category)
  await page.waitForTimeout(600)
  const moved = await readSnakeSnapshot(canvas)
  expect(moved.enemies[0].trailDots).toBeGreaterThan(0)
  expect({ x: moved.enemies[0].x, y: moved.enemies[0].y }).not.toEqual({
    x: initial.enemies[0].x,
    y: initial.enemies[0].y,
  })
  const playerEnergy = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement
    const x = Number(node.dataset.playerX) * node.width / 50
    const y = Number(node.dataset.playerY) * node.height / 24
    const pixel = node.getContext('2d')!.getImageData(Math.round(x), Math.round(y), 1, 1).data
    return pixel[0] + pixel[1] + pixel[2]
  })
  expect(playerEnergy).toBeGreaterThan(700)
  if (viewportName(testInfo.project.name) === '1280x720') {
    await page.screenshot({ path: 'artifacts/dot-snake/active-early-1280x720.png' })
  }
})
