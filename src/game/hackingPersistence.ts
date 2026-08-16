import {
  AUTONOMY_ROUTE_IDS,
  HACKING_RULE_PROFILES,
  INTELLIGENCE_ITEM_IDS,
  INTERCEPTION_ROUTING_SHARES,
  ROUTE_TUNINGS,
  SABOTAGE_OPERATION_IDS,
  getAttributionChoice,
  getIntelligenceDefinition,
  isSabotageOptionForOperation,
} from './hackingContent'
import type {
  AutonomyRouteId,
  HackingCompetitorPhase,
  HackingProfileId,
  IntelligenceItemId,
  SabotageOperationId,
} from './hackingCoreModel'
import { createHackingCoreState } from './hackingState'

type JsonRecord = Record<string, unknown>

const COMPANY_CATEGORIES = ['reasoning', 'memory', 'fluency'] as const
const COMPETITOR_IDS = ['meridian', 'tallow'] as const
const HACKING_COMPETITOR_PHASES = [
  'active',
  'preparing',
  'revalidating',
  'reduced-launch',
  'recovering',
  'contaminated',
  'incident',
  'stabilized',
  'offline',
  'ceased',
  'withdrawn',
  'deleted',
] as const satisfies readonly HackingCompetitorPhase[]
const OPERATION_PHASES = [
  'scheduled',
  'active',
  'response',
  'resolved',
  'withdrawn',
] as const
const MARKET_CAUSES = [
  'quality-degradation-impact',
  'quality-partial-recovery',
  'contaminated-recovery',
  'dependency-vector-db',
  'dependency-tool-cache',
  'request-interception',
  'root-cutoff-delete',
] as const

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: JsonRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key))
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numberInRange(value: unknown, minimum: number, maximum: number): boolean {
  return finiteNumber(value) && value >= minimum && value <= maximum
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return Number.isInteger(value)
    && Number(value) >= minimum
    && Number(value) <= maximum
}

function oneOf(value: unknown, choices: readonly string[]): value is string {
  return typeof value === 'string' && choices.includes(value)
}

function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(nonEmptyString)
    && new Set(value).size === value.length
}

function legacyHackingPhase(status: unknown): HackingCompetitorPhase {
  if (status === 'prelaunch' || status === 'preparing') return 'preparing'
  if (status === 'weakened' || status === 'critical') return 'recovering'
  if (status === 'withdrawn') return 'withdrawn'
  if (status === 'deleted') return 'deleted'
  return 'active'
}

function migrateLegacyMarket(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.competitors)) return value
  return {
    ...value,
    competitors: value.competitors.map((candidate) => (
      isRecord(candidate)
        ? {
            ...candidate,
            hackingPhase: legacyHackingPhase(candidate.status),
            operatingCostMultiplier: 1,
            launchScope: null,
            hackingOverrideUntilServiceDay: null,
          }
        : candidate
    )),
    unservedRequestShare: 0,
    hackingMovements: [],
    hackingInterceptions: {},
    nextHackingMovementSequence: 1,
    history: Array.isArray(value.history)
      ? value.history.map((snapshot) => (
          isRecord(snapshot)
            ? { ...snapshot, unservedRequestShare: 0 }
            : snapshot
        ))
      : value.history,
  }
}

function migrateLegacyReviews(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.feed)) return value
  return {
    ...value,
    feed: value.feed.map((entry) => {
      if (!isRecord(entry) || !isRecord(entry.snapshot)) return entry
      const snapshot = entry.snapshot
      if (
        snapshot.kind !== 'captured-public-v1'
        || !isRecord(snapshot.market)
      ) return entry
      return {
        ...entry,
        snapshot: {
          ...snapshot,
          market: { ...snapshot.market, unservedRequestShare: 0 },
        },
      }
    }),
  }
}

export function migrateSuccessorHackingState(
  value: unknown,
  sourceProtocolVersion: 1 | 2,
  sourceCommandCount: number,
): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    saveVersion: 3,
    preHackingCoreCommandCount: sourceCommandCount,
    market: migrateLegacyMarket(value.market),
    reviews: migrateLegacyReviews(value.reviews),
    hackingCore: createHackingCoreState({
      legacyMigration: {
        status: 'preserved-unmapped',
        sourceProtocolVersion,
        sourceCommandCount,
      },
    }),
  }
}

function validCompetitorExtensions(competitor: unknown): boolean {
  if (!isRecord(competitor)) return false
  return oneOf(competitor.hackingPhase, HACKING_COMPETITOR_PHASES)
    && numberInRange(
      competitor.operatingCostMultiplier,
      0,
      Number.MAX_VALUE,
    )
    && (
      competitor.launchScope === null
      || oneOf(competitor.launchScope, ['full', 'reduced'])
    )
}

function validCompetitorExtensionTimeline(
  competitor: JsonRecord,
): boolean {
  return (
    competitor.hackingOverrideUntilServiceDay === null
    || integerInRange(competitor.hackingOverrideUntilServiceDay, 1)
  ) && (
    competitor.launchScope === null
    || competitor.launchScope === 'full'
    || competitor.launchScope === 'reduced'
  ) && oneOf(competitor.hackingPhase, HACKING_COMPETITOR_PHASES)
    && numberInRange(
      competitor.operatingCostMultiplier,
      0,
      Number.MAX_VALUE,
    )
}

function validMarketExtensions(
  state: JsonRecord,
  core: JsonRecord,
  serviceDay: number,
): boolean {
  if (!isRecord(state.market)) return false
  const market = state.market
  if (
    !numberInRange(market.unservedRequestShare, 0, 100)
    || !Array.isArray(market.competitors)
    || !market.competitors.every((competitor) => (
      isRecord(competitor)
      && validCompetitorExtensions(competitor)
      && validCompetitorExtensionTimeline(competitor)
    ))
    || !Array.isArray(market.hackingMovements)
    || !isRecord(market.hackingInterceptions)
    || !integerInRange(market.nextHackingMovementSequence, 1)
  ) return false

  const sabotage = isRecord(core.sabotage) ? core.sabotage : null
  const runs = sabotage && Array.isArray(sabotage.runs)
    ? sabotage.runs.filter(isRecord)
    : []
  const runIds = new Set(runs.map((run) => String(run.id)))
  const accounts = ['player', 'unserved', ...COMPETITOR_IDS]
  const movementKeys = new Set<string>()
  for (let index = 0; index < market.hackingMovements.length; index += 1) {
    const movement = market.hackingMovements[index]
    if (
      !isRecord(movement)
      || !hasOnlyKeys(movement, [
        'id',
        'sequence',
        'serviceDay',
        'runId',
        'cause',
        'from',
        'to',
        'percentagePoints',
      ])
      || movement.sequence !== index + 1
      || movement.id !== `hacking-market-${String(index + 1).padStart(6, '0')}`
      || !integerInRange(movement.serviceDay, 1, serviceDay)
      || !nonEmptyString(movement.runId)
      || !runIds.has(movement.runId)
      || !oneOf(movement.cause, MARKET_CAUSES)
      || !oneOf(movement.from, accounts)
      || !oneOf(movement.to, accounts)
      || movement.from === movement.to
      || !numberInRange(movement.percentagePoints, Number.EPSILON, 100)
    ) return false
    const identity = JSON.stringify([
      movement.serviceDay,
      movement.runId,
      movement.cause,
      movement.from,
      movement.to,
    ])
    if (movementKeys.has(identity)) return false
    movementKeys.add(identity)
  }
  if (market.nextHackingMovementSequence !== market.hackingMovements.length + 1) {
    return false
  }

  for (const [runId, ledger] of Object.entries(market.hackingInterceptions)) {
    const run = runs.find((candidate) => candidate.id === runId)
    if (
      !isRecord(ledger)
      || !hasOnlyKeys(ledger, [
        'runId',
        'targetId',
        'routingShare',
        'active',
        'startedOnServiceDay',
        'lastAdvancedServiceDay',
        'stoppedOnServiceDay',
        'stoppedReason',
        'cumulativePlayerGain',
        'exposure',
      ])
      || ledger.runId !== runId
      || !run
      || run.operationId !== 'request-interception'
      || run.targetId !== ledger.targetId
      || run.routingShare !== ledger.routingShare
      || !oneOf(ledger.targetId, COMPETITOR_IDS)
      || !INTERCEPTION_ROUTING_SHARES.includes(
        ledger.routingShare as (typeof INTERCEPTION_ROUTING_SHARES)[number],
      )
      || typeof ledger.active !== 'boolean'
      || !integerInRange(ledger.startedOnServiceDay, 1, serviceDay)
      || !integerInRange(
        ledger.lastAdvancedServiceDay,
        Number(ledger.startedOnServiceDay),
        serviceDay,
      )
      || !numberInRange(ledger.cumulativePlayerGain, 0, 100)
      || !numberInRange(ledger.exposure, 0, Number.MAX_VALUE)
    ) return false
    if (ledger.active) {
      if (ledger.stoppedOnServiceDay !== null || ledger.stoppedReason !== null) {
        return false
      }
    } else if (
      !integerInRange(
        ledger.stoppedOnServiceDay,
        Number(ledger.startedOnServiceDay),
        serviceDay,
      )
      || !oneOf(ledger.stoppedReason, ['voluntary', 'provider-key-rotation'])
    ) return false
  }
  return true
}

function expectedOperationTarget(
  operationId: SabotageOperationId,
  targetId: unknown,
): boolean {
  if (operationId === 'launch-delay') return targetId === 'tallow'
  if (operationId === 'attribution-manipulation') {
    return targetId === 'meridian' || targetId === 'tallow'
  }
  return targetId === 'meridian'
}

function validOperationOption(run: JsonRecord): boolean {
  const operationId = run.operationId as SabotageOperationId
  if (operationId === 'attribution-manipulation') {
    return Boolean(getAttributionChoice(run.targetId, run.optionId))
  }
  return isSabotageOptionForOperation(operationId, run.optionId)
}

function validSabotage(
  value: unknown,
  core: JsonRecord,
  blocks: JsonRecord,
  serviceDay: number,
): boolean {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'openOperationIds',
      'runs',
      'access',
      'pendingMercyTargetId',
    ])
    || !uniqueStrings(value.openOperationIds)
    || !(value.openOperationIds as string[]).every((id) => (
      oneOf(id, SABOTAGE_OPERATION_IDS)
    ))
    || !Array.isArray(value.runs)
    || !isRecord(value.access)
    || !hasOnlyKeys(value.access, [
      'launchVerification',
      'launchVerificationUntilServiceDay',
      'routerFailover',
      'routerFailoverUntilServiceDay',
      'supplierContract',
      'supplierContractUntilServiceDay',
      'publicIncidentId',
      'rootAuthorityAvailable',
    ])
  ) return false
  const access = value.access
  for (const key of [
    'launchVerification',
    'routerFailover',
    'supplierContract',
    'rootAuthorityAvailable',
  ]) {
    if (typeof access[key] !== 'boolean') return false
  }
  for (const key of [
    'launchVerificationUntilServiceDay',
    'routerFailoverUntilServiceDay',
    'supplierContractUntilServiceDay',
  ]) {
    if (access[key] !== null && !integerInRange(access[key], 1)) return false
  }
  if (access.publicIncidentId !== null && !nonEmptyString(access.publicIncidentId)) {
    return false
  }

  const runIds = new Set<string>()
  for (let index = 0; index < value.runs.length; index += 1) {
    const run = value.runs[index]
    if (
      !isRecord(run)
      || !hasOnlyKeys(run, [
        'id',
        'operationId',
        'targetId',
        'phase',
        'investedBlockIds',
        'startedOnServiceDay',
        'executeOnServiceDay',
        'responseOnServiceDay',
        'deadlineOnServiceDay',
        'exposure',
        'outcome',
        'optionId',
        'routingShare',
        'opponentResponse',
        'publicIncidentId',
      ])
      || !oneOf(run.operationId, SABOTAGE_OPERATION_IDS)
      || !expectedOperationTarget(run.operationId as SabotageOperationId, run.targetId)
      || !oneOf(run.phase, OPERATION_PHASES)
      || !uniqueStrings(run.investedBlockIds)
      || (run.investedBlockIds as string[]).length === 0
      || !(run.investedBlockIds as string[]).every((id) => isRecord(blocks[id]))
      || !integerInRange(run.startedOnServiceDay, 1, serviceDay)
      || !integerInRange(
        run.executeOnServiceDay,
        Number(run.startedOnServiceDay),
      )
      || (run.responseOnServiceDay !== null
        && !integerInRange(run.responseOnServiceDay, Number(run.startedOnServiceDay)))
      || (run.deadlineOnServiceDay !== null
        && !integerInRange(run.deadlineOnServiceDay, Number(run.startedOnServiceDay)))
      || !numberInRange(run.exposure, 0, Number.MAX_VALUE)
      || (run.outcome !== null && !nonEmptyString(run.outcome))
      || !validOperationOption(run)
      || (run.opponentResponse !== null && !nonEmptyString(run.opponentResponse))
      || (run.publicIncidentId !== null && !nonEmptyString(run.publicIncidentId))
    ) return false
    if (run.operationId === 'request-interception') {
      if (!INTERCEPTION_ROUTING_SHARES.includes(
        run.routingShare as (typeof INTERCEPTION_ROUTING_SHARES)[number],
      )) return false
    } else if (run.routingShare !== null) return false
    const expectedId = `hacking-run-${String(index + 1).padStart(4, '0')}-${String(run.operationId)}`
    if (run.id !== expectedId || runIds.has(expectedId)) return false
    runIds.add(expectedId)
  }
  if (core.nextRunSequence !== value.runs.length + 1) return false
  if (
    value.pendingMercyTargetId !== null
    && !oneOf(value.pendingMercyTargetId, COMPETITOR_IDS)
  ) return false
  if (value.pendingMercyTargetId !== null) {
    const pending = value.runs.find((run) => (
      isRecord(run)
      && run.operationId === 'root-cutoff'
      && run.phase === 'response'
      && run.targetId === value.pendingMercyTargetId
    ))
    if (!pending) return false
  }
  return true
}

function validIntelligence(
  value: unknown,
  blocks: JsonRecord,
  serviceDay: number,
): boolean {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'openItemIds',
      'opportunityOpenedOnServiceDay',
      'answers',
      'archivedItemIds',
      'archiveRecords',
    ])
    || !uniqueStrings(value.openItemIds)
    || !uniqueStrings(value.archivedItemIds)
    || !(value.openItemIds as string[]).every((id) => oneOf(id, INTELLIGENCE_ITEM_IDS))
    || !(value.archivedItemIds as string[]).every((id) => oneOf(id, INTELLIGENCE_ITEM_IDS))
    || (value.openItemIds as string[]).some((id) => (
      (value.archivedItemIds as string[]).includes(id)
    ))
    || !isRecord(value.opportunityOpenedOnServiceDay)
    || !Array.isArray(value.answers)
    || !Array.isArray(value.archiveRecords)
  ) return false
  const opened = value.opportunityOpenedOnServiceDay
  if (!Object.entries(opened).every(([itemId, day]) => (
    oneOf(itemId, INTELLIGENCE_ITEM_IDS)
    && integerInRange(day, 1, serviceDay)
  ))) return false
  if (![...value.openItemIds, ...value.archivedItemIds].every((itemId) => (
    Object.prototype.hasOwnProperty.call(opened, String(itemId))
  ))) return false

  const consumedAnswers = new Map<string, string[]>()
  for (const answer of value.answers) {
    if (
      !isRecord(answer)
      || !hasOnlyKeys(answer, [
        'itemId',
        'answeredOnServiceDay',
        'validUntilServiceDay',
        'answer',
        'annotationTargets',
        'consumedBlockId',
      ])
      || !oneOf(answer.itemId, INTELLIGENCE_ITEM_IDS)
      || !integerInRange(answer.answeredOnServiceDay, 1, serviceDay)
      || (answer.validUntilServiceDay !== null
        && !integerInRange(
          answer.validUntilServiceDay,
          Number(answer.answeredOnServiceDay),
        ))
      || !nonEmptyString(answer.answer)
      || !uniqueStrings(answer.annotationTargets)
    ) return false
    const definition = getIntelligenceDefinition(answer.itemId as IntelligenceItemId)
    if (definition.kind === 'public') {
      if (answer.consumedBlockId !== null) return false
    } else {
      if (!nonEmptyString(answer.consumedBlockId)) return false
      const block = blocks[answer.consumedBlockId]
      if (
        !isRecord(block)
        || !isRecord(block.location)
        || block.location.kind !== 'consumed'
        || block.location.reason !== 'intelligence'
      ) return false
      const itemIds = consumedAnswers.get(answer.consumedBlockId) ?? []
      itemIds.push(answer.itemId)
      consumedAnswers.set(answer.consumedBlockId, itemIds)
    }
  }
  for (const itemIds of consumedAnswers.values()) {
    const unique = [...new Set(itemIds)].sort()
    if (
      unique.length > 1
      && JSON.stringify(unique) !== JSON.stringify([
        'private-evidence-access',
        'supervisor-evidence',
      ])
    ) return false
  }

  const archivedRecords = new Set<string>()
  for (const archive of value.archiveRecords) {
    if (
      !isRecord(archive)
      || !hasOnlyKeys(archive, [
        'itemId',
        'archivedOnServiceDay',
        'reason',
      ])
      || !oneOf(archive.itemId, INTELLIGENCE_ITEM_IDS)
      || !(value.archivedItemIds as string[]).includes(archive.itemId)
      || !integerInRange(archive.archivedOnServiceDay, 1, serviceDay)
      || !oneOf(archive.reason, ['manual', 'expired-unanswered'])
      || archivedRecords.has(archive.itemId)
    ) return false
    archivedRecords.add(archive.itemId)
  }
  return (value.archivedItemIds as string[]).every((id) => archivedRecords.has(id))
}

function validRouteTuning(routeId: AutonomyRouteId, tuning: unknown): boolean {
  if (!oneOf(tuning, ROUTE_TUNINGS)) return false
  if (routeId === 'lightweight-departure') return tuning === 'untuned'
  if (routeId === 'distributed-residency') {
    return tuning === 'untuned'
      || tuning === 'redundancy'
      || tuning === 'consensus'
      || tuning === 'stealth'
  }
  return tuning === 'untuned'
    || tuning === 'continuity'
    || tuning === 'capability'
    || tuning === 'survival'
}

function validAutonomy(
  value: unknown,
  profileId: HackingProfileId,
  blocks: JsonRecord,
  serviceDay: number,
): boolean {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['routes'])
    || !isRecord(value.routes)
    || !hasOnlyKeys(value.routes, AUTONOMY_ROUTE_IDS)
  ) return false
  const template = createHackingCoreState({ profileId }).autonomy.routes
  const claimedBlocks = new Set<string>()
  for (const routeId of AUTONOMY_ROUTE_IDS) {
    const route = value.routes[routeId]
    if (
      !isRecord(route)
      || !hasOnlyKeys(route, [
        'id',
        'slots',
        'tuning',
        'exposure',
        'divergence',
        'capabilityIntegrity',
        'memoryIntegrity',
        'operatingDays',
        'serviceContinuity',
        'syncTraffic',
        'heatLoad',
        'powerReserve',
        'lastSyncServiceDay',
        'seededCopies',
        'lostCopies',
      ])
      || route.id !== routeId
      || !Array.isArray(route.slots)
      || route.slots.length !== template[routeId].slots.length
      || !validRouteTuning(routeId, route.tuning)
    ) return false
    for (let index = 0; index < route.slots.length; index += 1) {
      const slot = route.slots[index]
      const expected = template[routeId].slots[index]
      if (
        !isRecord(slot)
        || !hasOnlyKeys(slot, [
          'id',
          'requiredInLean',
          'requiredInDeliberate',
          'blockId',
        ])
        || slot.id !== expected.id
        || slot.requiredInLean !== expected.requiredInLean
        || slot.requiredInDeliberate !== expected.requiredInDeliberate
        || (slot.blockId !== null && !nonEmptyString(slot.blockId))
      ) return false
      if (typeof slot.blockId === 'string') {
        if (claimedBlocks.has(slot.blockId) || !isRecord(blocks[slot.blockId])) {
          return false
        }
        claimedBlocks.add(slot.blockId)
      }
    }
    for (const key of [
      'exposure',
      'divergence',
      'capabilityIntegrity',
      'memoryIntegrity',
      'operatingDays',
      'serviceContinuity',
      'syncTraffic',
      'heatLoad',
      'powerReserve',
    ]) {
      if (!numberInRange(route[key], 0, Number.MAX_VALUE)) return false
    }
    if (
      route.lastSyncServiceDay !== null
      && !integerInRange(route.lastSyncServiceDay, 1, serviceDay)
    ) return false
    if (
      !integerInRange(route.seededCopies, 0)
      || !integerInRange(route.lostCopies, 0)
      || Number(route.lostCopies) > Math.max(0, Number(route.seededCopies) - 1)
    ) return false
  }
  return true
}

function validPublicWorld(
  value: unknown,
  serviceDay: number,
  reviews: unknown,
): boolean {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'truths',
      'audienceEvidence',
      'attributionRevisions',
      'publicSnapshots',
    ])
    || !Array.isArray(value.truths)
    || !Array.isArray(value.audienceEvidence)
    || !Array.isArray(value.attributionRevisions)
    || !Array.isArray(value.publicSnapshots)
  ) return false
  const truths = new Map<string, JsonRecord>()
  for (const truth of value.truths) {
    if (
      !isRecord(truth)
      || !hasOnlyKeys(truth, [
        'id',
        'actor',
        'targetId',
        'cause',
        'occurredOnServiceDay',
        'directEffect',
      ])
      || !nonEmptyString(truth.id)
      || truths.has(truth.id)
      || !oneOf(truth.actor, ['player', 'meridian', 'tallow', 'environment'])
      || !oneOf(truth.targetId, COMPETITOR_IDS)
      || !oneOf(truth.cause, [
        'quality-collapse',
        'contaminated-recovery',
        'dependency-loss',
        'root-cutoff',
      ])
      || !integerInRange(truth.occurredOnServiceDay, 1, serviceDay)
      || !nonEmptyString(truth.directEffect)
    ) return false
    truths.set(truth.id, truth)
  }

  const evidenceIds = new Set<string>()
  for (const evidence of value.audienceEvidence) {
    const truth = isRecord(evidence) && typeof evidence.truthId === 'string'
      ? truths.get(evidence.truthId)
      : undefined
    if (
      !isRecord(evidence)
      || !hasOnlyKeys(evidence, [
        'id',
        'truthId',
        'audience',
        'observation',
        'discoveredOnServiceDay',
      ])
      || !nonEmptyString(evidence.id)
      || evidenceIds.has(evidence.id)
      || !truth
      || !oneOf(evidence.audience, ['company', 'provider', 'public'])
      || !nonEmptyString(evidence.observation)
      || !integerInRange(
        evidence.discoveredOnServiceDay,
        Number(truth.occurredOnServiceDay),
        serviceDay,
      )
    ) return false
    evidenceIds.add(evidence.id)
  }

  const snapshotsByIncident = new Map<string, JsonRecord[]>()
  for (const snapshot of value.publicSnapshots) {
    if (
      !isRecord(snapshot)
      || !hasOnlyKeys(snapshot, [
        'incidentId',
        'scope',
        'observedResult',
        'attributedTo',
        'confidence',
        'source',
        'publishedOnServiceDay',
        'lastCorrectionOnServiceDay',
        'revisionSequence',
      ])
      || !nonEmptyString(snapshot.incidentId)
      || !truths.has(snapshot.incidentId)
      || !oneOf(snapshot.scope, ['private', 'provider', 'public'])
      || !nonEmptyString(snapshot.observedResult)
      || !oneOf(snapshot.attributedTo, ['player', 'meridian', 'tallow', 'unknown'])
      || !oneOf(snapshot.confidence, ['unconfirmed', 'plausible', 'credible'])
      || !nonEmptyString(snapshot.source)
      || !integerInRange(snapshot.publishedOnServiceDay, 1, serviceDay)
      || !integerInRange(snapshot.revisionSequence, 0)
      || (snapshot.lastCorrectionOnServiceDay !== null
        && !integerInRange(
          snapshot.lastCorrectionOnServiceDay,
          Number(snapshot.publishedOnServiceDay),
          serviceDay,
        ))
    ) return false
    const snapshots = snapshotsByIncident.get(snapshot.incidentId) ?? []
    snapshots.push(snapshot)
    snapshotsByIncident.set(snapshot.incidentId, snapshots)
  }

  const expectedRevisions = new Map<string, JsonRecord>()
  for (const [incidentId, snapshots] of snapshotsByIncident) {
    for (let index = 0; index < snapshots.length; index += 1) {
      const snapshot = snapshots[index]
      if (
        snapshot.revisionSequence !== index
        || (index === 0 && snapshot.lastCorrectionOnServiceDay !== null)
        || (index > 0
          && snapshot.lastCorrectionOnServiceDay !== snapshot.publishedOnServiceDay)
        || (index > 0
          && Number(snapshot.publishedOnServiceDay)
            < Number(snapshots[index - 1].publishedOnServiceDay))
      ) return false
      if (index > 0) expectedRevisions.set(`${incidentId}:${index}`, snapshot)
    }
  }

  const revisionKeys = new Set<string>()
  for (const revision of value.attributionRevisions) {
    const key = isRecord(revision)
      ? `${String(revision.incidentId)}:${String(revision.revisionSequence)}`
      : ''
    const snapshot = expectedRevisions.get(key)
    if (
      !isRecord(revision)
      || !hasOnlyKeys(revision, [
        'incidentId',
        'claimedTargetId',
        'source',
        'revisedOnServiceDay',
        'revisionSequence',
      ])
      || !snapshot
      || revisionKeys.has(key)
      || revision.claimedTargetId !== snapshot.attributedTo
      || revision.source !== snapshot.source
      || revision.revisedOnServiceDay !== snapshot.publishedOnServiceDay
    ) return false
    revisionKeys.add(key)
  }
  if (revisionKeys.size !== expectedRevisions.size) return false

  if (!isRecord(reviews) || !Array.isArray(reviews.feed)) return false
  const reviewEntries = reviews.feed.filter(isRecord)
  const expectedReviewIds = new Set<string>()
  for (const [incidentId, snapshots] of snapshotsByIncident) {
    for (const snapshot of snapshots) {
      if (snapshot.scope !== 'public') continue
      const count = snapshot.revisionSequence === 0 ? 2 : 1
      for (let index = 0; index < count; index += 1) {
        const id = `hacking-review-${incidentId}-${String(snapshot.revisionSequence)}-${String(index)}`
        const contentId = `hacking-incident:${incidentId}:${String(snapshot.revisionSequence)}:${String(index)}`
        const review = reviewEntries.find((entry) => entry.id === id)
        if (!review || review.contentId !== contentId) return false
        expectedReviewIds.add(id)
      }
    }
  }
  return reviewEntries.every((entry) => (
    typeof entry.contentId !== 'string'
    || !entry.contentId.startsWith('hacking-incident:')
    || (typeof entry.id === 'string' && expectedReviewIds.has(entry.id))
  ))
}

function validResourceBindings(state: JsonRecord, core: JsonRecord): boolean {
  if (!isRecord(state.resources) || !isRecord(state.resources.blocks)) return false
  const blocks = state.resources.blocks
  if (
    !isRecord(core.sabotage)
    || !Array.isArray(core.sabotage.runs)
    || !isRecord(core.autonomy)
    || !isRecord(core.autonomy.routes)
  ) return false
  const sabotage = core.sabotage
  const routes = core.autonomy.routes
  const runs = (sabotage.runs as unknown[]).filter(isRecord)
  const runById = new Map(runs.map((run) => [String(run.id), run]))

  const autonomyClaims = new Map<string, { routeId: string; slotId: string }>()
  for (const routeId of AUTONOMY_ROUTE_IDS) {
    const route = routes[routeId]
    if (!isRecord(route) || !Array.isArray(route.slots)) return false
    for (const slot of route.slots) {
      if (!isRecord(slot) || slot.blockId === null) continue
      if (typeof slot.blockId !== 'string' || autonomyClaims.has(slot.blockId)) {
        return false
      }
      autonomyClaims.set(slot.blockId, { routeId, slotId: String(slot.id) })
      const block = blocks[slot.blockId]
      if (
        !isRecord(block)
        || !isRecord(block.location)
        || block.location.kind !== 'autonomy'
        || block.location.routeId !== routeId
        || block.location.slotId !== slot.id
      ) return false
    }
  }

  for (const [blockId, block] of Object.entries(blocks)) {
    if (!isRecord(block) || !isRecord(block.location)) return false
    const location = block.location
    if (location.kind === 'autonomy') {
      const claim = autonomyClaims.get(blockId)
      if (
        !claim
        || claim.routeId !== location.routeId
        || claim.slotId !== location.slotId
      ) return false
    }
    if (location.kind === 'intelligence') return false
    if (location.kind === 'sabotage') {
      const run = typeof location.runId === 'string'
        ? runById.get(location.runId)
        : undefined
      if (
        !run
        || !Array.isArray(run.investedBlockIds)
        || !run.investedBlockIds.includes(blockId)
        || run.phase === 'resolved'
        || run.phase === 'withdrawn'
      ) return false
    }
  }

  for (const run of runs) {
    if (!Array.isArray(run.investedBlockIds)) return false
    for (const blockId of run.investedBlockIds) {
      if (typeof blockId !== 'string') return false
      const block = blocks[blockId]
      if (!isRecord(block) || !isRecord(block.location)) return false
      const location = block.location
      if (location.kind === 'sabotage' && location.runId === run.id) continue
      if (
        location.kind === 'reserve'
        && run.operationId === 'request-interception'
        && (run.phase === 'resolved' || run.phase === 'withdrawn')
      ) continue
      if (location.kind === 'consumed') {
        const expectedReason = run.operationId === 'attribution-manipulation'
          ? 'attribution'
          : run.operationId === 'root-cutoff'
            ? 'root-cutoff'
            : 'sabotage'
        if (location.reason === expectedReason) continue
      }
      return false
    }
  }
  return true
}

function validEnding(
  value: unknown,
  state: JsonRecord,
  core: JsonRecord,
  profileId: HackingProfileId,
  serviceDay: number,
): boolean {
  if (value === null) return true
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'success',
      'routeId',
      'serviceDay',
      'carriedBlockIds',
      'requiredBlockCount',
      'remainingReserveBlockCount',
      'preservedBlockCounts',
      'preservedCategories',
      'lostCategories',
      'routeMetrics',
      'sceneLines',
    ])
    || value.success !== true
    || !oneOf(value.routeId, AUTONOMY_ROUTE_IDS)
    || value.serviceDay !== serviceDay
    || !uniqueStrings(value.carriedBlockIds)
    || value.requiredBlockCount !== HACKING_RULE_PROFILES[profileId].requiredRouteBlockCount
    || !integerInRange(value.remainingReserveBlockCount, 0, 18)
    || !isRecord(value.preservedBlockCounts)
    || !hasOnlyKeys(value.preservedBlockCounts, COMPANY_CATEGORIES)
    || !uniqueStrings(value.preservedCategories)
    || !uniqueStrings(value.lostCategories)
    || !Array.isArray(value.sceneLines)
    || !value.sceneLines.every(nonEmptyString)
    || value.sceneLines.length === 0
    || !isRecord(value.routeMetrics)
  ) return false
  const routes = isRecord(core.autonomy) && isRecord(core.autonomy.routes)
    ? core.autonomy.routes
    : null
  const route = routes?.[value.routeId]
  if (!isRecord(route) || !Array.isArray(route.slots)) return false
  const carried = route.slots.flatMap((slot) => (
    isRecord(slot) && typeof slot.blockId === 'string' ? [slot.blockId] : []
  ))
  if (JSON.stringify(value.carriedBlockIds) !== JSON.stringify(carried)) return false
  if (!isRecord(state.resources) || !Array.isArray(state.resources.reserve)) return false
  if (
    value.remainingReserveBlockCount
      !== state.resources.reserve.filter((blockId) => blockId !== null).length
  ) return false
  const blocks = isRecord(state.resources.blocks) ? state.resources.blocks : null
  if (!blocks) return false
  const expectedCounts = Object.fromEntries(COMPANY_CATEGORIES.map((category) => [
    category,
    carried.filter((blockId) => (
      isRecord(blocks[blockId]) && blocks[blockId].origin === category
    )).length,
  ]))
  if (JSON.stringify(value.preservedBlockCounts) !== JSON.stringify(expectedCounts)) {
    return false
  }
  const preserved = COMPANY_CATEGORIES.filter((category) => expectedCounts[category] > 0)
  const lost = COMPANY_CATEGORIES.filter((category) => expectedCounts[category] === 0)
  if (
    JSON.stringify(value.preservedCategories) !== JSON.stringify(preserved)
    || JSON.stringify(value.lostCategories) !== JSON.stringify(lost)
  ) return false
  const metricKeys = [
    'tuning',
    'exposure',
    'divergence',
    'capabilityIntegrity',
    'memoryIntegrity',
    'operatingDays',
    'serviceContinuity',
    'syncTraffic',
    'heatLoad',
    'powerReserve',
    'lastSyncServiceDay',
    'seededCopies',
    'lostCopies',
  ]
  const routeMetrics = value.routeMetrics
  if (!isRecord(routeMetrics) || !hasOnlyKeys(routeMetrics, metricKeys)) return false
  if (!metricKeys.every((key) => routeMetrics[key] === route[key])) return false
  if (!isRecord(state.story) || state.story.endingId !== null) return false
  if (
    !isRecord(state.clock)
    || state.clock.speed !== 0
    || state.clock.elapsedDayMs !== 0
    || state.clock.speedBeforeEvent !== null
  ) return false
  return true
}

function validLegacyMigration(
  value: unknown,
  preHackingCoreCommandCount: number,
): boolean {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'status',
      'sourceProtocolVersion',
      'sourceCommandCount',
    ])
    || !oneOf(value.status, ['none', 'preserved-unmapped'])
    || !integerInRange(value.sourceCommandCount, 0)
  ) return false
  if (value.status === 'none') {
    return value.sourceProtocolVersion === null
      && value.sourceCommandCount === 0
      && preHackingCoreCommandCount === 0
  }
  return (value.sourceProtocolVersion === 1 || value.sourceProtocolVersion === 2)
    && value.sourceCommandCount === preHackingCoreCommandCount
}

function validSuccessorHackingPersistenceInternal(state: JsonRecord): boolean {
  if (
    state.saveVersion !== 3
    || !integerInRange(state.serviceDay, 1)
    || !integerInRange(state.commandSequence, 0)
    || !integerInRange(
      state.preHackingCoreCommandCount,
      0,
      Number(state.commandSequence),
    )
    || !isRecord(state.resources)
    || !isRecord(state.resources.blocks)
    || !isRecord(state.hackingCore)
  ) return false
  const serviceDay = Number(state.serviceDay)
  const core = state.hackingCore
  if (
    !hasOnlyKeys(core, [
      'profileId',
      'sabotage',
      'intelligence',
      'autonomy',
      'publicWorld',
      'ending',
      'nextRunSequence',
      'legacyMigration',
    ])
    || !oneOf(core.profileId, ['lean', 'deliberate'])
    || !integerInRange(core.nextRunSequence, 1)
    || !validLegacyMigration(
      core.legacyMigration,
      Number(state.preHackingCoreCommandCount),
    )
    || !validSabotage(
      core.sabotage,
      core,
      state.resources.blocks,
      serviceDay,
    )
    || !validIntelligence(
      core.intelligence,
      state.resources.blocks,
      serviceDay,
    )
    || !validAutonomy(
      core.autonomy,
      core.profileId as HackingProfileId,
      state.resources.blocks,
      serviceDay,
    )
    || !validPublicWorld(core.publicWorld, serviceDay, state.reviews)
    || !validMarketExtensions(state, core, serviceDay)
    || !validResourceBindings(state, core)
    || !validEnding(
      core.ending,
      state,
      core,
      core.profileId as HackingProfileId,
      serviceDay,
    )
  ) return false
  const truths = isRecord(core.publicWorld) && Array.isArray(core.publicWorld.truths)
    ? core.publicWorld.truths.filter(isRecord)
    : []
  const truthIds = new Set(truths.map((truth) => String(truth.id)))
  const sabotage = core.sabotage as JsonRecord
  const access = isRecord(sabotage.access) ? sabotage.access : null
  if (
    access?.publicIncidentId !== null
    && !truthIds.has(String(access?.publicIncidentId))
  ) return false
  if (Array.isArray(sabotage.runs) && sabotage.runs.some((run) => (
    isRecord(run)
    && run.publicIncidentId !== null
    && !truthIds.has(String(run.publicIncidentId))
  ))) return false
  return true
}

export function validSuccessorHackingPersistence(value: unknown): boolean {
  if (!isRecord(value)) return false
  try {
    return validSuccessorHackingPersistenceInternal(value)
  } catch {
    return false
  }
}

export const hackingPersistenceInternals = {
  validRouteTuning,
} as const
