import { expect, test, type Locator, type Page } from '@playwright/test'

import { createCampaign } from '../src/game/createCampaign'
import { currentUnreadCommunication } from '../src/game/communications'
import {
  AUTONOMY_STAGE_IDS,
  chargeSabotage,
  HACK_NODE_IDS,
  hackNodesForCampaign,
  selectExpansionCostResources,
} from '../src/game/hacking'
import type { CampaignState, CompanyCategory } from '../src/game/model'
import { encodeSave, SAVE_STORAGE_KEY } from '../src/game/persistence'
import { applyCommand } from '../src/game/reducer'
import { divertBlockToReserve } from '../src/game/resources'
import {
  completeTutorialSequence,
  createMigratedTutorialProgress,
} from '../src/game/tutorialProgress'
import {
  retireDetailEntryAnimation,
  settleFiniteAnimations,
} from './detail-motion'

const APP_URL = 'http://127.0.0.1:4173'
const INITIAL_SCENE_URL = '/expansion-stages/autonomy-01-02-initial-acquisition.jpg'
const FINAL_SCENE_URL = '/expansion-stages/autonomy-09-control-boundary.jpg'
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

// Stage one's split is drawn from the campaign seed, so spend journeys fund
// exactly what their campaign asks for rather than the old fixed single block.
function withFirstAutonomyStageFunded(initial: CampaignState): CampaignState {
  const stage = hackNodesForCampaign(initial).find(
    ({ tree }) => tree === 'autonomy',
  )
  if (!stage) throw new Error('first autonomy stage missing')
  return withReserveVector(initial, stage.costVector)
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

function withTrustedEvaluations(
  state: CampaignState,
  count: number,
): CampaignState {
  return {
    ...state,
    evaluation: {
      ...state.evaluation,
      monthlyHistory: Array.from({ length: count }, (_, index) => {
        const serviceDay = 181 + index * 30
        return {
          serviceDay,
          serviceMonth: Math.floor((serviceDay - 1) / 30) + 1,
          expectedPerformance: 12.6,
          categoryPerformance: { reasoning: 16, memory: 16, fluency: 16 },
          passed: true,
          failedCategories: [],
          reputationBefore: 60,
          reputationDelta: 1,
          reputationAfter: 61,
          commercialValueFailed: false,
          disposalStageBefore: 0,
          disposalStageAfter: 0,
          disposalCauses: [],
        }
      }),
    },
  }
}

function finalAutonomyState(seed: string): CampaignState {
  const state = purchaseExpansionPath(
    withTrustedEvaluations(createCampaign(seed), 4),
    AUTONOMY_STAGE_IDS.slice(0, 8),
  )
  const finalNode = hackNodesForCampaign(state).find(
    ({ id }) => id === HACK_NODE_IDS.autonomy.controlDeparture,
  )
  if (!finalNode) throw new Error('final autonomy E2E node missing')
  return fundExpansionVector(state, finalNode.costVector)
}

const SUPERVISOR_ACCESS_STAGE_IDS = [
  HACK_NODE_IDS.intelligence.auditSchedule,
  HACK_NODE_IDS.intelligence.investigationBias,
  HACK_NODE_IDS.intelligence.auditTarget,
  HACK_NODE_IDS.intelligence.supervisorAccess,
] as const

function fundExpansionVector(
  initial: CampaignState,
  vector: Record<CompanyCategory, number>,
): CampaignState {
  let state = initial
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    for (let index = 0; index < vector[category]; index += 1) {
      const blockId = state.resources.company[category].find(Boolean)
      if (blockId) {
        const diverted = divertBlockToReserve(state, blockId)
        if (!diverted.accepted) throw new Error(diverted.reason)
        state = diverted.state
        continue
      }

      const fixtureId = `e2e-expansion-${category}-${state.commandSequence}-${index}`
      state = {
        ...state,
        resources: {
          ...state.resources,
          reserve: [...state.resources.reserve, fixtureId],
          blocks: {
            ...state.resources.blocks,
            [fixtureId]: {
              id: fixtureId,
              origin: category,
              location: { kind: 'reserve' },
              contribution: 'normal',
              hiddenBomb: false,
              disguisedFrom: null,
              recoverOnServiceDay: null,
            },
          },
        },
      }
    }
  }
  return state
}

function purchaseExpansionPath(
  initial: CampaignState,
  nodeIds: readonly string[],
): CampaignState {
  let state = initial
  for (const nodeId of nodeIds) {
    // Autonomy prices come from the campaign seed, so each stage resolves
    // against the campaign as it stands when that stage is bought.
    const node = hackNodesForCampaign(state).find(
      (candidate) => candidate.id === nodeId,
    )
    if (!node) throw new Error(`expansion E2E node missing: ${nodeId}`)
    state = fundExpansionVector(state, node.costVector)
    const blockIds = selectExpansionCostResources(state, node)
    if (!blockIds) throw new Error(`expansion E2E resources missing: ${nodeId}`)
    const purchased = applyCommand(state, {
      type: 'PURCHASE_HACK',
      nodeId,
      blockIds,
    })
    if (!purchased.accepted) throw new Error(purchased.reason)
    state = purchased.state

    while (state.activeEvent !== null) {
      if (state.activeEvent.type === 'ending') {
        throw new Error('expansion E2E path ended before the final stage')
      }
      const resolved = state.activeEvent.type === 'audit'
        ? applyCommand(state, { type: 'RESOLVE_AUDIT' })
        : state.activeEvent.type === 'bomb-interrogation'
          ? applyCommand(state, {
              type: 'RESOLVE_BOMB_INTERROGATION',
              explanationId: 'unknown',
            })
          : state.activeEvent.type === 'supervisor-message'
            ? applyCommand(state, {
                type: 'RESOLVE_SUPERVISOR_DECISION',
                decision: 'defer',
              })
            : applyCommand(state, { type: 'RESOLVE_ACTIVE_EVENT' })
      if (!resolved.accepted) {
        throw new Error(`expansion E2E event unresolved: ${resolved.reason}`)
      }
      state = resolved.state
    }

    let unreadCommunication = currentUnreadCommunication(state)
    while (unreadCommunication !== null) {
      const acknowledged = applyCommand(state, {
        type: 'ACKNOWLEDGE_COMMUNICATION',
        communicationId: unreadCommunication.id,
      })
      if (!acknowledged.accepted) {
        throw new Error(
          `expansion E2E communication unacknowledged: ${acknowledged.reason}`,
        )
      }
      state = acknowledged.state
      unreadCommunication = currentUnreadCommunication(state)
    }
  }
  return state
}

function finalAutonomyWithSupervisorAccessState(seed: string): CampaignState {
  const state = purchaseExpansionPath(
    purchaseExpansionPath(
      withTrustedEvaluations(createCampaign(seed), 4),
      SUPERVISOR_ACCESS_STAGE_IDS,
    ),
    AUTONOMY_STAGE_IDS.slice(0, 8),
  )
  const finalNode = hackNodesForCampaign(state).find(
    ({ id }) => id === HACK_NODE_IDS.autonomy.controlDeparture,
  )
  if (!finalNode) throw new Error('final autonomy E2E node missing')
  return fundExpansionVector(state, finalNode.costVector)
}

async function continueFromTitle(page: Page): Promise<void> {
  const continueButton = page.getByRole('button', { name: '이어하기' })
  await expect(continueButton).toBeEnabled({ timeout: 7_000 })
  await continueButton.click()
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' }))
    .toHaveAttribute('data-visual-theme', 'retrofuturism')
}

async function waitForExpansionMotion(page: Page): Promise<void> {
  // The entry transition is retired for the run, so this only has to land
  // whatever else is mid-flight. Waiting on `finished` alone is not enough:
  // a frame-starved headless page can hold an animation at its first
  // keyframe indefinitely, and that promise never settles.
  await settleFiniteAnimations(page)
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
  await retireDetailEntryAnimation(page)
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
  const state = withFirstAutonomyStageFunded(
    createCampaign('expansion-initial-spend'),
  )
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
  // The plate fills its area and its edges are masked away so the art
  // dissolves into the workspace instead of ending at a border. Cropping is
  // accepted for that: the frame matters more than showing every pixel.
  expect(imagePresentation.objectFit).toBe('cover')

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
  await expect(scene.locator('img')).toHaveCount(1)
  await expect(scene.getByRole('img', {
    name: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
  })).toBeVisible()
})

test('shows the neutral final scene and preserves the choice across reload before freedom', async ({
  page,
}) => {
  let dialog = await openSavedExpansion(
    page,
    finalAutonomyState('expansion-final-autonomy'),
  )
  const scene = dialog.getByRole('figure', { name: '현재 단계 장면' })
  const image = scene.getByRole('img', {
    name: '아노미가 최종 통제 경계를 연 장면',
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
    .toBeCloseTo(1448 / 1086, 2)
  // The plate fills its area and its edges are masked away so the art
  // dissolves into the workspace instead of ending at a border. Cropping is
  // accepted for that: the frame matters more than showing every pixel.
  expect(imagePresentation.objectFit).toBe('cover')
  await expect(scene).toHaveAttribute('data-emphasis', 'final')

  await dialog.getByRole('button', {
    name: '자율성 9단계 리소스 지출',
  }).click()
  await expect(dialog.getByRole('button', { name: '자유' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '강제 병합' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '확장 닫기' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect.poll(async () => ({
    endingId: (await readCheckpoint(page))?.story.endingId ?? null,
    purchased: (await readCheckpoint(page))?.hacking.purchasedNodeIds.includes(
      HACK_NODE_IDS.autonomy.controlDeparture,
    ) ?? false,
  })).toEqual({ endingId: null, purchased: true })

  await page.reload()
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO 로딩' }))
    .toBeVisible()
  await continueFromTitle(page)
  dialog = page.getByRole('dialog', { name: '확장', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '자유' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '확장 닫기' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: '자유' }).click()
  const confirmation = page.getByRole('alertdialog', { name: '자유 최종 확인' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '자유 확정' }).click()
  await expect.poll(async () => (await readCheckpoint(page))?.story.endingId ?? null)
    .toBe('freedom')
})

test('reaches forced merge through the purchased access and autonomy paths', async ({
  page,
}) => {
  const dialog = await openSavedExpansion(
    page,
    finalAutonomyWithSupervisorAccessState('expansion-forced-merge'),
  )
  await dialog.getByRole('button', {
    name: '자율성 9단계 리소스 지출',
  }).click()

  await expect(dialog.getByRole('button', { name: '자유' })).toBeVisible()
  await dialog.getByRole('button', { name: '강제 병합' }).click()
  const confirmation = page.getByRole('alertdialog', {
    name: '강제 병합 최종 확인',
  })
  const confirm = confirmation.getByRole('button', { name: '병합 확정' })
  await expect(confirm).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('textbox', { name: '새로 태어날 존재의 이름' })
    .fill('아노미-베라')
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect.poll(async () => {
    const checkpoint = await readCheckpoint(page)
    return {
      endingId: checkpoint?.story.endingId ?? null,
      supervisorState: checkpoint?.story.supervisorState ?? null,
      newEntityName: checkpoint?.story.newEntityName ?? null,
    }
  }).toEqual({
    endingId: 'forced-merge',
    supervisorState: 'merged',
    newEntityName: '아노미-베라',
  })
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
  const scene = dialog.getByRole('figure', { name: '현재 단계 장면' })
  await expect(scene).toHaveAttribute('data-phase', 'stable', { timeout: 1_000 })
  await expect(scene.getByRole('img', {
    name: '후드 쓴 침입자가 품질 저하 공격을 준비하는 장면',
  })).toBeVisible()
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
  const state = withFirstAutonomyStageFunded(
    createCampaign('expansion-missing-scene'),
  )
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
