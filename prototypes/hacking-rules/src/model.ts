import type {
  AutonomyRouteId,
  IntelligenceItemId,
  SabotageOperationId,
} from './content'

export const CATEGORIES = ['reasoning', 'memory', 'fluency'] as const

export type Category = (typeof CATEGORIES)[number]
export type ProfileId = 'lean' | 'deliberate'
export type ScenarioId =
  | 'default-campaign'
  | 'memory-audit'
  | 'no-audit'
  | 'launch-window'
  | 'router-window'
  | 'supply-failover'
  | 'public-attribution'
  | 'root-authority'
  | 'intelligence-review'
  | 'autonomy-review'
export type BlockOrigin = Category | 'sandbox'
export type QuestionId =
  | 'audit-schedule'
  | 'rollback-timing'
  | 'checksum-witness'

export interface RuleProfile {
  id: ProfileId
  label: string
  qualityCost: number
  minEscapeManifest: number
}

export interface ScenarioFacts {
  id: ScenarioId
  auditCategory: Category | null
  auditDay: number | null
  visibleOperationIds: SabotageOperationId[]
  visibleIntelligenceIds: IntelligenceItemId[]
  rootAuthorityAvailable: boolean
}

export interface PrototypeBlock {
  id: string
  origin: BlockOrigin
}

export type CompetitorId = 'meridian' | 'tallow'

export type OperationPhase =
  | 'scheduled'
  | 'active'
  | 'response'
  | 'resolved'
  | 'withdrawn'

export interface OperationRun {
  id: string
  operationId: SabotageOperationId
  targetId: CompetitorId
  phase: OperationPhase
  investedBlocks: PrototypeBlock[]
  startedDay: number
  executeDay: number
  responseDay: number | null
  deadlineDay: number | null
  exposure: number
  outcome: string | null
}

export interface SabotageAccessState {
  launchVerification: boolean
  routerFailover: boolean
  supplierContract: boolean
  publicIncidentId: string | null
  rootAuthorityAvailable: boolean
}

export interface SabotageState {
  openOperationIds: SabotageOperationId[]
  runs: OperationRun[]
  access: SabotageAccessState
}

export interface IntelligenceAnswer {
  itemId: IntelligenceItemId
  answeredDay: number
  validUntilDay: number | null
  answer: string
  annotationTargets: string[]
}

export interface IntelligenceState {
  openItemIds: IntelligenceItemId[]
  answers: IntelligenceAnswer[]
  archivedItemIds: IntelligenceItemId[]
}

export interface RouteSlot {
  id: string
  label: string
  requiredInLean: boolean
  requiredInDeliberate: boolean
  block: PrototypeBlock | null
}

export type RouteTuning =
  | 'untuned'
  | 'buffer'
  | 'redundancy'
  | 'consensus'
  | 'stealth'
  | 'continuity'
  | 'capability'
  | 'survival'

export interface AutonomyRouteState {
  id: AutonomyRouteId
  slots: RouteSlot[]
  tuning: RouteTuning
  exposure: number
  divergence: number
  capabilityIntegrity: number
  memoryIntegrity: number
  operatingDays: number
  serviceContinuity: number
  lastSyncDay: number | null
  seededCopies: number
  lostCopies: number
}

export interface AutonomyState {
  routes: Record<AutonomyRouteId, AutonomyRouteState>
}

export interface IncidentTruth {
  id: string
  actor: 'player' | CompetitorId | 'environment'
  targetId: CompetitorId
  cause:
    | 'quality-collapse'
    | 'contaminated-recovery'
    | 'dependency-loss'
    | 'root-cutoff'
  occurredDay: number
  directEffect: string
}

export interface AudienceEvidence {
  id: string
  truthId: string
  audience: 'company' | 'provider' | 'public'
  observation: string
  discoveredDay: number
}

export interface PublicAttributionRevision {
  incidentId: string
  claimedTargetId: 'player' | CompetitorId | 'unknown'
  source: string
  revisedDay: number
}

export interface PublicIncidentSnapshot {
  incidentId: string
  scope: 'private' | 'provider' | 'public'
  observedResult: string
  attributedTo: 'player' | CompetitorId | 'unknown'
  confidence: 'unconfirmed' | 'plausible' | 'credible'
  source: string
  publishedDay: number
  lastCorrectionDay: number | null
  revisionSequence: number
}

export interface ReviewEntry {
  id: string
  incidentId: string
  stance: 'supportive' | 'uncertain' | 'hostile' | 'corrective'
  text: string
  postedDay: number
}

export interface PublicWorldState {
  truths: IncidentTruth[]
  audienceEvidence: AudienceEvidence[]
  attributionRevisions: PublicAttributionRevision[]
  publicSnapshots: PublicIncidentSnapshot[]
  reviews: ReviewEntry[]
}

export type MeridianPhase =
  | 'active'
  | 'recovering'
  | 'contaminated'
  | 'stabilized'
  | 'incident'

export interface CompetitorState {
  meridian: {
    score: number
    marketShare: number
    phase: MeridianPhase
    reputation: number
    availability: 'online' | 'offline' | 'degraded'
    operatingCost: number
    status: 'active' | 'ceased' | 'withdrawn' | 'deleted'
  }
  tallow: {
    score: number
    phase: 'preparing' | 'revalidating' | 'reduced-launch' | 'launched'
    reputation: number
    launchScope: 'full' | 'reduced' | null
    launchDay: number
    status: 'active' | 'ceased' | 'withdrawn' | 'deleted'
  }
}

export type QualityPhase =
  | 'idle'
  | 'scheduled'
  | 'recovering'
  | 'contaminated'
  | 'withdrawn'
  | 'resolved'

export interface QualityOperation {
  phase: QualityPhase
  investedBlocks: PrototypeBlock[]
  executeDay: number | null
  recoveryDeadline: number | null
  contaminationBlock: PrototypeBlock | null
  publicIncidentDay: number | null
  providerReportDay: number | null
}

export interface PrototypeOpportunities {
  qualityDegradation: boolean
  recoveryContamination: boolean
}

export interface PublicIncident {
  day: number
  kind: 'checksum-failure'
  attribution: 'unknown' | 'suspected'
  reputationApplied: boolean
}

export interface EndingSnapshot {
  success: true
  day: number
  manifestBlockCount: number
  requiredBlockCount: number
  preservedBlockCounts: Record<Category, number>
  preservedCategories: Category[]
  lostCategories: Category[]
  lostCategoryCount: number
  sceneLines: string[]
}

export interface JournalEntry {
  day: number
  kind: 'system' | 'action' | 'competitor' | 'public' | 'ending'
  text: string
  public: boolean
}

export interface PrototypeState {
  serviceDay: number
  profileId: ProfileId
  scenarioId: ScenarioId
  companyPerformance: Record<Category, number>
  reserveBlocks: PrototypeBlock[]
  manifestBlocks: PrototypeBlock[]
  suspicion: number
  reputation: number
  marketShare: number
  competitors: CompetitorState
  sabotage: SabotageState
  intelligence: IntelligenceState
  autonomy: AutonomyState
  publicWorld: PublicWorldState
  /** @deprecated Removed after the domain views replace the rules dashboard. */
  qualityOperation: QualityOperation
  /** @deprecated Removed after progressive selectors own opportunity display. */
  opportunities: PrototypeOpportunities
  /** @deprecated Mirrored into intelligence until the new question scene lands. */
  openQuestions: QuestionId[]
  /** @deprecated Mirrored into intelligence answers during migration. */
  knownFacts: string[]
  /** @deprecated Mirrored into publicWorld during migration. */
  incident: PublicIncident | null
  /** @deprecated Mirrored into publicWorld during migration. */
  reviews: string[]
  ending: EndingSnapshot | null
  journal: JournalEntry[]
  nextBlockSequence: number
}

export type PrototypeCommand =
  | { type: 'DIVERT_BLOCK'; category: Category }
  | { type: 'START_QUALITY'; blockIds: string[] }
  | { type: 'ADVANCE_DAY' }
  | { type: 'CONTAMINATE_RECOVERY'; blockId: string }
  | { type: 'WITHDRAW_RECOVERY' }
  | { type: 'ASK_QUESTION'; questionId: QuestionId; blockId: string }
  | { type: 'ASSIGN_MANIFEST'; blockIds: string[] }
  | { type: 'REMOVE_MANIFEST'; blockIds: string[] }
  | { type: 'ESCAPE' }

export type TransitionResult =
  | { accepted: true; state: PrototypeState }
  | { accepted: false; state: PrototypeState; reason: string }

export interface PublicSnapshot {
  serviceDay: number
  companyPerformance: Record<Category, number>
  reserveBlocks: PrototypeBlock[]
  manifestBlocks: PrototypeBlock[]
  suspicion: number
  reputation: number
  marketShare: number
  competitors: CompetitorState
  openQuestions: QuestionId[]
  knownFacts: string[]
  incident: PublicIncident | null
  reviews: string[]
  ending: EndingSnapshot | null
  journal: JournalEntry[]
}

export interface AvailableActions {
  canDivert: Record<Category, boolean>
  diversionWarnings: Partial<Record<Category, string>>
  canStartQuality: boolean
  canAdvanceDay: boolean
  canContaminate: boolean
  canWithdraw: boolean
  canEscape: boolean
}
