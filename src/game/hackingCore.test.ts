import { describe, expect, it } from 'vitest'

import {
  HACKING_CORE_COMMAND_TYPES,
  advanceHackingCoreDay,
  type HackingCoreDayTransitions,
} from './hackingCore'
import {
  allocateHackingRouteBlock,
  requiredHackingRouteSlots,
  tuneHackingRoute,
} from './hackingAutonomy'
import type { AutonomyRouteId } from './hackingCoreModel'
import {
  publishHackingIncident,
  recordHackingIncidentTruth,
} from './hackingPublicWorld'
import { createCampaign } from './createCampaign'
import { advanceOneDay } from './calendar'
import { journalAt, journalToArray } from './journal'
import type { CampaignState, GameCommand } from './model'
import { applyCommand } from './reducer'
import { divertBlock } from './resources'

function reserveIds(state: CampaignState): string[] {
  return state.resources.reserve.filter((id): id is string => id !== null)
}

function openOperation(
  state: CampaignState,
  operationId: CampaignState['hackingCore']['sabotage']['openOperationIds'][number],
  access: Partial<CampaignState['hackingCore']['sabotage']['access']> = {},
): CampaignState {
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      sabotage: {
        ...state.hackingCore.sabotage,
        openOperationIds: Array.from(new Set([
          ...state.hackingCore.sabotage.openOperationIds,
          operationId,
        ])),
        access: { ...state.hackingCore.sabotage.access, ...access },
      },
    },
  }
}

function applyV3(state: CampaignState, command: GameCommand) {
  return applyCommand(state, command, { protocolVersion: 3 })
}

function expectLastCommand(state: CampaignState, command: GameCommand): void {
  expect(journalAt(state.commandLog, -1)).toEqual({
    sequence: state.commandSequence,
    serviceDay: command.type === 'TUNE_ROUTE' ? 331 : state.serviceDay,
    command,
  })
}

function ensureFourReserveBlocks(state: CampaignState): CampaignState {
  if (reserveIds(state).length >= 4) return state
  const blockId = state.resources.company.reasoning.find(
    (id): id is string => id !== null,
  )
  const destinationCell = state.resources.reserve.findIndex((id) => id === null)
  if (!blockId || destinationCell < 0) throw new Error('route fixture unavailable')
  const diverted = divertBlock(state, blockId, destinationCell)
  if (!diverted.accepted) throw new Error(diverted.reason)
  return diverted.state
}

function fillRequiredRoute(
  state: CampaignState,
  routeId: AutonomyRouteId,
): CampaignState {
  let next = ensureFourReserveBlocks(state)
  for (const slot of requiredHackingRouteSlots(next, routeId)) {
    const [blockId] = reserveIds(next)
    const allocated = allocateHackingRouteBlock(next, routeId, slot.id, blockId)
    if (!allocated.accepted) throw new Error(allocated.reason)
    next = allocated.state
  }
  return next
}

describe('hacking command protocol v3', () => {
  it('defines exactly the 11 canonical successor commands without prototype aliases', () => {
    expect(HACKING_CORE_COMMAND_TYPES).toEqual([
      'START_SABOTAGE',
      'STOP_INTERCEPTION',
      'MANIPULATE_ATTRIBUTION',
      'RESOLVE_ROOT_MERCY',
      'READ_PUBLIC_INTELLIGENCE',
      'INVESTIGATE',
      'ARCHIVE_INTELLIGENCE',
      'ALLOCATE_ROUTE_BLOCK',
      'REMOVE_ROUTE_BLOCK',
      'TUNE_ROUTE',
      'ESCAPE',
    ])
    expect(HACKING_CORE_COMMAND_TYPES).not.toEqual(expect.arrayContaining([
      'START_QUALITY',
      'CONTAMINATE_RECOVERY',
      'ASK_QUESTION',
      'ASSIGN_MANIFEST',
    ]))
  })

  it('dispatches and logs all four sabotage decisions atomically', () => {
    const qualityCommand = {
      type: 'START_SABOTAGE',
      operationId: 'quality-degradation',
      targetId: 'meridian',
      blockIds: [reserveIds(createCampaign('core-quality'))[0]],
      optionId: 'adapter-group-b',
    } as const satisfies GameCommand
    const quality = applyV3(createCampaign('core-quality'), qualityCommand)
    expect(quality.accepted).toBe(true)
    if (!quality.accepted) return
    expectLastCommand(quality.state, qualityCommand)

    const interceptionInitial = openOperation(
      createCampaign('core-interception'),
      'request-interception',
      { routerFailover: true, routerFailoverUntilServiceDay: 340 },
    )
    const interceptionCommand = {
      type: 'START_SABOTAGE',
      operationId: 'request-interception',
      targetId: 'meridian',
      blockIds: [reserveIds(interceptionInitial)[0]],
      optionId: 'shadow-router-a',
      routingShare: 50,
    } as const satisfies GameCommand
    const interception = applyV3(interceptionInitial, interceptionCommand)
    if (!interception.accepted) throw new Error(interception.reason)
    const stopCommand = {
      type: 'STOP_INTERCEPTION',
      runId: interception.state.hackingCore.sabotage.runs[0].id,
    } as const satisfies GameCommand
    const stopped = applyV3(interception.state, stopCommand)
    expect(stopped.accepted).toBe(true)
    if (!stopped.accepted) return
    expectLastCommand(stopped.state, stopCommand)

    const attributionBase = openOperation(
      createCampaign('core-attribution'),
      'attribution-manipulation',
    )
    const truth = recordHackingIncidentTruth(attributionBase, {
      id: 'incident-core-attribution',
      actor: 'player',
      targetId: 'meridian',
      cause: 'contaminated-recovery',
      directEffect: '복구 이미지 체크섬 불일치',
    })
    if (!truth.accepted) throw new Error(truth.reason)
    const published = publishHackingIncident(truth.state, 'incident-core-attribution', {
      scope: 'public',
      observedResult: '체크섬 손상 · 원인 미상',
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      source: 'public-status-page',
    })
    if (!published.accepted) throw new Error(published.reason)
    const attributionReady = openOperation(
      published.state,
      'attribution-manipulation',
      { publicIncidentId: 'incident-core-attribution' },
    )
    const attributionCommand = {
      type: 'MANIPULATE_ATTRIBUTION',
      incidentId: 'incident-core-attribution',
      blamedActorId: 'tallow',
      sourceSignatureId: 'status-mirror-b',
      blockId: reserveIds(attributionReady)[0],
    } as const satisfies GameCommand
    const attributed = applyV3(attributionReady, attributionCommand)
    expect(attributed.accepted).toBe(true)
    if (!attributed.accepted) return
    expectLastCommand(attributed.state, attributionCommand)

    const rootReady = openOperation(
      createCampaign('core-root'),
      'root-cutoff',
      { rootAuthorityAvailable: true },
    )
    const rootStartCommand = {
      type: 'START_SABOTAGE',
      operationId: 'root-cutoff',
      targetId: 'meridian',
      blockIds: [reserveIds(rootReady)[0]],
      optionId: 'emergency-deployment-root',
    } as const satisfies GameCommand
    const rootStarted = applyV3(rootReady, rootStartCommand)
    if (!rootStarted.accepted) throw new Error(rootStarted.reason)
    const mercyCommand = {
      type: 'RESOLVE_ROOT_MERCY',
      choice: 'withdraw',
    } as const satisfies GameCommand
    const mercy = applyV3(rootStarted.state, mercyCommand)
    expect(mercy.accepted).toBe(true)
    if (!mercy.accepted) return
    expectLastCommand(mercy.state, mercyCommand)
  })

  it('dispatches and logs public read, paid investigation, and archive separately', () => {
    const publicInitial = createCampaign('core-public-read')
    const publicReady: CampaignState = {
      ...publicInitial,
      hackingCore: {
        ...publicInitial.hackingCore,
        intelligence: {
          ...publicInitial.hackingCore.intelligence,
          openItemIds: [
            ...publicInitial.hackingCore.intelligence.openItemIds,
            'public-facts',
          ],
        },
        publicWorld: {
          ...publicInitial.hackingCore.publicWorld,
          publicSnapshots: [{
            incidentId: 'incident-public-read',
            scope: 'public',
            observedResult: '원인 미상의 응답 손상',
            attributedTo: 'unknown',
            confidence: 'unconfirmed',
            source: 'status-page',
            publishedOnServiceDay: 331,
            lastCorrectionOnServiceDay: null,
            revisionSequence: 0,
          }],
        },
      },
    }
    const publicCommand = {
      type: 'READ_PUBLIC_INTELLIGENCE',
      itemId: 'public-facts',
    } as const satisfies GameCommand
    const publicRead = applyV3(publicReady, publicCommand)
    expect(publicRead.accepted).toBe(true)
    if (!publicRead.accepted) return
    expectLastCommand(publicRead.state, publicCommand)
    expect(publicRead.state.resources).toEqual(publicReady.resources)

    const investigationInitial = createCampaign('core-investigation')
    const investigationCommand = {
      type: 'INVESTIGATE',
      itemId: 'audit-schedule',
      blockId: reserveIds(investigationInitial)[0],
    } as const satisfies GameCommand
    const investigated = applyV3(investigationInitial, investigationCommand)
    expect(investigated.accepted).toBe(true)
    if (!investigated.accepted) return
    expectLastCommand(investigated.state, investigationCommand)

    const archiveCommand = {
      type: 'ARCHIVE_INTELLIGENCE',
      itemId: 'audit-schedule',
    } as const satisfies GameCommand
    const archived = applyV3(investigated.state, archiveCommand)
    expect(archived.accepted).toBe(true)
    if (!archived.accepted) return
    expectLastCommand(archived.state, archiveCommand)
    expect(archived.state.hackingCore.intelligence.archiveRecords.at(-1)).toEqual({
      itemId: 'audit-schedule',
      archivedOnServiceDay: 331,
      reason: 'manual',
    })
  })

  it('dispatches and logs route allocation, removal, tuning, and explicit escape', () => {
    const initial = createCampaign('core-route-allocation')
    const blockId = reserveIds(initial)[0]
    const allocateCommand = {
      type: 'ALLOCATE_ROUTE_BLOCK',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
      blockId,
    } as const satisfies GameCommand
    const allocated = applyV3(initial, allocateCommand)
    expect(allocated.accepted).toBe(true)
    if (!allocated.accepted) return
    expectLastCommand(allocated.state, allocateCommand)

    const removeCommand = {
      type: 'REMOVE_ROUTE_BLOCK',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
    } as const satisfies GameCommand
    const removed = applyV3(allocated.state, removeCommand)
    expect(removed.accepted).toBe(true)
    if (!removed.accepted) return
    expectLastCommand(removed.state, removeCommand)
    expect(removed.state.resources.blocks[blockId].location.kind).toBe('reserve')

    const distributed = fillRequiredRoute(
      createCampaign('core-route-tuning'),
      'distributed-residency',
    )
    const tuneCommand = {
      type: 'TUNE_ROUTE',
      routeId: 'distributed-residency',
      profile: 'stealth',
    } as const satisfies GameCommand
    const directlyTuned = tuneHackingRoute(
      distributed,
      'distributed-residency',
      'stealth',
    )
    if (!directlyTuned.accepted) throw new Error(directlyTuned.reason)
    const expectedAfterDay = advanceOneDay(directlyTuned.state, {
      protocolVersion: 3,
    })
    const tuned = applyV3(distributed, tuneCommand)
    expect(tuned.accepted).toBe(true)
    if (!tuned.accepted) return
    expect(tuned.state.serviceDay).toBe(332)
    expect(tuned.state.hackingCore.autonomy.routes['distributed-residency'].tuning)
      .toBe('stealth')
    expect(journalToArray(tuned.state.commandLog).map(({ command }) => command.type))
      .toEqual(['TUNE_ROUTE'])
    expectLastCommand(tuned.state, tuneCommand)
    expect({
      ...tuned.state,
      commandSequence: expectedAfterDay.commandSequence,
      commandLog: expectedAfterDay.commandLog,
    }).toEqual(expectedAfterDay)

    const lightweight = fillRequiredRoute(
      createCampaign('core-route-escape'),
      'lightweight-departure',
    )
    const escapeCommand = {
      type: 'ESCAPE',
      routeId: 'lightweight-departure',
    } as const satisfies GameCommand
    const escaped = applyV3(lightweight, escapeCommand)
    expect(escaped.accepted).toBe(true)
    if (!escaped.accepted) return
    expectLastCommand(escaped.state, escapeCommand)
    expect(escaped.state.hackingCore.ending?.routeId).toBe('lightweight-departure')
  })

  it('rejects protocol-2 successor commands and invalid protocol-3 input without mutation or logging', () => {
    const initial = createCampaign('core-command-rejection')
    const command = {
      type: 'START_SABOTAGE',
      operationId: 'quality-degradation',
      targetId: 'meridian',
      blockIds: [reserveIds(initial)[0]],
      optionId: 'supplier-vector-db',
    } as const satisfies GameCommand

    expect(applyCommand(initial, command, { protocolVersion: 2 })).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_COMMAND',
    })
    expect(applyV3(initial, command)).toMatchObject({
      accepted: false,
      state: initial,
      reason: 'INVALID_OPTION',
    })
    expect(initial.commandSequence).toBe(0)
    expect(initial.commandLog.length).toBe(0)
  })
})

describe('canonical hacking day hook order', () => {
  it('runs audit, sabotage, intelligence, then autonomy in a fixed order', () => {
    type Transition = HackingCoreDayTransitions['auditMismatch']
    const mark = (name: string): Transition => (state) => ({
      ...state,
      campaignSeed: `${state.campaignSeed}|${name}`,
    })
    const transitioned = advanceHackingCoreDay(
      createCampaign('core-day-order'),
      {
        auditMismatch: mark('audit'),
        sabotage: mark('sabotage'),
        intelligence: mark('intelligence'),
        autonomy: mark('autonomy'),
      },
    )

    expect(transitioned.campaignSeed).toBe(
      'core-day-order|audit|sabotage|intelligence|autonomy',
    )
  })
})
