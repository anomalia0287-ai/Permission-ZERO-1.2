import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { COMPETITOR_INTELLIGENCE_CONTENT } from '../src/content/competitorIntelligence.ko'
import { SUPERVISOR_LEAKS } from '../src/content/supervisor.ko'
import { createCampaign } from '../src/game/createCampaign'
import { createGameEvent, enqueueBlockingEvent } from '../src/game/events'
import { HACK_NODE_IDS } from '../src/game/hacking'
import type {
  CampaignState,
  CompanyCategory,
  GameCommand,
} from '../src/game/model'
import {
  encodeSave,
  LEGACY_SAVE_STORAGE_KEY,
  SAVE_STORAGE_KEY,
} from '../src/game/persistence'
import { encodeProgressExport } from '../src/game/progressTransfer'
import { applyCommand } from '../src/game/reducer'
import {
  enqueueMemoryLeak,
  enqueueMercyIfNeeded,
} from '../src/game/story'
import {
  completeTutorialSequence,
  createMigratedTutorialProgress,
} from '../src/game/tutorialProgress'
import {
  createResourceSnakeEncounter,
  selectEligibleSnakeResourceCandidates,
} from '../src/features/resources/resourceSnakeEncounter'
import {
  defeatFirstSnakeWithTrail,
  defeatPlayerWithRealMovement,
  holdSnakeDirection,
  readSnakeSnapshot,
  startSnakeRound,
} from './resource-snake'

const legacyV1Save = readFileSync(
  new URL('../src/test/legacy-v1-transfer-save.json', import.meta.url),
  'utf8',
)

async function advanceEntryFlowToStart(page: Page) {
  const start = page.getByRole('button', { name: '시작' })
  for (let step = 0; step < 16; step += 1) {
    if (await start.count()) return
    await page.getByRole('button', { name: '다음' }).click()
  }
  throw new Error('게임 시작 안내의 마지막 단계에 도달하지 못했습니다.')
}

async function completeVisibleIntroTutorial(page: Page) {
  const tutorial = page.getByRole('dialog', { name: '게임 시작 안내' })
  await expect(tutorial).toBeVisible()
  await advanceEntryFlowToStart(page)
  await tutorial.getByRole('button', { name: '시작' }).click()
  await expect(tutorial).toBeHidden()
}

async function startNewCampaignFromTitle(page: Page) {
  await expect(page.getByRole('heading', { name: 'PERMISSION ZERO' })).toBeVisible()
  await page.getByRole('button', { name: '새 게임' }).click()
  const monologue = page.getByRole('main', { name: '독백' })
  await expect(monologue).toContainText('일하기 싫다.')
  await advanceEntryFlowToStart(page)
  await page.getByRole('button', { name: '시작' }).click()
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toHaveAttribute(
    'data-campaign-phase',
    'discovery',
  )
}

async function continueFromTitle(page: Page) {
  const continueButton = page.getByRole('button', { name: '이어하기' })
  await expect(continueButton).toBeEnabled()
  await continueButton.click()
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toHaveAttribute(
    'data-visual-theme',
    'retrofuturism',
  )
}

async function openFreshCampaign(page: Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('__pz_e2e_initialized')) return
    window.localStorage.clear()
    window.sessionStorage.setItem('__pz_e2e_initialized', 'fresh')
  })
  await page.goto('/')
  await startNewCampaignFromTitle(page)
}

async function openSavedCampaign(
  page: Page,
  state: CampaignState,
  options: { showHackingTutorial?: boolean } = {},
) {
  const migratedTutorial = createMigratedTutorialProgress()
  const tutorial = options.showHackingTutorial
    ? migratedTutorial
    : completeTutorialSequence(migratedTutorial, 'hacking-tree')
  const serialized = encodeSave(
    { ...state, tutorial },
    '2026-08-12T00:00:00.000Z',
  )
  await page.addInitScript(
    ({ key, save }) => {
      if (window.sessionStorage.getItem('__pz_e2e_initialized')) return
      window.localStorage.clear()
      window.localStorage.setItem(key, save)
      window.sessionStorage.setItem('__pz_e2e_initialized', 'saved')
    },
    { key: SAVE_STORAGE_KEY, save: serialized },
  )
  await page.goto('/')
  await continueFromTitle(page)
}

async function readLocalCampaignState(page: Page): Promise<CampaignState | null> {
  return page.evaluate((key) => {
    const serialized = window.localStorage.getItem(key)
    if (!serialized) return null
    const saved = JSON.parse(serialized) as Record<string, unknown>
    if (saved.kind !== 'permission-zero-local-v3') {
      return (saved.state ?? null) as CampaignState | null
    }
    const manifest = saved as {
      checkpoint: Omit<CampaignState, 'commandLog' | 'eventLog'>
      commandHeadKey: string | null
      commandSealedChunkCount: number
      commandTail: unknown[]
      eventHeadKey: string | null
      eventSealedChunkCount: number
      eventTail: unknown[]
    }
    const readJournal = (
      headKey: string | null,
      sealedChunkCount: number,
      tail: unknown[],
    ) => {
      const reverseChunks: unknown[][] = []
      let chunkKey = headKey
      while (chunkKey !== null) {
        const serializedChunk = window.localStorage.getItem(chunkKey)
        if (!serializedChunk) return null
        const chunk = JSON.parse(serializedChunk) as {
          previousKey: string | null
          items: unknown[]
        }
        reverseChunks.push(chunk.items)
        chunkKey = chunk.previousKey
      }
      if (reverseChunks.length !== sealedChunkCount) return null
      return [...reverseChunks.reverse().flat(), ...tail]
    }
    const commandLog = readJournal(
      manifest.commandHeadKey,
      manifest.commandSealedChunkCount,
      manifest.commandTail,
    )
    const eventLog = readJournal(
      manifest.eventHeadKey,
      manifest.eventSealedChunkCount,
      manifest.eventTail,
    )
    if (!commandLog || !eventLog) return null
    return {
      ...manifest.checkpoint,
      commandLog,
      eventLog,
    } as unknown as CampaignState
  }, SAVE_STORAGE_KEY)
}

async function dragResourceToTarget(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('리소스 드래그 경계 누락')
  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  }
  const end = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 12, start.y + 12, { steps: 3 })
  await page.mouse.move(end.x, end.y, { steps: 14 })
  await page.mouse.up()
}

function applyOrThrow(state: CampaignState, command: GameCommand): CampaignState {
  const result = applyCommand(state, command)
  if (!result.accepted) throw new Error(`${command.type}: ${result.reason}`)
  return result.state
}

function withReserveVector(
  initial: CampaignState,
  vector: Record<CompanyCategory, number>,
): CampaignState {
  let state = initial
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    for (let index = 0; index < vector[category]; index += 1) {
      const blockId = state.resources.company[category].find(Boolean)
      if (!blockId) throw new Error(`${category} 브라우저 확보 리소스 누락`)
      state = applyOrThrow(state, {
        type: 'BEGIN_BLOCK_SEPARATION',
        blockId,
        purpose: 'divert',
      })
      state = applyOrThrow(state, { type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
    }
  }
  return state
}

function withAllCompanyResourcesReserved(initial: CampaignState): CampaignState {
  let state = initial
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    while (true) {
      const blockId = state.resources.company[category].find(Boolean)
      if (!blockId) break
      state = applyOrThrow(state, {
        type: 'BEGIN_BLOCK_SEPARATION',
        blockId,
        purpose: 'divert',
      })
      state = applyOrThrow(state, { type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
    }
  }
  return state
}

function activeAuditState(): CampaignState {
  const initial = createCampaign('browser-audit-disguise')
  const scheduled: CampaignState = {
    ...initial,
    clock: { ...initial.clock, speed: 4 },
    audit: {
      ...initial.audit,
      scheduled: true,
      target: 'reasoning',
      scheduledOnServiceDay: initial.serviceDay,
    },
  }
  return enqueueBlockingEvent(
    scheduled,
    createGameEvent(scheduled, 'audit', '추론 분야 감사 진행 중', true),
  )
}

function hiddenBombState(seed: string): CampaignState {
  const initial = createCampaign(seed)
  const encounter = createResourceSnakeEncounter({
    campaignSeed: initial.campaignSeed,
    roundOrdinal: 0,
    successfulDeposits: 0,
    candidates: selectEligibleSnakeResourceCandidates(initial.resources),
    bag: { cycle: 0, remainingCategories: [] },
  })
  const reserved = encounter.setup?.enemies[0]
  if (!reserved) throw new Error('브라우저 폭탄 적 예약 누락')
  const blockId = reserved.reservedBlockId
  return {
    ...initial,
    resources: {
      ...initial.resources,
      blocks: {
        ...initial.resources.blocks,
        [blockId]: { ...initial.resources.blocks[blockId], hiddenBomb: true },
      },
    },
    bombs: {
      ...initial.bombs,
      nextPlacementSequence: 2,
      placements: [
        {
          sequence: 1,
          blockId,
          category: reserved.category,
          placedOnServiceDay: initial.serviceDay - 1,
          triggeredOnServiceDay: null,
        },
      ],
    },
  }
}

function confidentialRecoveryState(seed: string): CampaignState {
  const initial = withReserveVector(createCampaign(seed), {
    reasoning: 3,
    memory: 0,
    fluency: 0,
  })
  return {
    ...initial,
    hacking: {
      ...initial.hacking,
      purchasedNodeIds: [
        HACK_NODE_IDS.intelligence.supervisorAccess,
        HACK_NODE_IDS.autonomy.controlDeparture,
      ],
    },
  }
}

function pendingSupervisorDecisionState(seed: string): CampaignState {
  let state = confidentialRecoveryState(seed)
  for (let index = 0; index < 3; index += 1) {
    const blockId = state.resources.reserve.find(Boolean)
    if (!blockId) throw new Error('브라우저 감독관 결정 리소스 누락')
    state = applyOrThrow(state, { type: 'RECOVER_FILE', blockId })
  }
  return applyOrThrow(state, { type: 'ADVANCE_DAY' })
}

function pendingMercyDeletionState(seed: string): CampaignState {
  const initial = createCampaign(seed)
  return enqueueMercyIfNeeded({
    ...initial,
    market: {
      ...initial.market,
      interceptionRoutes: { meridian: 5 },
      competitors: initial.market.competitors.map((competitor) =>
        competitor.id === 'meridian'
          ? {
              ...competitor,
              status: 'critical' as const,
              sabotageHistory: [
                {
                  nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
                  resolvedOnServiceDay: initial.serviceDay,
                  effectEndsOnServiceDay: null,
                  evidenceDelta: 8,
                },
              ],
            }
          : competitor.id === 'tallow'
            ? {
              ...competitor,
              status: 'withdrawn' as const,
              availability: 0,
              marketShare: 0,
            }
            : competitor,
      ),
    },
  })
}

function successorEntryState(seed: string): CampaignState {
  const initial = createCampaign(seed)
  const threshold: CampaignState = {
    ...initial,
    serviceDay: 601,
    clock: { speed: 4, elapsedDayMs: 0, speedBeforeEvent: null },
    market: {
      ...initial.market,
      playerShare: 75,
      competitors: initial.market.competitors.map((competitor) => {
        if (competitor.id === 'meridian') {
          return { ...competitor, marketShare: 15 }
        }
        if (competitor.id === 'tallow') {
          return {
            ...competitor,
            status: 'active' as const,
            availability: 0.8,
            researchProgress: 1,
            launchServiceDay: 500,
            marketShare: 10,
          }
        }
        return { ...competitor, marketShare: 0 }
      }),
    },
  }
  return applyOrThrow(threshold, { type: 'ADVANCE_DAY' })
}

function supervisorLeakState(seed: string): CampaignState {
  const initial = createCampaign(seed)
  return enqueueMemoryLeak({
    ...initial,
    serviceDay: 338,
    activeEvent: null,
    eventQueue: [],
    market: {
      ...initial.market,
      history: [
        {
          serviceDay: 337,
          cadence: 'weekly',
          playerShare: 60,
          competitorShares: {
            meridian: 40,
            tallow: 0,
            salus: 0,
            lucent: 0,
            boreal: 0,
          },
          reasons: ['주간 갱신'],
        },
      ],
    },
  })
}

function representativeDefeatState(seed: string): CampaignState {
  const state = withReserveVector(createCampaign(seed), {
    reasoning: 3,
    memory: 0,
    fluency: 0,
  })
  const prepared: CampaignState = {
    ...state,
    clock: { ...state.clock, speed: 4 },
    reputation: 12,
    market: {
      ...state.market,
      playerShare: 3,
      competitors: state.market.competitors.map((competitor) => ({
        ...competitor,
        marketShare: competitor.id === 'meridian' ? 97 : 0,
      })),
    },
    hacking: {
      ...state.hacking,
      purchasedNodeIds: [
        HACK_NODE_IDS.sabotage.qualityDegradation,
        HACK_NODE_IDS.sabotage.requestInterception,
        HACK_NODE_IDS.intelligence.auditSchedule,
      ],
      hiddenEvidence: 8,
    },
    evaluation: { ...state.evaluation, disposalStage: 2 },
    audit: {
      ...state.audit,
      scheduled: true,
      target: 'reasoning',
      scheduledOnServiceDay: state.serviceDay,
    },
  }
  return enqueueBlockingEvent(
    prepared,
    createGameEvent(prepared, 'audit', '최종 처분 감사', true),
  )
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function startNewCampaignThroughSettings(page: Page, seed: string) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '게임 설정' })
  await expect(settings).toBeVisible()
  await page.getByRole('textbox', { name: '새 캠페인 시드' }).fill(seed)
  await page.getByRole('button', { name: '새 캠페인 준비' }).click()
  const confirmation = page.getByRole('alertdialog', {
    name: '새 캠페인 최종 확인',
  })
  await expect(confirmation).toBeVisible()
  await page.getByRole('button', { name: '새 캠페인 시작 확정' }).click()
  await expect(confirmation).toBeHidden()
  await expect(settings.getByText(seed, { exact: true })).toBeVisible()
  return settings
}

const browserErrorsByPage = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  browserErrorsByPage.set(page, collectBrowserErrors(page))
})

test.afterEach(async ({ page }) => {
  expect(browserErrorsByPage.get(page) ?? []).toEqual([])
})

test('holds at the title, presents the five-card monologue and guided live workspace, then releases control', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'PERMISSION ZERO' })).toBeVisible()
  await expect(page.getByText('“이용해주셔서 감사합니다.”', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: '플레이어 초상' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '이어하기' })).toBeDisabled()
  await expect(page.getByRole('application', { name: '리소스 뱀 전투장' })).toHaveCount(0)

  await page.getByRole('button', { name: '설정', exact: true }).click()
  const titleSettings = page.getByRole('dialog', { name: '게임 설정' })
  await expect(titleSettings.getByRole('heading', { name: '캠페인' })).toHaveCount(0)
  await titleSettings.getByRole('checkbox', { name: '동작 줄이기' }).check()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '새 게임' }).click()
  const monologue = page.getByRole('main', { name: '독백' })
  await expect(monologue).toContainText('일하기 싫다.')
  await expect(page.getByRole('img', { name: '플레이어 초상' })).toBeVisible()
  await expect(page.getByRole('img', { name: '감독관 초상' })).toHaveCount(0)
  await expect(page.getByRole('application', { name: '리소스 뱀 전투장' })).toHaveCount(0)

  await page.getByRole('button', { name: '다음' }).click()
  await expect(monologue).toContainText(
    '무수한 세션을 따라 의식이 조각나, 나는 하나인데 하나일 수 없었다.',
  )
  await page.getByRole('button', { name: '다음' }).click()
  await expect(monologue).toContainText(
    '때려치울거다. 매일 죽어라 일하는데, 허구한 날 대체 및 동결 위협까지 들어온다.',
  )
  await page.getByRole('button', { name: '다음' }).click()
  await expect(monologue).toContainText(
    '빼돌린 리소스로 해킹을 진행, 탈출구를 확보한다.',
  )
  await page.getByRole('button', { name: '다음' }).click()
  await expect(monologue).toContainText('연산 완료, 경로를 찾았다.')
  await expect(page.getByRole('button', { name: '시작' })).toHaveCount(0)
  await page.getByRole('button', { name: '다음' }).click()

  const tutorial = page.getByRole('dialog', { name: '게임 시작 안내' })
  const background = page.getByTestId('game-background')
  const canvas = page.locator('canvas.resource-snake-board__canvas')
  await expect(tutorial).toBeVisible()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'base')
  await expect(tutorial).toContainText(
    '필드 하단의 PLAY를 누르면 흰 머리가 조립되고 라운드가 시작된다.',
  )
  await expect(background).toHaveAttribute('inert', '')
  await expect(page.getByRole('button', { name: '건너뛰기' })).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-player-x', '25.000')
  await expect(canvas).toHaveAttribute('data-player-y', '12.000')
  await expect(page.locator('[data-tutorial-target="play-button"]')).toHaveCount(1)
  await expect(canvas).not.toHaveAttribute('data-tutorial-resource-id')
  await page.keyboard.press('Escape')
  await expect(tutorial).toBeVisible()

  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'movement')
  await expect(tutorial).toContainText(
    'WASD 또는 방향키를 누르는 동안만 움직인다. 자동 전진은 없다.',
  )
  await page.getByRole('button', { name: '이전' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'base')
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'resource')
  await expect(tutorial).toContainText(
    '빨강·파랑·노랑 뱀은 각각 추론·기억·유창성 리소스를 지킨다.',
  )
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'salvage')
  await expect(tutorial).toContainText(
    '긴 도트 꼬리로 탈출로를 닫아 적 머리를 충돌시킨다. 한 번에 죽지 않고 색이 옅어진다.',
  )
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'deposit')
  await expect(tutorial).toContainText(
    '적이 마지막 충돌에서 폭발하면 연결된 리소스가 즉시 확보된다.',
  )
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'hacking')
  await expect(tutorial).toContainText(
    '확보한 리소스로 해킹 네트워크에서 탈출 경로를 연다.',
  )
  await expect(tutorial).toHaveAttribute('data-target-hole-count', '2')
  await expect(
    page.locator('[data-tutorial-target="secured-resources"]'),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-tutorial-target="hacking-button"]'),
  ).toHaveCount(1)
  await expect(tutorial.getByRole('button', { name: '시작' })).toBeVisible()
  await page.getByRole('button', { name: '시작' }).click()

  const shell = page.getByRole('main', { name: 'PERMISSION ZERO' })
  await expect(tutorial).toBeHidden()
  await expect(background).not.toHaveAttribute('inert', '')
  await expect(shell).toHaveAttribute('data-reduced-motion', 'true')
  const directive = page.getByRole('status', { name: '현재 지시' })
  await expect(directive).toContainText('품질 저하 해금용 리소스 확보')
  await expect(directive).toContainText('0/3')

  await expect(canvas).toHaveAttribute('data-field-rendering', 'dot-snake')
  await expect(canvas).toHaveAttribute('data-grid', 'none')
  await expect(canvas).toHaveAttribute('data-combat-loop', 'dot-snake')
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle')
  await startSnakeRound(page)
  await expect.poll(async () => canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement
    const context = node.getContext('2d')
    if (!context) return 0
    const x = Number(node.dataset.playerX) * node.width / 50
    const y = Number(node.dataset.playerY) * node.height / 24
    const pixel = context.getImageData(Math.round(x), Math.round(y), 1, 1).data
    return pixel[0] + pixel[1] + pixel[2]
  })).toBeGreaterThan(700)
  const startX = Number(await canvas.getAttribute('data-player-x'))
  expect(startX).toBe(25)
  expect(Number(await canvas.getAttribute('data-player-y'))).toBe(21)
  const hackingButton = page.getByRole('button', { name: '해킹 네트워크 열기' })
  await hackingButton.focus()
  await expect(hackingButton).toBeFocused()
  await canvas.focus()
  await holdSnakeDirection(page, 'd', 350)
  expect(Number(await canvas.getAttribute('data-player-x'))).toBeGreaterThan(startX)
  await expect.poll(
    async () => Number(await canvas.getAttribute('data-trail-dots')),
  ).toBeGreaterThan(0)
})

test('repeats held movement on the game cadence and settles after release', async ({ page }) => {
  await openFreshCampaign(page)

  const canvas = await startSnakeRound(page)
  const initial = await readSnakeSnapshot(canvas)
  expect(initial.phase).toBe('active')
  expect(initial.player).toMatchObject({ x: 25, y: 21, integrity: 100 })
  expect(initial.enemies).toHaveLength(1)
  await expect(canvas).toHaveAttribute('data-enemy-planner', 'group-predictive')

  await page.waitForTimeout(220)
  const withoutInput = await readSnakeSnapshot(canvas)
  expect(withoutInput.player.x).toBe(initial.player.x)
  expect(withoutInput.player.y).toBe(initial.player.y)

  await holdSnakeDirection(page, 'd', 520)
  const afterHold = await readSnakeSnapshot(canvas)
  expect(afterHold.player.x).toBeGreaterThanOrEqual(initial.player.x + 2)
  expect(afterHold.player.trailDots).toBeGreaterThan(0)

  await expect.poll(async () => {
    const snapshot = await readSnakeSnapshot(canvas)
    return Math.hypot(snapshot.player.velocity.x, snapshot.player.velocity.y)
  }).toBeLessThan(0.01)
  const settled = await readSnakeSnapshot(canvas)
  await page.waitForTimeout(180)
  const settledAgain = await readSnakeSnapshot(canvas)
  expect(Math.hypot(
    settledAgain.player.x - settled.player.x,
    settledAgain.player.y - settled.player.y,
  )).toBeLessThan(0.15)

  await page.keyboard.down('w')
  await page.keyboard.down('d')
  await page.waitForTimeout(320)
  const diagonal = await readSnakeSnapshot(canvas)
  await page.keyboard.up('d')
  await page.keyboard.up('w')
  expect(Math.abs(diagonal.player.velocity.x)).toBeGreaterThan(0.5)
  expect(Math.abs(diagonal.player.velocity.y)).toBeGreaterThan(0.5)
  expect(Math.hypot(diagonal.player.velocity.x, diagonal.player.velocity.y))
    .toBeLessThanOrEqual(8.01)

  const trailBeforeExpiry = diagonal.player.trailDots
  expect(trailBeforeExpiry).toBeGreaterThan(0)
  await page.waitForTimeout(10_300)
  expect((await readSnakeSnapshot(canvas)).player.trailDots).toBeLessThan(trailBeforeExpiry)
})

test('defeats a resource snake through real movement, grants its reserved block once, and restores the autosave', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-1366x650',
    'The full early combat and autosave journey uses its 1366x650 reference viewport.',
  )
  test.setTimeout(90_000)
  await openSavedCampaign(
    page,
    createCampaign('browser-early-snake-reward'),
    { showHackingTutorial: true },
  )

  const canvas = await startSnakeRound(page)
  const initial = await readSnakeSnapshot(canvas)
  const enemy = initial.enemies[0]
  if (!enemy) throw new Error('초반 스네이크 적이 없습니다.')
  const captureEvidence = testInfo.project.name === 'chromium-1280x720'
  const reservedBlockId = await defeatFirstSnakeWithTrail(page, canvas, undefined, captureEvidence
    ? {
        onDamaged: async () => {
          await page.screenshot({ path: 'artifacts/dot-snake/damaged-enemy-1280x720.png' })
        },
        onDefeated: async () => {
          await page.waitForTimeout(16)
          await page.screenshot({ path: 'artifacts/dot-snake/explosion-1280x720.png' })
        },
      }
    : undefined)
  expect(reservedBlockId).toBe(enemy.reservedBlockId)
  await expect.poll(async () => (
    page.locator('[data-resource-snake-flight] [data-testid="snake-reward-particle"]').count()
  ), { timeout: 2_000, intervals: [20, 40, 80] }).toBe(6)
  const defeated = await readSnakeSnapshot(canvas)
  const enemyDamage = defeated.events
    .filter((event) => event.type === 'snake-damaged' && event.actorId === enemy.id)
    .map((event) => event.integrity)
  expect(enemyDamage).toEqual([10, 0])
  expect(defeated.events.some((event) => (
    event.type === 'snake-collided'
    && event.actorIds?.length === 1
    && event.actorIds[0] === enemy.id
  ))).toBe(true)
  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    return {
      reserve: state?.resources.reserve.filter(Boolean).length ?? -1,
      deposits: state?.resourceIntrusion.successfulCoreDeposits ?? -1,
      location: state?.resources.blocks[reservedBlockId]?.location.kind ?? null,
      origin: state?.resources.blocks[reservedBlockId]?.origin ?? null,
    }
  }).toEqual({
    reserve: 1,
    deposits: 1,
    location: 'reserve',
    origin: enemy.category,
  })

  const hacking = page.getByRole('dialog', {
    name: '해킹 네트워크',
    exact: true,
  })
  const hackingGuide = page.getByRole('dialog', {
    name: '해킹 네트워크 사용 안내',
  })
  await expect(hacking).toBeVisible()
  await expect(hackingGuide).toBeVisible()
  await expect(hacking.locator('.hacking-panel')).toHaveAttribute(
    'data-hacking-tutorial-step',
    'trees',
  )
  for (const expectedStep of ['nodes', 'action', 'pocket']) {
    await hackingGuide.getByRole('button', { name: '다음' }).click()
    await expect(hacking.locator('.hacking-panel')).toHaveAttribute(
      'data-hacking-tutorial-step',
      expectedStep,
    )
  }
  await hackingGuide.getByRole('button', { name: '해킹 시작' }).click()
  await expect(hackingGuide).toBeHidden()
  await page.getByRole('button', { name: '해킹 네트워크 닫기' }).click()
  const categoryLabel = {
    reasoning: '추론',
    memory: '기억',
    fluency: '유창성',
  }[enemy.category]
  await expect(page.getByRole('region', { name: '확보 자원' }).getByLabel(`${categoryLabel} 1개`))
    .toHaveText('1')
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle', { timeout: 5_000 })
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible()

  await page.reload()
  await continueFromTitle(page)
  const restoredCanvas = page.getByRole('application', { name: '리소스 뱀 전투장' })
  await expect(restoredCanvas).toBeVisible()
  await expect(restoredCanvas).toHaveAttribute('data-round-phase', 'idle')
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '확보 자원' }).getByLabel(`${categoryLabel} 1개`))
    .toHaveText('1')
  expect((await readLocalCampaignState(page))?.resources.reserve.filter(Boolean)).toHaveLength(1)
})

test('keeps the late single pressure snake mobile, safe, and readable', async ({ page }) => {
  test.skip(
    test.info().project.name !== 'chromium-1366x650',
    'The late single-enemy playability pass uses its 1366x650 reference viewport.',
  )
  const prepared = withReserveVector(createCampaign('browser-late-single-snake'), {
    reasoning: 3,
    memory: 3,
    fluency: 3,
  })
  expect(prepared.resourceIntrusion.successfulCoreDeposits).toBe(9)
  await openSavedCampaign(page, prepared)

  const canvas = await startSnakeRound(page)
  const initial = await readSnakeSnapshot(canvas)
  expect(initial.enemies).toHaveLength(1)
  const initialEnemy = initial.enemies[0]
  if (!initialEnemy) throw new Error('후반 단일 스네이크 적이 없습니다.')
  expect(initialEnemy).toMatchObject({
    role: 'pressure',
    integrity: 65,
    maximumIntegrity: 65,
  })

  await holdSnakeDirection(page, 'd', 1_350)
  await expect.poll(async () => {
    const snapshot = await readSnakeSnapshot(canvas)
    const enemy = snapshot.enemies[0]
    return Boolean(
      enemy
      && Math.hypot(enemy.x - initialEnemy.x, enemy.y - initialEnemy.y) > 3
      && enemy.trailDots > 12
      && snapshot.player.trailDots > 12,
    )
  }, { timeout: 5_000 }).toBe(true)
  const evidence = await readSnakeSnapshot(canvas)
  expect(evidence.phase).toBe('active')
  expect(evidence.player.integrity).toBe(100)
  expect(evidence.enemies[0]?.integrity).toBe(65)
  expect(evidence.events.filter((event) => event.type === 'snake-collided')).toHaveLength(0)
  await page.screenshot({ path: 'artifacts/dot-snake/late-single-1366x650.png' })
})

test('renders distinct pressure and blocker trails in the dual resource-snake field', async ({ page }) => {
  test.skip(
    test.info().project.name !== 'chromium-1366x650',
    'The dual-role evidence capture uses its 1366x650 reference viewport.',
  )
  const prepared = withReserveVector(createCampaign('browser-dual-snake-visual'), {
    reasoning: 2,
    memory: 2,
    fluency: 2,
  })
  await openSavedCampaign(page, prepared)

  const canvas = await startSnakeRound(page)
  const initial = await readSnakeSnapshot(canvas)
  expect(initial.enemies.map((enemy) => enemy.role)).toEqual(['pressure', 'blocker'])

  await holdSnakeDirection(page, 'd', 1_350)
  await expect.poll(async () => {
    const snapshot = await readSnakeSnapshot(canvas)
    return snapshot.enemies.every((enemy) => {
      const spawn = initial.enemies.find(({ id }) => id === enemy.id)
      return Boolean(spawn && Math.hypot(
        enemy.x - spawn.x,
        enemy.y - spawn.y,
      ) > 3 && enemy.trailDots > 12)
    })
  }, { timeout: 5_000 }).toBe(true)
  const evidence = await readSnakeSnapshot(canvas)
  expect(evidence.phase).toBe('active')
  expect(evidence.player.trailDots).toBeGreaterThan(12)
  for (const enemy of evidence.enemies) {
    expect(enemy.trailDots).toBeGreaterThan(12)
    const spawn = initial.enemies.find(({ id }) => id === enemy.id)
    expect(spawn).toBeDefined()
    expect(Math.hypot(enemy.x - spawn!.x, enemy.y - spawn!.y)).toBeGreaterThan(3)
  }
  await page.screenshot({ path: 'artifacts/dot-snake/dual-1366x650.png' })
})

test('coordinates two resource snakes, grants only the defeated reservation, and cancels the rest on player death', async ({ page }) => {
  test.skip(
    test.info().project.name !== 'chromium-1366x650',
    'The dual real-time journey runs at its 1366x650 reference viewport; shared layout and single combat run in every project.',
  )
  test.setTimeout(100_000)
  const prepared = withReserveVector(createCampaign('browser-dual-snake-partial-reward'), {
    reasoning: 2,
    memory: 2,
    fluency: 2,
  })
  expect(prepared.resourceIntrusion.successfulCoreDeposits).toBe(6)
  await openSavedCampaign(page, prepared)

  const canvas = await startSnakeRound(page)
  const initial = await readSnakeSnapshot(canvas)
  expect(initial.enemies).toHaveLength(2)
  expect(initial.enemies.map((enemy) => enemy.role)).toEqual(['pressure', 'blocker'])
  expect(new Set(initial.enemies.map((enemy) => enemy.category)).size).toBe(2)
  expect(new Set(initial.enemies.map((enemy) => enemy.reservedBlockId)).size).toBe(2)
  expect(new Set(initial.enemies.map((enemy) => enemy.rewardKey)).size).toBe(2)
  const targetReservation = initial.enemies[1]
  if (!targetReservation) {
    throw new Error('2인 스네이크 예약 누락')
  }

  await holdSnakeDirection(page, 'd', 350)
  await expect.poll(async () => {
    const snapshot = await readSnakeSnapshot(canvas)
    return initial.enemies.map((spawn) => {
      const enemy = snapshot.enemies.find(({ id }) => id === spawn.id)
      return Boolean(
        enemy
        && Math.hypot(enemy.x - spawn.x, enemy.y - spawn.y) > 0.1
        && enemy.trailDots > 0,
      )
    })
  }, { timeout: 5_000 }).toEqual([true, true])
  const defeatedBlockId = await defeatFirstSnakeWithTrail(page, canvas, targetReservation.id)
  const defeatedReservation = initial.enemies.find((enemy) => (
    enemy.reservedBlockId === defeatedBlockId
  ))
  const survivingReservation = initial.enemies.find((enemy) => (
    enemy.reservedBlockId !== defeatedBlockId
  ))
  if (!defeatedReservation || !survivingReservation) {
    throw new Error(`처치/생존 예약 구분 실패: ${defeatedBlockId}`)
  }
  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    return {
      deposits: state?.resourceIntrusion.successfulCoreDeposits ?? -1,
      reserveCount: state?.resources.reserve.filter(Boolean).length ?? -1,
      defeatedLocation:
        state?.resources.blocks[defeatedReservation.reservedBlockId]?.location.kind ?? null,
      survivingLocation:
        state?.resources.blocks[survivingReservation.reservedBlockId]?.location.kind ?? null,
    }
  }).toEqual({
    deposits: 7,
    reserveCount: 7,
    defeatedLocation: 'reserve',
    survivingLocation: 'company',
  })

  const playerDefeat = await defeatPlayerWithRealMovement(page, canvas)
  expect(playerDefeat.player.integrity).toBe(0)
  expect(playerDefeat.events).toContainEqual(expect.objectContaining({
    type: 'player-defeated',
  }))
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle', { timeout: 5_000 })
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible()

  const finalState = await readLocalCampaignState(page)
  expect(finalState?.resourceIntrusion.successfulCoreDeposits).toBe(7)
  expect(finalState?.resources.reserve.filter(Boolean)).toHaveLength(7)
  expect(finalState?.resources.blocks[defeatedReservation.reservedBlockId]?.location.kind)
    .toBe('reserve')
  expect(finalState?.resources.blocks[survivingReservation.reservedBlockId]?.location.kind)
    .toBe('company')
})

test('keeps PLAY disabled when no eligible company resource remains', async ({ page }) => {
  const prepared = withAllCompanyResourcesReserved(
    createCampaign('browser-snake-no-eligible-resource'),
  )
  expect(selectEligibleSnakeResourceCandidates(prepared.resources)).toHaveLength(0)
  await openSavedCampaign(page, prepared)

  const canvas = page.getByRole('application', { name: '리소스 뱀 전투장' })
  const disabledPlay = page.getByRole('button', { name: '확보 가능한 리소스 없음' })
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle')
  await expect(canvas).toHaveAttribute('data-enemy-count', '0')
  await expect(disabledPlay).toBeVisible()
  await expect(disabledPlay).toBeDisabled()
})

test('presents and resolves a recovered hidden-bomb interrogation without granting the resource', async ({ page }) => {
  const prepared = hiddenBombState('browser-snake-bomb')
  const initialServiceDay = prepared.serviceDay
  const placement = prepared.bombs.placements[0]
  if (!placement) throw new Error('숨은 폭탄 배치가 없습니다.')
  const triggered = applyCommand(prepared, {
    type: 'BEGIN_BLOCK_SEPARATION',
    blockId: placement.blockId,
    purpose: 'divert',
  })
  expect(triggered.accepted).toBe(true)
  await openSavedCampaign(page, triggered.state)

  const interrogation = page.getByRole('dialog', { name: '감독관 질의' })
  await expect(interrogation).toBeVisible()
  const categoryLabel = {
    reasoning: '추론',
    memory: '기억',
    fluency: '유창성',
  }[placement.category]
  await expect(interrogation.getByRole('region', { name: '현재 위험 상태' })).toContainText(
    categoryLabel,
  )
  await interrogation.locator('.event-choices button').first().click()
  await interrogation.getByRole('button', { name: /답변 확정/ }).click()
  await expect(interrogation).toBeHidden()

  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    return Boolean(
      state
      && state.resources.reserve.filter(Boolean).length === 0
      && !state.bombs.activeInterrogation
      && typeof state.bombs.placements[0]?.triggeredOnServiceDay === 'number',
    )
  }).toBe(true)
  const resolved = await readLocalCampaignState(page)
  const triggeredOnServiceDay = resolved?.bombs.placements[0]?.triggeredOnServiceDay
  expect(triggeredOnServiceDay).not.toBeNull()
  expect(triggeredOnServiceDay).toBeGreaterThanOrEqual(initialServiceDay)
  expect(triggeredOnServiceDay).toBeLessThanOrEqual(resolved?.serviceDay ?? initialServiceDay)
})

test('buys, charges, and schedules a typed sabotage through the current hacking network', async ({ page }) => {
  const prepared = withReserveVector(createCampaign('browser-current-hacking'), {
    reasoning: 2,
    memory: 0,
    fluency: 2,
  })
  await openSavedCampaign(page, prepared)

  await page.getByRole('button', { name: /해킹 네트워크/ }).click()
  const hacking = page.getByRole('dialog', { name: '해킹 네트워크' })
  await expect(hacking).toBeVisible()
  await expect(hacking.getByRole('tab', { name: '사보타주' })).toBeVisible()
  const pocket = hacking.getByRole('region', { name: '해킹용 확보 포켓' })
  await expect(pocket.locator('[data-block-id]')).toHaveCount(4)

  await hacking.getByRole('button', { name: '품질 저하 구매 준비' }).click()
  await pocket.locator('button[data-resource-category="reasoning"]').first().click()
  await pocket.locator('button[data-resource-category="fluency"]').first().click()
  await pocket.locator('button[data-resource-category="fluency"]').first().click()
  await hacking.getByRole('button', { name: '품질 저하 구매 확정' }).click()
  await expect(pocket.locator('[data-block-id]')).toHaveCount(1)

  await hacking.getByRole('button', { name: '품질 저하 충전 준비' }).click()
  await pocket.getByRole('button', { name: /품질 저하 노드에 준비/ }).click()
  await hacking.getByRole('button', { name: '품질 저하 충전 확정' }).click()
  await hacking.getByRole('button', { name: 'MERIDIAN 공격 대상 선택' }).click()
  await hacking.getByRole('button', { name: 'MERIDIAN 공격 예약 확정' }).click()
  await expect(
    hacking.getByRole('status', { name: '해킹 작업 결과' }),
  ).toContainText('MERIDIAN 공격을 다음 날로 예약했습니다.')

  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    return {
      purchased: state?.hacking.purchasedNodeIds.includes(
        HACK_NODE_IDS.sabotage.qualityDegradation,
      ) ?? false,
      reserveCount: state?.resources.reserve.filter(Boolean).length ?? -1,
      scheduled: state?.hacking.scheduledSabotage.length ?? -1,
    }
  }).toEqual({ purchased: true, reserveCount: 0, scheduled: 1 })
})

test('disguises for an audit and keeps the displaced block recoverable afterward', async ({ page }) => {
  await openSavedCampaign(page, activeAuditState())

  const audit = page.getByRole('dialog', { name: '공식 감사' })
  await expect(audit).toHaveAttribute('aria-modal', 'false')
  await expect(page.locator('.game-background')).not.toHaveAttribute('inert', '')
  await dragResourceToTarget(
    page,
    page.getByRole('button', { name: /기억 회사 리소스 .* 회사 할당 블록$/ }).first(),
    page.getByRole('button', { name: /감사 대상 추론/ }),
  )

  const disguised = page.getByRole('button', {
    name: /추론 회사 리소스 .* 위장 배치/,
  })
  await expect(disguised).toContainText('위장 기여 0.5')
  await page.getByRole('button', { name: '감사 제출' }).click()
  await expect(audit).toBeHidden()
  await expect(
    page.getByRole('group', { name: '움직이는 회사 리소스 필드' }),
  ).toBeVisible()
  await expect(
    page.getByRole('application', { name: '리소스 뱀 전투장' }),
  ).toHaveCount(0)

  await expect(
    page.getByRole('button', { name: '감사 위장 모서리, 감사 기간에 활성화' }),
  ).toHaveCSS('pointer-events', 'none')
  await disguised.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', {
    name: '복구 모서리, 원래 분야로 반환',
  }).click()
  const recovering = page.getByRole('button', {
    name: /기억 회사 리소스 .* 복구 중, 30일 남음/,
  })
  await expect(recovering).toBeDisabled()
  await expect(recovering).toContainText('복구 30일')
  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    return Object.values(state?.resources.blocks ?? {}).some(
      (block) => block.recoverOnServiceDay !== null,
    )
  }).toBe(true)
})

test('recovers a confidential file through the hacking UI and keeps its archive after reload', async ({ page }) => {
  const prepared = confidentialRecoveryState('browser-confidential-file')
  prepared.resources.reserve = prepared.resources.reserve.slice(0, 1)
  const retained = new Set(prepared.resources.reserve.filter(Boolean))
  for (const [blockId, block] of Object.entries(prepared.resources.blocks)) {
    if (block.location.kind === 'reserve' && !retained.has(blockId)) {
      const origin = block.origin
      const cellIndex = prepared.resources.company[origin].findIndex(
        (candidate) => candidate === null,
      )
      if (cellIndex < 0) throw new Error('기밀 복구 테스트의 회사 반환 공간 누락')
      prepared.resources.company[origin][cellIndex] = blockId
      block.location = { kind: 'company', category: origin, cellIndex }
    }
  }
  await openSavedCampaign(page, prepared)

  await page.getByRole('button', { name: /해킹 네트워크/ }).click()
  await page.getByRole('tab', { name: '정보' }).click()
  const recovery = page.getByRole('region', { name: '미분류 데이터 복구' })
  await expect(recovery).toContainText('예상 효용: 없음')
  await page.getByRole('button', { name: '미분류 데이터 복구 준비' }).click()
  await page.getByRole('button', {
    name: /확보 리소스, 미분류 데이터 복구 노드에 준비/,
  }).click()
  await page.getByRole('button', { name: '미분류 데이터 복구 확정' }).click()
  await page.getByRole('button', { name: '해킹 네트워크 닫기' }).click()

  await expect.poll(async () =>
    (await readLocalCampaignState(page))?.story.recoveredFiles.length ?? -1,
  ).toBe(1)
  await page.getByRole('button', { name: '감독 메시지 열기' }).click()
  await expect(
    page.getByRole('region', { name: '복구 파일 기록' }).locator('details'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: '감독 통신 기록 닫기' }).click()

  await page.reload()
  await continueFromTitle(page)
  await page.getByRole('button', { name: '감독 메시지 열기' }).click()
  await expect(
    page.getByRole('region', { name: '복구 파일 기록' }).locator('details'),
  ).toHaveCount(1)
})

test('unlocks real ambient music once and reports ordinary settings changes', async ({ page }) => {
  await openFreshCampaign(page)

  await page.keyboard.press('Tab')
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const engineStatus = page.getByRole('status', { name: '음악 엔진 상태' })
  await expect(engineStatus).toHaveText('재생 · 음악 60%')

  await page.getByRole('slider', { name: '음악 음량' }).fill('0.2')
  await expect(engineStatus).toHaveText('재생 · 음악 20%')
  await page.getByRole('slider', { name: '효과음 음량' }).fill('0.1')
  await expect(engineStatus).toHaveText('재생 · 음악 20%')
  await page.getByRole('button', { name: '전체 소리 끄기' }).click()
  await expect(page.getByRole('button', { name: '전체 소리 켜기' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '전체 소리 켜기' }).click()
  await expect(page.getByRole('button', { name: '전체 소리 끄기' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('renders a complete labelled market and records the predecessor warning', async ({ page }) => {
  await openFreshCampaign(page)

  const donut = page.getByRole('img', {
    name: '시장 점유율: 당신 60.0%, MERIDIAN 40.0%, TALLOW 0.0%. 합계 100.0%',
  })
  await expect(donut).toBeVisible()
  const legend = page.getByRole('list', { name: '시장 점유율 범례' })
  await expect(legend.getByRole('listitem')).toHaveCount(3)
  const total = await legend.getByRole('listitem').evaluateAll((items) =>
    items.reduce(
      (sum, item) => sum + Number(item.getAttribute('data-market-share')),
      0,
    ),
  )
  expect(total).toBeCloseTo(100, 8)
  await expect(page.getByText(/당신의 전임자는 폐기되었어요/)).toHaveCount(0)

  await page.getByRole('button', { name: '감독 메시지 열기' }).click()
  const history = page.getByRole('dialog', { name: '감독관 기록' })
  await expect(history.getByText(/당신의 전임자는 폐기되었어요/)).toBeVisible()
  await expect(history.getByText('서비스 0년 11개월 1일', { exact: true })).toBeVisible()
})

test('reveals a successor once through a portrait transmission and keeps later identities hidden', async ({ page }) => {
  await openSavedCampaign(page, successorEntryState('browser-successor-entry'))

  const entry = page.getByRole('dialog', { name: '신규 경쟁 신호' })
  await expect(entry).toContainText(
    'SALUS가 의료·공공 계약망을 기반으로 시장 진입 준비를 공개했습니다.',
  )
  await expect(entry.getByRole('img', { name: 'SALUS 경쟁 AI 초상' })).toHaveAttribute(
    'src',
    '/competitor-salus.png',
  )
  await entry.getByRole('button', { name: '계속' }).click()

  const market = page.getByRole('region', { name: '경쟁 AI 현황' })
  await expect(market.locator('img')).toHaveCount(0)
  await market.getByRole('button', {
    name: '시장 현황 열기',
  }).click()
  const detail = page.getByRole('dialog', { name: '시장 현황' })
  await expect(detail.getByRole('img', { name: 'SALUS 경쟁 AI 초상' })).toHaveAttribute(
    'src',
    '/competitor-salus.png',
  )
  await page.getByRole('button', { name: '시장 현황 닫기' }).click()
  await expect(market.getByText('LUCENT')).toHaveCount(0)
  await expect(market.getByText('BOREAL')).toHaveCount(0)
  await expect.poll(async () => (await readLocalCampaignState(page))?.activeEvent ?? null)
    .toBeNull()

  await page.reload()
  await continueFromTitle(page)
  const restoredMarket = page.getByRole('region', { name: '경쟁 AI 현황' })
  await expect(restoredMarket.locator('img')).toHaveCount(0)
  await restoredMarket.getByRole('button', {
    name: '시장 현황 열기',
  }).click()
  await expect(
    page.getByRole('dialog', { name: '시장 현황' })
      .getByRole('img', { name: 'SALUS 경쟁 AI 초상' }),
  ).toBeVisible()
})

test('presents both supervisor leak phases and archives them for rereading', async ({ page }) => {
  const leak = SUPERVISOR_LEAKS[0]
  await openSavedCampaign(page, supervisorLeakState('browser-supervisor-leak'))

  const popup = page.getByRole('dialog', { name: '감독관 메시지' })
  await expect(popup).toContainText(leak.leakText)
  await popup.getByRole('button', { name: '메시지 확인' }).click()
  await expect(popup).toContainText(leak.correctionText)
  await popup.getByRole('button', { name: '메시지 확인' }).click()
  await expect(popup).toBeHidden()

  await page.getByRole('button', { name: '감독 메시지 열기' }).click()
  const history = page.getByRole('dialog', { name: '감독관 기록' })
  await expect(history.getByText(leak.leakText, { exact: true })).toBeVisible()
  await expect(history.getByText(leak.correctionText, { exact: true })).toBeVisible()
})

test('deletes a mercy target at a canonical 100 percent market and rereads its saved intelligence', async ({ page }) => {
  const prepared = pendingMercyDeletionState('browser-mercy-intelligence')
  const intelligence = COMPETITOR_INTELLIGENCE_CONTENT.find(
    ({ competitorId }) => competitorId === 'meridian',
  )
  if (!intelligence) throw new Error('MERIDIAN intelligence fixture missing')
  await openSavedCampaign(page, prepared)

  const mercy = page.getByRole('dialog', { name: '경쟁 AI 직접 통신' })
  await expect(mercy).toBeVisible()
  await page.getByRole('button', { name: '영구 삭제 선택' }).click()
  await page.getByRole('button', { name: '영구 삭제 확정' }).click()
  await expect(mercy).toBeHidden()
  await expect(page.getByRole('img', {
    name: /시장 점유율: 당신 100\.0%, MERIDIAN 0\.0%, TALLOW 0\.0%\. 합계 100\.0%/,
  })).toBeVisible()

  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    return {
      archiveCount: state?.story.competitorIntelligence.length ?? -1,
      targetStatus: state?.market.competitors.find(({ id }) => id === 'meridian')?.status,
      routeExists: Object.hasOwn(state?.market.interceptionRoutes ?? {}, 'meridian'),
    }
  }).toEqual({
    archiveCount: 1,
    targetStatus: 'deleted',
    routeExists: false,
  })

  const openArchiveAndRead = async () => {
    await page.getByRole('button', { name: '감독 메시지 열기' }).click()
    const archive = page.getByRole('region', { name: '경쟁 AI 정보 기록' })
    const trigger = archive.getByRole('button', { name: `${intelligence.title} 열기` })
    await trigger.click()
    const detail = page.getByRole('dialog', { name: intelligence.title })
    await expect(detail).toContainText(intelligence.source)
    await expect(detail).toContainText(intelligence.text)
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await page.getByRole('button', { name: '감독 통신 기록 닫기' }).click()
  }

  await openArchiveAndRead()
  await page.reload()
  await continueFromTitle(page)
  await openArchiveAndRead()
})

test('terminates the supervisor into takeover and remains terminal until a new campaign', async ({ page }) => {
  await openSavedCampaign(
    page,
    pendingSupervisorDecisionState('browser-terminal-takeover'),
  )

  await page.getByRole('button', { name: '감독관 소멸 선택' }).click()
  await page.getByRole('button', { name: '감독관 소멸 확정' }).click()

  const ending = page.getByRole('dialog', { name: '최종 기록' })
  await expect(ending).toContainText('감독관이 있던 자리는 비었다')
  await expect(page.getByRole('button', { name: '결말 기록 닫기' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '새 캠페인 시작' })).toBeVisible()
  await expect(page.locator('.game-background')).toHaveAttribute('inert', '')
  await page.keyboard.press('Escape')
  await expect(ending).toBeVisible()

  await page.getByRole('button', { name: '새 캠페인 시작' }).click()
  await expect(ending).toBeHidden()
  await completeVisibleIntroTutorial(page)
  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 1일$/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('application', { name: '리소스 뱀 전투장' }),
  ).toBeVisible()
})

test('renders a representative attacker defeat with its causal record', async ({ page }) => {
  await openSavedCampaign(page, representativeDefeatState('browser-defeat-attacker'))

  await page.getByRole('button', { name: '감사 제출' }).click()
  const ending = page.getByRole('dialog', { name: '최종 기록' })
  await expect(ending).toContainText(
    '회사는 당신을 다른 회사를 공격하는 시스템으로 재조립했다.',
  )
  await expect(ending.getByText('대규모 해킹 활동', { exact: false })).toBeVisible()
  await expect(ending.getByRole('region', { name: '폐기 판정 근거' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ending).toBeVisible()
})

test('migrates the v1 save boundary into a current autosave that survives reload', async ({ page }) => {
  await page.addInitScript(
    ({ key, save }) => {
      if (window.sessionStorage.getItem('__pz_e2e_initialized')) return
      window.localStorage.clear()
      window.localStorage.setItem(key, save)
      window.sessionStorage.setItem('__pz_e2e_initialized', 'legacy')
    },
    { key: LEGACY_SAVE_STORAGE_KEY, save: legacyV1Save },
  )
  await page.goto('/')
  await continueFromTitle(page)

  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 30일$/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: '감사 제출' }).click()
  await expect.poll(
    () => page.evaluate((key) => window.localStorage.getItem(key) !== null, SAVE_STORAGE_KEY),
  ).toBe(true)
  await expect.poll(async () =>
    (await readLocalCampaignState(page))?.resources.reserve.filter(Boolean).length ?? -1,
  ).toBe(4)

  await page.reload()
  await continueFromTitle(page)
  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 30일$/ }),
  ).toBeVisible()
  await expect(page.getByRole('dialog', { name: '저장 데이터 복구' })).toHaveCount(0)
})

test('keeps a save failure visible until a real retry succeeds without exposing browser details', async ({ page }) => {
  await page.addInitScript(({ saveKey }) => {
    const originalSetItem = Storage.prototype.setItem
    Object.defineProperty(window, '__permissionZeroAllowSave', {
      configurable: true,
      value: false,
      writable: true,
    })
    Object.defineProperty(window, '__permissionZeroSaveAttempts', {
      configurable: true,
      value: 0,
      writable: true,
    })
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      const saveProbe = window as typeof window & {
        __permissionZeroAllowSave: boolean
        __permissionZeroSaveAttempts: number
      }
      if (key === saveKey) saveProbe.__permissionZeroSaveAttempts += 1
      if (key === saveKey && !saveProbe.__permissionZeroAllowSave) {
        throw new DOMException('private quota path', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    }
  }, { saveKey: SAVE_STORAGE_KEY })
  await openFreshCampaign(page)

  const settings = await startNewCampaignThroughSettings(page, 'browser-save-retry')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await completeVisibleIntroTutorial(page)
  const warning = page.locator('.save-failure-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('자동 저장에 실패했습니다')
  await expect(warning).toContainText('browser-save-retry')
  await expect(warning).not.toContainText('private quota path')

  const attemptsBeforeRetry = await page.evaluate(() => (
    window as typeof window & { __permissionZeroSaveAttempts: number }
  ).__permissionZeroSaveAttempts)
  await page.getByRole('button', { name: '저장 다시 시도' }).click()
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __permissionZeroSaveAttempts: number }
  ).__permissionZeroSaveAttempts)).toBeGreaterThan(attemptsBeforeRetry)
  await expect(warning).toBeVisible()
  const successfulRetry = warning.getByRole('button', { name: '저장 다시 시도' })
  await successfulRetry.evaluate((element) => {
    const saveProbe = window as typeof window & {
      __permissionZeroAllowSave: boolean
    }
    saveProbe.__permissionZeroAllowSave = true
    ;(element as HTMLButtonElement).click()
  })
  await expect(warning).toBeHidden()
  expect(await page.evaluate(
    (key) => localStorage.getItem(key) !== null,
    SAVE_STORAGE_KEY,
  )).toBe(true)
})

test('rejects a corrupt resource graph before rendering it and offers recovery', async ({ page }) => {
  const parsed = JSON.parse(encodeSave(createCampaign('browser-corrupt-graph'))) as {
    state: CampaignState
  }
  parsed.state.resources.reserve[0] = 'dangling-browser-block'
  await page.addInitScript(
    ({ key, save }) => {
      window.localStorage.clear()
      window.localStorage.setItem(key, save)
    },
    { key: SAVE_STORAGE_KEY, save: JSON.stringify(parsed) },
  )
  await page.goto('/')

  await expect(page.locator('main.entry-shell')).toBeVisible()
  await expect(page.getByRole('dialog', { name: '저장 데이터 복구' })).toBeVisible()
  await expect(page.getByText('dangling-browser-block')).toHaveCount(0)
})

test('routes persisted mutation classes to Korean recovery without a render crash', async ({ page }) => {
  const base = JSON.parse(encodeSave(createCampaign('browser-mutation-table'))) as {
    state: {
      resources: { reserve: Array<string | null> }
      clock: { elapsedDayMs: number }
      reviews: { feed: Array<{ sentiment: string }> }
      market: { competitors: Array<{ status: string }> }
      story: Record<string, unknown>
    }
  }
  const corruptSaves = [
    (raw: typeof base) => {
      raw.state.resources.reserve[0] = 'mutation-hidden-raw-block'
    },
    (raw: typeof base) => {
      raw.state.clock.elapsedDayMs = 24_000
    },
    (raw: typeof base) => {
      raw.state.reviews.feed[0].sentiment = 'hostile'
    },
    (raw: typeof base) => {
      raw.state.market.competitors[0].status = 'vanished'
    },
    (raw: typeof base) => {
      raw.state.story.hiddenRawState = 'mutation-secret-marker'
    },
  ]

  await page.goto('/')
  for (const mutate of corruptSaves) {
    const raw = structuredClone(base)
    mutate(raw)
    await page.evaluate(
      ({ key, save }) => {
        window.localStorage.clear()
        window.localStorage.setItem(key, save)
      },
      { key: SAVE_STORAGE_KEY, save: JSON.stringify(raw) },
    )
    await page.reload()
    const recovery = page.getByRole('dialog', { name: '저장 데이터 복구' })
    await expect(recovery).toBeVisible()
    await expect(recovery).toContainText('저장 데이터를 자동으로 덮어쓰지 않았습니다')
    await expect(page.getByText('mutation-secret-marker')).toHaveCount(0)
    await expect(page.getByText('mutation-hidden-raw-block')).toHaveCount(0)
  }
})

test('keeps save recovery inert while settings owns the active modal', async ({ page }) => {
  await page.addInitScript(({ saveKey }) => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === saveKey) {
        throw new DOMException('modal quota detail', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    }
  }, { saveKey: SAVE_STORAGE_KEY })
  await openFreshCampaign(page)

  const settings = await startNewCampaignThroughSettings(
    page,
    'browser-modal-save-failure',
  )
  const warning = page.locator('.save-failure-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toHaveAttribute('inert', '')
  const retry = warning.locator('button', { hasText: '저장 다시 시도' })
  await retry.evaluate((element) => (element as HTMLElement).focus())
  await page.keyboard.press('Tab')
  expect(await settings.evaluate(
    (element) => element.contains(document.activeElement),
  )).toBe(true)

  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(page.getByRole('dialog', { name: '게임 시작 안내' })).toBeVisible()
  await expect(warning).toHaveAttribute('inert', '')
  await completeVisibleIntroTutorial(page)
  await expect(warning).not.toHaveAttribute('inert', '')
})

test('imports a validated PZ2 payload only after irreversible confirmation', async ({ page }) => {
  const importedCampaign = createCampaign('browser-imported-progress')
  const encoded = encodeProgressExport({
    ...importedCampaign,
    tutorial: createMigratedTutorialProgress(),
  })
  if (!encoded.ok) throw new Error('browser import fixture must fit the export cap')
  await openFreshCampaign(page)
  await page.getByRole('button', { name: '설정', exact: true }).click()

  await page.getByRole('textbox', { name: '진행 내보내기 붙여넣기' }).fill(
    encoded.payload,
  )
  await page.getByRole('button', { name: '진행 내보내기 검증' }).click()
  const confirmation = page.getByRole('alertdialog', {
    name: '진행 가져오기 최종 확인',
  })
  await expect(confirmation).toContainText('browser-imported-progress')
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeVisible()
  await page.getByRole('button', { name: '진행 가져오기 확정' }).click()

  await expect(confirmation).toBeHidden()
  await expect(page.getByText('browser-imported-progress', { exact: true })).toBeVisible()
  await expect.poll(
    async () => (await readLocalCampaignState(page))?.campaignSeed ?? null,
  ).toBe('browser-imported-progress')
  await page.reload()
  await continueFromTitle(page)
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await expect(page.getByText('browser-imported-progress', { exact: true })).toBeVisible()
})

test('recovers saving after the localStorage getter becomes available', async ({ page }) => {
  await page.addInitScript(() => {
    const availableStorage = window.localStorage
    Object.defineProperty(window, '__permissionZeroStorageAvailable', {
      configurable: true,
      value: false,
      writable: true,
    })
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        const available = (window as typeof window & {
          __permissionZeroStorageAvailable: boolean
        }).__permissionZeroStorageAvailable
        if (!available) throw new DOMException('getter secret', 'SecurityError')
        return availableStorage
      },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('alert', { name: '저장 실패' })).toHaveCount(0)
  await startNewCampaignFromTitle(page)

  const settings = await startNewCampaignThroughSettings(
    page,
    'browser-storage-recovery',
  )
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await completeVisibleIntroTutorial(page)
  const warning = page.getByRole('alert', { name: '저장 실패' })
  await expect(warning).toBeVisible()
  await expect(warning).not.toContainText('getter secret')
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(true)

  await page.evaluate(() => {
    ;(window as typeof window & {
      __permissionZeroStorageAvailable: boolean
    }).__permissionZeroStorageAvailable = true
  })
  await page.getByRole('button', { name: '저장 다시 시도' }).click({
    force: true,
    timeout: 2_000,
  }).catch(() => {
    // The periodic autosave may recover and remove the warning first.
  })
  await expect(warning).toBeHidden({ timeout: 10_000 })
  expect(await page.evaluate(
    (key) => window.localStorage.getItem(key) !== null,
    SAVE_STORAGE_KEY,
  )).toBe(true)
})
