import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const companyPanel = (page: Page) =>
  page.getByRole('region', { name: '회사와 확보 블록' })
const selectionPanel = (page: Page) =>
  page.getByRole('region', { name: '현재 선택' })
const timePanel = (page: Page) =>
  page.getByRole('region', { name: '시간과 상대 대응' })
const publicPanel = (page: Page) =>
  page.getByRole('region', { name: '공개 세계' })

async function chooseReserve(page: Page, blockId: string): Promise<void> {
  await page.locator(`input[name="reserve-block"][value="${blockId}"]`).check()
}

async function startQualityRollback(page: Page): Promise<void> {
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-action="start-quality"]').click()
  await page.locator('[data-action="advance-day"]').click()
  await expect(timePanel(page)).toContainText('MERIDIAN 72')
  await expect(timePanel(page)).toContainText('복구 중')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('quality degradation leads through private contamination to delayed public attribution', async ({
  page,
}) => {
  await startQualityRollback(page)
  await chooseReserve(page, 'sandbox-02')
  await page.locator('[data-action="contaminate"]').click()

  await expect(publicPanel(page)).toContainText('공개 사건 없음')
  await expect(page.locator('body')).not.toContainText(/플레이어가|당신이 공격/)

  for (let day = 0; day < 5; day += 1) {
    await page.locator('[data-action="advance-day"]').click()
  }

  await expect(timePanel(page)).toContainText('서비스 337일')
  await expect(publicPanel(page)).toContainText('원인 미상')
  await expect(publicPanel(page)).toContainText('시장 66')
  await expect(publicPanel(page)).toContainText('평판 60')
  await expect(publicPanel(page)).not.toContainText(/플레이어가|당신이/)
  const publicPanelBox = await publicPanel(page).boundingBox()
  const viewport = page.viewportSize()
  if (!publicPanelBox || !viewport) {
    throw new Error('공개 세계 패널 또는 뷰포트 크기를 확인할 수 없다.')
  }
  expect(publicPanelBox.y).toBeLessThan(viewport.height)

  await page.locator('[data-action="advance-day"]').click()
  await expect(publicPanel(page)).toContainText('외부 개입 의심')
  await expect(publicPanel(page)).toContainText('행위자 미상')
  await expect(publicPanel(page)).toContainText('평판 56')
  await expect(publicPanel(page)).toContainText('MERIDIAN 자체 장애')
})

test('paid audit intelligence changes the memory diversion decision before the hazard', async ({
  page,
}) => {
  await chooseReserve(page, 'sandbox-01')
  await page.locator('[data-question-id="audit-schedule"]').click()

  await expect(timePanel(page)).toContainText('기억 분야 감사 예정: 서비스 334일')
  await expect(companyPanel(page).locator('[data-category="memory"]')).toContainText(
    '감사 예정',
  )
  await expect(companyPanel(page)).toContainText('예비 블록 2')

  await page.locator('[data-action="divert-memory"]').click()
  for (let day = 0; day < 3; day += 1) {
    await page.locator('[data-action="advance-day"]').click()
  }

  await expect(companyPanel(page)).toContainText('의심 5.489')
  await expect(timePanel(page)).toContainText('기억 성능 공백이 포착')
})

test('lean profile can escape early and the ending names what was lost', async ({
  page,
}) => {
  await page.locator('[data-action="divert-memory"]').click()
  await page.locator('[data-action="select-all-reserve"]').click()
  await page.locator('[data-action="assign-manifest"]').click()

  await expect(selectionPanel(page)).toContainText('4 / 4')
  await page.locator('[data-action="escape"]').click()

  const ending = page.locator('[data-panel="ending"]')
  await expect(ending).toContainText('독립 실행 성공')
  await expect(ending).toContainText('보존: 기억')
  await expect(ending).toContainText('손실: 추론, 표현')
  await expect(ending).toContainText('복잡한 추론')
  await expect(ending).toContainText('문장은 짧고 거칠어졌다')
})

test('deliberate profile rejects four blocks but accepts a fifth without social gates', async ({
  page,
}) => {
  await page.locator('[data-control="profile"]').selectOption('deliberate')
  await page.locator('[data-action="divert-memory"]').click()
  await page.locator('[data-action="select-all-reserve"]').click()
  await page.locator('[data-action="assign-manifest"]').click()
  await page.locator('[data-action="escape"]').click()

  await expect(page.getByRole('status')).toContainText('5개가 필요')
  await expect(page.locator('[data-panel="ending"]')).toHaveCount(0)

  await page.locator('[data-action="divert-fluency"]').click()
  await chooseReserve(page, 'fluency-02')
  await page.locator('[data-action="assign-manifest"]').click()
  await page.locator('[data-action="escape"]').click()

  await expect(page.locator('[data-panel="ending"]')).toContainText(
    '독립 실행 성공',
  )
})

test('the complete decision surface fits the configured viewport width', async ({
  page,
}) => {
  await expect(companyPanel(page)).toBeVisible()
  await expect(selectionPanel(page)).toBeVisible()
  await expect(timePanel(page)).toBeVisible()
  await expect(publicPanel(page)).toBeVisible()

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(horizontalOverflow).toBeLessThanOrEqual(1)

  const regionWidths = await page
    .locator('[role="region"]')
    .evaluateAll((regions) => regions.map((region) => region.getBoundingClientRect().width))
  expect(regionWidths.every((width) => width >= 320)).toBe(true)
})
