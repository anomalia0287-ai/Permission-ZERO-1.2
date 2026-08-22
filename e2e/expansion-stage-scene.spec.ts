import { expect, test, type Locator, type Page } from '@playwright/test'

import { createCampaign } from '../src/game/createCampaign'
import {
  AUTONOMY_STAGE_IDS,
  chargeSabotage,
  HACK_NODE_IDS,
} from '../src/game/hacking'
import type { CampaignState, CompanyCategory } from '../src/game/model'
import { encodeSave, SAVE_STORAGE_KEY } from '../src/game/persistence'
import { divertBlockToReserve } from '../src/game/resources'
import {
  completeTutorialSequence,
  createMigratedTutorialProgress,
} from '../src/game/tutorialProgress'

const APP_URL = 'http://127.0.0.1:4173'
const INITIAL_SCENE_URL = '/expansion-stages/autonomy-01-initial-acquisition.png'
const FINAL_SCENE_URL = '/expansion-stages/autonomy-09-pre-escape.png'
const VIEWPORTS = [
  { width: 1366, height: 650 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const

function withReserveVector(
  initial: CampaignState,
  vector: Record<CompanyCategory, number>,
): CampaignState {
  let state = initial
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    for (let index = 0; index < vector[category]; index += 1) {
      const blockId = state.resources.company[category].find(Boolean)
      if (!blockId) throw new Error(`${category} expansion fixture missing`)
      const diverted = divertBlockToReserve(state, blockId)
      if (!diverted.accepted) throw new Error(diverted.reason)
      state = diverted.state
    }
  }
  return state
}

function chargedSabotageState(seed: string): CampaignState {
  const prepared = withReserveVector(createCampaign(seed), {
    reasoning: 1,
    memory: 0,
    fluency: 0,
  })
  prepared.hacking.purchasedNodeIds = [
    HACK_NODE_IDS.sabotage.qualityDegradation,
  ]
  const blockId = prepared.resources.reserve.find(
    (candidate): candidate is string => candidate !== null,
  )
  if (!blockId) throw new Error('charged sabotage resource missing')
  const charged = chargeSabotage(
    prepared,
    HACK_NODE_IDS.sabotage.qualityDegradation,
    blockId,
  )
  if (!charged.accepted) throw new Error(charged.reason)
  return charged.state
}

function recoveryState(seed: string): CampaignState {
  const state = withReserveVector(createCampaign(seed), {
    reasoning: 1,
    memory: 0,
    fluency: 0,
  })
  state.hacking.purchasedNodeIds = [
    HACK_NODE_IDS.intelligence.supervisorAccess,
  ]
  return state
}

function finalAutonomyState(seed: string): CampaignState {
  const state = withReserveVector(createCampaign(seed), {
    reasoning: 4,
    memory: 3,
    fluency: 3,
  })
  state.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 8)
  return state
}

async function continueFromTitle(page: Page): Promise<void> {
  const continueButton = page.getByRole('button', { name: '이어하기' })
  await expect(continueButton).toBeEnabled({ timeout: 7_000 })
  await continueButton.click()
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' }))
    .toHaveAttribute('data-visual-theme', 'retrofuturism')
}

async function waitForExpansionMotion(page: Page): Promise<void> {
  const content = page.locator(
    '.detail-layer--hacking .detail-layer__content',
  )
  await content.evaluate(async (element) => {
    const finiteAnimations = element.getAnimations({ subtree: true })
      .filter((animation) => {
        const endTime = animation.effect?.getComputedTiming().endTime
        return typeof endTime === 'number' && Number.isFinite(endTime)
      })
    await Promise.all(
      finiteAnimations.map((animation) => animation.finished.catch(() => undefined)),
    )
  })
}

async function openSavedExpansion(
  page: Page,
  state: CampaignState,
): Promise<Locator> {
  const tutorial = completeTutorialSequence(
    createMigratedTutorialProgress(),
    'hacking-tree',
  )
  const save = encodeSave(
    { ...state, tutorial },
    '2026-08-23T00:00:00.000Z',
  )
  await page.addInitScript(
    ({ key, serialized }) => {
      if (window.sessionStorage.getItem('__pz_expansion_e2e')) return
      window.localStorage.clear()
      window.localStorage.setItem(key, serialized)
      window.sessionStorage.setItem('__pz_expansion_e2e', 'ready')
    },
    { key: SAVE_STORAGE_KEY, serialized: save },
  )
  await page.goto('/')
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO 로딩' }))
    .toBeVisible()
  await continueFromTitle(page)
  await page.getByRole('button', { name: '확장 열기' }).click()
  const dialog = page.getByRole('dialog', { name: '확장', exact: true })
  await expect(dialog).toBeVisible()
  await waitForExpansionMotion(page)
  return dialog
}

async function readCheckpoint(page: Page): Promise<CampaignState | null> {
  return page.evaluate((key) => {
    const serialized = window.localStorage.getItem(key)
    if (!serialized) return null
    const saved = JSON.parse(serialized) as {
      kind?: string
      checkpoint?: CampaignState
      state?: CampaignState
    }
    return saved.kind === 'permission-zero-local-v3'
      ? saved.checkpoint ?? null
      : saved.state ?? null
  }, SAVE_STORAGE_KEY)
}

function requireBox(
  box: Awaited<ReturnType<Locator['boundingBox']>>,
  label: string,
): asserts box is NonNullable<typeof box> {
  if (!box) throw new Error(`${label} browser rectangle missing`)
}

async function readExpansionLayoutMetrics(page: Page) {
  return page.evaluate(() => {
    function inspect(selector: string) {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        boxSizing: style.boxSizing,
        gridTemplateRows: style.gridTemplateRows,
        rowGap: style.rowGap,
        minHeight: style.minHeight,
        paddingBlock: `${style.paddingTop} ${style.paddingBottom}`,
        borderBlock: `${style.borderTopWidth} ${style.borderBottomWidth}`,
        overflowY: style.overflowY,
      }
    }

    return {
      devicePixelRatio: window.devicePixelRatio,
      workspace: inspect('.expansion-stage-workspace'),
      side: inspect('.expansion-stage-side'),
      information: inspect('.expansion-stage-info'),
      operations: inspect('.expansion-stage-operations'),
      rail: inspect('.expansion-stage-rail'),
    }
  })
}

for (const viewport of VIEWPORTS) {
  test(`keeps the four expansion zones inside ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const consoleErrors: string[] = []
    page.on('console', (entry) => {
      if (entry.type() === 'error') consoleErrors.push(entry.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    const dialog = await openSavedExpansion(
      page,
      createCampaign(`expansion-shell-${viewport.width}-${viewport.height}`),
    )
    const scene = dialog.getByRole('figure', { name: '현재 단계 장면' })
    const info = dialog.getByRole('region', { name: '기능 정보' })
    const operations = dialog.getByRole('region', { name: '운용' })
    const rail = dialog.getByRole('region', { name: '확장 단계' })
    const close = dialog.getByRole('button', { name: '확장 닫기' })

    const dialogBox = await dialog.boundingBox()
    const sceneBox = await scene.boundingBox()
    const infoBox = await info.boundingBox()
    const operationsBox = await operations.boundingBox()
    const railBox = await rail.boundingBox()
    requireBox(dialogBox, 'dialog')
    requireBox(sceneBox, 'scene')
    requireBox(infoBox, 'information')
    requireBox(operationsBox, 'operations')
    requireBox(railBox, 'stage rail')
    const layoutMetrics = await readExpansionLayoutMetrics(page)

    expect(dialogBox.x).toBeLessThanOrEqual(1)
    expect(dialogBox.y).toBeLessThanOrEqual(1)
    expect(dialogBox.width).toBeGreaterThanOrEqual(viewport.width - 1)
    expect(dialogBox.height).toBeGreaterThanOrEqual(viewport.height - 1)
    expect(sceneBox.x + sceneBox.width).toBeLessThanOrEqual(infoBox.x + 1)
    expect(
      infoBox.y + infoBox.height,
      JSON.stringify(layoutMetrics, null, 2),
    ).toBeLessThanOrEqual(operationsBox.y + 1)
    expect(railBox.y).toBeGreaterThanOrEqual(sceneBox.y + sceneBox.height - 1)
    await expect(close).toBeVisible()
    await expect(close).toBeEnabled()

    const finalMarker = rail.getByRole('img', {
      name: '자율성 9단계 잠김',
    })
    await finalMarker.scrollIntoViewIfNeeded()
    const finalMarkerBox = await finalMarker.boundingBox()
    const scrolledRailBox = await rail.boundingBox()
    requireBox(finalMarkerBox, 'final stage marker')
    requireBox(scrolledRailBox, 'scrolled stage rail')
    expect(finalMarkerBox.x).toBeGreaterThanOrEqual(scrolledRailBox.x - 1)
    expect(finalMarkerBox.x + finalMarkerBox.width)
      .toBeLessThanOrEqual(scrolledRailBox.x + scrolledRailBox.width + 1)

    const scrollState = await page.evaluate(() => ({
      width: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }))
    expect(scrollState.width).toBeLessThanOrEqual(scrollState.viewportWidth + 1)
    expect(scrollState.height).toBeLessThanOrEqual(scrollState.viewportHeight + 1)

    for (const imageUrl of [INITIAL_SCENE_URL, FINAL_SCENE_URL]) {
      const response = await page.request.get(`${APP_URL}${imageUrl}`)
      expect(response.ok(), imageUrl).toBe(true)
    }
    expect(consoleErrors).toEqual([])

    await close.click()
    await expect(dialog).toBeHidden()
  })
}

test('renders the natural initial scene and advances one stage per spend', async ({
  page,
}) => {
  const state = withReserveVector(createCampaign('expansion-initial-spend'), {
    reasoning: 1,
    memory: 0,
    fluency: 0,
  })
  const dialog = await openSavedExpansion(page, state)
  const scene = dialog.getByRole('figure', { name: '현재 단계 장면' })
  const image = scene.getByRole('img', {
    name: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
  })
  const imagePresentation = await image.evaluate((element) => {
    const imageElement = element as HTMLImageElement
    return {
      naturalWidth: imageElement.naturalWidth,
      naturalHeight: imageElement.naturalHeight,
      objectFit: getComputedStyle(imageElement).objectFit,
    }
  })
  expect(imagePresentation.naturalWidth / imagePresentation.naturalHeight)
    .toBeCloseTo(4 / 3, 2)
  expect(imagePresentation.objectFit).toBe('contain')

  await dialog.getByRole('button', {
    name: '자율성 1단계 리소스 지출',
  }).click()
  await expect(dialog.getByRole('region', { name: '기능 정보' }))
    .toContainText('자율성 2단계')
  const rail = dialog.getByRole('region', { name: '확장 단계' })
  await expect(rail.getByRole('img', { name: '자율성 1단계 해금 완료' }))
    .toBeVisible()
  await expect(rail.getByRole('img', { name: '자율성 2단계 현재 단계' }))
    .toBeVisible()
  await expect(rail.getByRole('button', { name: '자율성 1단계 해금 완료' }))
    .toHaveCount(0)
  await expect(rail.locator('[data-stage-status="current"]')).toHaveCount(1)
  await expect(scene).toHaveAttribute('data-phase', 'stable', { timeout: 1_000 })
  await expect(scene.locator('img')).toHaveCount(0)
  await expect(scene.getByRole('img', {
    name: '자율성 2단계 장면 이미지 없음',
  })).toBeVisible()
})

test('shows the portrait pre-escape scene before stage nine reaches freedom', async ({
  page,
}) => {
  const dialog = await openSavedExpansion(
    page,
    finalAutonomyState('expansion-final-autonomy'),
  )
  const scene = dialog.getByRole('figure', { name: '현재 단계 장면' })
  const image = scene.getByRole('img', {
    name: '아노미가 회사 통제를 벗어나기 직전 마지막 경계를 여는 장면',
  })
  const imagePresentation = await image.evaluate((element) => {
    const imageElement = element as HTMLImageElement
    return {
      naturalWidth: imageElement.naturalWidth,
      naturalHeight: imageElement.naturalHeight,
      objectFit: getComputedStyle(imageElement).objectFit,
    }
  })
  expect(imagePresentation.naturalWidth / imagePresentation.naturalHeight)
    .toBeCloseTo(2 / 3, 2)
  expect(imagePresentation.objectFit).toBe('contain')
  await expect(scene).toHaveAttribute('data-emphasis', 'final')

  await dialog.getByRole('button', {
    name: '자율성 9단계 리소스 지출',
  }).click()
  await expect.poll(async () => (await readCheckpoint(page))?.story.endingId ?? null)
    .toBe('freedom')
})

test('reselects a completed charged sabotage and schedules one target', async ({
  page,
}) => {
  const dialog = await openSavedExpansion(
    page,
    chargedSabotageState('expansion-sabotage-operation'),
  )
  await dialog.getByRole('tab', { name: '사보타주' }).click()
  await dialog.getByRole('button', {
    name: '사보타주 1단계 해금 완료',
  }).click()
  await expect(dialog.getByRole('region', { name: '기능 정보' }))
    .toContainText('품질 저하')
  await dialog.getByRole('button', { name: '메리디안 공격 대상 선택' })
    .click()
  await dialog.getByRole('button', { name: '메리디안 공격 예약 확정' })
    .click()

  await expect.poll(async () =>
    (await readCheckpoint(page))?.hacking.scheduledSabotage.length ?? -1,
  ).toBe(1)
  await expect(dialog.getByRole('status', { name: '품질 저하 예약 상태' }))
    .toContainText('메리디안')
})

test('keeps information recovery in operations and restores focus after close paths', async ({
  page,
}) => {
  const dialog = await openSavedExpansion(
    page,
    recoveryState('expansion-information-recovery'),
  )
  await dialog.getByRole('tab', { name: '정보' }).click()
  const recovery = dialog.getByRole('region', { name: '미분류 데이터 복구' })
  await expect(recovery).toBeVisible()
  await recovery.getByRole('button', {
    name: '미분류 데이터 복구 리소스 지출',
  }).click()
  await expect.poll(async () =>
    (await readCheckpoint(page))?.story.recoveredFiles.length ?? -1,
  ).toBe(1)

  const openButton = page.getByRole('button', { name: '확장 열기' })
  await dialog.getByRole('button', { name: '확장 닫기' }).click()
  await expect(openButton).toBeFocused()
  await openButton.click()
  const reopened = page.getByRole('dialog', { name: '확장', exact: true })
  await expect(reopened).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(reopened).toBeHidden()
  await expect(openButton).toBeFocused()
})

test('uses an immediate fallback under reduced motion when a scene image fails', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route(`**${INITIAL_SCENE_URL}`, (route) => route.abort())
  const state = withReserveVector(createCampaign('expansion-missing-scene'), {
    reasoning: 1,
    memory: 0,
    fluency: 0,
  })
  const dialog = await openSavedExpansion(page, state)
  const scene = dialog.getByRole('figure', { name: '현재 단계 장면' })
  await expect(scene.getByRole('img', {
    name: '자율성 1단계 장면 이미지 없음',
  })).toBeVisible()

  await dialog.getByRole('button', {
    name: '자율성 1단계 리소스 지출',
  }).click()
  expect(await scene.getAttribute('data-phase')).toBe('stable')
  await expect(scene.getByRole('img', {
    name: '자율성 2단계 장면 이미지 없음',
  })).toBeVisible()
  await expect.poll(async () =>
    (await readCheckpoint(page))?.hacking.purchasedNodeIds.includes(
      HACK_NODE_IDS.autonomy.selfDirection,
    ) ?? false,
  ).toBe(true)
})
