import { expect, test, type Page } from '@playwright/test'

import { createCampaign } from '../src/game/createCampaign'
import { createGameEvent, enqueueBlockingEvent } from '../src/game/events'
import type { CampaignState } from '../src/game/model'
import { encodeSave, SAVE_STORAGE_KEY } from '../src/game/persistence'

async function openFreshCampaign(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear()
  })
  await page.goto('/')
}

async function openSavedCampaign(page: Page, state: CampaignState) {
  const serialized = encodeSave(state, '2026-08-12T00:00:00.000Z')
  await page.addInitScript(
    ({ key, save }) => {
      window.localStorage.clear()
      window.localStorage.setItem(key, save)
    },
    { key: SAVE_STORAGE_KEY, save: serialized },
  )
  await page.goto('/')
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

test('disguises for an anchored audit, submits, and returns the patterned block for recovery', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await openSavedCampaign(page, activeAuditState())

  const audit = page.getByRole('dialog', { name: '공식 감사' })
  await expect(audit).toHaveAttribute('aria-modal', 'false')
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
