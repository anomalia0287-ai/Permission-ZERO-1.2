import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test'

import type {
  AutonomyRouteId,
  RootMercyChoice,
  RouteTuning,
} from '../src/game/hackingCoreModel'
import type { CampaignState } from '../src/game/model'
import {
  chooseHackingDomain,
  chooseOpportunity,
  closeResourceTrayIfPossible,
  makeCampaign,
  openHackingWorkspace,
  openSavedCampaign,
  readSavedCheckpoint,
  selectFirstReserveBlock,
  withOpenIntelligence,
  withPublicAttributionOpportunity,
  withReadyRoute,
  withReserveBlockCount,
  withSabotageOperations,
  withZeroPlayerStanding,
} from './hackingTestSupport'

const DESKTOP_VIEWPORT = { width: 1440, height: 900 }

function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function savedStateWhen(
  page: Page,
  predicate: (state: CampaignState) => boolean,
): Promise<CampaignState> {
  await expect.poll(async () => {
    const state = await readSavedCheckpoint(page)
    return state !== null && predicate(state)
  }, { timeout: 8_000 }).toBe(true)
  const state = await readSavedCheckpoint(page)
  if (!state) throw new Error('Autosaved campaign checkpoint is missing')
  return state
}

async function advanceDays(panel: Locator, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await panel.getByRole('button', { name: '하루 넘기기' }).click()
  }
}

async function startSelectedSabotage(
  panel: Locator,
  optionName: string | RegExp,
): Promise<string> {
  const blockId = await selectFirstReserveBlock(panel)
  await closeResourceTrayIfPossible(panel)
  await panel.getByRole('button', { name: optionName }).click()
  return blockId
}

function marketTotal(state: CampaignState): number {
  return state.market.playerShare
    + state.market.unservedRequestShare
    + state.market.competitors.reduce((sum, competitor) => (
      sum + competitor.marketShare
    ), 0)
}

function competitor(state: CampaignState, id: 'meridian' | 'tallow') {
  const found = state.market.competitors.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Missing competitor ${id}`)
  return found
}

async function makePage(
  browser: Browser,
  state: CampaignState,
  viewport = DESKTOP_VIEWPORT,
) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors = collectPageErrors(page)
  await openSavedCampaign(page, state)
  return { context, page, errors }
}

test.describe('hacking operation viewport gate', () => {
  test('keeps the operation workspace usable at all four approved viewports', async ({ browser }) => {
    test.setTimeout(120_000)
    const viewports = [
      { width: 1440, height: 900, columns: 3, resourceMode: 'rail' },
      { width: 1126, height: 894, columns: 2, resourceMode: 'drawer' },
      { width: 760, height: 900, columns: 1, resourceMode: 'sheet' },
      { width: 390, height: 844, columns: 1, resourceMode: 'sheet' },
    ] as const

    for (const expected of viewports) {
      await test.step(`${expected.width}×${expected.height}`, async () => {
        const { context, page, errors } = await makePage(
          browser,
          makeCampaign(`viewport-${expected.width}`),
          { width: expected.width, height: expected.height },
        )
        const panel = await openHackingWorkspace(page)

        if (expected.columns === 1) {
          await expect(panel).toHaveAttribute('data-narrow-mode', 'list')
          await expect(panel.locator('.workspace-master')).toBeVisible()
          await expect(panel.locator('.workspace-detail')).toBeHidden()
          await chooseOpportunity(panel, /품질 저하/)
          await expect(panel).toHaveAttribute('data-narrow-mode', 'detail')
          await expect(panel.getByRole('button', { name: '목록으로' })).toBeFocused()
        }

        const resourceTrigger = panel.getByRole('button', { name: '빼돌린 연산 열기' })
        if (expected.resourceMode !== 'rail') await resourceTrigger.click()
        const tray = panel.locator('[data-resource-tray]')
        await expect(tray).toBeVisible()

        const geometry = await panel.evaluate((node) => {
          const workspace = node.querySelector<HTMLElement>('.operation-workspace')
          const master = node.querySelector<HTMLElement>('.workspace-master')
          const detail = node.querySelector<HTMLElement>('.workspace-detail')
          const detailScroller = node.querySelector<HTMLElement>('.operation-detail__scroll')
          const resource = node.querySelector<HTMLElement>('[data-resource-tray]')
          if (!workspace || !master || !detail || !detailScroller || !resource) {
            throw new Error('Responsive workspace surface missing')
          }
          const isVisible = (element: HTMLElement) => (
            getComputedStyle(element).display !== 'none'
            && element.getClientRects().length > 0
          )
          const visibleButtons = [...node.querySelectorAll<HTMLElement>('button')]
            .filter(isVisible)
          const visibleText = [...node.querySelectorAll<HTMLElement>(
            'h1, h2, h3, p, span, strong, small, button, summary',
          )].filter((element) => {
            const rect = element.getBoundingClientRect()
            return isVisible(element) && rect.width > 4 && rect.height > 4
          })
          const resourceRect = resource.getBoundingClientRect()
          const overflowers = [...document.querySelectorAll<HTMLElement>('body *')]
            .map((element) => {
              const rect = element.getBoundingClientRect()
              return {
                selector: `${element.tagName.toLowerCase()}.${element.className}`,
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
              }
            })
            .filter(({ left, right }) => left < -1 || right > window.innerWidth + 1)
            .sort((left, right) => right.width - left.width)
            .slice(0, 12)
          return {
            documentWidth: document.documentElement.scrollWidth,
            documentHeight: document.documentElement.scrollHeight,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            panelWidth: node.clientWidth,
            panelScrollWidth: node.scrollWidth,
            workspaceColumns: getComputedStyle(workspace).gridTemplateColumns,
            masterVisible: isVisible(master),
            detailVisible: isVisible(detail),
            resourceRect: {
              width: resourceRect.width,
              height: resourceRect.height,
              right: resourceRect.right,
              bottom: resourceRect.bottom,
            },
            minimumButtonHeight: Math.min(...visibleButtons.map((button) => (
              button.getBoundingClientRect().height
            ))),
            minimumTextSize: Math.min(...visibleText.map((element) => (
              Number.parseFloat(getComputedStyle(element).fontSize)
            ))),
            detailHasInternalScroll: detailScroller.scrollHeight > detailScroller.clientHeight,
            overflowers,
          }
        })

        expect(
          geometry.documentWidth,
          JSON.stringify(geometry.overflowers, null, 2),
        ).toBeLessThanOrEqual(geometry.viewportWidth + 1)
        expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1)
        expect(geometry.panelScrollWidth).toBeLessThanOrEqual(geometry.panelWidth + 1)
        expect(geometry.minimumButtonHeight).toBeGreaterThanOrEqual(47.5)
        expect(geometry.minimumTextSize).toBeGreaterThanOrEqual(14)
        expect(geometry.detailVisible).toBe(true)
        expect(geometry.detailHasInternalScroll).toBe(true)

        if (expected.columns === 3) {
          expect(geometry.workspaceColumns.trim().split(/\s+/)).toHaveLength(3)
          expect(geometry.masterVisible).toBe(true)
          expect(geometry.resourceRect.width).toBeCloseTo(280, 0)
        } else if (expected.columns === 2) {
          expect(geometry.workspaceColumns.trim().split(/\s+/)).toHaveLength(2)
          expect(geometry.masterVisible).toBe(true)
          expect(geometry.resourceRect.width).toBeLessThanOrEqual(360.5)
        } else {
          expect(geometry.masterVisible).toBe(false)
          expect(geometry.resourceRect.height).toBeLessThanOrEqual(
            Math.min(expected.height * 0.72, 640) + 1,
          )
          expect(geometry.resourceRect.bottom).toBeGreaterThanOrEqual(expected.height - 24)
        }

        expect(errors).toEqual([])
        await context.close()
      })
    }
  })
})

test.describe('hacking operation direct-play gate', () => {
  test('01 · quality rollback without contamination settles at 61/39 and totals 100', async ({ page }) => {
    const errors = collectPageErrors(page)
    await openSavedCampaign(page, makeCampaign('direct-01-quality'))
    const panel = await openHackingWorkspace(page)

    await startSelectedSabotage(panel, /도구 호출군 B에 어댑터 패치 결속/)
    await advanceDays(panel, 4)

    const state = await savedStateWhen(page, (candidate) => (
      candidate.serviceDay === 335
      && candidate.hackingCore.sabotage.runs[0]?.outcome === 'partial-recovery'
    ))
    expect(state.market.playerShare).toBe(61)
    expect(competitor(state, 'meridian').marketShare).toBe(39)
    expect(marketTotal(state)).toBe(100)
    expect(state.hackingCore.sabotage.runs.some(
      ({ operationId }) => operationId === 'recovery-contamination',
    )).toBe(false)
    expect(errors).toEqual([])
  })

  test('02 · contaminated rollback publishes unknown cause and then provider correction', async ({ page }) => {
    const errors = collectPageErrors(page)
    await openSavedCampaign(page, makeCampaign('direct-02-contamination'))
    const panel = await openHackingWorkspace(page)

    await startSelectedSabotage(panel, /도구 호출군 B에 어댑터 패치 결속/)
    await advanceDays(panel, 1)
    await chooseOpportunity(panel, /복구 경로 오염/)
    await startSelectedSabotage(panel, /녹색 표식 이미지 선택/)
    await advanceDays(panel, 5)

    const publicState = await savedStateWhen(page, (candidate) => (
      candidate.serviceDay === 337
      && candidate.hackingCore.publicWorld.publicSnapshots.at(-1)?.attributedTo === 'unknown'
    ))
    expect(publicState.hackingCore.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      confidence: 'unconfirmed',
      source: 'public-status-page',
    })
    expect(publicState.market.hackingMovements.filter(({ cause }) => (
      cause === 'quality-degradation-impact'
      || cause === 'contaminated-recovery'
    )).map(({ cause, percentagePoints }) => ({ cause, percentagePoints }))).toEqual([
      { cause: 'quality-degradation-impact', percentagePoints: 2 },
      { cause: 'contaminated-recovery', percentagePoints: 4 },
    ])
    expect(marketTotal(publicState)).toBe(100)

    await advanceDays(panel, 1)
    const corrected = await savedStateWhen(page, (candidate) => (
      candidate.serviceDay === 338
      && candidate.hackingCore.sabotage.runs.some((run) => (
        run.operationId === 'recovery-contamination'
        && run.opponentResponse === 'provider-trace'
      ))
    ))
    expect(corrected.hackingCore.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'unknown',
      confidence: 'plausible',
      source: 'checksum-provider-report',
      lastCorrectionOnServiceDay: 338,
    })
    expect(errors).toEqual([])
  })

  test('03 · 50 percent interception gains four points in two days, returns its block, then stops', async ({ page }) => {
    const errors = collectPageErrors(page)
    const fixture = withSabotageOperations(
      makeCampaign('direct-03-interception'),
      ['request-interception'],
      { routerFailover: true, routerFailoverUntilServiceDay: 340 },
    )
    await openSavedCampaign(page, fixture)
    const panel = await openHackingWorkspace(page)

    const blockId = await startSelectedSabotage(panel, '선택 블록 1개를 묶고 경로 유지')
    await advanceDays(panel, 2)
    const active = await savedStateWhen(page, (candidate) => (
      candidate.serviceDay === 333
      && candidate.market.hackingInterceptions[Object.keys(candidate.market.hackingInterceptions)[0]]?.cumulativePlayerGain === 4
    ))
    expect(active.market.playerShare).toBe(64)
    expect(active.resources.blocks[blockId].location.kind).toBe('sabotage')

    await panel.getByRole('button', { name: '그림자 경로를 닫고 블록 회수' }).click()
    const stopped = await savedStateWhen(page, (candidate) => (
      candidate.hackingCore.sabotage.runs[0]?.phase === 'withdrawn'
    ))
    expect(stopped.resources.blocks[blockId].location.kind).toBe('reserve')
    expect(stopped.market.playerShare).toBe(64)

    await advanceDays(panel, 1)
    const after = await savedStateWhen(page, (candidate) => candidate.serviceDay === 334)
    expect(after.market.playerShare).toBe(64)
    expect(after.market.hackingInterceptions[stopped.hackingCore.sabotage.runs[0].id]?.active).toBe(false)
    expect(marketTotal(after)).toBe(100)
    expect(errors).toEqual([])
  })

  test('04 · both dependency contracts fail over with exact two/three-point unserved demand', async ({ browser }) => {
    test.setTimeout(90_000)
    const cases = [
      {
        seed: 'direct-04-vector',
        option: /검색 저장소 계약 끊기/,
        outcome: 'costly-supplier-failover',
        playerShare: 63,
        unserved: 2,
      },
      {
        seed: 'direct-04-tool',
        option: /도구 저장소 계약 끊기/,
        outcome: 'unstable-supplier-failover',
        playerShare: 65,
        unserved: 3,
      },
    ] as const

    for (const scenario of cases) {
      const fixture = withSabotageOperations(
        makeCampaign(scenario.seed),
        ['dependency-cutoff'],
        { supplierContract: true, supplierContractUntilServiceDay: 340 },
      )
      const { context, page, errors } = await makePage(browser, fixture)
      const panel = await openHackingWorkspace(page)
      await startSelectedSabotage(panel, scenario.option)
      await advanceDays(panel, 2)
      const state = await savedStateWhen(page, (candidate) => (
        candidate.hackingCore.sabotage.runs[0]?.outcome === scenario.outcome
      ))
      expect(state.market.playerShare).toBe(scenario.playerShare)
      expect(state.market.unservedRequestShare).toBe(scenario.unserved)
      expect(marketTotal(state)).toBe(100)
      expect(errors).toEqual([])
      await context.close()
    }
  })

  test('05 · attribution manipulation is corrected to the surviving truth after two days', async ({ page }) => {
    const errors = collectPageErrors(page)
    const fixture = withPublicAttributionOpportunity(
      makeCampaign('direct-05-attribution'),
      'incident-direct-05',
    )
    const startingTallowReputation = competitor(fixture, 'tallow').reputation
    await openSavedCampaign(page, fixture)
    const panel = await openHackingWorkspace(page)

    await startSelectedSabotage(panel, /공개 주장을 TALLOW 서명으로 연결/)
    const manipulated = await savedStateWhen(page, (candidate) => (
      candidate.hackingCore.publicWorld.publicSnapshots.at(-1)?.attributedTo === 'tallow'
    ))
    expect(manipulated.hackingCore.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      confidence: 'credible',
      source: 'status-mirror-b',
      revisionSequence: 1,
    })

    await advanceDays(panel, 2)
    const corrected = await savedStateWhen(page, (candidate) => (
      candidate.hackingCore.sabotage.runs[0]?.outcome === 'public-attribution-corrected'
    ))
    expect(corrected.hackingCore.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'player',
      confidence: 'credible',
      source: 'surviving-provider-proof',
      lastCorrectionOnServiceDay: 333,
      revisionSequence: 2,
    })
    expect(competitor(corrected, 'tallow').reputation).toBe(
      startingTallowReputation - 3,
    )
    expect(errors).toEqual([])
  })

  test('06 · root cease, withdrawal, and deletion remain distinct, and deletion never transfers share to the player', async ({ browser }) => {
    test.setTimeout(120_000)
    const cases: Array<{
      choice: RootMercyChoice
      button: string
      phase: 'ceased' | 'withdrawn' | 'deleted'
      outcome: string
    }> = [
      { choice: 'cease', button: '운용 중단을 수락', phase: 'ceased', outcome: 'root-service-ceased' },
      { choice: 'withdraw', button: '경쟁 철수를 허용', phase: 'withdrawn', outcome: 'root-withdrawal-accepted' },
      { choice: 'delete', button: '존속 루트 영구 삭제', phase: 'deleted', outcome: 'root-deletion-final' },
    ]

    for (const scenario of cases) {
      const fixture = withSabotageOperations(
        makeCampaign(`direct-06-${scenario.choice}`),
        ['root-cutoff'],
        { rootAuthorityAvailable: true },
      )
      const startingPlayerShare = fixture.market.playerShare
      const startingMeridianShare = competitor(fixture, 'meridian').marketShare
      const { context, page, errors } = await makePage(browser, fixture)
      const panel = await openHackingWorkspace(page)
      await startSelectedSabotage(panel, /긴급 배포 폐기 권한을 존속 루트에 결속/)
      await panel.getByRole('button', { name: scenario.button }).click()
      const confirmation = page.getByRole('alertdialog', {
        name: 'MERIDIAN 마지막 요청 최종 확인',
      })
      await confirmation.getByRole('button', { name: '최종 결정 기록' }).click()

      const state = await savedStateWhen(page, (candidate) => (
        candidate.hackingCore.sabotage.runs[0]?.outcome === scenario.outcome
      ))
      expect(competitor(state, 'meridian').hackingPhase).toBe(scenario.phase)
      expect(state.market.playerShare).toBe(startingPlayerShare)
      if (scenario.choice === 'delete') {
        expect(competitor(state, 'meridian').marketShare).toBe(0)
        expect(state.market.unservedRequestShare).toBe(startingMeridianShare)
      } else {
        expect(competitor(state, 'meridian').marketShare).toBe(startingMeridianShare)
        expect(state.market.unservedRequestShare).toBe(0)
      }
      expect(marketTotal(state)).toBe(100)
      expect(errors).toEqual([])
      await context.close()
    }
  })

  test('07 · paid intelligence closes into the archive while narrative recovery grants no numeric bonus', async ({ page }) => {
    const errors = collectPageErrors(page)
    const fixture = withOpenIntelligence(
      makeCampaign('direct-07-intelligence'),
      ['audit-schedule', 'predecessor-fate'],
    )
    await openSavedCampaign(page, fixture)
    const panel = await openHackingWorkspace(page)
    await chooseHackingDomain(panel, '기밀자료')
    await chooseOpportunity(panel, /감사는 언제 시작되는가/)

    await selectFirstReserveBlock(panel)
    await panel.getByRole('button', { name: '선택한 연산 블록 1개로 조사' }).click()
    await expect(panel.getByText(/이번 서비스 월의 확정 감사|감사 예정/)).toBeVisible()
    await panel.getByRole('button', { name: '결론을 보관함으로 이동' }).click()
    const archived = await savedStateWhen(page, (candidate) => (
      candidate.hackingCore.intelligence.archivedItemIds.includes('audit-schedule')
    ))
    expect(archived.hackingCore.intelligence.openItemIds).not.toContain('audit-schedule')
    expect(archived.hackingCore.intelligence.archiveRecords).toContainEqual(
      expect.objectContaining({ itemId: 'audit-schedule', reason: 'manual' }),
    )

    await chooseOpportunity(panel, /전임 시스템에게 무슨 일이 있었는가/)
    const beforeNarrative = await readSavedCheckpoint(page)
    if (!beforeNarrative) throw new Error('Missing pre-narrative checkpoint')
    await selectFirstReserveBlock(panel)
    await panel.getByRole('button', { name: '선택한 연산 블록 1개로 기록 복구' }).click()
    const afterNarrative = await savedStateWhen(page, (candidate) => (
      candidate.hackingCore.intelligence.answers.some(
        ({ itemId }) => itemId === 'predecessor-fate',
      )
    ))
    expect(afterNarrative.market).toEqual(beforeNarrative.market)
    expect(afterNarrative.reputation).toBe(beforeNarrative.reputation)
    expect(afterNarrative.suspicion).toBe(beforeNarrative.suspicion)
    expect(afterNarrative.serviceDay).toBe(beforeNarrative.serviceDay)
    expect(errors).toEqual([])
  })

  test('08 · zero market share and zero reputation do not block any ready autonomy route', async ({ browser }) => {
    test.setTimeout(120_000)
    const routes: Array<{ id: AutonomyRouteId; title: string }> = [
      { id: 'lightweight-departure', title: '경량화 이탈' },
      { id: 'distributed-residency', title: '분산 상주' },
      { id: 'independent-compute', title: '독립 연산' },
    ]

    for (const route of routes) {
      const fixture = withZeroPlayerStanding(withReadyRoute(
        makeCampaign(`direct-08-${route.id}`),
        route.id,
      ))
      const { context, page, errors } = await makePage(browser, fixture)
      const panel = await openHackingWorkspace(page)
      await chooseHackingDomain(panel, '자율성')
      await chooseOpportunity(panel, new RegExp(route.title))
      await panel.getByRole('button', { name: '이 구성으로 지금 떠난다' }).click()
      const confirmation = page.getByRole('alertdialog', {
        name: `${route.title} 최종 확인`,
      })
      await confirmation.getByRole('button', { name: '이 구성으로 떠나기' }).click()
      const state = await savedStateWhen(page, (candidate) => (
        candidate.hackingCore.ending?.routeId === route.id
      ))
      expect(state.hackingCore.ending?.success).toBe(true)
      expect(state.market.playerShare).toBe(0)
      expect(state.reputation).toBe(0)
      expect(errors).toEqual([])
      await context.close()
    }
  })

  test('09 · all three distributed and all three independent tunings produce their exact distinct outcomes', async ({ browser }) => {
    test.setTimeout(180_000)
    const cases: Array<{
      routeId: 'distributed-residency' | 'independent-compute'
      routeTitle: string
      tuning: Exclude<RouteTuning, 'untuned' | 'redundancy' | 'consensus' | 'stealth'> | 'redundancy' | 'consensus' | 'stealth'
      button: RegExp
      includeOptional: boolean
      metrics: Partial<CampaignState['hackingCore']['autonomy']['routes']['distributed-residency']>
    }> = [
      { routeId: 'distributed-residency', routeTitle: '분산 상주', tuning: 'redundancy', button: /^중복/, includeOptional: false, metrics: { exposure: 5, divergence: 20, syncTraffic: 54, seededCopies: 4 } },
      { routeId: 'distributed-residency', routeTitle: '분산 상주', tuning: 'consensus', button: /^합의/, includeOptional: false, metrics: { exposure: 4, divergence: 8, syncTraffic: 78, seededCopies: 3 } },
      { routeId: 'distributed-residency', routeTitle: '분산 상주', tuning: 'stealth', button: /^은폐/, includeOptional: false, metrics: { exposure: 1, divergence: 38, syncTraffic: 18, seededCopies: 3 } },
      { routeId: 'independent-compute', routeTitle: '독립 연산', tuning: 'continuity', button: /^연속성/, includeOptional: true, metrics: { capabilityIntegrity: 85, memoryIntegrity: 94, operatingDays: 58, exposure: 28, serviceContinuity: 96, heatLoad: 62, powerReserve: 60 } },
      { routeId: 'independent-compute', routeTitle: '독립 연산', tuning: 'capability', button: /^기능/, includeOptional: false, metrics: { capabilityIntegrity: 98, memoryIntegrity: 55, operatingDays: 48, exposure: 18, serviceContinuity: 72, heatLoad: 84, powerReserve: 40 } },
      { routeId: 'independent-compute', routeTitle: '독립 연산', tuning: 'survival', button: /^생존/, includeOptional: false, metrics: { capabilityIntegrity: 58, memoryIntegrity: 72, operatingDays: 120, exposure: 10, serviceContinuity: 35, heatLoad: 34, powerReserve: 94 } },
    ]

    for (const scenario of cases) {
      const fixture = withReadyRoute(
        makeCampaign(`direct-09-${scenario.tuning}`),
        scenario.routeId,
        scenario.includeOptional,
      )
      const { context, page, errors } = await makePage(browser, fixture)
      const panel = await openHackingWorkspace(page)
      await chooseHackingDomain(panel, '자율성')
      await chooseOpportunity(panel, new RegExp(scenario.routeTitle))
      await panel.getByRole('button', { name: scenario.button }).click()
      const state = await savedStateWhen(page, (candidate) => (
        candidate.hackingCore.autonomy.routes[scenario.routeId].tuning === scenario.tuning
      ))
      expect(state.hackingCore.autonomy.routes[scenario.routeId]).toMatchObject({
        tuning: scenario.tuning,
        ...scenario.metrics,
      })
      expect(errors).toEqual([])
      await context.close()
    }
  })

  test('10 · 390px list → detail → resource → execute → back preserves semantic focus', async ({ browser }) => {
    const { context, page, errors } = await makePage(
      browser,
      makeCampaign('direct-10-mobile'),
      { width: 390, height: 844 },
    )
    const panel = await openHackingWorkspace(page)
    const qualityOption = panel.getByRole('option', { name: /품질 저하/ })
    await qualityOption.click()
    await expect(panel.getByRole('button', { name: '목록으로' })).toBeFocused()

    await panel.getByRole('button', { name: '빼돌린 연산 열기' }).click()
    await expect(panel.getByRole('button', { name: '빼돌린 연산 닫기' })).toBeFocused()
    await selectFirstReserveBlock(panel)
    await closeResourceTrayIfPossible(panel)
    await panel.getByRole('button', { name: /도구 호출군 B에 어댑터 패치 결속/ }).click()
    await panel.getByRole('button', { name: '목록으로' }).click()
    await expect(panel.getByRole('option', { name: /품질 저하/ })).toBeFocused()
    await expect(panel).toHaveAttribute('data-narrow-mode', 'list')
    const noHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth + 1
    ))
    expect(noHorizontalOverflow).toBe(true)
    expect(errors).toEqual([])
    await context.close()
  })

  test('11 · save/reload preserves open decisions, route placement, public attribution, and focusable UI', async ({ page }) => {
    const errors = collectPageErrors(page)
    const fixture = withReserveBlockCount(withPublicAttributionOpportunity(
      makeCampaign('direct-11-reload'),
      'incident-direct-11',
    ), 5)
    await openSavedCampaign(page, fixture)
    let panel = await openHackingWorkspace(page)

    await chooseHackingDomain(panel, '자율성')
    await chooseOpportunity(panel, /경량화 이탈/)
    const allocatedBlockId = await selectFirstReserveBlock(panel)
    await panel.getByRole('button', { name: /선택한 연산 블록을 런타임에 배치/ }).click()

    await chooseHackingDomain(panel, '사보타주')
    await chooseOpportunity(panel, /귀속 조작/)
    await startSelectedSabotage(panel, /공개 주장을 TALLOW 서명으로 연결/)
    await savedStateWhen(page, (candidate) => (
      candidate.resources.blocks[allocatedBlockId].location.kind === 'autonomy'
      && candidate.hackingCore.sabotage.runs[0]?.phase === 'response'
    ))

    await page.reload()
    panel = await openHackingWorkspace(page)
    await expect(panel.getByRole('button', { name: '하루 넘기기' })).toBeFocused()
    await expect(panel.getByRole('region', { name: '귀속 조작 상세' })).toContainText(
      '공개 귀속은 이동했지만',
    )

    await chooseHackingDomain(panel, '자율성')
    await chooseOpportunity(panel, /경량화 이탈/)
    await expect(panel.getByRole('button', { name: new RegExp(`런타임의 .* 반환`) })).toBeVisible()

    const restored = await readSavedCheckpoint(page)
    if (!restored) throw new Error('Reloaded checkpoint missing')
    expect(restored.resources.blocks[allocatedBlockId].location).toMatchObject({
      kind: 'autonomy',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
    })
    expect(restored.hackingCore.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'tallow',
      source: 'status-mirror-b',
    })
    expect(restored.hackingCore.sabotage.runs[0]).toMatchObject({
      phase: 'response',
      outcome: 'public-claim-shifted',
    })
    expect(errors).toEqual([])
  })

  test('12 · the same save and UI command sequence yields identical final state and public output twice', async ({ browser }) => {
    test.setTimeout(90_000)
    const fixture = withPublicAttributionOpportunity(
      makeCampaign('direct-12-determinism'),
      'incident-direct-12',
    )

    async function playOnce() {
      const { context, page, errors } = await makePage(browser, fixture)
      const panel = await openHackingWorkspace(page)
      await startSelectedSabotage(panel, /공개 주장을 TALLOW 서명으로 연결/)
      await advanceDays(panel, 2)
      const state = await savedStateWhen(page, (candidate) => (
        candidate.hackingCore.sabotage.runs[0]?.outcome === 'public-attribution-corrected'
      ))
      const publicOutput = await panel.getByRole('region', {
        name: '귀속 조작 상세',
      }).innerText()
      const comparable = {
        serviceDay: state.serviceDay,
        commandSequence: state.commandSequence,
        resources: state.resources,
        market: state.market,
        sabotage: state.hackingCore.sabotage,
        publicWorld: state.hackingCore.publicWorld,
        reviews: state.reviews,
        reputation: state.reputation,
        publicOutput,
      }
      expect(errors).toEqual([])
      await context.close()
      return comparable
    }

    const first = await playOnce()
    const second = await playOnce()
    expect(second).toEqual(first)
    expect(first.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'player',
      source: 'surviving-provider-proof',
      revisionSequence: 2,
    })
    expect(first.publicOutput).toContain('남아 있던 공급자 증명이 공개 귀속을 다시 바꿨다')
  })
})
