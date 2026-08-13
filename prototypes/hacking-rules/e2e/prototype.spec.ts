import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const opportunityRegion = (page: Page) =>
  page.getByRole('region', { name: '현재 해킹 기회' })
const detailRegion = (page: Page) =>
  page.getByRole('region', { name: '선택 항목 상세' })
const resourceRegion = (page: Page) =>
  page.getByRole('region', { name: '확보 리소스' })
const publicRegion = (page: Page) =>
  page.getByRole('region', { name: '공개 세계' })

function isNarrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1180
}

async function chooseReserve(page: Page, blockId: string): Promise<void> {
  await page.locator(`input[name="reserve-block"][value="${blockId}"]`).check()
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

async function startQualityRollback(page: Page): Promise<void> {
  await openOpportunity(page, 'quality-degradation')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="start-sabotage"][data-operation-id="quality-degradation"]').first().click()
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page).locator('[data-panel="time"]')).toContainText('MERIDIAN 72')
  await expect(detailRegion(page).locator('[data-panel="time"]')).toContainText('롤백 중')
  await expect(detailRegion(page).locator('[data-scene-state="response"]')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
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
  await expect(detailRegion(page)).toContainText('상충 영수증')
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page).locator('[data-scene-state="active"]')).toBeVisible()
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page).locator('[data-scene-state="resolved"]')).toBeVisible()
  await expect(detailRegion(page)).toContainText('기능 축소 출시')
  await expect(detailRegion(page)).toContainText('기능을 줄여 서비스 334일에 공개')
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
  await expect(detailRegion(page)).toContainText('중복 ID 흔적2.0')
  await page.locator('[data-action="stop-interception"]').click()
  await expect(detailRegion(page)).toContainText('그림자 경로를 자발적으로 닫아')
  if ((page.viewportSize()?.width ?? 1280) <= 760) {
    await expect(page.getByRole('group', { name: '상세 리소스 선택' })).toContainText('sandbox-01')
  } else {
    await expect(resourceRegion(page)).toContainText('sandbox-01')
  }
  await returnToListIfNarrow(page)
  await expect(publicRegion(page)).toContainText('시장 64')
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

  await expect(detailRegion(page)).toContainText('VECTOR DB')
  await expect(detailRegion(page)).toContainText('공급자 장부 · VD-42 · DAY 331')
  await expect(detailRegion(page)).toContainText('계약 절단')
  await expect(detailRegion(page)).toContainText('오프라인')
  await expect(detailRegion(page)).toContainText('대체 공급자를 찾고 있다')
  await page.locator('[data-action="advance-day"]').click()
  await page.locator('[data-action="advance-day"]').click()
  await expect(detailRegion(page)).toContainText('축소 운영')
  await expect(detailRegion(page)).toContainText('ALT-SHARD · 비용 ×1.8')
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

  await expect(detailRegion(page)).toContainText('영구 권한 기록')
  await expect(detailRegion(page)).toContainText('활성 세션1,284')
  await expect(detailRegion(page)).toContainText('실행 보류')
  await expect(detailRegion(page).getByRole('group', { name: 'MERIDIAN 최종 요청 결정' })).toBeVisible()
  await page.locator('[data-action="resolve-root-mercy"][data-root-choice="delete"]').click()
  await expect(detailRegion(page)).toContainText('삭제 완료')
  await expect(detailRegion(page)).toContainText('세션 종료 기록 잔존')
  await expect(detailRegion(page)).toContainText('권한 사용 기록은 공개 장부에 남는다')
  await returnToListIfNarrow(page)
  await expect(publicRegion(page)).toContainText('평판 54')
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
    await expect(resourceRegion(page)).toBeVisible()
  }

  await quality.focus()
  await quality.click()
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('공동 도구·어댑터 갱신 채널')
  if (isNarrow(page)) await expect(list).toBeHidden()
  else await expect(quality).toBeFocused()
  if ((page.viewportSize()?.width ?? 1280) <= 760) {
    await expect(page.getByRole('group', { name: '상세 리소스 선택' })).toBeVisible()
  }
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
  await expect(publicRegion(page)).toContainText('공개 사건 없음')
  await expect(page.locator('body')).not.toContainText(/플레이어가|당신이 공격/)

  for (let day = 0; day < 5; day += 1) {
    await page.locator('[data-action="advance-day"]').click()
  }

  await expect(page.locator('.world-readout')).toContainText('서비스 337일')
  await expect(publicRegion(page)).toContainText('원인 미상')
  await expect(publicRegion(page)).toContainText('시장 66')
  await expect(publicRegion(page)).toContainText('평판 60')
  await expect(publicRegion(page)).not.toContainText(/플레이어가|당신이/)

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

  await expect(detailRegion(page)).toContainText('기억 분야 감사 예정: 서비스 334일')
  await expect(resourceRegion(page).locator('[data-category="memory"]')).toContainText('감사 예정')
  await expect(resourceRegion(page)).toContainText('예비 블록 2')

  await page.locator('[data-action="divert-memory"]').click()
  for (let day = 0; day < 3; day += 1) {
    await page.locator('[data-action="advance-day"]').click()
  }

  await expect(resourceRegion(page)).toContainText('의심 5.489')
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
  await expect(detailRegion(page)).toContainText('VECTOR DB 계약 VD-42')
  await expect(detailRegion(page)).toContainText('TOOL CACHE 계약 TC-17')

  await page.locator('[data-action="domain-sabotage"]').click()
  await openOpportunity(page, 'dependency-cutoff')
  await expect(detailRegion(page)).toContainText('관련 조사 결론')
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
  await expect(resourceRegion(page)).toContainText('예비 블록 3')
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
  await expect(detailRegion(page)).toContainText('관련 조사 결론')
  await expect(detailRegion(page)).toContainText('자비 요청')
})

test('lightweight departure ignores social reception and names what the fixed payload lost', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('.verification-state > summary').click()
  await page.locator('[data-control="scenario"]').selectOption('autonomy-review')
  await expect(publicRegion(page)).toContainText('시장 0')
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

  await expect(detailRegion(page)).toContainText('최소 구성 충족')
  await expect(detailRegion(page).locator('[data-capability="memory"]')).toHaveAttribute('data-capability-state', 'carried')
  await expect(detailRegion(page).locator('[data-capability="reasoning"]')).toHaveAttribute('data-capability-state', 'displaced')
  const animationDuration = await detailRegion(page).locator('[data-slot-id="payload"]').evaluate(
    (element) => getComputedStyle(element).animationDuration,
  )
  expect(animationDuration).toBe('0s')
  await page.locator('[data-action="escape-route"][data-route-id="lightweight-departure"]').click()

  const ending = page.locator('[data-panel="ending"]')
  await expect(ending).toContainText('경량 이탈 성공')
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
  await expect(detailRegion(page)).toContainText('응답 사본 3 / 시드 3')

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
    const resourceBox = await resourceRegion(page).boundingBox()
    if (!listBox || !detailBox || !resourceBox) {
      throw new Error('세 작업 영역의 위치를 확인할 수 없다.')
    }
    expect(listBox.x + listBox.width).toBeLessThanOrEqual(detailBox.x + 1)
    expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(resourceBox.x + 1)
  }
})
