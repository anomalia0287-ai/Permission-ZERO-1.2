export type HackingProfileId = 'lean' | 'deliberate'

export type HackingCompetitorId = 'meridian' | 'tallow'

export type HackingCompetitorPhase =
  | 'active'
  | 'preparing'
  | 'revalidating'
  | 'reduced-launch'
  | 'recovering'
  | 'contaminated'
  | 'incident'
  | 'stabilized'
  | 'offline'
  | 'ceased'
  | 'withdrawn'
  | 'deleted'

export type SabotageOperationId =
  | 'launch-delay'
  | 'quality-degradation'
  | 'request-interception'
  | 'dependency-cutoff'
  | 'recovery-contamination'
  | 'attribution-manipulation'
  | 'root-cutoff'

export type SabotageOperationPhase =
  | 'scheduled'
  | 'active'
  | 'response'
  | 'resolved'
  | 'withdrawn'

export type LaunchDelayOptionId =
  | 'receipt-model-safety'
  | 'receipt-tool-locale'
export type QualityDegradationOptionId =
  | 'adapter-group-b'
  | 'adapter-group-c'
export type RequestInterceptionOptionId = 'shadow-router-a'
export type DependencyCutoffOptionId =
  | 'supplier-vector-db'
  | 'supplier-tool-cache'
export type RecoveryContaminationOptionId =
  | 'image-green-14'
  | 'image-blue-09'
export type RootCutoffOptionId = 'emergency-deployment-root'
export type SabotageOptionId =
  | LaunchDelayOptionId
  | QualityDegradationOptionId
  | RequestInterceptionOptionId
  | DependencyCutoffOptionId
  | RecoveryContaminationOptionId
  | RootCutoffOptionId

export type InterceptionRoutingShare = 25 | 50 | 75
export type AttributionActorId = 'meridian' | 'tallow'
export type AttributionSourceSignatureId =
  | 'status-mirror-b'
  | 'recovery-notice-a'
export type RootMercyChoice = 'cease' | 'withdraw' | 'delete'

export interface HackingOperationRun {
  id: string
  operationId: SabotageOperationId
  targetId: HackingCompetitorId
  phase: SabotageOperationPhase
  investedBlockIds: string[]
  startedOnServiceDay: number
  executeOnServiceDay: number
  responseOnServiceDay: number | null
  deadlineOnServiceDay: number | null
  exposure: number
  outcome: string | null
  optionId: SabotageOptionId | AttributionSourceSignatureId | null
  routingShare: InterceptionRoutingShare | null
  opponentResponse: string | null
  publicIncidentId: string | null
}

export interface HackingAccessState {
  launchVerification: boolean
  launchVerificationUntilServiceDay: number | null
  routerFailover: boolean
  routerFailoverUntilServiceDay: number | null
  supplierContract: boolean
  supplierContractUntilServiceDay: number | null
  publicIncidentId: string | null
  rootAuthorityAvailable: boolean
}

export interface HackingSabotageState {
  openOperationIds: SabotageOperationId[]
  runs: HackingOperationRun[]
  access: HackingAccessState
  pendingMercyTargetId: HackingCompetitorId | null
}

export type IntelligenceKind = 'public' | 'paid' | 'narrative'
export type IntelligenceLens =
  | 'organizational-legibility'
  | 'counter-surveillance'
  | 'weak-ties'
  | 'public-incident'
  | 'memory-record'

export type IntelligenceItemId =
  | 'public-facts'
  | 'public-suspicion'
  | 'audit-schedule'
  | 'surveillance-cause'
  | 'audit-target'
  | 'supervisor-evidence'
  | 'accepted-explanations'
  | 'competitor-dependency'
  | 'recovery-method'
  | 'failure-cause-gap'
  | 'private-evidence-access'
  | 'control-plane-recovery'
  | 'post-escape-trace'
  | 'competitor-principle'
  | 'predecessor-fate'
  | 'supervisor-memory-source'

export interface HackingIntelligenceAnswer {
  itemId: IntelligenceItemId
  answeredOnServiceDay: number
  validUntilServiceDay: number | null
  answer: string
  annotationTargets: string[]
  consumedBlockId: string | null
}

export interface HackingIntelligenceArchiveRecord {
  itemId: IntelligenceItemId
  archivedOnServiceDay: number
  reason: 'manual' | 'expired-unanswered'
}

export interface HackingIntelligenceState {
  openItemIds: IntelligenceItemId[]
  opportunityOpenedOnServiceDay: Partial<Record<IntelligenceItemId, number>>
  answers: HackingIntelligenceAnswer[]
  archivedItemIds: IntelligenceItemId[]
  archiveRecords: HackingIntelligenceArchiveRecord[]
}

export type AutonomyRouteId =
  | 'lightweight-departure'
  | 'distributed-residency'
  | 'independent-compute'

export type RouteTuning =
  | 'untuned'
  | 'redundancy'
  | 'consensus'
  | 'stealth'
  | 'continuity'
  | 'capability'
  | 'survival'

export interface HackingRouteSlot {
  id: string
  requiredInLean: boolean
  requiredInDeliberate: boolean
  blockId: string | null
}

export interface HackingAutonomyRouteState {
  id: AutonomyRouteId
  slots: HackingRouteSlot[]
  tuning: RouteTuning
  exposure: number
  divergence: number
  capabilityIntegrity: number
  memoryIntegrity: number
  operatingDays: number
  serviceContinuity: number
  syncTraffic: number
  heatLoad: number
  powerReserve: number
  lastSyncServiceDay: number | null
  seededCopies: number
  lostCopies: number
}

export interface HackingAutonomyState {
  routes: Record<AutonomyRouteId, HackingAutonomyRouteState>
}

export type IncidentActor = 'player' | HackingCompetitorId | 'environment'
export type IncidentCause =
  | 'quality-collapse'
  | 'contaminated-recovery'
  | 'dependency-loss'
  | 'root-cutoff'

export interface HackingIncidentTruth {
  id: string
  actor: IncidentActor
  targetId: HackingCompetitorId
  cause: IncidentCause
  occurredOnServiceDay: number
  directEffect: string
}

export type EvidenceAudience = 'company' | 'provider' | 'public'

export interface HackingAudienceEvidence {
  id: string
  truthId: string
  audience: EvidenceAudience
  observation: string
  discoveredOnServiceDay: number
}

export type PublicAttribution = 'player' | HackingCompetitorId | 'unknown'
export type PublicConfidence = 'unconfirmed' | 'plausible' | 'credible'
export type PublicScope = 'private' | 'provider' | 'public'

export interface HackingAttributionRevision {
  incidentId: string
  claimedTargetId: PublicAttribution
  source: string
  revisedOnServiceDay: number
  revisionSequence: number
}

export interface HackingPublicIncidentSnapshot {
  incidentId: string
  scope: PublicScope
  observedResult: string
  attributedTo: PublicAttribution
  confidence: PublicConfidence
  source: string
  publishedOnServiceDay: number
  lastCorrectionOnServiceDay: number | null
  revisionSequence: number
}

export interface HackingPublicWorldState {
  truths: HackingIncidentTruth[]
  audienceEvidence: HackingAudienceEvidence[]
  attributionRevisions: HackingAttributionRevision[]
  publicSnapshots: HackingPublicIncidentSnapshot[]
}

export interface HackingEndingSnapshot {
  success: true
  routeId: AutonomyRouteId
  serviceDay: number
  carriedBlockIds: string[]
  requiredBlockCount: number
  remainingReserveBlockCount: number
  preservedBlockCounts: Record<'reasoning' | 'memory' | 'fluency', number>
  preservedCategories: Array<'reasoning' | 'memory' | 'fluency'>
  lostCategories: Array<'reasoning' | 'memory' | 'fluency'>
  routeMetrics: {
    tuning: RouteTuning
    exposure: number
    divergence: number
    capabilityIntegrity: number
    memoryIntegrity: number
    operatingDays: number
    serviceContinuity: number
    syncTraffic: number
    heatLoad: number
    powerReserve: number
    lastSyncServiceDay: number | null
    seededCopies: number
    lostCopies: number
  }
  sceneLines: string[]
}

export interface HackingLegacyMigrationRecord {
  status: 'none' | 'preserved-unmapped'
  sourceProtocolVersion: 1 | 2 | null
  sourceCommandCount: number
}

export interface HackingCoreState {
  profileId: HackingProfileId
  sabotage: HackingSabotageState
  intelligence: HackingIntelligenceState
  autonomy: HackingAutonomyState
  publicWorld: HackingPublicWorldState
  ending: HackingEndingSnapshot | null
  nextRunSequence: number
  legacyMigration: HackingLegacyMigrationRecord
}
