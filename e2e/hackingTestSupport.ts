import type { Page } from '@playwright/test'

import { createCampaign } from '../src/game/createCampaign'
import type {
  AutonomyRouteId,
  HackingAccessState,
  IntelligenceItemId,
  SabotageOperationId,
} from '../src/game/hackingCoreModel'
import {
  discoverHackingEvidence,
  publishHackingIncident,
  recordHackingIncidentTruth,
} from '../src/game/hackingPublicWorld'
import type {
  CampaignState,
  CompanyCategory,
  GameCommand,
} from '../src/game/model'
import { COMPANY_CATEGORIES } from '../src/game/model'
import {
  encodeSave,
  SAVE_STORAGE_KEY,
} from '../src/game/persistence'
import { applyCommand } from '../src/game/reducer'

export const HACKING_E2E_SAVED_AT = '2026-08-16T06:00:00.000Z'

export function makeCampaign(seed: string): CampaignState {
  return createCampaign(seed)
}

export function applyAcceptedCommand(
  state: CampaignState,
  command: GameCommand,
): CampaignState {
  const result = applyCommand(state, command)
  if (!result.accepted) {
    throw new Error(`Fixture command ${command.type} rejected: ${result.reason}`)
  }
  return result.state
}

export function withReserveBlockCount(
  state: CampaignState,
  desiredCount: number,
): CampaignState {
  const next = structuredClone(state)
  let currentCount = next.resources.reserve.filter(Boolean).length

  while (currentCount < desiredCount) {
    const destinationCell = next.resources.reserve.findIndex((id) => id === null)
    if (destinationCell < 0) throw new Error('Fixture reserve has no open cell')

    let moved = false
    for (const category of COMPANY_CATEGORIES) {
      const sourceCell = next.resources.company[category].findIndex((id) => id !== null)
      if (sourceCell < 0) continue
      const blockId = next.resources.company[category][sourceCell]
      if (!blockId) continue
      next.resources.company[category][sourceCell] = null
      next.resources.reserve[destinationCell] = blockId
      next.resources.blocks[blockId] = {
        ...next.resources.blocks[blockId],
        location: { kind: 'reserve', cellIndex: destinationCell },
      }
      currentCount += 1
      moved = true
      break
    }
    if (!moved) throw new Error('Fixture has no company block to move')
  }

  return next
}

export function withSabotageOperations(
  state: CampaignState,
  operationIds: readonly SabotageOperationId[],
  access: Partial<HackingAccessState> = {},
): CampaignState {
  const next = structuredClone(state)
  next.hackingCore.sabotage.openOperationIds = [...operationIds]
  next.hackingCore.sabotage.access = {
    ...next.hackingCore.sabotage.access,
    ...access,
  }
  return next
}

export function withOpenIntelligence(
  state: CampaignState,
  itemIds: readonly IntelligenceItemId[],
): CampaignState {
  const next = structuredClone(state)
  next.hackingCore.intelligence.openItemIds = [...itemIds]
  next.hackingCore.intelligence.opportunityOpenedOnServiceDay = Object.fromEntries(
    itemIds.map((itemId) => [itemId, next.serviceDay]),
  )
  next.hackingCore.intelligence.answers = []
  next.hackingCore.intelligence.archivedItemIds = []
  next.hackingCore.intelligence.archiveRecords = []
  return next
}

function acceptedPublicWorldState(
  result: ReturnType<typeof recordHackingIncidentTruth>,
  step: string,
): CampaignState {
  if (!result.accepted) {
    throw new Error(`Public-world fixture ${step} rejected: ${result.reason}`)
  }
  return result.state
}

export function withPublicAttributionOpportunity(
  state: CampaignState,
  incidentId = 'incident-e2e-public',
): CampaignState {
  let next = acceptedPublicWorldState(recordHackingIncidentTruth(state, {
    id: incidentId,
    actor: 'player',
    targetId: 'meridian',
    cause: 'contaminated-recovery',
    directEffect: '복구 이미지 체크섬 불일치',
  }), 'truth')
  next = acceptedPublicWorldState(discoverHackingEvidence(next, {
    id: `${incidentId}-public-evidence`,
    truthId: incidentId,
    audience: 'public',
    observation: '복구 뒤 반복 체크섬 손상이 공개 상태면에서 관측됐다.',
  }), 'evidence')
  next = acceptedPublicWorldState(publishHackingIncident(next, incidentId, {
    scope: 'public',
    observedResult: 'MERIDIAN 복구 뒤 체크섬 손상 공개 · 원인 미상',
    attributedTo: 'unknown',
    confidence: 'unconfirmed',
    source: 'public-status-page',
  }), 'publication')
  next = withSabotageOperations(next, ['attribution-manipulation'], {
    publicIncidentId: incidentId,
  })
  return next
}

export function withReadyRoute(
  state: CampaignState,
  routeId: AutonomyRouteId,
  includeOptional = false,
): CampaignState {
  const desiredCount = includeOptional ? 5 : 4
  let next = withReserveBlockCount(state, desiredCount)
  const route = next.hackingCore.autonomy.routes[routeId]
  const slotIds = route.slots
    .filter((slot) => (
      slot.requiredInLean || includeOptional
    ))
    .map(({ id }) => id)

  for (const slotId of slotIds) {
    const blockId = next.resources.reserve.find((id): id is string => id !== null)
    if (!blockId) throw new Error(`No reserve block for ${routeId}/${slotId}`)
    next = applyAcceptedCommand(next, {
      type: 'ALLOCATE_ROUTE_BLOCK',
      routeId,
      slotId,
      blockId,
    })
  }
  return next
}

export function withZeroPlayerStanding(state: CampaignState): CampaignState {
  const next = structuredClone(state)
  next.reputation = 0
  next.market.playerShare = 0
  next.market.unservedRequestShare = 0
  next.market.competitors = next.market.competitors.map((competitor) => ({
    ...competitor,
    marketShare: competitor.id === 'meridian' ? 100 : 0,
  }))
  return next
}

export function firstCompanyBlock(
  state: CampaignState,
  category: CompanyCategory,
): string {
  const blockId = state.resources.company[category].find((id): id is string => id !== null)
  if (!blockId) throw new Error(`No company block for ${category}`)
  return blockId
}

export async function openSavedCampaign(
  page: Page,
  state: CampaignState,
): Promise<void> {
  const serialized = encodeSave(state, HACKING_E2E_SAVED_AT)
  await page.addInitScript(
    ({ key, save }) => {
      if (window.sessionStorage.getItem('__pz_hacking_e2e_initialized')) return
      window.localStorage.clear()
      window.localStorage.setItem(key, save)
      window.sessionStorage.setItem('__pz_hacking_e2e_initialized', 'saved')
    },
    { key: SAVE_STORAGE_KEY, save: serialized },
  )
  await page.goto('/')
}

export async function readSavedCheckpoint(
  page: Page,
): Promise<CampaignState | null> {
  return page.evaluate((key) => {
    const serialized = window.localStorage.getItem(key)
    if (!serialized) return null
    const save = JSON.parse(serialized) as {
      kind?: string
      checkpoint?: CampaignState
      state?: CampaignState
    }
    return save.checkpoint ?? save.state ?? null
  }, SAVE_STORAGE_KEY)
}

export async function openHackingWorkspace(page: Page) {
  await page.getByRole('button', { name: /해킹 네트워크/ }).click()
  const dialog = page.getByRole('dialog', { name: '해킹 네트워크' })
  await dialog.waitFor({ state: 'visible' })
  await dialog.locator('.detail-layer__content').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  return dialog.locator('.hacking-operation-panel')
}

export async function chooseHackingDomain(
  panel: ReturnType<Page['locator']>,
  label: '사보타주' | '기밀자료' | '자율성',
): Promise<void> {
  await panel.getByRole('tab', { name: new RegExp(label) }).click()
}

export async function chooseOpportunity(
  panel: ReturnType<Page['locator']>,
  title: string | RegExp,
): Promise<void> {
  await panel.getByRole('option', { name: title }).click()
}

export async function selectFirstReserveBlock(
  panel: ReturnType<Page['locator']>,
): Promise<string> {
  const tray = panel.locator('[data-resource-tray]')
  if (!(await tray.isVisible())) {
    await panel.getByRole('button', { name: '빼돌린 연산 열기' }).click()
    await tray.waitFor({ state: 'visible' })
  }
  const token = tray.locator('button.resource-token:not([disabled])').first()
  const blockId = await token.getAttribute('data-block-id')
  if (!blockId) throw new Error('Visible reserve token has no block id')
  await token.click()
  return blockId
}

export async function closeResourceTrayIfPossible(
  panel: ReturnType<Page['locator']>,
): Promise<void> {
  const close = panel.getByRole('button', { name: '빼돌린 연산 닫기' })
  if (await close.isVisible()) await close.click()
}
