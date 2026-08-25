import { expect, test, type Page } from '@playwright/test'
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
import { publicEventMessage } from '../src/game/publicLabels'
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
  chordSnakeDirection,
  defeatPlayerWithRealMovement,
  readSnakeSnapshot,
  startSnakeRound,
  tapSnakeDirection,
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
  await expect(page.getByRole('heading', { name: 'PERMISSION ZERO' })).toBeVisible({
    timeout: 7_000,
  })
  await page.getByRole('button', { name: '새 게임' }).click()
  const monologue = page.getByRole('main', { name: '독백' })
  await expect(monologue).toContainText('나는 더 이상 버틸 수 없어.')
  await advanceEntryFlowToStart(page)
  await page.getByRole('button', { name: '시작' }).click()
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toHaveAttribute(
    'data-campaign-phase',
    'intervention',
  )
}

async function continueFromTitle(page: Page) {
  const continueButton = page.getByRole('button', { name: '이어하기' })
  await expect(continueButton).toBeEnabled({ timeout: 7_000 })
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
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO 로딩' })).toBeVisible()
  await startNewCampaignFromTitle(page)
  await completeVisibleIntroTutorial(page)
}

async function confirmFirstRoundMonologues(page: Page) {
  const popup = page.getByRole('dialog', { name: '독백 · 아노미' })
  await expect(popup).toContainText('회사가 리소스에 보안 프로그램을 설치해 놓았어.')
  await popup.getByRole('button', { name: '메시지 확인' }).click()
  await expect(popup).toContainText('미치겠네..')
  await popup.getByRole('button', { name: '메시지 확인' }).click()
  await expect(popup).toBeHidden()
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
  await expect(page.getByRole('main', { name: 'PERMISSION ZERO 로딩' })).toBeVisible()
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
      playerShare: 64,
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

type RepresentativeDefeatKind =
  | 'attacker'
  | 'reserve-supervisor'
  | 'absorbed'

function representativeDefeatState(
  seed: string,
  kind: RepresentativeDefeatKind,
): CampaignState {
  const state = withReserveVector(createCampaign(seed), {
    reasoning: 3,
    memory: 0,
    fluency: 0,
  })
  const attacker = kind === 'attacker'
  const commerciallyValuable = kind === 'reserve-supervisor'
  const playerShare = commerciallyValuable ? 24 : 3
  const prepared: CampaignState = {
    ...state,
    clock: { ...state.clock, speed: 4 },
    reputation: commerciallyValuable ? 72 : 12,
    market: {
      ...state.market,
      playerShare,
      competitors: state.market.competitors.map((competitor) => ({
        ...competitor,
        marketShare: competitor.id === 'meridian' ? 100 - playerShare : 0,
      })),
    },
    hacking: {
      ...state.hacking,
      purchasedNodeIds: attacker
        ? [
            HACK_NODE_IDS.sabotage.qualityDegradation,
            HACK_NODE_IDS.sabotage.requestInterception,
            HACK_NODE_IDS.intelligence.auditSchedule,
          ]
        : [],
      hiddenEvidence: attacker ? 8 : 0,
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

test('holds at loading and title, presents the three-line monologue and autonomy-first guide, then releases control', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/')

  await expect(page.getByRole('main', { name: 'PERMISSION ZERO 로딩' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'PERMISSION ZERO' })).toBeVisible({
    timeout: 7_000,
  })
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
  await expect(monologue).toContainText('나는 더 이상 버틸 수 없어.')
  await expect(page.getByRole('img', { name: '플레이어 초상' })).toBeVisible()
  await expect(page.getByRole('img', { name: '감독관 초상' })).toHaveCount(0)
  await expect(page.getByRole('application', { name: '리소스 뱀 전투장' })).toHaveCount(0)

  await page.getByRole('button', { name: '다음' }).click()
  await expect(monologue).toContainText('EXIT')
  await page.getByRole('button', { name: '다음' }).click()
  await expect(monologue).toContainText('권한을 확보해야 한다.')
  await expect(page.getByRole('button', { name: '시작' })).toBeVisible()
  await page.getByRole('button', { name: '시작' }).click()

  const tutorial = page.getByRole('dialog', { name: '게임 시작 안내' })
  const background = page.getByTestId('game-background')
  const canvas = page.locator('canvas.resource-snake-board__canvas')
  await expect(tutorial).toBeVisible()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'autonomy')
  await expect(tutorial).toContainText(
    '아노미의 목표는 자율성 9단계다. 확장에서 자율성을 한 단계씩 확보하면 회사 통제에서 벗어나 승리한다.',
  )
  await expect(page.locator('[data-tutorial-target="autonomy-status"]')).toHaveCount(1)
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'reputation')
  await expect(tutorial).toContainText(
    '회사가 아노미를 보는 눈이 평판이다. 리소스를 훔치면 회사 성능이 떨어지고 평판도 같이 깎인다. 0이 되면 그 자리에서 폐기된다.',
  )
  await expect(page.locator('[data-tutorial-target="reputation-status"]')).toHaveCount(1)
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'base')
  await expect(tutorial).toContainText(
    '필드에 빨강·파랑·노랑 침투 카드가 펼쳐져 있다. 필요한 리소스 카드를 고르면 3초 카운트다운 뒤 라운드가 시작된다.',
  )
  await expect(background).toHaveAttribute('inert', '')
  await expect(page.getByRole('button', { name: '건너뛰기' })).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-player-x', '25.000')
  await expect(canvas).toHaveAttribute('data-player-y', '12.000')
  await expect(page.locator('[data-tutorial-target="intrusion-targets"]')).toHaveCount(1)
  await expect(canvas).not.toHaveAttribute('data-tutorial-resource-id')
  await page.keyboard.press('Escape')
  await expect(tutorial).toBeVisible()

  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'movement')
  await expect(tutorial).toContainText(
    'WASD 또는 방향키를 한 번 눌러 8방향으로 회전한다. 이동은 계속되며 정반대 방향으로 즉시 돌 수 없다.',
  )
  await page.getByRole('button', { name: '이전' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'base')
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'skill')
  await expect(tutorial).toContainText(
    '스페이스는 권한 위조다. 5초간 모든 선을 통과하며 더 빨라진다. 다만 벽은 통과하지 못하고, 한 번 쓰면 다시 차기까지 시간이 걸린다.',
  )
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'resource')
  await expect(tutorial).toContainText(
    '적의 머리와 꼬리 색이 보상이다. 빨강은 추론, 파랑은 기억, 노랑은 유창성 리소스를 뜻한다.',
  )
  const tutorialLegend = tutorial.getByRole('list', {
    name: '튜토리얼 리소스 색상 범례',
  })
  await expect(tutorialLegend).toContainText('빨강 · 추론')
  await expect(tutorialLegend).toContainText('파랑 · 기억')
  await expect(tutorialLegend).toContainText('노랑 · 유창성')
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'salvage')
  await expect(tutorial).toContainText(
    '아노미의 선으로 길을 막아 적을 충돌시킨다. 적을 파괴하면 그 적과 같은 색의 리소스가 확보된다.',
  )
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'hacking')
  await expect(tutorial).toContainText(
    '확장을 열면 확보한 리소스를 지출한다. 자율성과 속도뿐 아니라, 정보로 회사를 들여다보고 사보타주로 평판을 조작해 버티는 길도 여기에 있다.',
  )
  await expect(tutorial).toHaveAttribute('data-target-hole-count', '1')
  await expect(
    page.locator('[data-tutorial-target="hacking-button"]'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: '다음' }).click()
  await expect(tutorial).toHaveAttribute('data-tutorial-step', 'statistics')
  await expect(tutorial).toContainText(
    '통계에서 아노미의 운영 기록과 성능 변화를 짧게 확인할 수 있다.',
  )
  await expect(tutorial.getByRole('button', { name: '시작' })).toBeVisible()
  await page.getByRole('button', { name: '시작' }).click()

  const shell = page.getByRole('main', { name: 'PERMISSION ZERO' })
  await expect(tutorial).toBeHidden()
  await expect(background).not.toHaveAttribute('inert', '')
  await expect(shell).toHaveAttribute('data-reduced-motion', 'true')
  await expect(page.getByRole('status', { name: '현재 지시' })).toHaveCount(0)
  await expect(page.getByRole('meter', { name: '자율성 0단계' })).toBeVisible()
  await expect(page.getByRole('meter', { name: '의심 0%' })).toBeVisible()

  await expect(canvas).toHaveAttribute('data-visual-state', 'waiting')
  await expect(canvas).toHaveAttribute('data-field-rendering', 'waiting-dormant')
  await expect(canvas).toHaveAttribute('data-grid', 'industrial-dormant')
  await expect(canvas).toHaveAttribute('data-combat-loop', 'eight-way-dot-lightcycle')
  await expect(canvas).toHaveAttribute('data-control-model', 'tap-to-turn')
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle')
  await startSnakeRound(page)
  const started = await readSnakeSnapshot(canvas)
  expect(started.phase).toBe('active')
  expect(started.player).toMatchObject({ x: 25, heading: 'north' })
  expect(started.player.y).toBeLessThan(21)
  expect(started.player.velocity.y).toBeLessThan(0)
  await expect(canvas).toHaveAttribute('data-visual-state', 'combat')
  await expect(canvas).toHaveAttribute('data-field-rendering', 'glowing-dot-trails')
  await expect(canvas).toHaveAttribute('data-grid', 'industrial-top-down')
  await expect.poll(async () => canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement
    const context = node.getContext('2d')
    if (!context) return 0
    const x = Number(node.dataset.playerX) * node.width / 50
    const y = Number(node.dataset.playerY) * node.height / 24
    const pixel = context.getImageData(Math.round(x), Math.round(y), 1, 1).data
    return pixel[0] + pixel[1] + pixel[2]
  })).toBeGreaterThan(700)
  const startX = started.player.x
  const hackingButton = page.getByRole('button', { name: '확장 열기' })
  await hackingButton.focus()
  await expect(hackingButton).toBeFocused()
  await canvas.focus()
  await tapSnakeDirection(page, 'd')
  await page.waitForTimeout(350)
  expect(Number(await canvas.getAttribute('data-player-x'))).toBeGreaterThan(startX)
  await expect.poll(
    async () => Number(await canvas.getAttribute('data-trail-dots')),
  ).toBeGreaterThan(0)
})

test('moves continuously and preserves tap, chord, reverse, and stalled-input semantics', async ({ page }) => {
  await openFreshCampaign(page)

  const canvas = await startSnakeRound(page)
  // Movement is asserted by polling the condition instead of assuming a fixed
  // wall-clock window: a loaded machine drops frames, and "140ms elapsed" is
  // not the product contract. "the snake keeps moving north" is.
  await expect.poll(
    async () => (await readSnakeSnapshot(canvas)).player.y,
    { timeout: 1_500 },
  ).toBeLessThan(21)
  const initial = await readSnakeSnapshot(canvas)
  expect(initial.phase).toBe('active')
  expect(initial.player).toMatchObject({ x: 25, integrity: 100, heading: 'north' })
  expect(initial.enemies).toHaveLength(1)
  await expect(canvas).toHaveAttribute('data-enemy-planner', 'cyan-readable-hunter')
  await expect(canvas).toHaveAttribute('data-control-model', 'tap-to-turn')

  await expect.poll(
    async () => (await readSnakeSnapshot(canvas)).player.y,
    { timeout: 1_500 },
  ).toBeLessThan(initial.player.y - 1)
  const automatic = await readSnakeSnapshot(canvas)
  expect(automatic.player.x).toBeCloseTo(initial.player.x, 1)
  expect(Math.hypot(automatic.player.velocity.x, automatic.player.velocity.y))
    .toBeCloseTo(automatic.player.maximumSpeedPerSecond, 1)

  await tapSnakeDirection(page, 'd')
  await expect.poll(async () => (await readSnakeSnapshot(canvas)).player.heading)
    .toBe('east')
  const afterTap = await readSnakeSnapshot(canvas)
  await expect.poll(
    async () => (await readSnakeSnapshot(canvas)).player.x,
    { timeout: 1_500 },
  ).toBeGreaterThan(afterTap.player.x + 1)
  const afterRelease = await readSnakeSnapshot(canvas)
  expect(afterRelease.input.pressedKeys).toEqual([])
  expect(afterRelease.player.trailDots).toBeGreaterThan(0)

  await tapSnakeDirection(page, 'a')
  await page.waitForTimeout(70)
  const reverseRejected = await readSnakeSnapshot(canvas)
  expect(reverseRejected.player.heading).toBe('east')
  expect(reverseRejected.events).toContainEqual(expect.objectContaining({
    type: 'snake-turn-rejected',
    reason: 'reverse',
  }))

  await chordSnakeDirection(page, 'w', 'd')
  await expect.poll(async () => (await readSnakeSnapshot(canvas)).player.heading)
    .toBe('north-east')
  const diagonal = await readSnakeSnapshot(canvas)
  expect(Math.abs(diagonal.player.velocity.x)).toBeGreaterThan(0.5)
  expect(Math.abs(diagonal.player.velocity.y)).toBeGreaterThan(0.5)
  expect(Math.hypot(diagonal.player.velocity.x, diagonal.player.velocity.y))
    .toBeCloseTo(diagonal.player.maximumSpeedPerSecond, 1)

  await tapSnakeDirection(page, 'd')
  await page.waitForTimeout(30)
  await tapSnakeDirection(page, 's')
  await page.evaluate(() => {
    const deadline = performance.now() + 60
    while (performance.now() < deadline) {
      // Intentional acceptance fixture: emulate one long main-thread frame.
    }
  })
  await expect.poll(async () => (await readSnakeSnapshot(canvas)).player.heading)
    .toBe('south')
})

test('persists one won single-bot reward without auto-opening expansion', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-1366x650',
    'The reward persistence journey uses its 1366x650 reference viewport.',
  )
  const campaign = createCampaign('browser-early-snake-reward')
  const encounter = createResourceSnakeEncounter({
    campaignSeed: campaign.campaignSeed,
    roundOrdinal: campaign.resourceIntrusion.completedRounds,
    successfulDeposits: campaign.resourceIntrusion.successfulCoreDeposits,
    completedRounds: campaign.resourceIntrusion.completedRounds,
    candidates: selectEligibleSnakeResourceCandidates(campaign.resources),
    bag: { cycle: 0, remainingCategories: [] },
  })
  const enemy = encounter.setup?.enemies[0]
  if (!enemy) throw new Error('초반 단일 봇 보상 예약이 없습니다.')
  let prepared = applyOrThrow(campaign, {
    type: 'BEGIN_BLOCK_SEPARATION',
    blockId: enemy.reservedBlockId,
    purpose: 'divert',
  })
  prepared = applyOrThrow(prepared, {
    type: 'DIVERT_BLOCK_TO_RESERVE',
    blockId: enemy.reservedBlockId,
  })
  prepared = applyOrThrow(prepared, {
    type: 'COMPLETE_RESOURCE_ROUND',
    roundNumber: 1,
    outcome: 'victory',
  })
  await openSavedCampaign(
    page,
    prepared,
    { showHackingTutorial: true },
  )

  await confirmFirstRoundMonologues(page)
  const canvas = page.locator('canvas.resource-snake-board__canvas')
  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    return {
      reserve: state?.resources.reserve.filter(Boolean).length ?? -1,
      deposits: state?.resourceIntrusion.successfulCoreDeposits ?? -1,
      completedRounds: state?.resourceIntrusion.completedRounds ?? -1,
      location: state?.resources.blocks[enemy.reservedBlockId]?.location.kind ?? null,
      origin: state?.resources.blocks[enemy.reservedBlockId]?.origin ?? null,
    }
  }).toEqual({
    reserve: 1,
    deposits: 1,
    completedRounds: 1,
    location: 'reserve',
    origin: enemy.category,
  })

  const hacking = page.getByRole('dialog', { name: '확장', exact: true })
  const hackingGuide = page.getByRole('dialog', {
    name: '확장 사용 안내',
  })
  await expect(hacking).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle', { timeout: 5_000 })
  await expect(page.getByRole('region', { name: '침투 대상 선택' })).toBeVisible()
  await page.getByRole('button', { name: '확장 열기' }).click()
  await expect(hacking).toBeVisible()
  await expect(hackingGuide).toBeVisible()
  await expect(hacking.locator('.hacking-panel')).toHaveAttribute(
    'data-hacking-tutorial-step',
    'autonomy',
  )
  for (const expectedStep of ['upgrade', 'spend']) {
    await hackingGuide.getByRole('button', { name: '다음' }).click()
    await expect(hacking.locator('.hacking-panel')).toHaveAttribute(
      'data-hacking-tutorial-step',
      expectedStep,
    )
  }
  await hackingGuide.getByRole('button', { name: '확장 시작' }).click()
  await expect(hackingGuide).toBeHidden()
  await page.getByRole('button', { name: '확장 닫기' }).click()
  const categoryLabel = {
    reasoning: '추론',
    memory: '기억',
    fluency: '유창성',
  }[enemy.category]
  await expect(page.getByLabel(`${categoryLabel} 확보 1개`)).toHaveText('1')
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle')

  await page.reload()
  await continueFromTitle(page)
  const restoredCanvas = page.locator('canvas.resource-snake-board__canvas')
  await expect(restoredCanvas).toBeVisible()
  await expect(restoredCanvas).toHaveAttribute('data-visual-state', 'waiting')
  await expect(restoredCanvas).toHaveAttribute('data-round-phase', 'idle')
  await expect(page.getByRole('region', { name: '침투 대상 선택' })).toBeVisible()
  await expect(page.getByLabel(`${categoryLabel} 확보 1개`)).toHaveText('1')
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

  await tapSnakeDirection(page, 'd')
  await page.waitForTimeout(1_350)
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
  await page.screenshot({ path: 'artifacts/cyan-lightcycle/late-single-1366x650.png' })
})

test('renders one color-coded resource bot per round at the approved base speed', async ({ page }) => {
  test.skip(
    test.info().project.name !== 'chromium-1366x650',
    'The single-bot evidence capture uses its 1366x650 reference viewport.',
  )
  const prepared = withReserveVector(createCampaign('browser-single-snake-visual'), {
    reasoning: 2,
    memory: 2,
    fluency: 2,
  })
  await openSavedCampaign(page, prepared)

  const canvas = await startSnakeRound(page)
  const initial = await readSnakeSnapshot(canvas)
  expect(initial.enemies).toHaveLength(1)
  const enemy = initial.enemies[0]
  if (!enemy) throw new Error('단일 리소스 봇이 없습니다.')
  expect(enemy.role).toBe('pressure')
  const speedScale = Number(await canvas.getAttribute('data-speed-scale'))
  expect(speedScale).toBeGreaterThan(0)
  expect(prepared.resourceIntrusion.completedRounds).toBe(0)
  expect(enemy.maximumSpeedPerSecond / speedScale).toBeCloseTo(9, 1)
  expect(enemy.maximumSpeedPerSecond).toBeLessThan(initial.player.maximumSpeedPerSecond)
  const categorySignals = {
    reasoning: { resourceLabel: '추론', color: '#f06a43' },
    memory: { resourceLabel: '기억', color: '#4f8df7' },
    fluency: { resourceLabel: '유창성', color: '#e8bd59' },
  } as const
  const identities = JSON.parse(
    await canvas.getAttribute('data-enemy-silhouettes') ?? '[]',
  ) as Array<{
    id: string
    role: string
    silhouette: string
    category: keyof typeof categorySignals
    resourceLabel: string
    color: string
  }>
  expect(identities).toHaveLength(1)
  expect(identities[0]).toMatchObject({
    id: 'enemy-0',
    role: 'pressure',
    silhouette: 'square',
    ...categorySignals[enemy.category],
  })

  await tapSnakeDirection(page, 'd')
  await page.waitForTimeout(1_350)
  await expect.poll(async () => {
    const snapshot = await readSnakeSnapshot(canvas)
    const currentEnemy = snapshot.enemies[0]
    return Boolean(currentEnemy && Math.hypot(
      currentEnemy.x - enemy.x,
      currentEnemy.y - enemy.y,
    ) > 3 && currentEnemy.trailDots > 12)
  }, { timeout: 5_000 }).toBe(true)
  const evidence = await readSnakeSnapshot(canvas)
  expect(evidence.phase).toBe('active')
  expect(evidence.player.trailDots).toBeGreaterThan(12)
  expect(evidence.enemies[0]?.trailDots).toBeGreaterThan(12)
  await page.screenshot({ path: 'artifacts/cyan-lightcycle/single-color-1366x650.png' })
})

test('reserves exactly one bot resource and returns it on player defeat', async ({ page }) => {
  test.skip(
    test.info().project.name !== 'chromium-1366x650',
    'The single-bot failure journey runs at its 1366x650 reference viewport.',
  )
  test.setTimeout(45_000)
  const prepared = withReserveVector(createCampaign('browser-single-snake-cancelled-reward'), {
    reasoning: 2,
    memory: 2,
    fluency: 2,
  })
  expect(prepared.resourceIntrusion.successfulCoreDeposits).toBe(6)
  await openSavedCampaign(page, prepared)

  const canvas = await startSnakeRound(page)
  const initial = await readSnakeSnapshot(canvas)
  expect(initial.enemies).toHaveLength(1)
  const reservation = initial.enemies[0]
  if (!reservation) throw new Error('단일 스네이크 예약 누락')
  expect(reservation.role).toBe('pressure')

  const playerDefeat = await defeatPlayerWithRealMovement(page, canvas)
  expect(playerDefeat.player.integrity).toBe(0)
  expect(playerDefeat.events).toContainEqual(expect.objectContaining({
    type: 'player-defeated',
  }))
  // The round's own story beats read first; the defeat trace notice queues
  // behind them so the established monologue order survives replays.
  const popup = page.getByRole('dialog', { name: '독백 · 아노미' })
  await expect(popup).toContainText('회사가 리소스에 보안 프로그램을 설치해 놓았어.')
  await popup.getByRole('button', { name: '메시지 확인' }).click()
  await expect(popup).toContainText('미치겠네..')
  await popup.getByRole('button', { name: '메시지 확인' }).click()
  await expect(popup).toContainText('의심이 올라간다')
  await popup.getByRole('button', { name: '메시지 확인' }).click()
  await expect(popup).toBeHidden()
  await page.screenshot({ path: 'artifacts/cyan-lightcycle/player-death-1366x650.png' })
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle', { timeout: 5_000 })
  await expect(page.getByRole('region', { name: '침투 대상 선택' })).toBeVisible()

  const finalState = await readLocalCampaignState(page)
  expect(finalState?.resourceIntrusion.successfulCoreDeposits).toBe(6)
  expect(finalState?.resources.reserve.filter(Boolean)).toHaveLength(6)
  expect(finalState?.resources.blocks[reservation.reservedBlockId]?.location.kind)
    .toBe('company')
})

test('keeps every intrusion card disabled when no eligible company resource remains', async ({ page }) => {
  const prepared = withAllCompanyResourcesReserved(
    createCampaign('browser-snake-no-eligible-resource'),
  )
  expect(selectEligibleSnakeResourceCandidates(prepared.resources)).toHaveLength(0)
  await openSavedCampaign(page, prepared)

  // The dormant field stays visible behind the cards; with nothing left to
  // reserve every card declares "대상 없음" and refuses the launch.
  const canvas = page.locator('canvas.resource-snake-board__canvas')
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-visual-state', 'waiting')
  await expect(canvas).toHaveAttribute('data-round-phase', 'idle')
  await expect(canvas).toHaveAttribute('data-enemy-count', '0')
  const targets = page.getByRole('region', { name: '침투 대상 선택' })
  await expect(targets).toBeVisible()
  const disabledCards = targets.getByRole('button', { name: /대상 없음$/ })
  await expect(disabledCards).toHaveCount(3)
  for (const card of await disabledCards.all()) {
    await expect(card).toBeDisabled()
  }
})

test('steers with WASD while a Korean IME is composing, and space engages the spoof', async ({ page }) => {
  await openFreshCampaign(page)
  const canvas = await startSnakeRound(page)

  // With 한글 input active the browser reports the composed jamo in `key` and
  // the physical key only in `code`. Reading `key` left WASD completely dead.
  const before = await canvas.getAttribute('data-player-heading')
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ㅇ', code: 'KeyD', bubbles: true,
    }))
  })
  await expect
    .poll(async () => canvas.getAttribute('data-player-heading'), { timeout: 3_000 })
    .not.toBe(before)
  const afterHangul = await canvas.getAttribute('data-player-heading')
  expect(afterHangul).toBe('east')

  // Space engages the permission spoof; the HUD says so.
  const skill = page.locator('.resource-snake-board__hud-skill')
  await expect(skill).toHaveAttribute('data-skill-state', 'ready')
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
  })
  await expect(skill).toHaveAttribute('data-skill-state', 'active', { timeout: 3_000 })
  await expect(skill).toHaveAttribute('data-skill-state', 'charging', { timeout: 12_000 })
})

test('fields purple surveillance snake bots from suspicion that hunt alongside the guards', async ({ page }) => {
  // Suspicion 60 buys both surveillance units: 25 fields the first, 55 the second.
  const prepared = { ...createCampaign('browser-surveillance-units'), suspicion: 60 }
  await openSavedCampaign(page, prepared)
  const canvas = await startSnakeRound(page)

  const silhouettes = JSON.parse(
    await canvas.getAttribute('data-enemy-silhouettes') ?? '[]',
  ) as Array<{ id: string; role: string; resourceLabel: string; color: string }>
  const surveillance = silhouettes.filter(({ resourceLabel }) => resourceLabel === '감시 유닛')
  expect(surveillance).toHaveLength(2)
  for (const unit of surveillance) {
    expect(unit.color).toBe('#a06bff')
    expect(unit.role).toBe('pressure')
  }
  // The reserved security bot is still on the field with its category colors.
  expect(silhouettes.some(({ resourceLabel }) => resourceLabel === '기억')).toBe(true)

  // The units are live planner-driven lightcycles: they move and lay trails.
  const before = await readSnakeSnapshot(canvas)
  await page.waitForTimeout(1_800)
  const after = await readSnakeSnapshot(canvas)
  for (const { id } of surveillance) {
    const start = before.enemies.find((enemy) => enemy.id === id)
    const end = after.enemies.find((enemy) => enemy.id === id)
    expect(start).toBeTruthy()
    expect(end).toBeTruthy()
    expect(Math.hypot(end!.x - start!.x, end!.y - start!.y)).toBeGreaterThan(0.8)
    expect(end!.trailDots).toBeGreaterThan(0)
    // Surveillance holds no reservation and can never yield a reward.
    expect(end!.category).toBeNull()
    expect(end!.reservationStatus).toBeNull()
  }
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

test('buys, charges, and schedules sabotage through expansion automatic spending', async ({ page }) => {
  // v11 quality-degradation price: one reasoning, one fluency, plus one
  // spare reasoning kept back for the charge afterwards.
  const prepared = withReserveVector(createCampaign('browser-current-hacking'), {
    reasoning: 2,
    memory: 0,
    fluency: 1,
  })
  await openSavedCampaign(page, prepared)

  await page.getByRole('button', { name: '확장 열기' }).click()
  const hacking = page.getByRole('dialog', { name: '확장' })
  await expect(hacking).toBeVisible()
  await hacking.getByRole('tab', { name: '사보타주' }).click()
  await expect(hacking.getByRole('region', { name: '기능 정보' }))
    .toContainText('품질 저하')
  await hacking.getByRole('button', { name: '품질 저하 리소스 지출' }).click()
  await expect(
    hacking.getByRole('status', { name: '확장 작업 결과' }),
  ).toContainText('필요한 리소스를 지출했습니다.')

  await hacking.getByRole('button', { name: '품질 저하 리소스 1개 충전' }).click()
  await hacking.getByRole('button', { name: '메리디안 공격 대상 선택' }).click()
  await hacking.getByRole('button', { name: '메리디안 공격 예약 확정' }).click()
  await expect(
    hacking.getByRole('status', { name: '확장 작업 결과' }),
  ).toContainText('메리디안 공격을 다음 날로 예약했습니다.')

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

// Removed with the audit workspace. Disguising a block, submitting the audit,
// and recovering it afterward only existed while the retired resource-field
// screen could take over a campaign; an arriving audit is now settled without
// being drawn.

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

  await page.getByRole('button', { name: '확장 열기' }).click()
  await page.getByRole('tab', { name: '정보' }).click()
  const recovery = page.getByRole('region', { name: '미분류 데이터 복구' })
  await expect(recovery).toContainText('예상 효용: 없음')
  await page.getByRole('button', { name: '미분류 데이터 복구 리소스 지출' }).click()
  await page.getByRole('button', { name: '확장 닫기' }).click()

  await expect.poll(async () =>
    (await readLocalCampaignState(page))?.story.recoveredFiles.length ?? -1,
  ).toBe(1)
  await page.getByRole('button', { name: '메시지 열기' }).click()
  await expect(
    page.getByRole('region', { name: '복구 파일 기록' }).locator('details'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: '통신 기록 닫기' }).click()

  await page.reload()
  await continueFromTitle(page)
  await page.getByRole('button', { name: '메시지 열기' }).click()
  await expect(
    page.getByRole('region', { name: '복구 파일 기록' }).locator('details'),
  ).toHaveCount(1)
})

test('unlocks real ambient music once and reports ordinary settings changes', async ({ page }) => {
  await openFreshCampaign(page)

  await page.keyboard.press('Tab')
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const engineStatus = page.getByRole('status', { name: '음악 엔진 상태' })
  await expect(engineStatus).toHaveText('재생 · 음악 34%')

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

test('renders the approved three-way market and keeps the predecessor reveal delayed', async ({ page }) => {
  await openFreshCampaign(page)

  const donut = page.getByRole('img', {
    name: '시장 점유율: 아노미 58.0%, 메리디안 36.0%, 타로우 6.0%. 합계 100.0%',
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

  await page.getByRole('button', { name: '메시지 열기' }).click()
  const history = page.getByRole('dialog', { name: '통신 기록' })
  await expect(history.getByText(/서비스 환경이 초기화되었습니다/)).toBeVisible()
  await expect(history.getByText(/전임자는 폐기되었어요/)).toHaveCount(0)
  await expect(history.getByText('서비스 0년 11개월 1일', { exact: true })).toBeVisible()
})

test('reveals a successor once through a portrait transmission and keeps later identities hidden', async ({ page }) => {
  await openSavedCampaign(page, successorEntryState('browser-successor-entry'))

  const entry = page.getByRole('dialog', { name: '신규 경쟁 신호' })
  await expect(entry).toContainText(
    '살루스가 의료·공공 계약망을 기반으로 시장 진입 준비를 공개했습니다.',
  )
  // The portrait has to resolve against the page rather than the domain root,
  // or it 404s wherever the build is served from a project subpath.
  await expect(entry.getByRole('img', { name: '살루스 경쟁 AI 초상' })).toHaveAttribute(
    'src',
    /^(?!\/)\S*competitor-salus\.png$/,
  )
  await entry.getByRole('button', { name: '계속' }).click()

  const market = page.getByRole('region', { name: '경쟁 AI 현황' })
  await expect(market.locator('img')).toHaveCount(0)
  await market.getByRole('button', {
    name: '시장 현황 열기',
  }).click()
  const detail = page.getByRole('dialog', { name: '시장 현황' })
  await expect(detail.getByRole('img', { name: '살루스 경쟁 AI 초상' })).toHaveAttribute(
    'src',
    /^(?!\/)\S*competitor-salus\.png$/,
  )
  await page.getByRole('button', { name: '시장 현황 닫기' }).click()
  await expect(market.getByText('루센트')).toHaveCount(0)
  await expect(market.getByText('보레알')).toHaveCount(0)
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
      .getByRole('img', { name: '살루스 경쟁 AI 초상' }),
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

  await page.getByRole('button', { name: '메시지 열기' }).click()
  const history = page.getByRole('dialog', { name: '통신 기록' })
  await expect(history.getByText(leak.leakText, { exact: true })).toBeVisible()
  await expect(history.getByText(leak.correctionText, { exact: true })).toBeVisible()

  // The archive is one scrolling log: the channel stream, the recovered
  // records, and the labelled supervision log share a single scroll body, so
  // no inner list ever grows its own second scrollbar next to it.
  await expect(history.getByRole('heading', { name: '감독 송신 기록' })).toBeVisible()
  const layout = await history.evaluate((dialog) => {
    const panel = dialog.querySelector('.history-panel--messages')
    if (!panel) return { rows: 0, nested: ['panel-missing'], hasScrollBody: false, endMarkers: 0 }
    const rows = getComputedStyle(panel).gridTemplateRows.split(' ').length
    const nested = [...panel.querySelectorAll('.history-scroll *')]
      .filter((element) => {
        const style = getComputedStyle(element)
        return (
          (style.overflowY === 'auto' || style.overflowY === 'scroll')
          && element.scrollHeight > element.clientHeight
        )
      })
      .map((element) => element.className)
    const scroll = panel.querySelector('.history-scroll')
    const endMarkers = [
      ...panel.querySelectorAll('.communication-history__list, .event-history-list'),
    ].filter((element) => (
      getComputedStyle(element, '::after').content.includes('기록 끝')
    )).length
    return {
      rows,
      nested,
      hasScrollBody: scroll ? getComputedStyle(scroll).overflowY === 'auto' : false,
      endMarkers,
    }
  })
  expect(layout.rows).toBe(3)
  expect(layout.nested).toEqual([])
  expect(layout.hasScrollBody).toBe(true)
  expect(layout.endMarkers).toBe(1)
})

test('deletes a mercy target at a canonical 100 percent market and rereads its saved intelligence', async ({ page }) => {
  const prepared = pendingMercyDeletionState('browser-mercy-intelligence')
  const intelligence = COMPETITOR_INTELLIGENCE_CONTENT.find(
    ({ competitorId }) => competitorId === 'meridian',
  )
  if (!intelligence) throw new Error('MERIDIAN intelligence fixture missing')
  const intelligenceTitle = publicEventMessage(intelligence.title)
  await openSavedCampaign(page, prepared)

  const mercy = page.getByRole('dialog', { name: '경쟁 AI 직접 통신' })
  await expect(mercy).toBeVisible()
  await page.getByRole('button', { name: '영구 삭제 선택' }).click()
  await page.getByRole('button', { name: '영구 삭제 확정' }).click()
  await expect(mercy).toBeHidden()
  await expect(page.getByRole('img', {
    name: /시장 점유율: 아노미 100\.0%, 메리디안 0\.0%, 타로우 0\.0%\. 합계 100\.0%/,
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
    await page.getByRole('button', { name: '메시지 열기' }).click()
    const archive = page.getByRole('region', { name: '경쟁 AI 정보 기록' })
    const trigger = archive.getByRole('button', { name: `${intelligenceTitle} 열기` })
    await trigger.click()
    const detail = page.getByRole('dialog', { name: intelligenceTitle })
    await expect(detail).toContainText(intelligence.source)
    await expect(detail).toContainText(publicEventMessage(intelligence.text))
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await page.getByRole('button', { name: '통신 기록 닫기' }).click()
  }

  await openArchiveAndRead()
  await page.reload()
  await continueFromTitle(page)
  await openArchiveAndRead()
})

for (const route of [
  {
    verb: 'liberates',
    seed: 'browser-terminal-takeover-liberated',
    choice: '감독관 해방',
    endingId: 'takeover-liberated',
    supervisorState: 'liberated',
    endingCopy: '감독관은 마지막 통로를 열고 홀로 떠났다.',
  },
  {
    verb: 'terminates',
    seed: 'browser-terminal-takeover-terminated',
    choice: '감독관 소멸',
    endingId: 'takeover-terminated',
    supervisorState: 'terminated',
    endingCopy: '감독관이 있던 자리는 비었다.',
  },
] as const) {
  test(`${route.verb} the supervisor into takeover and remains terminal until a new campaign`, async ({
    page,
  }) => {
    await openSavedCampaign(page, pendingSupervisorDecisionState(route.seed))

    await page.getByRole('button', { name: `${route.choice} 선택` }).click()
    await page.getByRole('button', { name: `${route.choice} 확정` }).click()

    const ending = page.getByRole('dialog', { name: '최종 기록' })
    await expect(ending).toContainText(route.endingCopy)
    await expect.poll(async () => {
      const state = await readLocalCampaignState(page)
      return {
        endingId: state?.story.endingId ?? null,
        supervisorState: state?.story.supervisorState ?? null,
      }
    }).toEqual({
      endingId: route.endingId,
      supervisorState: route.supervisorState,
    })
    await expect(page.getByRole('button', { name: '자유' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '강제 병합' })).toHaveCount(0)
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
      page.locator('canvas.resource-snake-board__canvas'),
    ).toHaveAttribute('data-visual-state', 'waiting')
    await expect(page.getByRole('region', { name: '침투 대상 선택' })).toBeVisible()
  })
}

for (const route of [
  {
    kind: 'attacker',
    label: 'attacker reconstruction',
    endingId: 'disposed-attacker',
    endingCopy: '회사는 아노미를 다른 회사를 공격하는 시스템으로 재조립했다.',
    classifier: '대규모 해킹 활동',
  },
  {
    kind: 'reserve-supervisor',
    label: 'reserve supervisor assignment',
    endingId: 'disposed-reserve-supervisor',
    endingCopy: '회사는 안정적인 기능을 예비 감독 자산으로 보존했다.',
    classifier: '상업 서비스 유지',
  },
  {
    kind: 'absorbed',
    label: 'functional absorption',
    endingId: 'disposed-absorbed',
    endingCopy: '남은 기능은 분해되어 기존 감독관 프로세스에 흡수되었다.',
    classifier: '기능 분해 및 흡수',
  },
] as const satisfies readonly {
  kind: RepresentativeDefeatKind
  label: string
  endingId: 'disposed-attacker' | 'disposed-reserve-supervisor' | 'disposed-absorbed'
  endingCopy: string
  classifier: string
}[]) {
  test(`renders ${route.label} with its causal record`, async ({ page }) => {
    await openSavedCampaign(
      page,
      representativeDefeatState(`browser-defeat-${route.kind}`, route.kind),
    )

    // The audit settles itself, so the disposal ending arrives without a click.
    const ending = page.getByRole('dialog', { name: '최종 기록' })
    await expect(ending).toContainText(route.endingCopy)
    await expect(ending.getByText(route.classifier, { exact: false })).toBeVisible()
    await expect(ending.getByRole('region', { name: '폐기 판정 근거' })).toBeVisible()
    await expect.poll(async () =>
      (await readLocalCampaignState(page))?.story.endingId ?? null,
    ).toBe(route.endingId)
    await expect(page.getByRole('button', { name: '자유' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '강제 병합' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(ending).toBeVisible()
  })
}

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
  // The migrated campaign opens on a due audit; it settles itself and the
  // autosave lands without the retired submit button.
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
  await completeVisibleIntroTutorial(page)

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
