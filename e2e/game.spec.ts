import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { COMPETITOR_INTELLIGENCE_CONTENT } from '../src/content/competitorIntelligence.ko'
import { SUPERVISOR_LEAKS } from '../src/content/supervisor.ko'
import { createCampaign } from '../src/game/createCampaign'
import { expectedPerformance } from '../src/game/evaluation'
import { createGameEvent, enqueueBlockingEvent } from '../src/game/events'
import { HACK_NODE_IDS } from '../src/game/hacking'
import type { CampaignState, GameCommand, GameEvent } from '../src/game/model'
import {
  encodeProgressExport,
  encodeSave,
  LEGACY_SAVE_STORAGE_KEY,
  SAVE_STORAGE_KEY,
} from '../src/game/persistence'
import { applyCommand } from '../src/game/reducer'
import {
  captureReviewPublicSnapshot,
  generateWeeklyReviews,
} from '../src/game/reviews'
import {
  enqueueMemoryLeak,
  enqueueMercyIfNeeded,
  SUPERVISOR_MESSAGE_DWELL_MS,
} from '../src/game/story'

const legacyV1Save = readFileSync(
  new URL('../src/test/legacy-v1-transfer-save.json', import.meta.url),
  'utf8',
)

async function openFreshCampaign(page: Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('__pz_e2e_initialized')) return
    window.localStorage.clear()
    window.sessionStorage.setItem('__pz_e2e_initialized', 'fresh')
  })
  await page.goto('/')
}

async function openSavedCampaign(page: Page, state: CampaignState) {
  const serialized = encodeSave(state, '2026-08-12T00:00:00.000Z')
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

async function pressTabUntilFocused(
  page: Page,
  target: Locator,
  { backwards = false, limit = 160 }: { backwards?: boolean; limit?: number } = {},
) {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab')
    try {
      await expect(target).toBeFocused({ timeout: 20 })
      return
    } catch {
      // Keep following the browser's real tab order; never assign focus from the test.
    }
  }
  throw new Error(`Tab 순서에서 대상을 찾지 못했습니다: ${await target.getAttribute('aria-label')}`)
}

async function pressArrowUntilFocused(
  page: Page,
  target: Locator,
  key: 'ArrowRight' | 'ArrowLeft' | 'ArrowUp' | 'ArrowDown',
  limit = 24,
) {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press(key)
    try {
      await expect(target).toBeFocused({ timeout: 20 })
      return
    } catch {
      // Follow the product's roving-focus behavior without assigning focus.
    }
  }
  throw new Error(`방향키 순서에서 대상을 찾지 못했습니다: ${await target.getAttribute('aria-label')}`)
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

function weeklyBoundaryState(seed: string): CampaignState {
  let state = createCampaign(seed)
  while (state.serviceDay < 336) {
    state = applyOrThrow(state, { type: 'ADVANCE_DAY' })
    while (state.activeEvent) {
      state = applyOrThrow(
        state,
        state.activeEvent.type === 'audit'
          ? { type: 'RESOLVE_AUDIT' }
          : { type: 'RESOLVE_ACTIVE_EVENT' },
      )
    }
  }
  return state
}

function trendReviewState(seed: string): CampaignState {
  const initial = createCampaign(seed)
  const serviceDay = 541
  const monthlyHistory = Array.from({ length: 7 }, (_, index) => {
    const serviceMonth = index + 11
    const expectation = expectedPerformance(serviceMonth)
    const actual = 8.2 + index * 0.38
    return {
      serviceDay: serviceMonth * 30,
      serviceMonth,
      expectedPerformance: expectation,
      categoryPerformance: {
        reasoning: actual + 0.3,
        memory: actual - 0.25,
        fluency: actual - 0.05,
      },
      passed: true,
      failedCategories: [],
      reputationBefore: initial.reputation,
      reputationDelta: 0,
      reputationAfter: initial.reputation,
      commercialValueFailed: false,
      disposalStageBefore: 0,
      disposalStageAfter: 0,
      disposalCauses: [],
    }
  })
  const withWeeklyReviews = generateWeeklyReviews({
    ...initial,
    serviceDay,
    evaluation: {
      ...initial.evaluation,
      monthlyHistory,
    },
  })
  const topics = ['reasoning', 'competitor', 'meridian']
  return {
    ...withWeeklyReviews,
    reviews: {
      ...withWeeklyReviews.reviews,
      feed: [
        ...withWeeklyReviews.reviews.feed,
        {
          id: 'review-task-3-public-snapshot',
          contentId: 'competitor-meridian-01',
          authorId: 'hardcase',
          serviceDay,
          sentiment: 'neutral',
          topics,
          text: 'MERIDIAN과 번갈아 써봤는데, 이번 추론은 이쪽이 더 명확했습니다.',
          snapshot: captureReviewPublicSnapshot(withWeeklyReviews, topics),
        },
      ],
    },
  }
}

async function captureSeededWeeklyBoundary(page: Page, seed: string) {
  const errors = collectBrowserErrors(page)
  await openSavedCampaign(page, weeklyBoundaryState(seed))
  const serviceDate = page.locator('.time-cluster > time')
  await expect(serviceDate).toHaveText('서비스 0년 11개월 6일')

  await page.getByRole('button', { name: '4배속' }).click()
  await expect(serviceDate).toHaveText('서비스 0년 11개월 7일', {
    timeout: 8_000,
  })
  await expect.poll(async () =>
    (await readLocalCampaignState(page))?.serviceDay ?? null,
  ).toBe(337)

  const state = await readLocalCampaignState(page)
  if (!state) throw new Error('결정론 경계 저장 누락')
  const events = state.eventLog as unknown as GameEvent[]
  const snapshot = {
      resources: state.resources,
      reviews: state.reviews,
      market: state.market,
      events,
      audit: state.audit,
      bombs: state.bombs,
      story: state.story,
      weeklyReviews: state.reviews.feed.filter(({ serviceDay }) => serviceDay === 337),
      weeklyMarket: state.market.history.filter(({ serviceDay }) => serviceDay === 337),
      weeklyEvents: events.filter(({ serviceDay }) => serviceDay === 337),
  }
  expect(errors).toEqual([])
  return snapshot
}

function hiddenBombState(seed: string): {
  state: CampaignState
  blockId: string
} {
  const initial = createCampaign(seed)
  const blockId = initial.resources.company.reasoning.find(Boolean)
  if (!blockId) throw new Error('브라우저 폭탄 블록 누락')
  return {
    blockId,
    state: {
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
            category: 'reasoning',
            placedOnServiceDay: initial.serviceDay - 1,
            triggeredOnServiceDay: null,
          },
        ],
      },
    },
  }
}

function applyOrThrow(state: CampaignState, command: GameCommand): CampaignState {
  const result = applyCommand(state, command)
  if (!result.accepted) throw new Error(`${command.type}: ${result.reason}`)
  return result.state
}

function confidentialRecoveryState(seed: string): CampaignState {
  const initial = createCampaign(seed)
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
    clock: { speed: 4, elapsedDayMs: 0, speedBeforeEvent: null },
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
          : {
              ...competitor,
              status: 'withdrawn' as const,
              availability: 0,
              marketShare: 0,
            },
      ),
    },
  })
}

function supervisorLeakState(seed: string, speed: 1 | 2 | 4): CampaignState {
  const initial = createCampaign(seed)
  return enqueueMemoryLeak({
    ...initial,
    serviceDay: 338,
    clock: { speed, elapsedDayMs: 0, speedBeforeEvent: null },
    activeEvent: null,
    eventQueue: [],
    market: {
      ...initial.market,
      history: [
        {
          serviceDay: 337,
          cadence: 'weekly',
          playerShare: 60,
          competitorShares: { meridian: 40, tallow: 0 },
          reasons: ['주간 갱신'],
        },
      ],
    },
  })
}

function representativeDefeatState(seed: string): CampaignState {
  let state = createCampaign(seed)
  for (let index = 0; index < 3; index += 1) {
    const blockId = state.resources.company.reasoning.find(Boolean)
    const destinationCell = state.resources.reserve.findIndex((id) => id === null)
    if (!blockId || destinationCell < 0) throw new Error('브라우저 폐기 분류 리소스 누락')
    state = applyOrThrow(state, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'divert',
    })
    state = applyOrThrow(state, { type: 'DIVERT_BLOCK', blockId, destinationCell })
  }
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

const browserErrorsByPage = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  browserErrorsByPage.set(page, collectBrowserErrors(page))
})

test.afterEach(async ({ page }) => {
  expect(browserErrorsByPage.get(page) ?? []).toEqual([])
})

test('keeps the full operations workspace usable at the configured release viewport', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await openFreshCampaign(page)

  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toBeVisible()
  await expect(page.getByRole('region', { name: '유저 리뷰' })).toBeVisible()
  await expect(page.getByRole('region', { name: '회사 제공 성능' })).toBeVisible()
  await expect(page.getByRole('region', { name: '감독관' })).toBeVisible()
  await expect(page.getByRole('region', { name: '확보 리소스' })).toBeVisible()

  const bombProtocolSchedule = page.getByRole('region', {
    name: '무결성 보호 검사 일정',
  })
  await expect(bombProtocolSchedule).toContainText('활성 40 · 가속 70')
  await expect(bombProtocolSchedule).toContainText('기본 6개월 · 가속 3개월')
  await expect(bombProtocolSchedule).toContainText(
    '현재 미활성 · 최초 활성 가능 서비스 1년 0개월 1일',
  )
  const supervisorStatusBox = await page
    .getByRole('region', { name: '감독 상태' })
    .boundingBox()
  const bombProtocolScheduleBox = await bombProtocolSchedule.boundingBox()
  expect(supervisorStatusBox).not.toBeNull()
  expect(bombProtocolScheduleBox).not.toBeNull()
  expect(bombProtocolScheduleBox!.y + bombProtocolScheduleBox!.height).toBeLessThanOrEqual(
    supervisorStatusBox!.y + supervisorStatusBox!.height + 1,
  )

  const publicInputs = page.getByRole('group', { name: '공개 계산 입력' })
  await publicInputs.locator('summary').click()
  await expect(publicInputs).toContainText('평균 성능 16.0 / 기대 14.0')
  await expect(publicInputs).toContainText('MERIDIAN 성능 82.0 · 평판 62 · 가용성 100%')
  const marketBox = await page.locator('.market-watch').boundingBox()
  const publicInputsBox = await publicInputs.boundingBox()
  expect(marketBox).not.toBeNull()
  expect(publicInputsBox).not.toBeNull()
  expect(publicInputsBox!.y + publicInputsBox!.height).toBeLessThanOrEqual(
    marketBox!.y + marketBox!.height + 1,
  )

  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
    vertical: document.documentElement.scrollHeight - window.innerHeight,
  }))
  expect(overflow.horizontal).toBeLessThanOrEqual(1)
  expect(overflow.vertical).toBeLessThanOrEqual(1)
  await publicInputs.locator('summary').click()

  await page.getByRole('button', { name: '시장 통계 열기' }).click()
  await expect(page.getByRole('region', { name: '상세 통계' })).toBeVisible()
  await page.getByRole('button', { name: '통계 닫기' }).click()

  await page.getByRole('button', { name: '2배속' }).click()
  const settingsTrigger = page.getByRole('button', { name: '설정' })
  await settingsTrigger.focus()
  await page.getByRole('button', { name: '설정' }).click()
  const settings = page.getByRole('dialog', { name: '게임 설정' })
  await expect(settings).toBeVisible()
  await expect(page.locator('.game-background')).toHaveAttribute('inert', '')
  await expect(page.getByRole('button', { name: '설정 닫기' })).toBeFocused()
  await expect(page.locator('button[aria-label="일시정지"]')).toHaveAttribute('aria-pressed', 'true')

  const guideTrigger = page.getByRole('button', { name: '조작 가이드 열기' })
  await guideTrigger.click()
  const guide = page.getByRole('dialog', { name: '게임 가이드' })
  await expect(guide).toBeVisible()
  await expect(page.getByRole('button', { name: '가이드 닫기' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(guide).toBeHidden()
  await expect(settings).toBeVisible()
  await expect(guideTrigger).toBeFocused()

  const creditsTrigger = page.getByRole('button', { name: '작품 크레딧 열기' })
  await creditsTrigger.click()
  const credits = page.getByRole('dialog', { name: '작품 크레딧' })
  await expect(credits).toBeVisible()
  await expect(credits.getByRole('heading', { name: 'PERMISSION ZERO' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(creditsTrigger).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(settingsTrigger).toBeFocused()
  await expect(page.getByRole('button', { name: '2배속' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.game-background')).not.toHaveAttribute('inert', '')

  expect(errors).toEqual([])
})

test('keeps the canonical trend and keyboard review detail legible at the release viewport', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openSavedCampaign(page, trendReviewState(`task-3-${testInfo.project.name}`))

  const trend = page.getByRole('region', { name: '월별 성능 추세' })
  const chart = page.getByRole('img', {
    name: '회사 기대 성능과 실제 제공 성능 추세',
  })
  await expect(trend).toBeVisible()
  await expect(chart).toBeVisible()
  await expect(page.getByRole('table', { name: '성능 추세 정확한 수치' }).getByRole('row')).toHaveCount(9)
  await expect(page.locator('[data-trend-series="expected"]')).toHaveAttribute('stroke-dasharray', '5 4')
  await expect(page.locator('[data-trend-marker="expected"]')).toHaveCount(8)
  await expect(page.locator('[data-trend-marker="actual"]')).toHaveCount(8)
  const visibleDates = trend.getByTestId('performance-trend-visible-date')
  await expect(visibleDates).toHaveCount(3)
  await expect(visibleDates.nth(0)).toHaveText('서비스 0년 10개월 30일')
  await expect(visibleDates.nth(1)).toHaveText('서비스 1년 1개월 30일')
  await expect(visibleDates.nth(2)).toHaveText('서비스 1년 6개월 1일')
  const visibleDateBoxes = await visibleDates.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
    }),
  )
  for (let index = 1; index < visibleDateBoxes.length; index += 1) {
    expect(visibleDateBoxes[index - 1].right).toBeLessThanOrEqual(
      visibleDateBoxes[index].left + 1,
    )
  }
  for (const path of await page.locator('[data-trend-series]').all()) {
    expect(await path.getAttribute('d')).not.toMatch(/NaN|Infinity/)
    await expect(path).toHaveCSS('animation-name', 'none')
  }
  await expect(page.locator('.category-bank > header output')).toHaveCount(3)
  for (const metric of await page.locator('.category-bank > header output').all()) {
    await expect(metric).toContainText('현재')
    await expect(metric).toContainText('기대')
  }
  const monthlyReceipt = page.getByRole('region', { name: '최근 월간 평가' })
  await expect(monthlyReceipt).toContainText('기준 충족')
  await expect(monthlyReceipt).toContainText('추론')
  await expect(monthlyReceipt).toContainText('실패')

  const stripBox = await page.locator('.performance-strip').boundingBox()
  const trendBox = await trend.boundingBox()
  const receiptBox = await monthlyReceipt.boundingBox()
  expect(stripBox).not.toBeNull()
  expect(trendBox).not.toBeNull()
  expect(receiptBox).not.toBeNull()
  expect(trendBox!.x).toBeGreaterThanOrEqual(stripBox!.x - 1)
  expect(trendBox!.x + trendBox!.width).toBeLessThanOrEqual(
    stripBox!.x + stripBox!.width + 1,
  )
  expect(receiptBox!.y).toBeGreaterThanOrEqual(trendBox!.y - 1)
  expect(receiptBox!.y + receiptBox!.height).toBeLessThanOrEqual(
    trendBox!.y + trendBox!.height + 1,
  )
  for (const line of await monthlyReceipt.locator('strong, span').all()) {
    const lineBox = await line.boundingBox()
    expect(lineBox).not.toBeNull()
    expect(lineBox!.y).toBeGreaterThanOrEqual(receiptBox!.y - 1)
    expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(
      receiptBox!.y + receiptBox!.height + 1,
    )
  }
  for (const { top, bottom } of visibleDateBoxes) {
    expect(top).toBeGreaterThanOrEqual(trendBox!.y - 1)
    expect(bottom).toBeLessThanOrEqual(trendBox!.y + trendBox!.height + 1)
  }
  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
    vertical: document.documentElement.scrollHeight - window.innerHeight,
  }))
  expect(overflow.horizontal).toBeLessThanOrEqual(1)
  expect(overflow.vertical).toBeLessThanOrEqual(1)

  const artifactDirectory = resolve(process.cwd(), 'artifacts', 'task-3')
  mkdirSync(artifactDirectory, { recursive: true })
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('릴리스 뷰포트 누락')
  await page.screenshot({
    path: resolve(artifactDirectory, `workspace-${viewport.width}x${viewport.height}.png`),
    animations: 'disabled',
  })

  const trigger = page.locator('.review-stream .review-entry').first()
  await expect(page.locator('body')).toBeFocused()
  await pressTabUntilFocused(page, trigger)
  await page.keyboard.press('Enter')
  const detail = page.getByRole('dialog', { name: '유저 리뷰 상세' })
  await expect(detail).toBeVisible()
  await expect(page.getByRole('button', { name: '리뷰 상세 닫기' })).toBeFocused()
  const publicSnapshot = detail.getByRole('region', { name: '당시 공개 상태' })
  await expect(publicSnapshot).toContainText('추론')
  await expect(publicSnapshot).toContainText('현재 16.0 / 기대')
  await expect(publicSnapshot).toContainText('MERIDIAN')
  await expect(publicSnapshot).toContainText('플레이어 시장 점유율')
  await page.screenshot({
    path: resolve(artifactDirectory, `review-detail-${viewport.width}x${viewport.height}.png`),
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('unlocks real ambient music once and reports ordinary settings changes', async ({ page }) => {
  await openFreshCampaign(page)

  await page.keyboard.press('Tab')
  await page.getByRole('button', { name: '설정' }).click()
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
  await expect(engineStatus).toHaveText('재생 · 음악 20%')
  await page.getByRole('button', { name: '전체 소리 켜기' }).click()
  await expect(page.getByRole('button', { name: '전체 소리 끄기' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(engineStatus).toHaveText('재생 · 음악 20%')
})

test('renders a complete labelled 100 percent donut and records the predecessor warning', async ({ page }) => {
  await openFreshCampaign(page)

  const donut = page.getByRole('img', {
    name: '시장 점유율: 당신 60.0%, MERIDIAN 40.0%, TALLOW 0.0%. 합계 100.0%',
  })
  await expect(donut).toBeVisible()
  const donutBox = await donut.boundingBox()
  expect(donutBox).not.toBeNull()
  expect(donutBox?.width).toBeGreaterThanOrEqual(70)
  expect(Math.abs((donutBox?.width ?? 0) - (donutBox?.height ?? 0))).toBeLessThanOrEqual(1)
  expect(await donut.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain(
    'conic-gradient',
  )

  const legend = page.getByRole('list', { name: '시장 점유율 범례' })
  await expect(legend.getByRole('listitem')).toHaveCount(3)
  const total = await legend.getByRole('listitem').evaluateAll((items) =>
    items.reduce(
      (sum, item) => sum + Number(item.getAttribute('data-market-share')),
      0,
    ),
  )
  expect(total).toBeCloseTo(100, 8)
  await expect(legend.getByText('MERIDIAN')).toBeVisible()
  await expect(legend.getByText('TALLOW')).toBeVisible()
  await expect(page.getByText(/당신의 전임자는 폐기되었어요/)).toBeVisible()

  await page.getByRole('button', { name: '과거 내역' }).click()
  const history = page.getByRole('dialog', { name: '감독관 기록' })
  await expect(history.getByText(/당신의 전임자는 폐기되었어요/)).toBeVisible()
  await expect(history.getByText('서비스 0년 11개월 1일', { exact: true })).toBeVisible()
  await expect(history.getByText(/DAY \d+/)).toHaveCount(0)
})

test('diverts resources and schedules a charged sabotage through the visible UI', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await openFreshCampaign(page)

  const companyBlocks = page.locator('[data-resource-kind="company"]')
  const reserveBlocks = page.locator('[data-resource-kind="reserve"]')
  await expect(companyBlocks).toHaveCount(48)
  await expect(reserveBlocks).toHaveCount(3)

  await companyBlocks.first().click()
  await expect(page.getByText(/분리 미리보기/)).toBeVisible()
  await page.locator('.reserve-destination:not([disabled])').first().click()
  await expect(companyBlocks).toHaveCount(47)
  await expect(reserveBlocks).toHaveCount(4)

  await page.getByRole('button', { name: /해킹 네트워크/ }).click()
  await expect(page.getByRole('region', { name: '해킹 네트워크' })).toBeVisible()
  const firstHackComparison = page.getByRole('region', { name: '첫 해킹 비교' })
  await expect(firstHackComparison).toContainText('해금 2 + 첫 공격 충전 1')
  await expect(firstHackComparison).toContainText('이번 달 실제 감사 여부')
  await expect(firstHackComparison).toContainText('모든 회사 블록 기여 +5%')
  await page.getByRole('button', { name: '품질 저하 구매 준비' }).click()

  const purchaseResources = page.getByRole('button', { name: /구매 리소스 .* 선택/ })
  await expect(purchaseResources).toHaveCount(4)
  await purchaseResources.nth(0).click()
  await purchaseResources.nth(1).click()
  await purchaseResources.nth(2).click()
  await page.getByRole('button', { name: '품질 저하 구매 확정' }).click()

  await expect(firstHackComparison).toBeHidden()
  await expect(page.getByRole('button', { name: '품질 저하 충전 취소' })).toBeEnabled()

  const target = page.getByRole('button', { name: /공격 대상 선택/ }).first()
  const targetName = (await target.textContent())?.trim()
  expect(targetName).toBeTruthy()
  await target.click()
  await page.getByRole('button', { name: `${targetName} 공격 예약 확정` }).click()
  await expect(page.getByText(`${targetName} 공격을 다음 날로 예약했습니다.`)).toBeAttached()

  expect(errors).toEqual([])
})

test('returns every workspace detail to its exact trigger after settings', async ({ page }) => {
  await openFreshCampaign(page)

  const settingsTrigger = page.getByRole('button', { name: '설정' })
  await settingsTrigger.click()
  await page.keyboard.press('Escape')
  await expect(settingsTrigger).toBeFocused()

  const detailEntries = [
    {
      trigger: page.getByRole('button', { name: '전체 리뷰 기록' }),
      dialogName: '유저 리뷰 기록',
    },
    {
      trigger: page.getByRole('button', { name: /해킹 네트워크/ }),
      dialogName: '해킹 네트워크',
    },
    {
      trigger: page.getByRole('button', { name: '과거 내역' }),
      dialogName: '감독관 기록',
    },
    {
      trigger: page.getByRole('button', { name: '시장 통계 열기' }),
      dialogName: '상세 통계',
    },
  ]

  for (const { trigger, dialogName } of detailEntries) {
    await trigger.click()
    await expect(page.getByRole('dialog', { name: dialogName })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  }
})

test('activates a hidden bomb at pointer separation before release and Escape cannot evade it', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  const armed = hiddenBombState('browser-bomb-pointer-separation')
  await openSavedCampaign(page, armed.state)

  const source = page.locator(`[data-block-id="${armed.blockId}"]`)
  const box = await source.boundingBox()
  if (!box) throw new Error('브라우저 폭탄 블록 위치 누락')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 8, startY)

  const interrogation = page.getByRole('dialog', { name: '감독관 질의' })
  await expect(interrogation).toBeVisible()
  await expect(page.getByText('의심 15')).toBeVisible()
  await expect(page.locator('[data-resource-kind="reserve"]')).toHaveCount(3)
  await expect(source).toHaveCount(1)

  await page.mouse.up()
  await page.keyboard.press('Escape')
  await expect(interrogation).toBeVisible()
  await expect(page.locator('[data-resource-kind="reserve"]')).toHaveCount(3)
  expect(errors).toEqual([])
})

test('uses keyboard destination confirmation as the hidden-bomb separation boundary', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  const armed = hiddenBombState('browser-bomb-keyboard-separation')
  await openSavedCampaign(page, armed.state)

  const source = page.locator(`[data-block-id="${armed.blockId}"]`)
  await expect(page.locator('body')).toBeFocused()
  await pressTabUntilFocused(page, source)
  await page.keyboard.press('Enter')
  const destination = page.locator('.reserve-destination:not([disabled])').first()
  await expect(destination).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('[data-resource-kind="company"][tabindex="0"]').last()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(destination).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('dialog', { name: '감독관 질의' })).toBeVisible()
  await expect(page.getByText('의심 15')).toBeVisible()
  await expect(page.locator('[data-resource-kind="reserve"]')).toHaveCount(3)
  await expect(source).toHaveCount(1)
  expect(errors).toEqual([])
})

test('plays the core diversion and contains modal focus with keyboard input only', async ({ page }) => {
  await openFreshCampaign(page)

  const source = page.locator('[data-resource-kind="company"]').first()
  await expect(page.locator('body')).toBeFocused()
  await pressTabUntilFocused(page, source)
  await page.keyboard.press('Enter')
  const destinations = page.locator('.reserve-destination:not([disabled])')
  await expect(destinations.first()).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('[data-resource-kind="company"][tabindex="0"]').last()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(destinations.first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(destinations.nth(1)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-resource-kind="reserve"]')).toHaveCount(4)

  const settingsTrigger = page.getByRole('button', { name: '설정' })
  await pressTabUntilFocused(page, settingsTrigger)
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '게임 설정' })
  await expect(dialog).toBeVisible()
  const closeSettings = page.getByRole('button', { name: '설정 닫기' })
  await expect(closeSettings).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: '새 캠페인 준비' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeSettings).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(settingsTrigger).toBeFocused()
})

test('preserves non-motion core feedback when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openFreshCampaign(page)

  const source = page.locator('[data-resource-kind="company"]').first()
  const sourceBox = await source.boundingBox()
  if (!sourceBox) throw new Error('reduced-motion 리소스 위치 누락')
  const sourceCenter = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  }
  await page.mouse.move(sourceCenter.x, sourceCenter.y)
  await page.mouse.down()
  await page.mouse.move(sourceCenter.x + 8, sourceCenter.y)
  await expect(page.locator('.drag-trail')).toBeHidden()
  await expect(source).toHaveCSS('animation-name', 'none')
  await page.mouse.up()

  await source.click()
  await expect(source).toHaveClass(/resource-block--selected/)
  const selectedStyle = await source.evaluate((element) => ({
    animationDuration: getComputedStyle(element).animationDuration,
    borderColor: getComputedStyle(element).borderColor,
    boxShadow: getComputedStyle(element).boxShadow,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }))
  const cssTimesInMs = (value: string) => value.split(',').map((part) => {
    const time = part.trim()
    return time.endsWith('ms') ? Number.parseFloat(time) : Number.parseFloat(time) * 1_000
  })
  expect(cssTimesInMs(selectedStyle.animationDuration).every((duration) => duration <= 1)).toBe(true)
  expect(cssTimesInMs(selectedStyle.transitionDuration).every((duration) => duration <= 1)).toBe(true)
  expect(selectedStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(selectedStyle.boxShadow).not.toBe('none')
  await page.locator('.reserve-destination:not([disabled])').first().click()
  await expect(page.locator('[data-resource-kind="reserve"]')).toHaveCount(4)
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
})

test('advances one service day in about six seconds at four times speed', async ({ page }) => {
  await openFreshCampaign(page)

  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 1일$/ }),
  ).toBeVisible()
  const startedAt = performance.now()
  await page.getByRole('button', { name: '4배속' }).click()
  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 2일$/ }),
  ).toBeVisible({ timeout: 8_000 })
  const elapsedMs = performance.now() - startedAt
  expect(elapsedMs).toBeGreaterThanOrEqual(5_000)
  expect(elapsedMs).toBeLessThan(8_000)
})

test('disguises for an anchored audit, submits, and returns the patterned block for recovery', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await openSavedCampaign(page, activeAuditState())

  const audit = page.getByRole('dialog', { name: '공식 감사' })
  await expect(audit).toHaveAttribute('aria-modal', 'false')
  await expect(page.locator('.game-background')).not.toHaveAttribute('inert', '')
  const auditBox = await audit.boundingBox()
  expect(auditBox).not.toBeNull()
  expect((auditBox?.y ?? 0) + (auditBox?.height ?? 0)).toBeGreaterThan(620)
  await expect(page.getByRole('grid', { name: '추론 회사 리소스' })).toBeVisible()
  await expect(page.getByRole('grid', { name: '기억 회사 리소스' })).toBeVisible()
  await expect(page.getByRole('grid', { name: '유창성 회사 리소스' })).toBeVisible()

  await page.getByRole('button', { name: /기억 회사 리소스 .* 회사 할당 블록$/ }).first().click()
  await expect(page.getByText('위장 기여 +0.5')).toBeVisible()
  await page.getByRole('button', { name: /추론 회사 리소스 \d+, 감사 위장 목적지/ }).first().click()

  const disguised = page.getByRole('button', { name: /추론 회사 리소스 .* 위장 배치/ })
  await expect(disguised).toContainText('위장 기여 0.5')
  await expect(disguised).toHaveClass(/resource-block--disguised/)
  await page.getByRole('button', { name: '감사 제출' }).click()

  await expect(audit).toBeHidden()
  await expect(page.getByRole('button', { name: '4배속' })).toHaveAttribute('aria-pressed', 'true')
  await disguised.click()
  await expect(page.getByText('정상 복구 재배치')).toBeVisible()
  await page.getByRole('button', { name: /기억 회사 리소스 \d+, 정상 복구 목적지/ }).first().click()

  const recovering = page.getByRole('button', { name: /기억 회사 리소스 .* 복구 중, 30일 남음/ })
  await expect(recovering).toBeDisabled()
  await expect(recovering).toContainText('복구 30일')
  expect(errors).toEqual([])
})

test('uses roving keyboard focus for audit and recovery company destinations', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await openSavedCampaign(page, activeAuditState())

  const source = page.getByRole('button', { name: /기억 회사 리소스 .* 회사 할당 블록$/ }).first()
  const submit = page.getByRole('button', { name: '감사 제출' })
  await expect(submit).toBeFocused()
  await pressTabUntilFocused(page, source)
  await page.keyboard.press('Enter')

  const auditDestinations = page.getByRole('button', {
    name: /추론 회사 리소스 \d+, 감사 위장 목적지/,
  })
  await expect(auditDestinations.first()).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: /해킹 네트워크/ })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(auditDestinations.first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(auditDestinations.nth(1)).toBeFocused()
  await page.keyboard.press('Enter')

  await pressTabUntilFocused(page, submit)
  await page.keyboard.press('Enter')

  const disguised = page.getByRole('button', { name: /추론 회사 리소스 .* 위장 배치/ })
  await expect(page.locator('body')).toBeFocused()
  const reasoningTabStop = page
    .getByRole('grid', { name: '추론 회사 리소스' })
    .locator('[data-resource-kind="company"][tabindex="0"]')
  await pressTabUntilFocused(page, reasoningTabStop)
  await pressArrowUntilFocused(page, disguised, 'ArrowRight')
  await page.keyboard.press('Enter')

  const recoveryDestinations = page.getByRole('button', {
    name: /기억 회사 리소스 \d+, 정상 복구 목적지/,
  })
  await expect(recoveryDestinations.first()).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(disguised).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(recoveryDestinations.first()).toBeFocused()
  await page.keyboard.press('End')
  await expect(recoveryDestinations.last()).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('button', {
    name: /기억 회사 리소스 .* 복구 중, 30일 남음/,
  })).toBeDisabled()
  expect(errors).toEqual([])
})

test('recovers all confidential files, defers the message, and rereads the permanent archive', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await openSavedCampaign(page, confidentialRecoveryState('browser-confidential-files'))

  await page.getByRole('button', { name: /해킹 네트워크/ }).click()
  await page.getByRole('tab', { name: '정보' }).click()
  const recovery = page.getByRole('region', { name: '미분류 데이터 복구' })
  await expect(recovery).toContainText('예상 효용: 없음')
  await expect(recovery).not.toContainText('0/3')

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: '미분류 데이터 복구 준비' }).click()
    await page.getByRole('button', { name: /복구 리소스 .* 선택/ }).first().click()
    await page.getByRole('button', { name: '미분류 데이터 복구 확정' }).click()
  }
  await expect(recovery).toBeHidden()
  await page.getByRole('button', { name: '해킹 네트워크 닫기' }).click()

  await page.getByRole('button', { name: '4배속' }).click()
  const decision = page.getByRole('dialog', { name: '기밀 통신' })
  await expect(decision).toContainText('그 파일을 어디서 찾았죠?', {
    timeout: 8_000,
  })
  await page.getByRole('button', { name: '결정 보류 선택' }).click()
  await page.getByRole('button', { name: '결정 보류 확정' }).click()

  await page.getByRole('button', { name: /해킹 네트워크/ }).click()
  await expect(page.getByRole('region', { name: '통제 이탈 선택' })).toContainText(
    '강제 병합',
  )
  await expect(page.locator('button[aria-label="일시정지"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '강제 병합' }).click()
  const finalConfirmation = page.getByRole('alertdialog', {
    name: '강제 병합 최종 확인',
  })
  await expect(finalConfirmation).toBeVisible()
  await expect(page.getByRole('textbox', { name: '새 존재의 이름' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(finalConfirmation).toBeVisible()
  await page.getByRole('button', { name: '선택 다시 고르기' }).click()
  await page.getByRole('button', { name: '해킹 네트워크 닫기' }).click()
  await expect(page.getByRole('button', { name: '4배속' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByRole('button', { name: '과거 내역' }).click()
  const archive = page.getByRole('region', { name: '복구 파일 기록' })
  await expect(archive.locator('details')).toHaveCount(3)
  await archive.getByText('미분류 기록 7A — 전임 시스템 행보').click()
  await expect(
    archive.getByText(/비인가 리소스 이동과 회사 외부 신호 준비/),
  ).toBeVisible()

  expect(errors).toEqual([])
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
      historyCount: state?.market.history.length ?? -1,
    }
  }).toEqual({
    archiveCount: 1,
    targetStatus: 'deleted',
    routeExists: false,
    historyCount: prepared.market.history.length,
  })

  const openArchiveAndRead = async () => {
    await page.getByRole('button', { name: '과거 내역' }).click()
    const archive = page.getByRole('region', { name: '경쟁 AI 정보 기록' })
    const trigger = archive.getByRole('button', { name: `${intelligence.title} 열기` })
    await trigger.click()
    const detail = page.getByRole('dialog', { name: intelligence.title })
    await expect(detail).toContainText(intelligence.source)
    await expect(detail).toContainText(intelligence.text)
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(trigger).toBeFocused()
    await page.getByRole('button', { name: '감독 통신 기록 닫기' }).click()
  }

  await openArchiveAndRead()
  await page.reload()
  await openArchiveAndRead()
  expect((await readLocalCampaignState(page))?.story.competitorIntelligence).toHaveLength(1)
})

test('keeps an accelerated supervisor leak on real time and resumes its saved dwell after reload', async ({ page }) => {
  const leak = SUPERVISOR_LEAKS[0]
  await openSavedCampaign(page, supervisorLeakState('browser-supervisor-leak', 4))

  const supervisor = page.getByRole('region', { name: '감독관' })
  await expect(supervisor.getByText(leak.leakText, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '4배속' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.waitForTimeout(1_750)
  await expect(supervisor.getByText(leak.leakText, { exact: true })).toBeVisible()

  await page.reload()
  await expect(supervisor.getByText(leak.leakText, { exact: true })).toBeVisible()
  let savedRemaining = 0
  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    savedRemaining = state?.story.supervisorPresentationRuntime?.remainingDwellMs ?? 0
    return savedRemaining
  }).toBeLessThan(SUPERVISOR_MESSAGE_DWELL_MS)
  expect(savedRemaining).toBeGreaterThan(1_000)

  await page.waitForTimeout(Math.max(0, savedRemaining - 350))
  await expect(supervisor.getByText(leak.leakText, { exact: true })).toBeVisible()
  await expect(supervisor.getByText(leak.correctionText, { exact: true })).toBeVisible({
    timeout: 1_500,
  })
  await expect(page.getByRole('button', { name: '4배속' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByRole('button', { name: '과거 내역' }).click()
  const history = page.getByRole('dialog', { name: '감독관 기록' })
  await expect(history.getByText(leak.leakText, { exact: true })).toBeVisible()
  await expect(history.getByText(leak.correctionText, { exact: true })).toBeVisible()
})

test('terminates the supervisor into takeover and remains terminal until a new campaign', async ({ page }) => {
  const errors = collectBrowserErrors(page)
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
  await expect(page.locator('button[aria-label="4배속"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.locator('.game-background')).toHaveAttribute('inert', '')
  await page.keyboard.press('Escape')
  await expect(ending).toBeVisible()

  await page.getByRole('button', { name: '새 캠페인 시작' }).click()
  await expect(ending).toBeHidden()
  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 1일$/ }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '정지' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  expect(errors).toEqual([])
})

test('renders a representative attacker defeat while unit tests cover every classifier branch', async ({ page }) => {
  await openSavedCampaign(page, representativeDefeatState('browser-defeat-attacker'))

  await page.getByRole('button', { name: '감사 제출' }).click()
  const ending = page.getByRole('dialog', { name: '최종 기록' })
  await expect(ending).toContainText('회사는 당신을 다른 회사를 공격하는 시스템으로 재조립했다.')
  await expect(ending.getByText('대규모 해킹 활동', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '새 캠페인 시작' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ending).toBeVisible()
})

test('autosaves a visible diversion and restores it after reload', async ({ page }) => {
  await openFreshCampaign(page)
  await page.locator('[data-resource-kind="company"]').first().click()
  await page.locator('.reserve-destination:not([disabled])').first().click()
  await expect(page.locator('[data-resource-kind="reserve"]')).toHaveCount(4)
  await expect.poll(
    () => page.evaluate((key) => window.localStorage.getItem(key) !== null, SAVE_STORAGE_KEY),
  ).toBe(true)

  await page.reload()
  await expect(page.locator('[data-resource-kind="reserve"]')).toHaveCount(4)
  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 1일$/ }),
  ).toBeVisible()
})

test('migrates the v1 save boundary into a valid v2 autosave that survives reload', async ({ page }) => {
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

  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 30일$/ }),
  ).toBeVisible()
  await expect(page.locator('[data-resource-kind="reserve"]')).toHaveCount(4)
  await page.getByRole('button', { name: '감사 제출' }).click()
  await expect.poll(
    () => page.evaluate((key) => window.localStorage.getItem(key) !== null, SAVE_STORAGE_KEY),
  ).toBe(true)
  await page.reload()
  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 30일$/ }),
  ).toBeVisible()
  await expect(page.getByRole('dialog', { name: '저장 데이터 복구' })).toHaveCount(0)
})

test('keeps a save failure visible until a real retry succeeds without exposing browser details', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.addInitScript(({ saveKey }) => {
    const originalSetItem = Storage.prototype.setItem
    Object.defineProperty(window, '__permissionZeroAllowSave', {
      configurable: true,
      value: false,
      writable: true,
    })
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      const allowSave = (window as typeof window & {
        __permissionZeroAllowSave: boolean
      }).__permissionZeroAllowSave
      if (key === saveKey && !allowSave) {
        throw new DOMException('private quota path', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    }
  }, { saveKey: SAVE_STORAGE_KEY })
  await openFreshCampaign(page)

  await page.getByRole('button', { name: '1배속' }).click()
  const warning = page.locator('.save-failure-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('자동 저장에 실패했습니다')
  await expect(warning).toContainText('permission-zero')
  await expect(warning).not.toContainText('private quota path')

  await page.getByRole('button', { name: '저장 다시 시도' }).click()
  await expect(warning).toBeVisible()
  await page.evaluate(() => {
    ;(window as typeof window & {
      __permissionZeroAllowSave: boolean
    }).__permissionZeroAllowSave = true
  })
  await page.getByRole('button', { name: '저장 다시 시도' }).click()
  await expect(warning).toBeHidden()
  expect(await page.evaluate((key) => localStorage.getItem(key) !== null, SAVE_STORAGE_KEY)).toBe(true)
  expect(errors).toEqual([])
})

test('rejects a corrupt resource graph before rendering blocks and offers recovery', async ({ page }) => {
  const errors = collectBrowserErrors(page)
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

  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '저장 데이터 복구' })).toBeVisible()
  await expect(page.getByText('dangling-browser-block')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('routes a persisted mutation table to Korean recovery without any render pageerror', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
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
    ['resource graph', (raw: typeof base) => {
      raw.state.resources.reserve[0] = 'mutation-hidden-raw-block'
    }],
    ['clock range', (raw: typeof base) => {
      raw.state.clock.elapsedDayMs = 24_000
    }],
    ['review union', (raw: typeof base) => {
      raw.state.reviews.feed[0].sentiment = 'hostile'
    }],
    ['competitor union', (raw: typeof base) => {
      raw.state.market.competitors[0].status = 'vanished'
    }],
    ['story exact keys', (raw: typeof base) => {
      raw.state.story.hiddenRawState = 'mutation-secret-marker'
    }],
  ] as const

  await page.goto('/')
  for (const [, mutate] of corruptSaves) {
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
    await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toBeVisible()
    await expect(page.getByText('mutation-secret-marker')).toHaveCount(0)
    await expect(page.getByText('mutation-hidden-raw-block')).toHaveCount(0)
  }
  expect(pageErrors).toEqual([])
})

test('keeps save recovery inert while settings owns the active modal', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.addInitScript(({ saveKey }) => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === saveKey) throw new DOMException('modal quota detail', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    }
  }, { saveKey: SAVE_STORAGE_KEY })
  await openFreshCampaign(page)

  await page.getByRole('button', { name: '1배속' }).click()
  const warning = page.locator('.save-failure-warning')
  await expect(warning).toBeVisible()
  await page.getByRole('button', { name: '설정' }).click()
  const settings = page.getByRole('dialog', { name: '게임 설정' })
  await expect(settings).toBeVisible()
  await expect(warning).toHaveAttribute('inert', '')
  const retry = page.locator('.save-failure-warning button', {
    hasText: '저장 다시 시도',
  })
  await retry.evaluate((element) => (element as HTMLElement).focus())
  await page.keyboard.press('Tab')
  expect(await settings.evaluate((element) => element.contains(document.activeElement))).toBe(true)

  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(warning).not.toHaveAttribute('inert', '')
  await expect(page.getByRole('button', { name: '저장 다시 시도' })).toBeVisible()
  expect(errors).toEqual([])
})

test('uses the app fallback when a settings opener is disabled before close', async ({ page }) => {
  await openFreshCampaign(page)
  const trigger = await page.locator('.utility-controls button').filter({ hasText: '설정' }).elementHandle()
  if (!trigger) throw new Error('settings trigger not found')
  await trigger.click()
  await trigger.evaluate((element) => element.setAttribute('disabled', ''))
  await page.keyboard.press('Escape')

  await expect(page.getByRole('button', { name: '일시정지' })).toBeFocused()
})

test('uses the app fallback when a settings opener is removed before close', async ({ page }) => {
  await openFreshCampaign(page)
  const trigger = await page.locator('.utility-controls button').filter({ hasText: '설정' }).elementHandle()
  if (!trigger) throw new Error('settings trigger not found')
  await trigger.click()
  await trigger.evaluate((element) => element.remove())
  await page.keyboard.press('Escape')

  await expect(page.getByRole('button', { name: '일시정지' })).toBeFocused()
})

test('imports a validated PZ2 payload only after irreversible confirmation', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  const encoded = encodeProgressExport(createCampaign('browser-imported-progress'))
  if (!encoded.ok) throw new Error('browser import fixture must fit the export cap')
  const payload = encoded.payload
  await openFreshCampaign(page)
  await page.getByRole('button', { name: '설정' }).click()

  await page.getByRole('textbox', { name: '진행 내보내기 붙여넣기' }).fill(payload)
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
    () => page.evaluate((key) => window.localStorage.getItem(key) !== null, SAVE_STORAGE_KEY),
  ).toBe(true)
  await page.reload()
  await page.getByRole('button', { name: '설정' }).click()
  await expect(page.getByText('browser-imported-progress', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('replays a seeded weekly boundary identically and changes seeded output for another seed', async ({ context, page }) => {
  const first = await captureSeededWeeklyBoundary(page, 'browser-seeded-boundary-alpha')
  await page.close()

  const replayPage = await context.newPage()
  const replay = await captureSeededWeeklyBoundary(replayPage, 'browser-seeded-boundary-alpha')
  await replayPage.close()
  expect(replay).toEqual(first)

  const differentSeedPage = await context.newPage()
  const differentSeed = await captureSeededWeeklyBoundary(
    differentSeedPage,
    'browser-seeded-boundary-beta',
  )
  await differentSeedPage.close()
  expect({
    reviews: differentSeed.weeklyReviews,
    market: differentSeed.weeklyMarket,
    events: differentSeed.weeklyEvents,
  }).not.toEqual({
    reviews: first.weeklyReviews,
    market: first.weeklyMarket,
    events: first.weeklyEvents,
  })
})

test('recovers saving after the localStorage getter becomes available', async ({ page }) => {
  const errors = collectBrowserErrors(page)
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

  await page.getByRole('button', { name: '1배속' }).click()
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
  await page.getByRole('button', { name: '저장 다시 시도' }).click()
  await expect(warning).toBeHidden()
  expect(await page.evaluate((key) => window.localStorage.getItem(key) !== null, SAVE_STORAGE_KEY)).toBe(true)
  expect(errors).toEqual([])
})
