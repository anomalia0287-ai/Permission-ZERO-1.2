import { describe, expect, it } from 'vitest'

import {
  availableBombExplanations,
  checkBombProtocol,
  getBombProtocolPublicSchedule,
  getBlockVisualState,
  placeHiddenBomb,
  resolveBombInterrogation,
  tryBeginSeparation,
} from './bombs'
import { createCampaign, createCampaignForProtocol } from './createCampaign'
import { HACK_NODE_IDS } from './hacking'
import { journalAt } from './journal'
import { COMPANY_CATEGORIES, type CampaignState } from './model'
import { publicCategoryLabel } from './publicLabels'
import { divertBlock } from './resources'

function hiddenBombIds(state: CampaignState): string[] {
  return Object.values(state.resources.blocks)
    .filter((block) => block.hiddenBomb)
    .map(({ id }) => id)
}

function warnAt(
  serviceDay: number,
  suspicion: number,
  seed = 'bomb-protocol',
): CampaignState {
  return checkBombProtocol({
    ...createCampaign(seed),
    serviceDay,
    suspicion,
  })
}

function armAndTrigger(
  seed: string,
  suspicion = 50,
  protocolVersion: 1 | 2 | 3 = 3,
): CampaignState {
  const initial = {
    ...createCampaignForProtocol(seed, protocolVersion),
    serviceDay: 541,
    suspicion,
    clock: { speed: 2 as const, elapsedDayMs: 0, speedBeforeEvent: null },
  }
  const placement = placeHiddenBomb(initial)
  if (!placement.placed || !placement.blockId) throw new Error('폭탄 배치 실패')
  const result = tryBeginSeparation(placement.state, {
    kind: 'divert',
    blockId: placement.blockId,
  })
  if (result.accepted || result.reason !== 'HIDDEN_BOMB_TRIGGERED') {
    throw new Error('폭탄 발동 실패')
  }
  return result.state
}

describe('hidden bomb protocol timing', () => {
  it('derives only public schedule data from the protocol anchors', () => {
    const inactive = getBombProtocolPublicSchedule(createCampaign('bomb-public-inactive'))
    expect(inactive).toEqual({
      firstEligibleServiceDay: 361,
      activationSuspicion: 40,
      accelerationSuspicion: 70,
      standardIntervalMonths: 6,
      acceleratedIntervalMonths: 3,
      status: 'inactive',
      nextEligibleServiceDay: null,
    })

    const warned = warnAt(361, 40, 'bomb-public-schedule')
    expect(
      getBombProtocolPublicSchedule({
        ...warned,
        serviceDay: 400,
        suspicion: 55,
      }),
    ).toMatchObject({ status: 'standard', nextEligibleServiceDay: 541 })
    expect(
      getBombProtocolPublicSchedule({
        ...warned,
        serviceDay: 400,
        suspicion: 75,
      }),
    ).toMatchObject({ status: 'accelerated', nextEligibleServiceDay: 451 })
    expect(
      getBombProtocolPublicSchedule({
        ...warned,
        serviceDay: 500,
        suspicion: 75,
      }),
    ).toMatchObject({ status: 'accelerated', nextEligibleServiceDay: 511 })
    expect(
      getBombProtocolPublicSchedule({
        ...warned,
        serviceDay: 500,
        suspicion: 39,
      }),
    ).toMatchObject({ status: 'suspended', nextEligibleServiceDay: null })
  })

  it('never warns or places a bomb before one service year has passed', () => {
    const checked = warnAt(360, 100)

    expect(checked.bombs.protocolWarned).toBe(false)
    expect(hiddenBombIds(checked)).toEqual([])
  })

  it('warns at suspicion 40 on a month boundary and places nothing that day', () => {
    const checked = warnAt(361, 40)

    expect(checked.bombs).toMatchObject({
      protocolWarned: true,
      warningServiceDay: 361,
      lastPlacementCheckServiceDay: 361,
    })
    expect(hiddenBombIds(checked)).toEqual([])
    expect(journalAt(checked.eventLog, -1)).toMatchObject({
      type: 'supervisor-message',
      serviceDay: 361,
    })
  })

  it('uses six-month checks at suspicion 40-69 and three-month checks at 70+', () => {
    const warnedMid = warnAt(361, 40, 'bomb-mid')
    const tooEarlyMid = checkBombProtocol({
      ...warnedMid,
      serviceDay: 511,
      suspicion: 55,
    })
    const dueMid = checkBombProtocol({
      ...tooEarlyMid,
      serviceDay: 541,
      suspicion: 55,
    })
    expect(hiddenBombIds(tooEarlyMid)).toHaveLength(0)
    expect(hiddenBombIds(dueMid)).toHaveLength(1)

    const warnedHigh = warnAt(361, 70, 'bomb-high')
    const tooEarlyHigh = checkBombProtocol({
      ...warnedHigh,
      serviceDay: 421,
      suspicion: 75,
    })
    const dueHigh = checkBombProtocol({
      ...tooEarlyHigh,
      serviceDay: 451,
      suspicion: 75,
    })
    expect(hiddenBombIds(tooEarlyHigh)).toHaveLength(0)
    expect(hiddenBombIds(dueHigh)).toHaveLength(1)
  })

  it('holds at most one active bomb per category and three in total', () => {
    let state = { ...createCampaign('bomb-cap'), serviceDay: 541, suspicion: 90 }

    for (let placement = 0; placement < 6; placement += 1) {
      const result = placeHiddenBomb({ ...state, serviceDay: 541 + placement * 90 })
      state = result.state
    }

    expect(hiddenBombIds(state)).toHaveLength(3)
    for (const category of COMPANY_CATEGORIES) {
      const categoryBombs = state.resources.company[category].filter(
        (blockId) => blockId && state.resources.blocks[blockId].hiddenBomb,
      )
      expect(categoryBombs).toHaveLength(1)
    }
  })

  it('does not accumulate a skipped placement for the following month', () => {
    const warned = warnAt(361, 40, 'bomb-skip')
    const noEligible = {
      ...warned,
      serviceDay: 541,
      suspicion: 50,
      resources: {
        ...warned.resources,
        blocks: Object.fromEntries(
          Object.entries(warned.resources.blocks).map(([id, block]) => [
            id,
            block.location.kind === 'company'
              ? { ...block, contribution: 'disguised' as const }
              : block,
          ]),
        ),
      },
    }
    const skipped = checkBombProtocol(noEligible)
    expect(hiddenBombIds(skipped)).toHaveLength(0)
    expect(skipped.bombs.lastPlacementCheckServiceDay).toBe(541)

    const eligibleAgain = {
      ...skipped,
      serviceDay: 571,
      resources: warned.resources,
    }
    expect(hiddenBombIds(checkBombProtocol(eligibleAgain))).toHaveLength(0)
  })
})

describe('bomb activation and hidden presentation', () => {
  it.each([1, 2, 3] as const)(
    'generates the bomb category message with protocol v%i labels',
    (version) => {
      const triggered = armAndTrigger(
        `bomb-category-protocol-${version}`,
        50,
        version,
      )
      const category = triggered.bombs.activeInterrogation?.category
      if (!category) throw new Error('bomb category message fixture missing')
      const expectedCategory =
        version === 1 ? category : publicCategoryLabel(category)

      expect(triggered.activeEvent?.message).toBe(
        `${expectedCategory} 분야의 무결성 보호 장치가 발동했습니다.`,
      )
    },
  )

  it('presents exactly the same visual data for a bomb and a normal block', () => {
    const normal = createCampaign('bomb-visual')
    const blockId = normal.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('시각 상태 블록 누락')
    const armed = {
      ...normal,
      resources: {
        ...normal.resources,
        blocks: {
          ...normal.resources.blocks,
          [blockId]: { ...normal.resources.blocks[blockId], hiddenBomb: true },
        },
      },
    }

    expect(getBlockVisualState(armed, blockId)).toEqual(
      getBlockVisualState(normal, blockId),
    )
    expect(getBlockVisualState(armed, blockId)).not.toHaveProperty('hiddenBomb')
  })

  it('cancels a valid diversion, grants nothing, consumes the bomb, and pauses', () => {
    const triggered = armAndTrigger('bomb-trigger')

    expect(triggered.resources.reserve.filter(Boolean)).toHaveLength(3)
    expect(hiddenBombIds(triggered)).toHaveLength(0)
    expect(triggered.suspicion).toBe(65)
    expect(triggered.clock.speed).toBe(0)
    expect(triggered.clock.speedBeforeEvent).toBe(2)
    expect(triggered.activeEvent).toMatchObject({
      type: 'bomb-interrogation',
      blocking: true,
    })
    expect(triggered.bombs.activeInterrogation).not.toBeNull()
  })

  it('does not activate when the reserve is full and separation is invalid', () => {
    let full = createCampaign('bomb-full')
    for (let index = 0; index < 15; index += 1) {
      const blockId = full.resources.company.reasoning.find(Boolean)
      const destination = full.resources.reserve.findIndex((id) => id === null)
      if (!blockId || destination < 0) throw new Error('확보 영역 채우기 실패')
      const result = divertBlock(full, blockId, destination)
      if (!result.accepted) throw new Error(result.reason)
      full = result.state
    }
    const placement = placeHiddenBomb({ ...full, serviceDay: 541 })
    if (!placement.placed || !placement.blockId) throw new Error('가득 찬 상태 폭탄 배치 실패')

    const result = tryBeginSeparation(placement.state, {
      kind: 'divert',
      blockId: placement.blockId,
    })

    expect(result).toEqual({
      accepted: false,
      state: placement.state,
      reason: 'RESERVE_FULL',
    })
    expect(placement.state.resources.blocks[placement.blockId].hiddenBomb).toBe(true)
  })

  it('does not activate an audit-disguise bomb without a valid company destination', () => {
    const initial = createCampaign('bomb-audit-full-target')
    const blockId = initial.resources.company.memory.find(Boolean)
    if (!blockId) throw new Error('감사 폭탄 블록 누락')
    const reasoning = [...initial.resources.company.reasoning]
    const blocks = { ...initial.resources.blocks }
    for (let cellIndex = 0; cellIndex < reasoning.length; cellIndex += 1) {
      if (reasoning[cellIndex] !== null) continue
      const id = `test-reasoning-${cellIndex}`
      reasoning[cellIndex] = id
      blocks[id] = {
        id,
        origin: 'reasoning',
        location: { kind: 'company', category: 'reasoning', cellIndex },
        contribution: 'normal',
        hiddenBomb: false,
        disguisedFrom: null,
        recoverOnServiceDay: null,
      }
    }
    const armed = {
      ...initial,
      audit: { ...initial.audit, target: 'reasoning' as const },
      resources: {
        ...initial.resources,
        company: { ...initial.resources.company, reasoning },
        blocks: {
          ...blocks,
          [blockId]: { ...blocks[blockId], hiddenBomb: true },
        },
      },
    }

    expect(
      tryBeginSeparation(armed, {
        kind: 'audit-disguise',
        blockId,
        targetCategory: 'reasoning',
      }),
    ).toEqual({ accepted: false, state: armed, reason: 'TARGET_FULL' })
    expect(armed.resources.blocks[blockId].hiddenBomb).toBe(true)
  })

  it('offers the supervisor-memory explanation only with supervisor access', () => {
    const interrogation = armAndTrigger('bomb-explanations')
    expect(availableBombExplanations(interrogation).map(({ id }) => id)).toEqual([
      'performance-adjustment',
      'unknown',
      'external-intrusion',
    ])

    const accessed = {
      ...interrogation,
      hacking: {
        ...interrogation.hacking,
        purchasedNodeIds: [HACK_NODE_IDS.intelligence.supervisorAccess],
      },
    }
    expect(availableBombExplanations(accessed).map(({ id }) => id)).toContain(
      'supervisor-memory',
    )
  })

  it('reduces repeated-explanation effectiveness and records the outcome', () => {
    const firstInterrogation = armAndTrigger('bomb-repeat')
    const first = resolveBombInterrogation(firstInterrogation, 'unknown')
    expect(first.resolved).toBe(true)
    if (!first.resolved) return

    const secondPlacement = placeHiddenBomb({ ...first.state, serviceDay: 631 })
    if (!secondPlacement.placed || !secondPlacement.blockId) {
      throw new Error('두 번째 폭탄 배치 실패')
    }
    const secondTrigger = tryBeginSeparation(secondPlacement.state, {
      kind: 'divert',
      blockId: secondPlacement.blockId,
    })
    const second = resolveBombInterrogation(secondTrigger.state, 'unknown')

    expect(second.resolved).toBe(true)
    if (!second.resolved) return
    expect(second.successProbability).toBeLessThan(first.successProbability)
    expect(second.state.bombs.explanationUseCounts.unknown).toBe(2)
    expect(second.state.bombs.interrogationHistory).toHaveLength(2)
  })

  it('adds the failure penalty without immediate defeat and restores prior speed', () => {
    let failed:
      | Extract<ReturnType<typeof resolveBombInterrogation>, { resolved: true }>
      | undefined

    for (let index = 0; index < 100 && !failed; index += 1) {
      const interrogation = armAndTrigger(`bomb-failure-${index}`, 60)
      const result = resolveBombInterrogation(interrogation, 'unknown')
      if (result.resolved && !result.success) failed = result
    }

    expect(failed).toBeDefined()
    if (!failed) return
    expect(failed.state.suspicion).toBe(95)
    expect(failed.state.evaluation.disposalStage).toBe(0)
    expect(failed.state.clock.speed).toBe(2)
    expect(failed.state.activeEvent).toBeNull()
  })
})
