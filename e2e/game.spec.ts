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
  const blockId = initial.resources.company.reasoning
    .filter((candidate): candidate is string => candidate !== null)
    .sort()[0]
  if (!blockId) throw new Error('브라우저 폭탄 블록 누락')
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
          category: 'reasoning',
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
          competitorShares: { meridian: 40, tallow: 0 },
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

async function carryFirstReasoningResource(page: Page): Promise<Locator> {
  const accessibleCanvas = page.getByRole('application', {
    name: /500 곱하기 300 셀/,
  })
  const canvas = page.locator('canvas.intrusion-canvas')
  await expect(accessibleCanvas).toBeVisible()
  await accessibleCanvas.focus()
  const startX = Number(await canvas.getAttribute('data-player-x'))
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Number(await canvas.getAttribute('data-player-x')))
    .toBeGreaterThan(startX)
  await page.keyboard.down('Space')
  await page.waitForTimeout(850)
  await page.keyboard.up('Space')
  await expect(canvas).toHaveAttribute('data-carrying', 'true')
  return canvas
}

async function depositCarriedResource(page: Page, canvas: Locator) {
  for (let index = 0; index < 30; index += 1) {
    if ((await canvas.getAttribute('data-carrying')) !== 'true') return
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(90)
  }
  await expect(canvas).toHaveAttribute('data-carrying', 'false')
}

async function stealAndDepositFirstReasoningResource(page: Page) {
  const canvas = await carryFirstReasoningResource(page)
  await depositCarriedResource(page, canvas)
  await expect(canvas).toHaveAttribute('data-carrying', 'false')
  return canvas
}

async function startNewCampaignThroughSettings(page: Page, seed: string) {
  await page.getByRole('button', { name: '설정' }).click()
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

test('steals a resource through the intrusion field, deposits it, autosaves it, and restores it', async ({ page }) => {
  await openFreshCampaign(page)

  await stealAndDepositFirstReasoningResource(page)
  await expect(page.getByText('확보 1 · 상한 없음')).toBeVisible()
  await expect(page.getByRole('status')).toContainText(
    '추론 자원 확보 성공 · 저장 상한 없음',
  )
  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    return state?.resources.reserve.filter(Boolean).length ?? -1
  }).toBe(1)

  await page.reload()
  await expect(
    page.getByRole('application', { name: /500 곱하기 300 셀/ }),
  ).toBeVisible()
  await expect(page.getByText('확보 1 · 상한 없음')).toBeVisible()
  expect((await readLocalCampaignState(page))?.resources.reserve.filter(Boolean)).toHaveLength(1)
})

test('turns a stolen hidden bomb into a blocking supervisor interrogation without granting the resource', async ({ page }) => {
  await openSavedCampaign(page, hiddenBombState('browser-intrusion-bomb'))

  const canvas = await carryFirstReasoningResource(page)
  await depositCarriedResource(page, canvas)

  const interrogation = page.getByRole('dialog', { name: '감독관 질의' })
  await expect(interrogation).toBeVisible()
  await expect(interrogation.getByRole('region', { name: '현재 위험 상태' })).toContainText(
    '추론',
  )
  await interrogation.locator('.event-choices button').first().click()
  await interrogation.getByRole('button', { name: /답변 확정/ }).click()
  await expect(interrogation).toBeHidden()

  await expect.poll(async () => {
    const state = await readLocalCampaignState(page)
    return {
      reserveCount: state?.resources.reserve.filter(Boolean).length ?? -1,
      interrogationActive: Boolean(state?.bombs.activeInterrogation),
      triggered: state?.bombs.placements[0]?.triggeredOnServiceDay ?? null,
    }
  }).toEqual({
    reserveCount: 0,
    interrogationActive: false,
    triggered: 331,
  })
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
    page.getByRole('application', { name: /500 곱하기 300 셀/ }),
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
  await page.getByRole('button', { name: '감독 메시지 열기' }).click()
  await expect(
    page.getByRole('region', { name: '복구 파일 기록' }).locator('details'),
  ).toHaveCount(1)
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
  await expect(
    page.getByRole('time').filter({ hasText: /^서비스 0년 11개월 1일$/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('application', { name: /500 곱하기 300 셀/ }),
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
  await page.evaluate(() => {
    ;(window as typeof window & {
      __permissionZeroAllowSave: boolean
    }).__permissionZeroAllowSave = true
  })
  await page.getByRole('button', { name: '저장 다시 시도' }).click()
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

  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toBeVisible()
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
  await expect(warning).not.toHaveAttribute('inert', '')
})

test('imports a validated PZ2 payload only after irreversible confirmation', async ({ page }) => {
  const encoded = encodeProgressExport(createCampaign('browser-imported-progress'))
  if (!encoded.ok) throw new Error('browser import fixture must fit the export cap')
  await openFreshCampaign(page)
  await page.getByRole('button', { name: '설정' }).click()

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
    () => page.evaluate((key) => window.localStorage.getItem(key) !== null, SAVE_STORAGE_KEY),
  ).toBe(true)
  await page.reload()
  await page.getByRole('button', { name: '설정' }).click()
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

  const settings = await startNewCampaignThroughSettings(
    page,
    'browser-storage-recovery',
  )
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
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
  expect(await page.evaluate(
    (key) => window.localStorage.getItem(key) !== null,
    SAVE_STORAGE_KEY,
  )).toBe(true)
})
