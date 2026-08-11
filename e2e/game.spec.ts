import { expect, test, type Page } from '@playwright/test'

import { createCampaign } from '../src/game/createCampaign'
import { createGameEvent, enqueueBlockingEvent } from '../src/game/events'
import { HACK_NODE_IDS } from '../src/game/hacking'
import type { CampaignState, GameCommand } from '../src/game/model'
import { encodeSave, SAVE_STORAGE_KEY } from '../src/game/persistence'
import { applyCommand } from '../src/game/reducer'

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
        placements: [
          {
            sequence: 0,
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
  await expect(page.getByRole('dialog', { name: '작품 크레딧' })).toBeVisible()
  await expect(page.getByText('Sol')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(creditsTrigger).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(settingsTrigger).toBeFocused()
  await expect(page.getByRole('button', { name: '2배속' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.game-background')).not.toHaveAttribute('inert', '')

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
  await source.focus()
  await page.keyboard.press('Enter')
  const destination = page.locator('.reserve-destination:not([disabled])').first()
  await expect(destination).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('dialog', { name: '감독관 질의' })).toBeVisible()
  await expect(page.getByText('의심 15')).toBeVisible()
  await expect(page.locator('[data-resource-kind="reserve"]')).toHaveCount(3)
  await expect(source).toHaveCount(1)
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
  await source.focus()
  await page.keyboard.press('Enter')

  const auditDestinations = page.getByRole('button', {
    name: /추론 회사 리소스 \d+, 감사 위장 목적지/,
  })
  await expect(auditDestinations.first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(auditDestinations.nth(1)).toBeFocused()
  await page.keyboard.press('Enter')

  const submit = page.getByRole('button', { name: '감사 제출' })
  await submit.focus()
  await page.keyboard.press('Enter')

  const disguised = page.getByRole('button', { name: /추론 회사 리소스 .* 위장 배치/ })
  await disguised.focus()
  await page.keyboard.press('Enter')

  const recoveryDestinations = page.getByRole('button', {
    name: /기억 회사 리소스 \d+, 정상 복구 목적지/,
  })
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
  await expect(page.getByText('서비스 0년 11개월 1일')).toBeVisible()
  await expect(page.getByRole('button', { name: '정지' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  expect(errors).toEqual([])
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
  const warning = page.getByRole('alert', { name: '저장 실패' })
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
