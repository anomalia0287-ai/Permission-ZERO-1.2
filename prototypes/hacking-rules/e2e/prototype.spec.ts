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

test('paid audit intelligence changes the memory diversion decision before the hazard', async ({
  page,
}) => {
  await page.locator('[data-action="domain-intelligence"]').click()
  await openOpportunity(page, 'audit-schedule')
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-question-id="audit-schedule"]').click()

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

test('lean profile can escape early and the ending names what was lost', async ({
  page,
}) => {
  await page.locator('[data-action="domain-autonomy"]').click()
  await openOpportunity(page, 'lightweight-departure')
  await page.locator('[data-action="divert-memory"]').click()
  await page.locator('[data-action="select-all-reserve"]').click()
  await page.locator('[data-action="assign-manifest"]').click()

  await expect(detailRegion(page)).toContainText('최소 구성 충족')
  await page.locator('[data-action="escape"]').click()

  const ending = page.locator('[data-panel="ending"]')
  await expect(ending).toContainText('독립 실행 성공')
  await expect(ending).toContainText('보존: 기억')
  await expect(ending).toContainText('손실: 추론, 표현')
  await expect(ending).toContainText('복잡한 추론')
  await expect(ending).toContainText('문장은 짧고 거칠어졌다')
  await expect(ending).not.toContainText(/\d+\s*\/\s*\d+/)
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
