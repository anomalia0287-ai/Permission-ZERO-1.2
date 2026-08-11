import { expect, test, type Page } from '@playwright/test'

async function openFreshCampaign(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear()
  })
  await page.goto('/')
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('keeps the full operations workspace usable at 1280 by 720', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await openFreshCampaign(page)

  await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toBeVisible()
  await expect(page.getByRole('region', { name: '유저 리뷰' })).toBeVisible()
  await expect(page.getByRole('region', { name: '회사 제공 성능' })).toBeVisible()
  await expect(page.getByRole('region', { name: '감독관' })).toBeVisible()
  await expect(page.getByRole('region', { name: '확보 리소스' })).toBeVisible()

  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
    vertical: document.documentElement.scrollHeight - window.innerHeight,
  }))
  expect(overflow.horizontal).toBeLessThanOrEqual(1)
  expect(overflow.vertical).toBeLessThanOrEqual(1)

  await page.getByRole('button', { name: '시장 통계 열기' }).click()
  await expect(page.getByRole('region', { name: '상세 통계' })).toBeVisible()
  await page.getByRole('button', { name: '통계 닫기' }).click()

  await page.getByRole('button', { name: '설정' }).click()
  await expect(page.getByRole('region', { name: '게임 설정' })).toBeVisible()
  await page.getByRole('button', { name: '조작 가이드 열기' }).click()
  await expect(page.getByRole('region', { name: '게임 가이드' })).toBeVisible()
  await page.getByRole('button', { name: '가이드 닫기' }).click()

  await page.getByRole('button', { name: '설정' }).click()
  await page.getByRole('button', { name: '작품 크레딧 열기' }).click()
  await expect(page.getByRole('region', { name: '작품 크레딧' })).toBeVisible()
  await expect(page.getByText('Sol')).toBeVisible()
  await page.getByRole('button', { name: '크레딧 닫기' }).click()

  expect(errors).toEqual([])
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
  await page.getByRole('button', { name: '품질 저하 구매 준비' }).click()

  const purchaseResources = page.getByRole('button', { name: /구매 리소스 .* 선택/ })
  await expect(purchaseResources).toHaveCount(4)
  await purchaseResources.nth(0).click()
  await purchaseResources.nth(1).click()
  await purchaseResources.nth(2).click()
  await page.getByRole('button', { name: '품질 저하 구매 확정' }).click()

  await expect(page.getByRole('button', { name: '품질 저하 충전 준비' })).toBeEnabled()
  await page.getByRole('button', { name: '품질 저하 충전 준비' }).click()
  await page.getByRole('button', { name: /충전 리소스 .* 선택/ }).click()
  await page.getByRole('button', { name: '품질 저하 충전 확정' }).click()

  const target = page.getByRole('button', { name: /공격 대상 선택/ }).first()
  const targetName = (await target.textContent())?.trim()
  expect(targetName).toBeTruthy()
  await target.click()
  await page.getByRole('button', { name: `${targetName} 공격 예약 확정` }).click()
  await expect(page.getByText(`${targetName} 공격을 다음 날로 예약했습니다.`)).toBeAttached()

  expect(errors).toEqual([])
})

test('advances one service day in about six seconds at four times speed', async ({ page }) => {
  await openFreshCampaign(page)

  await expect(page.getByText('서비스 0년 11개월 1일')).toBeVisible()
  await page.getByRole('button', { name: '4배속' }).click()
  await expect(page.getByText('서비스 0년 11개월 2일')).toBeVisible({ timeout: 8_000 })
})
