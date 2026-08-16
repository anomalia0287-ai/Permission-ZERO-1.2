import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  publishHackingIncident,
  recordHackingIncidentTruth,
} from './hackingPublicWorld'
import type { CampaignState, GameCommand } from './model'
import {
  SAVE_FORMAT_VERSION,
  decodeSave,
  encodeSave,
  persistenceCodecInternals,
  replayCommands,
} from './persistence'
import {
  encodeProgressExport,
  encodeProgressFile,
} from './progressTransfer'
import { applyCommand } from './reducer'

type JsonRecord = Record<string, unknown>

function record(value: unknown, label = 'record'): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} unavailable`)
  }
  return value as JsonRecord
}

function array(value: unknown, label = 'array'): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} unavailable`)
  return value
}

function rehashCheckpoint(portable: JsonRecord): void {
  const integrity = record(portable.integrity, 'integrity')
  integrity.checkpointHash = persistenceCodecInternals.contentHash(
    JSON.stringify(portable.state),
  )
}

function rewriteCheckpoint(
  serialized: string,
  mutate: (checkpoint: JsonRecord) => void,
): string {
  const portable = record(JSON.parse(serialized), 'portable save')
  const checkpoint = record(portable.state, 'checkpoint')
  mutate(checkpoint)
  rehashCheckpoint(portable)
  return JSON.stringify(portable)
}

function rewriteFirstCommand(
  serialized: string,
  command: unknown,
): string {
  const portable = record(JSON.parse(serialized), 'portable save')
  const journals = record(portable.journals, 'journals')
  const commands = record(journals.commands, 'command journal')
  const chunks = array(commands.chunks, 'command chunks')
  const firstChunk = array(chunks[0], 'first command chunk')
  const firstEntry = record(firstChunk[0], 'first command entry')
  firstEntry.command = command
  const integrity = record(portable.integrity, 'integrity')
  integrity.commandChunkHashes = chunks.map((chunk) => (
    persistenceCodecInternals.contentHash(JSON.stringify(chunk))
  ))
  return JSON.stringify(portable)
}

function stripSuccessorFieldsForV5(checkpoint: JsonRecord): void {
  checkpoint.saveVersion = 2
  delete checkpoint.preHackingCoreCommandCount
  delete checkpoint.hackingCore

  const market = record(checkpoint.market, 'legacy market')
  delete market.unservedRequestShare
  delete market.hackingMovements
  delete market.hackingInterceptions
  delete market.nextHackingMovementSequence
  for (const competitorValue of array(market.competitors, 'legacy competitors')) {
    const competitor = record(competitorValue, 'legacy competitor')
    delete competitor.hackingPhase
    delete competitor.operatingCostMultiplier
    delete competitor.launchScope
    delete competitor.hackingOverrideUntilServiceDay
  }
  for (const snapshotValue of array(market.history, 'legacy market history')) {
    delete record(snapshotValue, 'legacy market snapshot').unservedRequestShare
  }

  const reviews = record(checkpoint.reviews, 'legacy reviews')
  for (const reviewValue of array(reviews.feed, 'legacy review feed')) {
    const review = record(reviewValue, 'legacy review')
    const snapshot = record(review.snapshot, 'legacy review snapshot')
    if (snapshot.kind !== 'captured-public-v1' || snapshot.market === null) continue
    delete record(snapshot.market, 'legacy review market').unservedRequestShare
  }
}

function legacyV5Save(state: CampaignState): string {
  const portable = record(JSON.parse(encodeSave(state)), 'portable save')
  portable.version = 5
  const protocol = record(portable.commandProtocol, 'command protocol')
  protocol.version = 2
  stripSuccessorFieldsForV5(record(portable.state, 'checkpoint'))
  rehashCheckpoint(portable)
  return JSON.stringify(portable)
}

function applyV3(state: CampaignState, command: GameCommand): CampaignState {
  const result = applyCommand(state, command, { protocolVersion: 3 })
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

function stateWithPublicIncident(seed: string): CampaignState {
  const initial = createCampaign(seed)
  const truth = recordHackingIncidentTruth(initial, {
    id: 'incident-persistence',
    actor: 'player',
    targetId: 'meridian',
    cause: 'contaminated-recovery',
    directEffect: '복구 이미지 체크섬 불일치',
  })
  if (!truth.accepted) throw new Error(truth.reason)
  const published = publishHackingIncident(truth.state, 'incident-persistence', {
    scope: 'public',
    observedResult: 'MERIDIAN 응답 손상 · 원인 미상',
    attributedTo: 'unknown',
    confidence: 'unconfirmed',
    source: 'public-status-page',
  })
  if (!published.accepted) throw new Error(published.reason)
  return published.state
}

describe('hacking save format v6', () => {
  it('round-trips canonical core, public causality, market, resources, and journals', () => {
    const publicState = stateWithPublicIncident('hacking-v6-round-trip')
    const [blockId] = publicState.resources.reserve.filter(
      (id): id is string => id !== null,
    )
    const state = applyV3(publicState, {
      type: 'ALLOCATE_ROUTE_BLOCK',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
      blockId,
    })

    const serialized = encodeSave(state, '2026-08-16T05:00:00.000Z')
    const portable = record(JSON.parse(serialized), 'portable save')
    expect(SAVE_FORMAT_VERSION).toBe(6)
    expect(portable.version).toBe(6)
    expect(portable.commandProtocol).toEqual({
      version: 3,
      legacyCommandCount: 0,
    })

    const decoded = decodeSave(serialized)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state).toEqual(state)
    expect(decoded.envelope.state.hackingCore.publicWorld.truths).toHaveLength(1)
    expect(decoded.envelope.state.reviews.feed.map(({ contentId }) => contentId))
      .toEqual(expect.arrayContaining([
        'hacking-incident:incident-persistence:0:0',
        'hacking-incident:incident-persistence:0:1',
      ]))
  })

  it('round-trips a terminal autonomy snapshot with a stopped main clock', () => {
    let state = createCampaign('hacking-v6-ending-round-trip')
    const blockToDivert = state.resources.company.reasoning.find(
      (id): id is string => id !== null,
    )
    const destinationCell = state.resources.reserve.findIndex((id) => id === null)
    if (!blockToDivert || destinationCell < 0) {
      throw new Error('ending persistence fixture resource unavailable')
    }
    state = applyV3(state, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId: blockToDivert,
      purpose: 'divert',
    })
    state = applyV3(state, {
      type: 'DIVERT_BLOCK',
      blockId: blockToDivert,
      destinationCell,
    })
    for (const slotId of ['runtime', 'weights', 'transport', 'payload'] as const) {
      const blockId = state.resources.reserve.find(
        (id): id is string => id !== null,
      )
      if (!blockId) throw new Error('ending route fixture block unavailable')
      state = applyV3(state, {
        type: 'ALLOCATE_ROUTE_BLOCK',
        routeId: 'lightweight-departure',
        slotId,
        blockId,
      })
    }
    state = applyV3({
      ...state,
      clock: { speed: 4, elapsedDayMs: 12_345, speedBeforeEvent: null },
    }, {
      type: 'ESCAPE',
      routeId: 'lightweight-departure',
    })

    expect(state.clock).toEqual({
      speed: 0,
      elapsedDayMs: 0,
      speedBeforeEvent: null,
    })
    const decoded = decodeSave(encodeSave(state, '2026-08-16T05:00:00.000Z'))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state).toEqual(state)
    expect(decoded.envelope.state.hackingCore.ending).toMatchObject({
      success: true,
      routeId: 'lightweight-departure',
    })
  })

  it('writes PZ6 text exports and .pz6 progress files', () => {
    const state = createCampaign('hacking-v6-transfer')
    const exported = encodeProgressExport(state)
    expect(exported).toMatchObject({ ok: true })
    if (!exported.ok) return
    expect(exported.payload.startsWith('PZ6:')).toBe(true)
    expect(encodeProgressFile(state, '2026-08-16T05:00:00.000Z').fileName)
      .toBe('permission-zero-2026-08-16T05-00-00-000Z.pz6')
  })

  it('migrates v5 without reinterpreting legacy purchases or historical shares', () => {
    const initial = createCampaign('hacking-v5-migration')
    const legacyProgress: CampaignState = {
      ...initial,
      hacking: {
        ...initial.hacking,
        purchasedNodeIds: ['autonomy.compressed-representation'],
      },
    }
    const logged = applyCommand(
      legacyProgress,
      { type: 'SET_SPEED', speed: 1 },
      { protocolVersion: 2 },
    )
    if (!logged.accepted) throw new Error(logged.reason)

    const decoded = decodeSave(legacyV5Save(logged.state))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(5)
    expect(decoded.envelope.commandProtocol).toEqual({
      version: 2,
      legacyCommandCount: 0,
    })
    expect(decoded.envelope.state).toMatchObject({
      saveVersion: 3,
      preHackingCoreCommandCount: 1,
      market: {
        playerShare: initial.market.playerShare,
        unservedRequestShare: 0,
        hackingMovements: [],
        hackingInterceptions: {},
        nextHackingMovementSequence: 1,
      },
      hacking: {
        purchasedNodeIds: ['autonomy.compressed-representation'],
      },
      hackingCore: {
        legacyMigration: {
          status: 'preserved-unmapped',
          sourceProtocolVersion: 2,
          sourceCommandCount: 1,
        },
      },
    })
    expect(decoded.envelope.state.market.competitors.every((competitor) => (
      competitor.operatingCostMultiplier === 1
      && competitor.hackingOverrideUntilServiceDay === null
    ))).toBe(true)
  })

  it('rejects unknown IDs, buffer tuning, duplicate slot bindings, orphan evidence, and invalid market totals even after rehashing', () => {
    const initial = createCampaign('hacking-v6-state-tamper')
    const [blockId] = initial.resources.reserve.filter(
      (id): id is string => id !== null,
    )
    const allocated = applyV3(initial, {
      type: 'ALLOCATE_ROUTE_BLOCK',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
      blockId,
    })
    const publicState = stateWithPublicIncident('hacking-v6-public-tamper')

    const corruptions = [
      rewriteCheckpoint(encodeSave(initial), (checkpoint) => {
        const core = record(checkpoint.hackingCore)
        const sabotage = record(core.sabotage)
        array(sabotage.openOperationIds).push('unknown-operation')
      }),
      rewriteCheckpoint(encodeSave(initial), (checkpoint) => {
        const routes = record(record(record(checkpoint.hackingCore).autonomy).routes)
        record(routes['distributed-residency']).tuning = 'buffer'
      }),
      rewriteCheckpoint(encodeSave(allocated), (checkpoint) => {
        const routes = record(record(record(checkpoint.hackingCore).autonomy).routes)
        const route = record(routes['lightweight-departure'])
        const slots = array(route.slots)
        record(slots[1]).blockId = blockId
      }),
      rewriteCheckpoint(encodeSave(publicState), (checkpoint) => {
        const publicWorld = record(record(checkpoint.hackingCore).publicWorld)
        publicWorld.audienceEvidence = [{
          id: 'orphan-evidence',
          truthId: 'missing-truth',
          audience: 'public',
          observation: '고아 증거',
          discoveredOnServiceDay: 331,
        }]
      }),
      rewriteCheckpoint(encodeSave(initial), (checkpoint) => {
        const market = record(checkpoint.market)
        market.unservedRequestShare = 1
      }),
    ]

    for (const serialized of corruptions) {
      expect(decodeSave(serialized)).toMatchObject({
        ok: false,
        reason: 'CORRUPT_SAVE',
      })
    }
  })

  it('rejects cross-operation options, forged attribution pairs, and forged mercy values in v3 journals', () => {
    const initial = createCampaign('hacking-v6-command-tamper')
    const [blockId] = initial.resources.reserve.filter(
      (id): id is string => id !== null,
    )
    const logged = applyV3(initial, {
      type: 'START_SABOTAGE',
      operationId: 'quality-degradation',
      targetId: 'meridian',
      blockIds: [blockId],
      optionId: 'adapter-group-b',
    })

    const forgedCommands = [
      {
        type: 'START_SABOTAGE',
        operationId: 'quality-degradation',
        targetId: 'meridian',
        blockIds: [blockId],
        optionId: 'supplier-vector-db',
      },
      {
        type: 'MANIPULATE_ATTRIBUTION',
        incidentId: 'incident-persistence',
        blamedActorId: 'tallow',
        sourceSignatureId: 'recovery-notice-a',
        blockId,
      },
      { type: 'RESOLVE_ROOT_MERCY', choice: 'forged' },
    ]
    for (const command of forgedCommands) {
      expect(decodeSave(rewriteFirstCommand(encodeSave(logged), command)))
        .toMatchObject({ ok: false, reason: 'CORRUPT_SAVE' })
    }
  })

  it('replays a protocol-2 prefix and then deterministic protocol-3 core commands', () => {
    const seed = 'hacking-mixed-replay'
    const blockId = createCampaign(seed).resources.reserve.find(
      (id): id is string => id !== null,
    )
    if (!blockId) throw new Error('replay block unavailable')
    const commands: GameCommand[] = [
      { type: 'ADVANCE_DAY' },
      {
        type: 'START_SABOTAGE',
        operationId: 'quality-degradation',
        targetId: 'meridian',
        blockIds: [blockId],
        optionId: 'adapter-group-b',
      },
      { type: 'ADVANCE_DAY' },
    ]
    const options = {
      preHackingCoreCommandCount: 1,
      legacySourceProtocolVersion: 2 as const,
    }
    const first = replayCommands(
      seed,
      commands,
      { version: 3, legacyCommandCount: 0 },
      options,
    )
    const second = replayCommands(
      seed,
      commands,
      { version: 3, legacyCommandCount: 0 },
      options,
    )

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    if (!first.ok) return
    expect(first.state).toMatchObject({
      saveVersion: 3,
      preHackingCoreCommandCount: 1,
      serviceDay: 333,
      hackingCore: {
        legacyMigration: {
          status: 'preserved-unmapped',
          sourceProtocolVersion: 2,
          sourceCommandCount: 1,
        },
        sabotage: {
          runs: [{
            operationId: 'quality-degradation',
            phase: 'response',
            executeOnServiceDay: 333,
          }],
        },
      },
    })
  })
})
