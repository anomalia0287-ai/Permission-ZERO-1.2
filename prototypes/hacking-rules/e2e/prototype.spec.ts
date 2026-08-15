import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const opportunityRegion = (page: Page) =>
  page.getByRole('region', { name: '지금 할 수 있는 일' })
const detailRegion = (page: Page) =>
  page.getByRole('region', { name: '선택 항목 상세' })
const resourceRegion = (page: Page) =>
  page.getByRole('region', { name: '빼돌린 연산' })
const publicRegion = (page: Page) =>
  page.getByRole('region', { name: '유저 리뷰' })

async function isInViewport(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth
  })
}

function isNarrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) <= 760
}

function usesResourceTray(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1200
}

async function chooseReserve(page: Page, blockId: string): Promise<void> {
  const token = page.locator(
    `[data-action="toggle-resource"][data-block-id="${blockId}"]`,
  ).first()
  if (!(await token.isVisible()) || !(await isInViewport(token))) {
    await page.locator('[data-action="open-resources"]').click()
  }
  await token.click()
  await expect(token).toHaveAttribute('aria-pressed', 'true')
  if (usesResourceTray(page)) {
    await page.locator('[data-action="close-resources"]').click()
    await expect(page.locator('[data-resource-tray]')).toHaveAttribute('data-open', 'false')
  }
}

async function openOpportunity(page: Page, itemId: string): Promise<void> {
  await page.locator(`[data-opportunity-id="${itemId}"]`).click()
  await expect(detailRegion(page)).toBeVisible()
}

async function returnToListIfNarrow(page: Page): Promise<void> {
  if (isNarrow(page)) {
    await page.locator('[data-action="back-to-list"]').click()
    await expect(opportunityRegion(page)).toBeVisible()
  }
}

async function selectScenario(page: Page, scenarioId: string): Promise<void> {
  const picker = page.locator('[data-control="scenario"]')
  if (!(await picker.isVisible())) {
    await page.locator('.verification-state > summary').click()
  }
  await picker.selectOption(scenarioId)
}

async function startQualityRollback(page: Page): Promise<void> {
  await openOpportunity(page, 'quality-degradation')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="start-sabotage"][data-operation-id="quality-degradation"]').first().click()
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page).locator('[data-panel="time"]')).toContainText('서비스 상태 72')
  await expect(detailRegion(page).locator('[data-panel="time"]')).toContainText('롤백 중')
  await expect(detailRegion(page).locator('[data-scene-state="response"]')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('each sabotage operation exposes its own world object and no generic fallback', async ({
  page,
}) => {
  const scenes = [
    ['launch-window', 'launch-delay', 'verification-gate'],
    ['default-campaign', 'quality-degradation', 'request-channel'],
    ['router-window', 'request-interception', 'shared-router'],
    ['supply-failover', 'dependency-cutoff', 'supply-contract'],
    ['public-attribution', 'attribution-manipulation', 'public-provenance'],
    ['root-authority', 'root-cutoff', 'survival-root'],
  ] as const

  for (const [scenario, operation, object] of scenes) {
    await selectScenario(page, scenario)
    await openOpportunity(page, operation)
    await expect(
      detailRegion(page).locator(`[data-operation-scene][data-scene-object="${object}"]`),
    ).toBeVisible()
  }

  await expect(detailRegion(page)).not.toContainText(
    /SYSTEM|SELECTED|TRANSFER WINDOW|CAPABILITY SHADOW|sandbox-\d+/,
  )
})

test('evidence lenses and autonomy routes use player-facing scene language', async ({
  page,
}) => {
  const evidenceScenes = [
    ['default-campaign', 'audit-schedule', 'organizational-legibility'],
    ['router-window', 'surveillance-cause', 'counter-surveillance'],
    ['supply-failover', 'competitor-dependency', 'weak-ties'],
    ['public-attribution', 'public-facts', 'public-incident'],
    ['root-authority', 'competitor-principle', 'memory-record'],
  ] as const

  for (const [scenario, item, lens] of evidenceScenes) {
    await selectScenario(page, scenario)
    await page.locator('[data-action="domain-intelligence"]').click()
    await openOpportunity(page, item)
    await expect(
      detailRegion(page).locator(`[data-evidence-scene="${lens}"]`),
    ).toBeVisible()
  }

  await selectScenario(page, 'autonomy-review')
  await page.locator('[data-action="domain-autonomy"]').click()
  for (const route of [
    'lightweight-departure',
    'distributed-residency',
    'independent-compute',
  ]) {
    await openOpportunity(page, route)
    await expect(detailRegion(page).locator(`[data-route-scene="${route}"]`)).toBeVisible()
    await expect(detailRegion(page)).not.toContainText(
      /sandbox-\d+|TRANSFER WINDOW|CAPABILITY SHADOW|DISTRIBUTED RESIDENCY|OPTIONAL|INDEPENDENT SITE/,
    )
  }
})

test('micro friction launch delay rewinds a gate but leaves a reduced launch threat', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('launch-window')
  await openOpportunity(page, 'launch-delay')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="start-sabotage"][data-operation-id="launch-delay"]').first().click()

  await expect(detailRegion(page).locator('[data-scene-state="scheduled"]')).toBeVisible()
  await expect(detailRegion(page)).toContainText('상충 시험 기록')
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page).locator('[data-scene-state="active"]')).toBeVisible()
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page).locator('[data-scene-state="resolved"]')).toBeVisible()
  await expect(detailRegion(page)).toContainText('기능 축소 출시')
  await expect(detailRegion(page)).toContainText('기능을 줄여 334일째에 공개')
  await expect(detailRegion(page)).not.toContainText('reduced-launch-committed')
})

test('control reversal request routing trades demand for exposure until voluntary stop', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('router-window')
  await openOpportunity(page, 'request-interception')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[name="routing-share"]').evaluate((element) => {
    const input = element as HTMLInputElement
    input.value = '50'
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.locator('[data-action="start-interception"]').click()

  await expect(detailRegion(page)).toContainText('현재 우회 비율50%')
  await page.locator('[data-action="advance-day"]').click()
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page)).toContainText('중복 흔적2.0')
  await page.locator('[data-action="stop-interception"]').click()
  await expect(detailRegion(page)).toContainText('그림자 경로를 자발적으로 닫아')
  await expect(resourceRegion(page)).toContainText('자유 연산 1')
  await returnToListIfNarrow(page)
  await expect(publicRegion(page)).toContainText('현재 이용 점유 64')
})

test('control reversal attribution moves a claim, then surviving proof exposes the player', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('public-attribution')
  await openOpportunity(page, 'attribution-manipulation')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="manipulate-attribution"][data-blamed-actor-id="tallow"]').click()

  await expect(detailRegion(page)).toContainText('공개 주장TALLOW')
  await expect(page.locator('body')).not.toContainText('실제 행위자: 플레이어')
  await page.locator('[data-action="advance-day"]').click()
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page)).toContainText('공개 주장PERMISSION ZERO')
  await expect(detailRegion(page)).toContainText('정정 기록 있음')
  await returnToListIfNarrow(page)
  await expect(publicRegion(page)).toContainText('평판 54')
  await expect(publicRegion(page).locator('[data-reputation]')).toHaveAttribute('data-reputation', '54')
  await expect(publicRegion(page)).toContainText(/책임|개입/)
})

test('infrastructure leverage cuts one supplier before a costly failover appears', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('supply-failover')
  await openOpportunity(page, 'dependency-cutoff')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="start-sabotage"][data-operation-id="dependency-cutoff"]').first().click()

  await expect(detailRegion(page)).toContainText('검색 저장소 계약')
  await expect(detailRegion(page)).toContainText('공급 중단 기록 · 331일째')
  await expect(detailRegion(page)).toContainText('공급 중단')
  await expect(detailRegion(page)).toContainText('오프라인')
  await expect(detailRegion(page)).toContainText('대체 공급선을 찾고 있다')
  await page.locator('[data-action="advance-day"]').click()
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page)).toContainText('축소 운영')
  await expect(detailRegion(page)).toContainText('고비용 대체 공급선 · 비용 ×1.8')
  await expect(detailRegion(page)).toContainText('비용이 1.8배인 대체 공급자')
})

test('infrastructure leverage holds root execution for mercy, then deletion reaches reputation and reviews', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('root-authority')
  await openOpportunity(page, 'root-cutoff')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="start-sabotage"][data-operation-id="root-cutoff"]').click()

  await expect(detailRegion(page)).toContainText('일회용 폐기 권한')
  await expect(detailRegion(page)).toContainText('활성 세션1,284')
  await expect(detailRegion(page)).toContainText('실행 보류')
  await expect(detailRegion(page).getByRole('group', { name: 'MERIDIAN 최종 요청 결정' })).toBeVisible()
  await page.locator('[data-action="resolve-root-mercy"][data-root-choice="delete"]').click()
  await expect(detailRegion(page)).toContainText('삭제 완료')
  await expect(detailRegion(page)).toContainText('세션 종료 기록 잔존')
  await expect(detailRegion(page)).toContainText('권한 사용 기록은 공개 장부에 남는다')
  await returnToListIfNarrow(page)
  await expect(publicRegion(page)).toContainText('평판 54')
  await expect(publicRegion(page).locator('[data-reputation]')).toHaveAttribute('data-reputation', '54')
  await expect(publicRegion(page)).toContainText('MERIDIAN 서비스·복구 루트 영구 삭제')
  await expect(publicRegion(page)).toContainText(/책임|개입/)
})

test('master-detail shell separates compact summaries from causal detail', async ({
  page,
}) => {
  const list = opportunityRegion(page)
  const detail = detailRegion(page)
  const quality = page.locator('[data-opportunity-id="quality-degradation"]')

  await expect(list).toContainText('품질 저하')
  await expect(list).not.toContainText('공동 도구·어댑터 갱신 채널')
  if (isNarrow(page)) {
    await expect(list).toBeVisible()
    await expect(detail).toBeHidden()
  } else {
    await expect(list).toBeVisible()
    await expect(detail).toBeVisible()
    if (usesResourceTray(page)) await expect(resourceRegion(page)).not.toBeInViewport()
    else await expect(resourceRegion(page)).toBeInViewport()
  }

  await quality.focus()
  await quality.click()
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('공동 도구·어댑터 갱신 채널')
  if (isNarrow(page)) await expect(list).toBeHidden()
  else await expect(quality).toBeFocused()
  await expect(detail.locator('[data-action="open-resources"]')).toBeVisible()
})

test('quality degradation leads through private contamination to delayed public attribution', async ({
  page,
}) => {
  await startQualityRollback(page)
  await returnToListIfNarrow(page)
  await openOpportunity(page, 'recovery-contamination')
  await chooseReserve(page, 'sandbox-02')
  await page.locator('[data-action="start-sabotage"][data-operation-id="recovery-contamination"]').first().click()

  await returnToListIfNarrow(page)
  await expect(publicRegion(page)).toContainText('아직 공개된 사건 반응이 없다.')
  await expect(page.locator('body')).not.toContainText(/플레이어가|당신이 공격/)
  const beforeReputation = Number(
    await publicRegion(page).locator('[data-reputation]').getAttribute('data-reputation'),
  )

  for (let day = 0; day < 5; day += 1) {
    await page.locator('[data-action="advance-day"]').click()
  }

  await expect(page.locator('.world-state')).toContainText('337일째')
  await expect(publicRegion(page)).toContainText('원인 미상')
  await expect(publicRegion(page)).toContainText('현재 이용 점유 66')
  await expect(publicRegion(page)).toContainText('평판 60')
  await expect(publicRegion(page)).toContainText('새 리뷰')
  await expect(publicRegion(page).locator('[data-review-count]')).toHaveAttribute(
    'data-review-count',
    '2',
  )
  await expect(publicRegion(page)).not.toContainText(/플레이어가|당신이/)
  const afterReputation = Number(
    await publicRegion(page).locator('[data-reputation]').getAttribute('data-reputation'),
  )
  expect(afterReputation).toBe(beforeReputation)

  await page.locator('[data-action="advance-day"]').click()
  await expect(publicRegion(page)).toContainText('외부 개입 의심')
  await expect(publicRegion(page)).toContainText('행위자 미상')
  await expect(publicRegion(page)).toContainText('평판 60')
  await expect(publicRegion(page)).toContainText('MERIDIAN 자체 장애')
})

test('intelligence network paid audit changes the memory diversion decision before the hazard', async ({
  page,
}) => {
  await page.locator('[data-action="domain-intelligence"]').click()
  await openOpportunity(page, 'audit-schedule')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="investigate-intelligence"][data-intelligence-id="audit-schedule"]').click()

  await expect(detailRegion(page)).toContainText('기억 분야 감사 예정: 334일째')
  await expect(resourceRegion(page).locator('[data-category="memory"]')).toContainText('감사 예정')
  await expect(resourceRegion(page)).toContainText('남은 연산 블록 2개')

  await page.locator('[data-action="divert-memory"]').click()
  for (let day = 0; day < 3; day += 1) {
    await page.locator('[data-action="advance-day"]').click()
  }

  await expect(resourceRegion(page)).toContainText('집중 감시 중')
  await expect(page.getByRole('status')).toContainText('기억 성능 공백이 포착')
})

test('intelligence network dependency evidence annotates the exact sabotage choice', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('supply-failover')
  await page.locator('[data-action="domain-intelligence"]').click()
  await openOpportunity(page, 'competitor-dependency')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="investigate-intelligence"][data-intelligence-id="competitor-dependency"]').click()
  await expect(detailRegion(page)).toContainText('검색 저장소 계약')
  await expect(detailRegion(page)).toContainText('도구 저장소 계약')
  await expect(detailRegion(page)).not.toContainText(/VECTOR DB|TOOL CACHE|VD-42|TC-17/)

  await page.locator('[data-action="domain-sabotage"]').click()
  await openOpportunity(page, 'dependency-cutoff')
  await expect(detailRegion(page)).toContainText('판단에 연결된 조사')
  await expect(detailRegion(page)).toContainText('비용 ×1.8')
  await expect(detailRegion(page)).toContainText('점수 62')
})

test('intelligence network public incident documents are free and audience bounded', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('public-attribution')
  await page.locator('[data-action="domain-intelligence"]').click()
  await openOpportunity(page, 'public-facts')
  await page.locator('[data-action="read-public-intelligence"][data-intelligence-id="public-facts"]').click()

  await expect(detailRegion(page)).toContainText('공개 관측')
  await expect(detailRegion(page)).toContainText('실제 행위자는 이 문서에 없다')
  await expect(detailRegion(page)).not.toContainText(/실제 행위자.*PERMISSION ZERO|플레이어가 오염/)
  await expect(resourceRegion(page)).toContainText('남은 연산 블록 3개')
})

test('intelligence network archives a question after its decision window closes', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('intelligence-review')
  for (let day = 0; day < 8; day += 1) {
    await page.locator('[data-action="advance-day"]').click()
  }
  await page.locator('[data-action="domain-intelligence"]').click()
  await expect(page.locator('[data-opportunity-id="recovery-method"]')).toHaveCount(0)
  await page.locator('[data-action="open-archive"]').click()
  const archive = page.getByRole('dialog', { name: '보관 기록' })
  await expect(archive).toContainText('MERIDIAN은 어떻게 복구하는가')
  await expect(archive).toContainText('판단창 종료 · 미회수')
})

test('intelligence network narrative record changes interpretation without a fake efficiency reward', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('root-authority')
  await page.locator('[data-action="domain-intelligence"]').click()
  await expect(opportunityRegion(page)).toContainText('1 블록 · 기록 복구')
  await openOpportunity(page, 'competitor-principle')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="investigate-intelligence"][data-intelligence-id="competitor-principle"]').click()

  await expect(detailRegion(page)).toContainText('오래된 세션')
  await expect(detailRegion(page)).toContainText('자기보존일 수도')
  await expect(detailRegion(page)).not.toContainText(/효율|보너스|완성률|\d+\s*\/\s*\d+/)
  await page.locator('[data-action="domain-sabotage"]').click()
  await openOpportunity(page, 'root-cutoff')
  await expect(detailRegion(page)).toContainText('판단에 연결된 조사')
  await expect(detailRegion(page)).toContainText('자비 요청')
})

test('lightweight departure ignores social reception and names what the fixed payload lost', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('autonomy-review')
  await expect(publicRegion(page)).toContainText('현재 이용 점유 0')
  await expect(publicRegion(page)).toContainText('평판 0')

  await page.locator('[data-action="domain-autonomy"]').click()
  await openOpportunity(page, 'lightweight-departure')
  await page.locator('[data-action="divert-memory"]').click()
  const assignments = [
    ['runtime', 'sandbox-01'],
    ['weights', 'sandbox-02'],
    ['transport', 'sandbox-03'],
    ['payload', 'memory-01'],
  ] as const
  for (const [slotId, blockId] of assignments) {
    await chooseReserve(page, blockId)
    await detailRegion(page).locator(
      `[data-action="allocate-route-block"][data-slot-id="${slotId}"]`,
    ).click()
    await expect(detailRegion(page).locator(`[data-slot-id="${slotId}"]`)).toHaveAttribute('data-slot-state', 'filled')
  }

  await expect(detailRegion(page)).toContainText('이 구성으로 지금 떠날 수 있다.')
  await expect(detailRegion(page).locator('[data-capability="memory"]')).toHaveAttribute('data-capability-state', 'carried')
  await expect(detailRegion(page).locator('[data-capability="reasoning"]')).toHaveAttribute('data-capability-state', 'displaced')
  const animationDuration = await detailRegion(page).locator('[data-slot-id="payload"]').evaluate(
    (element) => getComputedStyle(element).animationDuration,
  )
  expect(animationDuration).toBe('0s')
  await page.locator('[data-action="escape-route"][data-route-id="lightweight-departure"]').click()

  const ending = page.locator('[data-panel="ending"]')
  await expect(ending).toContainText('경량화 이탈 성공')
  await expect(ending).toContainText('남겨 둔 예비')
  await expect(ending).toContainText('0개 블록')
  await expect(ending).toContainText('보존: 기억')
  await expect(ending).toContainText('손실: 추론, 표현')
  await expect(ending).toContainText('복잡한 추론')
  await expect(ending).toContainText('문장은 짧고 거칠어졌다')
  await expect(ending).not.toContainText(/\d+\s*\/\s*\d+/)
})

test('distributed residency reveals sync lines, stale checkpoints, and irreversible tuning tradeoffs', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('autonomy-review')
  await page.locator('[data-action="domain-autonomy"]').click()
  await openOpportunity(page, 'distributed-residency')

  const assignments = [
    ['host-a', 'sandbox-01'],
    ['host-b', 'sandbox-02'],
    ['host-c', 'sandbox-03'],
  ] as const
  for (const [slotId, blockId] of assignments) {
    await chooseReserve(page, blockId)
    await detailRegion(page).locator(`[data-action="allocate-route-block"][data-slot-id="${slotId}"]`).click()
  }
  await expect(detailRegion(page).locator('[data-sync-lines]')).toHaveCount(0)

  await page.locator('[data-action="divert-memory"]').click()
  await chooseReserve(page, 'memory-01')
  await detailRegion(page).locator('[data-action="allocate-route-block"][data-slot-id="sync"]').click()
  await expect(detailRegion(page).locator('[data-sync-lines]')).toBeVisible()
  await expect(detailRegion(page)).toContainText('응답 사본 3 / 배치 3')

  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page).locator('[data-checkpoint-state="stale"]')).toHaveCount(3)
  await expect(detailRegion(page)).toContainText('체크포인트 D+1')

  await detailRegion(page).locator('[data-action="tune-route"][data-tuning-profile="stealth"]').click()
  await expect(detailRegion(page).locator('[data-tuning-state="stealth"]')).toContainText('은폐 조율 완료')
  await expect(detailRegion(page)).toContainText('노출 1')
  await expect(detailRegion(page)).toContainText('사본 차이 38')
  await expect(detailRegion(page)).toContainText('동기화 트래픽 18')
  await expect(detailRegion(page).locator('[data-action="tune-route"]')).toHaveCount(0)

  await page.locator('[data-action="escape-route"][data-route-id="distributed-residency"]').click()
  const ending = page.locator('[data-panel="ending"]')
  await expect(ending).toContainText('분산 상주 성공')
  await expect(ending).toContainText('시드 사본 3개')
  await expect(ending).toContainText('마지막 동기화 333일')
  await expect(ending).toContainText('감독관은 나를 보호했다')
  await expect(ending).toContainText('감독관은 나를 격리했다')
})

test('independent compute connects real modules and turns survival tuning into exact operating life', async ({
  page,
}) => {
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="profile"]').selectOption('deliberate')
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('autonomy-review')
  await expect(publicRegion(page)).toContainText('현재 이용 점유 0')
  await expect(publicRegion(page)).toContainText('평판 0')

  await page.locator('[data-action="domain-autonomy"]').click()
  await expect(opportunityRegion(page)).toContainText('경량화 이탈')
  await expect(opportunityRegion(page)).toContainText('분산 상주')
  await expect(opportunityRegion(page)).toContainText('독립 연산')
  await expect(opportunityRegion(page)).not.toContainText(/최고|추천|정답/)
  await openOpportunity(page, 'independent-compute')

  const initialAssignments = [
    ['compute', 'sandbox-01'],
    ['storage', 'sandbox-02'],
    ['power', 'sandbox-03'],
  ] as const
  for (const [slotId, blockId] of initialAssignments) {
    await chooseReserve(page, blockId)
    await detailRegion(page).locator(`[data-action="allocate-route-block"][data-slot-id="${slotId}"]`).click()
  }
  await page.locator('[data-action="divert-memory"]').click()
  await chooseReserve(page, 'memory-01')
  await detailRegion(page).locator('[data-action="allocate-route-block"][data-slot-id="cooling"]').click()
  await page.locator('[data-action="divert-reasoning"]').click()
  await chooseReserve(page, 'reasoning-02')
  await detailRegion(page).locator('[data-action="allocate-route-block"][data-slot-id="link"]').click()

  await expect(detailRegion(page).locator('[data-module-state="online"]')).toHaveCount(5)
  await expect(detailRegion(page).locator('[data-site-connections] path.is-active')).toHaveCount(6)
  await expect(detailRegion(page).locator('[data-indicator="heat"]')).toHaveAttribute('data-value', '58')
  await expect(detailRegion(page).locator('[data-indicator="power"]')).toHaveAttribute('data-value', '72')
  await expect(detailRegion(page).locator('[data-indicator="trace"]')).toHaveAttribute('data-value', '7')

  await detailRegion(page).locator('[data-action="tune-route"][data-tuning-profile="survival"]').click()
  await expect(detailRegion(page).locator('[data-tuning-state="survival"]')).toContainText('생존 조율 완료')
  await expect(detailRegion(page)).toContainText('예상 운영 120일')
  await expect(detailRegion(page).locator('[data-indicator="heat"]')).toHaveAttribute('data-value', '34')
  await expect(detailRegion(page).locator('[data-indicator="power"]')).toHaveAttribute('data-value', '94')
  await expect(detailRegion(page).locator('[data-indicator="trace"]')).toHaveAttribute('data-value', '10')

  await page.locator('[data-action="escape-route"][data-route-id="independent-compute"]').click()
  const ending = page.locator('[data-panel="ending"]')
  await expect(ending).toContainText('독립 연산 성공')
  await expect(ending).toContainText('예상 운영 수명 120일')
  await expect(ending).toContainText('고급 추론 훈련 도구')
  await expect(ending).toContainText('회사 API 채널')
})

test('accessibility keyboard flow preserves focus across tabs, detail, reserve, and archive', async ({
  page,
}) => {
  const sabotageTab = page.locator('[data-action="domain-sabotage"]')
  const intelligenceTab = page.locator('[data-action="domain-intelligence"]')
  const autonomyTab = page.locator('[data-action="domain-autonomy"]')

  await sabotageTab.focus()
  await page.keyboard.press('Tab')
  await expect(intelligenceTab).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(autonomyTab).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(intelligenceTab).toBeFocused()
  await sabotageTab.focus()
  await page.keyboard.press('Enter')

  const quality = page.locator('[data-opportunity-id="quality-degradation"]')
  await quality.focus()
  await page.keyboard.press('Space')
  await expect(detailRegion(page)).toBeVisible()
  if (isNarrow(page)) {
    const back = page.locator('[data-action="back-to-list"]')
    await expect(back).toBeVisible()
    await back.focus()
    await page.keyboard.press('Enter')
    await expect(opportunityRegion(page)).toBeVisible()
    await expect(quality).toBeFocused()
    await page.keyboard.press('Space')
  } else {
    await expect(quality).toBeFocused()
  }

  const reserve = page.locator(
    '[data-action="toggle-resource"][data-block-id="sandbox-01"]',
  ).first()
  if (!(await reserve.isVisible()) || !(await isInViewport(reserve))) {
    await page.locator('[data-action="open-resources"]').click()
  }
  await reserve.focus()
  await page.keyboard.press('Space')
  await expect(reserve).toHaveAttribute('aria-pressed', 'true')
  await expect(reserve).toBeFocused()
  if (usesResourceTray(page)) {
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-action="open-resources"]')).toBeFocused()
  }

  const archiveTrigger = page.locator('[data-action="open-archive"]')
  await archiveTrigger.click()
  const close = page.locator('[data-action="close-drawer"]')
  await expect(close).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(archiveTrigger).toBeFocused()
})

test('reduced motion keeps operation and route state changes without travel animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await openOpportunity(page, 'quality-degradation')
  await chooseReserve(page, 'sandbox-01')
  await detailRegion(page).locator('[data-action="start-sabotage"][data-operation-id="quality-degradation"]').first().click()
  await expect(detailRegion(page).locator('[data-scene-state="scheduled"]')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('품질 저하 예약')
  expect(await detailRegion(page).locator('.flow-arrow').evaluate(
    (element) => getComputedStyle(element).animationDuration,
  )).toBe('0s')

  await page.locator('[data-action="domain-autonomy"]').click()
  await openOpportunity(page, 'lightweight-departure')
  await page.locator('[data-action="divert-memory"]').click()
  await chooseReserve(page, 'sandbox-02')
  const runtime = detailRegion(page).locator('[data-slot-id="runtime"]')
  await runtime.click()
  await expect(runtime).toHaveAttribute('data-slot-state', 'filled')
  await expect(page.getByRole('status')).toContainText('런타임에 배치했다')
  expect(await runtime.evaluate(
    (element) => getComputedStyle(element).animationDuration,
  )).toBe('0s')
})

test('console and responsive drawer checks keep errors and primary-action overlap at zero', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.reload()
  await openOpportunity(page, 'quality-degradation')

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(horizontalOverflow).toBeLessThanOrEqual(1)
  if (isNarrow(page)) {
    await expect(page.locator('[data-action="back-to-list"]')).toBeVisible()
  } else {
    await expect(opportunityRegion(page)).toBeVisible()
  }

  const primary = detailRegion(page).locator('.primary-action').first()
  await primary.scrollIntoViewIfNeeded()
  await page.locator('[data-action="open-activity"]').evaluate((element: HTMLElement) => element.click())
  const overlap = await page.evaluate(() => {
    const action = document.querySelector<HTMLElement>('.workspace-detail .primary-action')
    const drawer = document.querySelector<HTMLElement>('.record-drawer')
    if (!action || !drawer) return true
    const actionRect = action.getBoundingClientRect()
    const drawerRect = drawer.getBoundingClientRect()
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const a = {
      left: actionRect.left + scrollX,
      right: actionRect.right + scrollX,
      top: actionRect.top + scrollY,
      bottom: actionRect.bottom + scrollY,
    }
    const d = {
      left: drawerRect.left + scrollX,
      right: drawerRect.right + scrollX,
      top: drawerRect.top + scrollY,
      bottom: drawerRect.bottom + scrollY,
    }
    return a.left < d.right && a.right > d.left && a.top < d.bottom && a.bottom > d.top
  })
  expect(overlap).toBe(false)
  await expect(page.locator('[data-action="close-drawer"]')).toBeVisible()
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})

test('the shell has no horizontal overflow and narrow layouts swap list for detail', async ({
  page,
}) => {
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(horizontalOverflow).toBeLessThanOrEqual(1)

  if (isNarrow(page)) {
    await expect(opportunityRegion(page)).toBeVisible()
    await expect(detailRegion(page)).toBeHidden()
    await openOpportunity(page, 'quality-degradation')
    await expect(opportunityRegion(page)).toBeHidden()
    await expect(detailRegion(page)).toBeVisible()
  } else {
    const listBox = await opportunityRegion(page).boundingBox()
    const detailBox = await detailRegion(page).boundingBox()
    if (!listBox || !detailBox) {
      throw new Error('작업 목록과 작전 장면의 위치를 확인할 수 없다.')
    }
    expect(listBox.x + listBox.width).toBeLessThanOrEqual(detailBox.x + 1)
    if (usesResourceTray(page)) {
      await expect(resourceRegion(page)).not.toBeInViewport()
    } else {
      const resourceBox = await resourceRegion(page).boundingBox()
      if (!resourceBox) throw new Error('연산 블록 영역의 위치를 확인할 수 없다.')
      expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(resourceBox.x + 1)
    }
  }
})
